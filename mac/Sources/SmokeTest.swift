import AppKit
import WebKit

/// `pdfpcnic --smoke-test deck.pdf deck.pdfpc out/ pdfpcnic-mac.zip`, for CI.
/// It opens the deck as the Finder would, with the audience window behind the
/// presenter, steps through it, makes the audience fullscreen, checks that both
/// windows drew the slide, installs the zip as an update would, reloads to
/// check the talk resumes, saves screenshots, and quits: status 1 if anything failed.
@MainActor
final class SmokeTest {
    private let files: [URL]
    private let out: URL
    /// The app's zip, as a release carries it.
    private let zip: URL
    private var failed = 0

    init?(arguments: [String]) {
        guard let i = arguments.firstIndex(of: "--smoke-test"), arguments.count > i + 4 else { return nil }
        files = [URL(fileURLWithPath: arguments[i + 1]), URL(fileURLWithPath: arguments[i + 2])]
        out = URL(fileURLWithPath: arguments[i + 3], isDirectory: true)
        zip = URL(fileURLWithPath: arguments[i + 4])
    }

    func run(_ app: App) async {
        try? FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)
        let web = app.presenter.web
        func js(_ body: String) async throws -> Any? {
            try await web.callAsyncJavaScript(body, arguments: [:], in: nil, contentWorld: .page)
        }
        func until(_ what: String, seconds: Double = 20, _ test: () async throws -> Bool) async throws {
            let end = Date().addingTimeInterval(seconds)
            while Date() < end {
                if (try? await test()) == true { return }
                try await Task.sleep(nanoseconds: 100_000_000)
            }
            throw Failure("waited \(Int(seconds)) s for \(what)")
        }
        func press(_ key: String, shift: Bool = false) async throws {
            _ = try await js("window.dispatchEvent(new KeyboardEvent('keydown', { key: '\(key)', shiftKey: \(shift) })); return null")
        }
        func page() async throws -> Int { try await js("return window.pdfpcnic.state?.page ?? -1") as? Int ?? -1 }
        func check(_ name: String, _ body: () async throws -> Void) async {
            do {
                try await body()
                print("  ok  \(name)")
            } catch {
                failed += 1
                print("FAIL  \(name): \(error.localizedDescription)")
            }
        }

