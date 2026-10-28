import AppKit

/// The audience's window: frameless, one slide, drawn by Quartz. Shift+W
/// puts it fullscreen on the projector, as Présentation.app does: its view
/// takes over that screen at once, with no animation and no new Space.
@MainActor
final class Audience: NSObject, NSWindowDelegate {
    /// Tells the page: the window's status, and keys, clicks and links in it.
    var emit: (String, Any) -> Void = { _, _ in }
    /// The presenter's window, fullscreen or not: the audience opens behind it,
    /// goes fullscreen off its screen, and gives the keyboard back to it.
    var presenter: () -> NSWindow? = { nil }
    let view = SlideView()
    private var window: AudienceWindow?
    /// The screen it's fullscreen on.
    private var fullscreenOn: NSScreen?

    override init() {
        super.init()
        view.events = { [unowned self] name, data in
            switch name {
            case "fullscreen": toggleFullscreen()
            default: emit(name, data)
            }
        }
    }

    private var isFullscreen: Bool { view.isInFullScreenMode }

    /// What the page's guide reads (core/guide.ts's AudienceStatus). The app can always place it: `remote`.
    var status: [String: Any] {
        let screen = window == nil ? nil : isFullscreen ? fullscreenOn : destination()
        return [
            "mode": window == nil ? "closed" : isFullscreen ? "fullscreen" : "window",
            "screen": screen.map { $0.localizedName as Any } ?? NSNull(),
            "remote": true,
            "refused": false,
        ]
    }

    func changed() {
        emit("audience", status)
    }

    func show(_ doc: Documents.Doc?) {
        view.doc = doc
    }

    func render(page: Int, black: Bool, laser: CGPoint?, size: Double) {
        view.page = page
        view.black = black
        view.laser = laser
        view.laserSize = CGFloat(size)
        view.redraw()
    }

    /// Opens it on the presenter's screen, or brings it forward. `behind`, as a
    /// deck opens: behind the presenter, and left as it is if it's open.
    func open(behind: Bool = false) {
        if let window {
            if !behind { window.makeKeyAndOrderFront(nil) }
            return
        }
        let area = (presenter()?.screen ?? NSScreen.main ?? NSScreen.screens[0]).visibleFrame
        let width = (area.width * 0.6).rounded()
        let height = (width * 9 / 16).rounded()
        let window = AudienceWindow(
            contentRect: NSRect(x: area.midX - width / 2, y: area.midY - height / 2, width: width, height: height),
            styleMask: [.borderless, .resizable],
            backing: .buffered,
            defer: false
        )
        window.title = "Audience"
        window.backgroundColor = .black
        window.isReleasedWhenClosed = false
        window.delegate = self
        window.contentView = view
        window.makeFirstResponder(view)
        if behind, let front = presenter() {
            window.order(.below, relativeTo: front.windowNumber)
        } else {
            window.makeKeyAndOrderFront(nil)
        }
        self.window = window
        view.hint()
        changed()
    }

    func toggleFullscreen() {
        guard let window else { return }
        if isFullscreen {
            view.exitFullScreenMode(options: nil)
            // Out of fullscreen, it stays on the screen it was on, not behind the presenter.
            if let screen = fullscreenOn {
                let area = screen.visibleFrame
                let size = window.frame.size
                window.setFrameOrigin(NSPoint(x: area.midX - size.width / 2, y: area.midY - size.height / 2))
            }
            fullscreenOn = nil
            window.orderFront(nil)
            window.makeFirstResponder(view)
        } else {
            guard let screen = destination() else { return }
            fullscreenOn = screen
            view.enterFullScreenMode(screen, withOptions: [.fullScreenModeAllScreens: false])
            // Its own window, left behind empty, would cover part of the presenter's screen.
            window.orderOut(nil)
            view.window?.makeFirstResponder(view)
        }
        // As in Présentation.app, keys go on to the presenter's window. Pressed
        // in the audience window, they reach the talk too.
        presenter()?.makeKeyAndOrderFront(nil)
        view.redraw()
        changed()
    }

    func windowWillClose(_ notification: Notification) {
        window = nil
        changed()
    }

    private func destination() -> NSScreen? {
        Screens.destination(for: window, presenter: presenter()?.screen)
    }
}

/// A frameless window that still takes keys.
final class AudienceWindow: NSWindow {
    override var canBecomeKey: Bool { true }
    override var canBecomeMain: Bool { true }
}
