import AppKit
import WebKit

/// The presenter's window: the presenter page, the same as the website's, in a
/// web view. It goes fullscreen as Présentation.app's windows do: its view
/// takes over its screen at once, with no animation and no new Space.
@MainActor
final class Presenter: NSObject, WKNavigationDelegate, WKUIDelegate, NSWindowDelegate {
    let window: NSWindow
    let web: WKWebView
    /// Fullscreen or the screens changed.
    var onChange: () -> Void = {}
    private var title: NSKeyValueObservation?
    /// Where the page's files came from, by name, to find a PDF's notes beside it.
    private var paths: [String: URL] = [:]

    init(scheme: PageScheme, bridge: Bridge) {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(scheme, forURLScheme: PageScheme.scheme)
        config.userContentController.addScriptMessageHandler(bridge, contentWorld: .page, name: "pdfpcnic")
        let view = DropWebView(frame: .zero, configuration: config)
        web = view
        let area = (NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let size = NSSize(width: (area.width * 0.85).rounded(), height: (area.height * 0.85).rounded())
        window = NSWindow(
            contentRect: NSRect(x: area.midX - size.width / 2, y: area.midY - size.height / 2, width: size.width, height: size.height),
            styleMask: [.titled, .closable, .miniaturizable, .resizable],
            backing: .buffered,
            defer: false
        )
        super.init()
        view.dropped = { [weak self] urls in self?.remember(urls) }
        window.title = "pdfpcnic"
        window.appearance = NSAppearance(named: .darkAqua)
        window.backgroundColor = .black
        window.isReleasedWhenClosed = false
        window.contentView = web
        window.delegate = self
        window.setFrameAutosaveName("presenter")
        web.navigationDelegate = self
        web.uiDelegate = self
        web.load(URLRequest(url: PageScheme.home))
        // The deck's name, as the page titles itself.
        title = web.observe(\.title, options: [.new]) { [weak self] web, _ in
            Task { @MainActor in self?.window.title = web.title.flatMap { $0.isEmpty ? nil : $0 } ?? "pdfpcnic" }
        }
        window.makeKeyAndOrderFront(nil)
        NotificationCenter.default.addObserver(forName: NSApplication.didChangeScreenParametersNotification, object: nil, queue: .main) { [weak self] _ in
            Task { @MainActor in self?.onChange() }
        }
    }

    var fullscreen: Bool { web.isInFullScreenMode }

    /// The screen the presenter is on.
    var screen: NSScreen? { web.window?.screen ?? window.screen }

    /// What the page's window port reports.
    var state: [String: Any] { ["fullscreen": fullscreen, "extended": NSScreen.screens.count > 1] }

    func setFullscreen(_ on: Bool) {
        guard on != fullscreen else { return }
        if on {
            web.enterFullScreenMode(window.screen ?? NSScreen.screens[0], withOptions: [.fullScreenModeAllScreens: false])
        } else {
            web.exitFullScreenMode(options: nil)
        }
        web.window?.makeFirstResponder(web)
        onChange()
    }

    /// Tells the page something happened: `window.pdfpcnicMac.emit(name, data)`.
    func emit(_ name: String, _ data: Any) {
        guard let json = try? JSONSerialization.data(withJSONObject: [name, data], options: [.fragmentsAllowed]),
              let args = String(data: json, encoding: .utf8) else { return }
        web.evaluateJavaScript("window.pdfpcnicMac?.emit(...\(args))", completionHandler: nil)
    }

    // The page stays; links leave for the browser.

    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        guard let url = action.request.url, url.scheme != PageScheme.scheme else { return decisionHandler(.allow) }
        Self.openOutside(url)
        decisionHandler(.cancel)
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { Self.openOutside(url) }
        return nil
    }

    /// Web and mail links only: a PDF's link can't run anything else.
    private static func openOutside(_ url: URL) {
        if ["http", "https", "mailto"].contains(url.scheme?.lowercased() ?? "") { NSWorkspace.shared.open(url) }
    }

    /// The page's "choose files".
    func webView(_ webView: WKWebView, runOpenPanelWith parameters: WKOpenPanelParameters, initiatedByFrame frame: WKFrameInfo, completionHandler: @escaping ([URL]?) -> Void) {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = parameters.allowsMultipleSelection
        panel.beginSheetModal(for: window) { [weak self] response in
            if response == .OK { self?.remember(panel.urls) }
            completionHandler(response == .OK ? panel.urls : nil)
        }
    }

    /// Where files the page is given come from: opened, chosen or dropped.
    func remember(_ urls: [URL]) {
        for url in urls { paths[url.lastPathComponent] = url }
    }

    /// A PDF's notes, as pdfpc finds them: the .pdfpc file of the same name beside it.
    func notes(of name: String) -> String? {
        guard let pdf = paths[name] else { return nil }
        return try? String(contentsOf: pdf.deletingPathExtension().appendingPathExtension("pdfpc"), encoding: .utf8)
    }

    /// If the page's process ever dies, it comes back; Resume picks up the talk.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        webView.reload()
    }

    func windowWillClose(_ notification: Notification) {
        NSApp.terminate(nil)
    }
}

/// The presenter's web view. It notes where dropped files come from, then lets
/// the page have them as it would anyway.
final class DropWebView: WKWebView {
    var dropped: ([URL]) -> Void = { _ in }

    override func performDragOperation(_ sender: NSDraggingInfo) -> Bool {
        dropped(sender.draggingPasteboard.readObjects(forClasses: [NSURL.self], options: [.urlReadingFileURLsOnly: true]) as? [URL] ?? [])
        return super.performDragOperation(sender)
    }
}
