import AppKit

/// The screens, as the audience's window needs them.
enum Screens {
    private static func id(_ screen: NSScreen) -> CGDirectDisplayID? {
        screen.deviceDescription[NSDeviceDescriptionKey("NSScreenNumber")] as? CGDirectDisplayID
    }

    private static func same(_ a: NSScreen?, _ b: NSScreen?) -> Bool {
        guard let a, let b else { return false }
        return id(a) == id(b)
    }

    /// The laptop's own screen.
    private static func builtIn(_ screen: NSScreen) -> Bool {
        id(screen).map { CGDisplayIsBuiltin($0) != 0 } ?? false
    }

    /**
     * Where the audience goes fullscreen, as on the website. Moved off the
     * presenter's screen, it stays where it was put; otherwise it takes another
     * screen, an external one over the laptop's own, then one that isn't the
     * main screen. Not by size: a projector can count as smaller than a laptop
     * with display scaling. With one screen, there.
     */
    static func destination(for window: NSWindow?, presenter: NSScreen?) -> NSScreen? {
        let here = presenter ?? NSScreen.main
        if let at = window?.screen, !same(at, here) { return at }
        let main = NSScreen.screens.first
        let rank = { (s: NSScreen) in (builtIn(s) ? 0 : 2) + (same(s, main) ? 0 : 1) }
        return NSScreen.screens.filter { !same($0, here) }.max { rank($0) < rank($1) } ?? window?.screen ?? here
    }
}
