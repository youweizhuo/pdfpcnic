import Foundation
import PDFKit

/// The PDFs the page has opened, by id: PDFKit reads what each page holds,
/// and Quartz draws them, as Preview does.
final class Documents {
    /// A link on a page: its box in fractions of the page from its top left, and where it leads, as the page reads it.
    struct Link {
        let rect: CGRect
        let to: [String: Any]

        var json: [String: Any] {
            ["x": Double(rect.minX), "y": Double(rect.minY), "width": Double(rect.width), "height": Double(rect.height), "to": to]
        }
    }

    final class Doc {
        /// For drawing on the main thread: the audience window.
        let cg: CGPDFDocument
        /// For drawing pictures for the page, off the main thread.
        let background: CGPDFDocument
        /// Each page's links, for clicks in the audience window.
        let links: [[Link]]

        init(cg: CGPDFDocument, background: CGPDFDocument, links: [[Link]]) {
            self.cg = cg
            self.background = background
            self.links = links
        }
    }

    private var docs: [Int: Doc] = [:]
    private var nextID = 1
    private let queue = DispatchQueue(label: "pdfpcnic.pictures", qos: .userInitiated)

    subscript(id: Int) -> Doc? { docs[id] }

    /// Opens a PDF; answers with its id, what each page holds (core/deck.ts's PageInfo) and the top of its
    /// outline (OutlineEntry).
    func open(_ data: Data) throws -> [String: Any] {
        guard let pdf = PDFDocument(data: data),
              let provider = CGDataProvider(data: data as CFData), let cg = CGPDFDocument(provider),
              let other = CGDataProvider(data: data as CFData), let background = CGPDFDocument(other)
        else { throw Failure("This file can't be opened as a PDF.") }
        if pdf.isLocked { throw Failure("This PDF is locked with a password.") }
        var pages: [[String: Any]] = []
        var links: [[Link]] = []
        for i in 0..<pdf.pageCount {
            guard let page = pdf.page(at: i), let cgPage = cg.page(at: i + 1) else { throw Failure("Page \(i + 1) of this PDF can't be read.") }
            let box = PageBox(cgPage)
            let own = page.annotations.compactMap { Self.link($0, in: pdf, box: box) }
            links.append(own)
            pages.append([
                "width": Double(box.size.width),
                "height": Double(box.size.height),
                "label": page.label.map { $0 as Any } ?? NSNull(),
                "note": Self.note(page),
                "links": own.map(\.json),
            ])
        }
        let id = nextID
        nextID += 1
        docs[id] = Doc(cg: cg, background: background, links: links)
        return ["id": id, "pages": pages, "outline": Self.outline(pdf)]
    }

    func close(_ id: Int) {
        docs[id] = nil
    }

    /// A picture of a page `width` pixels wide, for the page's PageCache: its
    /// width and height, then raw RGBA rows, so nothing is encoded or decoded.
    func picture(_ id: Int, page: Int, width: Int, done: @escaping (Data?) -> Void) {
        guard let doc = docs[id] else { return done(nil) }
        let pdf = doc.background
        queue.async {
            let data = pdf.page(at: page + 1).flatMap { Self.picture(of: $0, width: width) }
            DispatchQueue.main.async { done(data) }
        }
    }

    private static func picture(of page: CGPDFPage, width: Int) -> Data? {
        let box = PageBox(page)
        let w = max(1, min(width, 8192))
        let h = max(1, Int((CGFloat(w) * box.size.height / box.size.width).rounded()))
        var data = Data(count: 8 + w * h * 4)
        let drawn = data.withUnsafeMutableBytes { (raw: UnsafeMutableRawBufferPointer) -> Bool in
            guard let base = raw.baseAddress,
                  let ctx = CGContext(
                      data: base + 8, width: w, height: h, bitsPerComponent: 8, bytesPerRow: w * 4,
                      space: CGColorSpace(name: CGColorSpace.sRGB)!,
                      bitmapInfo: CGImageAlphaInfo.premultipliedLast.rawValue | CGBitmapInfo.byteOrder32Big.rawValue
                  )
            else { return false }
            base.storeBytes(of: UInt32(w).littleEndian, as: UInt32.self)
            base.storeBytes(of: UInt32(h).littleEndian, toByteOffset: 4, as: UInt32.self)
            // Text as macOS draws it on screen.
            ctx.setAllowsFontSmoothing(true)
            ctx.setShouldSmoothFonts(true)
            box.draw(page, in: CGRect(x: 0, y: 0, width: w, height: h), of: ctx)
            return true
        }
        return drawn ? data : nil
    }

