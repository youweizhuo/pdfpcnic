import AppKit

/// pdfpcnic for the Mac: the presenter page, the same as the website's, in a
/// native window, with a native audience window and PDFKit underneath. The
/// page calls the app through the bridge; this wires each call to its part.
@main
@MainActor
final class App: NSObject, NSApplicationDelegate {
    static func main() {
        setvbuf(stdout, nil, _IOLBF, 0)
        let app = NSApplication.shared
        let delegate = App()
        app.delegate = delegate
        app.setActivationPolicy(.regular)
        app.run()
    }

    let pdfs = Documents()
    let bridge = Bridge()
    let audience = Audience()
    let scheme: PageScheme
    private(set) var presenter: Presenter!
    /// Files to hand to the page once it's ready for them.
    private var waiting: [URL] = []
    private var ready = false

    override init() {
        scheme = PageScheme(pdfs: pdfs)
        super.init()
    }

    func applicationDidFinishLaunching(_ notification: Notification) {
        NSApp.mainMenu = menu()
        presenter = Presenter(scheme: scheme, bridge: bridge)
        wire()
        NSApp.activate(ignoringOtherApps: true)
        if let smoke = SmokeTest(arguments: CommandLine.arguments) {
            Task { await smoke.run(self) }
        } else {
            Task {
                try? await Task.sleep(nanoseconds: 5_000_000_000)
                await Updates.check(quietly: true)
            }
        }
    }

    func application(_ sender: NSApplication, open urls: [URL]) {
        open(urls)
    }

    func applicationShouldTerminateAfterLastWindowClosed(_ sender: NSApplication) -> Bool {
        true
    }

    /// Files opened from the Finder or File > Open: the page gets their names, and fetches their bytes from the app.
    func open(_ urls: [URL]) {
        waiting += urls
        guard ready, !waiting.isEmpty else { return }
        let files = waiting.compactMap { url in (try? Data(contentsOf: url)).map { (url.lastPathComponent, $0) } }
        waiting = []
        scheme.opened = files.map(\.1)
        presenter.emit("open", files.map { ["name": $0.0] })
    }

    /// Each of the page's calls, to the part that answers it.
    private func wire() {
        audience.presenter = { [unowned self] in presenter.web.window }
        audience.emit = { [unowned self] name, data in presenter.emit(name, data) }
        presenter.onChange = { [unowned self] in
            presenter.emit("window", presenter.state)
            audience.changed()
        }
        bridge.on("ready") { [unowned self] _ in
            ready = true
            presenter.onChange()
            open([])
            return nil
        }
        bridge.on("openPdf") { [unowned self] args in
            guard let text = args["data"] as? String, let data = Data(base64Encoded: text) else {
                throw Failure("The PDF didn't reach the app.")
            }
            return try pdfs.open(data)
        }
        bridge.on("closePdf") { [unowned self] args in
            pdfs.close(args.int("id"))
            return nil
        }
        bridge.on("audienceShow") { [unowned self] args in
            audience.show(pdfs[args.int("doc")])
            return nil
        }
        bridge.on("audienceOpen") { [unowned self] args in
            audience.open(behind: args.bool("behind"))
            return nil
        }
        bridge.on("audienceFullscreen") { [unowned self] _ in
            audience.toggleFullscreen()
            return nil
        }
        bridge.on("audienceRender") { [unowned self] args in
            let laser = (args["laser"] as? [String: Any]).map { CGPoint(x: $0.double("x"), y: $0.double("y")) }
            audience.render(page: args.int("page"), black: args.bool("black"), laser: laser, size: args.double("laserSize"))
            return nil
        }
        bridge.on("presenterFullscreen") { [unowned self] args in
            presenter.setFullscreen(args.bool("on"))
            return nil
        }
    }

    // The menus

    private func menu() -> NSMenu {
        let bar = NSMenu()
        func add(_ title: String, _ items: [NSMenuItem]) -> NSMenu {
            let menu = NSMenu(title: title)
            for item in items { menu.addItem(item) }
            let item = NSMenuItem()
            item.submenu = menu
            bar.addItem(item)
            return menu
        }
        func item(_ title: String, _ action: Selector, _ key: String = "", mine: Bool = false) -> NSMenuItem {
            let item = NSMenuItem(title: title, action: action, keyEquivalent: key)
            if mine { item.target = self }
            return item
        }
        _ = add("pdfpcnic", [
            item("About pdfpcnic", #selector(NSApplication.orderFrontStandardAboutPanel(_:))),
            item("Check for Updates…", #selector(checkForUpdates), mine: true),
            .separator(),
            item("Hide pdfpcnic", #selector(NSApplication.hide(_:)), "h"),
            item("Quit pdfpcnic", #selector(NSApplication.terminate(_:)), "q"),
        ])
        _ = add("File", [
            item("Open…", #selector(openDocument), "o", mine: true),
            item("Close Window", #selector(closeWindow), "w", mine: true),
        ])
        _ = add("Edit", [
            item("Cut", #selector(NSText.cut(_:)), "x"),
            item("Copy", #selector(NSText.copy(_:)), "c"),
            item("Paste", #selector(NSText.paste(_:)), "v"),
            item("Select All", #selector(NSText.selectAll(_:)), "a"),
        ])
        NSApp.windowsMenu = add("Window", [item("Minimize", #selector(NSWindow.performMiniaturize(_:)), "m")])
        _ = add("Help", [
            item("pdfpcnic on GitHub", #selector(openHelp), mine: true),
            item("Licenses", #selector(openLicenses), mine: true),
        ])
        return bar
    }

    @objc private func openDocument() {
        let panel = NSOpenPanel()
        panel.allowsMultipleSelection = true
        panel.begin { [unowned self] response in
            if response == .OK { open(panel.urls) }
        }
    }

    @objc private func closeWindow() {
        let key = NSApp.keyWindow
        if key != nil, key === audience.view.window { audience.close() } else { presenter.window.performClose(nil) }
    }

    @objc private func checkForUpdates() {
        Task { await Updates.check(quietly: false) }
    }

    @objc private func openHelp() {
        NSWorkspace.shared.open(URL(string: "https://github.com/youweizhuo/pdfpcnic#readme")!)
    }

    @objc private func openLicenses() {
        if let url = Bundle.main.url(forResource: "licenses", withExtension: "txt") { NSWorkspace.shared.open(url) }
    }
}