        await check("the presenter page loads") {
            try await until("the page") { try await js("return !!window.pdfpcnic") as? Bool == true }
        }
        app.open(files)
        await check("the deck opens as from the Finder, with its notes, and PDFKit draws the slides") {
            try await until("the deck") { (try await js("return window.pdfpcnic.deck?.slides.length ?? 0") as? Int ?? 0) > 0 }
            try await until("the notes") { (try await js("return document.querySelector('#notes-body').textContent.length") as? Int ?? 0) > 20 }
            try await until("the current slide drawn") { try await js(Self.painted("#current canvas")) as? Bool == true }
            try await until("the thumbnails drawn") { try await js(Self.painted("#strip li canvas")) as? Bool == true }
        }
        await check("the audience window opens with the deck, behind the presenter, and Quartz draws the slide in it") {
            try await until("the audience window") { app.audience.view.window != nil }
            let windows = NSApp.orderedWindows
            guard let audience = windows.firstIndex(where: { $0 === app.audience.view.window }),
                  let presenter = windows.firstIndex(where: { $0 === app.presenter.window }), presenter < audience
            else { throw Failure("it isn't behind the presenter") }
            try await until("the slide in it") { Self.painted(app.audience.view) }
            try await until("the guide's next step") {
                (try await js("return document.querySelector('#audience-button').textContent") as? String ?? "").hasPrefix("Audience fullscreen on")
            }
        }
        await check("keys step through the slides") {
            try await press("ArrowRight")
            try await until("page 2") { try await page() == 1 }
        }
        await check("Shift+W makes the audience fullscreen, and the presenter knows") {
            try await press("W", shift: true)
            try await until("fullscreen") { app.audience.view.isInFullScreenMode }
            try await until("the status line") {
                (try await js("return document.querySelector('#audience-status').textContent") as? String ?? "").hasPrefix("Audience fullscreen")
            }
            try await until("the slide, fullscreen") { Self.painted(app.audience.view) }
        }
        await check("black covers the audience, and comes back") {
            try await press("b")
            try await until("black") { !Self.painted(app.audience.view) }
            try await press("b")
            try await until("the slide again") { Self.painted(app.audience.view) }
        }
        await check("screenshots of both windows") {
            try Self.save(app.audience.view, to: out.appendingPathComponent("audience.png"))
            try await Self.save(web, to: out.appendingPathComponent("presenter.png"))
        }
        await check("w makes the presenter fullscreen, and back") {
            try await press("w")
            try await until("fullscreen") { app.presenter.fullscreen }
            try await press("w")
            try await until("windowed") { !app.presenter.fullscreen }
        }
        await check("GitHub says which release is the latest") {
            let latest = try await Updates.latest()
            guard latest.split(separator: ".").count == 3 else { throw Failure("it said \"\(latest)\"") }
        }
        await check("a release's zip goes in place of the app, wherever it is") {
            let older = FileManager.default.temporaryDirectory.appendingPathComponent("pdfpcnic-smoke/Anywhere/pdfpcnic.app")
            try? FileManager.default.removeItem(at: older.deletingLastPathComponent())
            try FileManager.default.createDirectory(at: older.appendingPathComponent("Contents"), withIntermediateDirectories: true)
            try Data("an older app".utf8).write(to: older.appendingPathComponent("Contents/old"))
            try await Updates.install(Data(contentsOf: zip), over: older)
            let version = NSDictionary(contentsOf: older.appendingPathComponent("Contents/Info.plist"))?["CFBundleShortVersionString"] as? String
            guard version == Updates.version, !FileManager.default.fileExists(atPath: older.appendingPathComponent("Contents/old").path) else {
                throw Failure("the app there is \(version ?? "not the release's")")
            }
        }
        await check("after a reload, Resume picks up the talk at its page") {
            try await Task.sleep(nanoseconds: 800_000_000)
            web.reload()
            try await until("the Resume button") {
                (try await js("return document.querySelector('#resume:not([hidden])')?.textContent ?? ''") as? String ?? "").contains("at page 2")
            }
            _ = try await js("document.querySelector('#resume').click(); return null")
            try await until("page 2") { try await page() == 1 }
        }
        print(failed == 0 ? "all checks passed (mac)" : "\(failed) checks failed (mac)")
        exit(failed == 0 ? 0 : 1)
    }

    /// Whether a canvas on the page shows something, not one flat color (as scripts/e2e.mjs checks).
    private static func painted(_ selector: String) -> String {
        """
        const c = document.querySelector("\(selector)");
        if (!c || !c.width) return false;
        const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
        let lo = 255, hi = 0;
        for (let i = 0; i < d.length; i += 4 * 97) { lo = Math.min(lo, d[i]); hi = Math.max(hi, d[i]); }
        return hi - lo > 40;
        """
    }

    /// Whether a view shows something, not one flat color.
    private static func painted(_ view: NSView) -> Bool {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { return false }
        view.cacheDisplay(in: view.bounds, to: rep)
        var lo = 255, hi = 0
        for y in stride(from: 0, to: rep.pixelsHigh, by: 7) {
            for x in stride(from: 0, to: rep.pixelsWide, by: 7) {
                let red = Int(((rep.colorAt(x: x, y: y)?.usingColorSpace(.sRGB)?.redComponent) ?? 0) * 255)
                lo = min(lo, red)
                hi = max(hi, red)
            }
        }
        return hi - lo > 40
    }

    private static func save(_ view: NSView, to file: URL) throws {
        guard let rep = view.bitmapImageRepForCachingDisplay(in: view.bounds) else { throw Failure("no picture of the audience") }
        view.cacheDisplay(in: view.bounds, to: rep)
        try rep.representation(using: .png, properties: [:])?.write(to: file)
    }

    private static func save(_ web: WKWebView, to file: URL) async throws {
        let image: NSImage = try await withCheckedThrowingContinuation { done in
            web.takeSnapshot(with: nil) { image, error in
                if let image { done.resume(returning: image) } else { done.resume(throwing: error ?? Failure("no picture of the presenter")) }
            }
        }
        guard let tiff = image.tiffRepresentation, let png = NSBitmapImageRep(data: tiff)?.representation(using: .png, properties: [:]) else {
            throw Failure("the presenter's picture couldn't be saved")
        }
        try png.write(to: file)
    }
}