    private static let noteTypes: Set<String> = ["Text", "FreeText", "Highlight", "Underline", "Squiggly"]

    /// The top level of the outline (the bookmarks), with the page each entry opens.
    private static func outline(_ pdf: PDFDocument) -> [[String: Any]] {
        guard let root = pdf.outlineRoot else { return [] }
        return (0..<root.numberOfChildren).compactMap { i -> [String: Any]? in
            guard let entry = root.child(at: i), let page = entry.destination?.page else { return nil }
            return ["title": entry.label ?? "", "page": pdf.index(for: page)]
        }
    }

    /// Text of a page's note annotations, the types pdfpc imports as notes.
    private static func note(_ page: PDFPage) -> String {
        page.annotations
            .filter { noteTypes.contains($0.type ?? "") }
            .compactMap { $0.contents?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .joined(separator: "\n")
    }

    /// A link, where it leads as pdf.js reads it: a web link first, then a named action, then a page.
    private static func link(_ a: PDFAnnotation, in pdf: PDFDocument, box: PageBox) -> Link? {
        guard a.type == "Link" else { return nil }
        let to: [String: Any]
        if let url = a.url ?? (a.action as? PDFActionURL)?.url {
            guard ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") else { return nil }
            to = ["url": url.absoluteString]
        } else if let named = a.action as? PDFActionNamed, let action = Self.named(named.name) {
            to = ["action": action]
        } else if let page = (a.destination ?? (a.action as? PDFActionGoTo)?.destination)?.page {
            to = ["page": pdf.index(for: page)]
        } else {
            return nil
        }
        let r = a.bounds.applying(box.upright)
        let s = box.size
        return Link(rect: CGRect(x: r.minX / s.width, y: 1 - r.maxY / s.height, width: r.width / s.width, height: r.height / s.height), to: to)
    }

    private static func named(_ name: PDFActionNamedName) -> String? {
        switch name {
        case .nextPage: return "NextPage"
        case .previousPage: return "PrevPage"
        case .firstPage: return "FirstPage"
        case .lastPage: return "LastPage"
        case .goBack: return "GoBack"
        case .goForward: return "GoForward"
        default: return nil
        }
    }
}

/// A page as it shows: its crop box, turned by its rotation.
struct PageBox {
    let box: CGRect
    let rotation: Int

    init(_ page: CGPDFPage) {
        box = page.getBoxRect(.cropBox)
        rotation = ((Int(page.rotationAngle) % 360) + 360) % 360
    }

    /// Its size upright, in points.
    var size: CGSize { rotation % 180 == 0 ? box.size : CGSize(width: box.height, height: box.width) }

    /// From the page's own space to its upright size, origin at the bottom left.
    var upright: CGAffineTransform {
        let w = box.width, h = box.height
        let turn: CGAffineTransform
        switch rotation {
        case 90: turn = CGAffineTransform(a: 0, b: -1, c: 1, d: 0, tx: 0, ty: w)
        case 180: turn = CGAffineTransform(a: -1, b: 0, c: 0, d: -1, tx: w, ty: h)
        case 270: turn = CGAffineTransform(a: 0, b: 1, c: -1, d: 0, tx: h, ty: 0)
        default: turn = .identity
        }
        return CGAffineTransform(translationX: -box.minX, y: -box.minY).concatenating(turn)
    }

    /// Draws the page filling `rect`, on white. Its annotations stay off, as in
    /// pdfpc: notes are the presenter's, and links are the page's to show.
    func draw(_ page: CGPDFPage, in rect: CGRect, of ctx: CGContext) {
        ctx.saveGState()
        ctx.setFillColor(CGColor(gray: 1, alpha: 1))
        ctx.fill(rect)
        ctx.translateBy(x: rect.minX, y: rect.minY)
        ctx.scaleBy(x: rect.width / size.width, y: rect.height / size.height)
        ctx.concatenate(upright)
        ctx.clip(to: box)
        ctx.interpolationQuality = .high
        ctx.drawPDFPage(page)
        ctx.restoreGState()
    }
}
