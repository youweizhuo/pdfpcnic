import WebKit

/// Serves the presenter page at pdfpcnic://app/, and what it fetches from the
/// app there: pictures of pages (`page?doc=&page=&width=`), and the files
/// opened from the Finder (`opened/0`, `opened/1`…).
@MainActor
final class PageScheme: NSObject, WKURLSchemeHandler {
    static let scheme = "pdfpcnic"
    static let home = URL(string: "pdfpcnic://app/index.html")!

    private let page: URL
    private let pdfs: Documents
    /// The bytes of the files last opened from the Finder.
    var opened: [Data] = []
    /// Requests the page gave up on: they get no answer.
    private var stopped = Set<ObjectIdentifier>()

    init(page: URL, pdfs: Documents) {
        self.page = page
        self.pdfs = pdfs
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        guard let url = task.request.url else { return }
        let query = Dictionary(
            (URLComponents(url: url, resolvingAgainstBaseURL: false)?.queryItems ?? []).map { ($0.name, Int($0.value ?? "") ?? 0) },
            uniquingKeysWith: { _, last in last }
        )
        switch url.path {
        case "/", "/index.html":
            reply(task, try? Data(contentsOf: page), type: "text/html")
        case "/page":
            pdfs.picture(query["doc"] ?? 0, page: query["page"] ?? 0, width: query["width"] ?? 0) { [weak self] data in
                self?.reply(task, data, type: "application/octet-stream")
            }
        case let path where path.hasPrefix("/opened/"):
            let i = Int(path.dropFirst("/opened/".count)) ?? -1
            reply(task, opened.indices.contains(i) ? opened[i] : nil, type: "application/octet-stream")
        default:
            reply(task, nil, type: "text/plain")
        }
    }

    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {
        stopped.insert(ObjectIdentifier(task))
    }

    private func reply(_ task: WKURLSchemeTask, _ data: Data?, type: String) {
        guard stopped.remove(ObjectIdentifier(task)) == nil, let url = task.request.url else { return }
        let headers = ["Content-Type": type, "Cache-Control": "no-store"]
        task.didReceive(HTTPURLResponse(url: url, statusCode: data == nil ? 404 : 200, httpVersion: "HTTP/1.1", headerFields: headers)!)
        if let data { task.didReceive(data) }
        task.didFinish()
    }
}
