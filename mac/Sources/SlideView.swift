import AppKit

/// One slide, fitted and centered on black, with the laser. Clicks, keys and
/// the pointer go to the page, as they do from the website's audience window.
@MainActor
final class SlideView: NSView {
    var doc: Documents.Doc? { didSet { redraw() } }
    var page = 0
    var black = false
    /// Where the laser points, in fractions of the slide from its top left.
    var laser: CGPoint?
    /// The laser dot's size, as a share of the slide's height.
    var laserSize: CGFloat = 0.035
    var events: (String, Any) -> Void = { _, _ in }
    private var hintUntil = Date.distantPast
    /// Counts clicks and moves, so a later one cancels what an earlier one scheduled.
    private var clicks = 0
    private var moves = 0
    private var mouseDown: NSEvent?
    private var dragged = false
    private var tracking: NSTrackingArea?

    override var acceptsFirstResponder: Bool { true }
    override var isOpaque: Bool { true }
    override func acceptsFirstMouse(for event: NSEvent?) -> Bool { true }

    func redraw() {
        needsDisplay = true
        window?.invalidateCursorRects(for: self)
    }

    /// Says how to go fullscreen, for a few seconds.
    func hint() {
        hintUntil = Date().addingTimeInterval(6)
        needsDisplay = true
        DispatchQueue.main.asyncAfter(deadline: .now() + 6.1) { [weak self] in self?.needsDisplay = true }
    }

    private var cgPage: CGPDFPage? { doc?.cg.page(at: page + 1) }

    /// Where the slide sits: fitted and centered, in whole points.
    private var slideRect: CGRect? {
        guard let cgPage else { return nil }
        let size = PageBox(cgPage).size
        let scale = min(bounds.width / size.width, bounds.height / size.height)
        let w = (size.width * scale).rounded(.down)
        let h = (size.height * scale).rounded(.down)
        return CGRect(x: ((bounds.width - w) / 2).rounded(.down), y: ((bounds.height - h) / 2).rounded(.down), width: w, height: h)
    }

    override func draw(_ dirtyRect: NSRect) {
        guard let ctx = NSGraphicsContext.current?.cgContext else { return }
        ctx.setFillColor(CGColor(gray: 0, alpha: 1))
        ctx.fill(bounds)
        if !black, let cgPage, let rect = slideRect {
            PageBox(cgPage).draw(cgPage, in: rect, of: ctx)
            if let laser { drawLaser(at: laser, in: rect, ctx) }
        }
        if Date() < hintUntil, !isInFullScreenMode { drawHint() }
    }

    /// The page's laser: a red dot with a soft glow (as `.laser-dot` in the page's CSS).
    private func drawLaser(at point: CGPoint, in rect: CGRect, _ ctx: CGContext) {
        let size = max(6, laserSize * rect.height)
        let center = CGPoint(x: rect.minX + point.x * rect.width, y: rect.maxY - point.y * rect.height)
        let colors = [
            CGColor(srgbRed: 1, green: 0.3, blue: 0.3, alpha: 1),
            CGColor(srgbRed: 1, green: 0.3, blue: 0.3, alpha: 1),
            CGColor(srgbRed: 1, green: 0.16, blue: 0.16, alpha: 0.55),
            CGColor(srgbRed: 1, green: 0, blue: 0, alpha: 0),
        ] as CFArray
        guard let gradient = CGGradient(colorsSpace: CGColorSpace(name: CGColorSpace.sRGB), colors: colors, locations: [0, 0.35, 0.55, 0.72]) else { return }
        // CSS's circle reaches the box's corners.
        ctx.drawRadialGradient(gradient, startCenter: center, startRadius: 0, endCenter: center, endRadius: size / 2 * 2.squareRoot(), options: [])
    }

    private func drawHint() {
        let text = "Double-click for fullscreen" as NSString
        let attributes: [NSAttributedString.Key: Any] = [.font: NSFont.systemFont(ofSize: 14), .foregroundColor: NSColor(white: 0.87, alpha: 1)]
        let size = text.size(withAttributes: attributes)
        let box = NSRect(x: (bounds.midX - size.width / 2 - 14).rounded(), y: 24, width: size.width + 28, height: size.height + 16)
        NSColor(white: 0, alpha: 0.7).setFill()
        NSBezierPath(roundedRect: box, xRadius: 8, yRadius: 8).fill()
        text.draw(at: NSPoint(x: box.minX + 14, y: box.minY + 8), withAttributes: attributes)
    }

    // Input

    /// The pointer in fractions of the slide from its top left, or nil off it.
    private func fraction(_ event: NSEvent) -> CGPoint? {
        guard let rect = slideRect else { return nil }
        let p = convert(event.locationInWindow, from: nil)
        let x = (p.x - rect.minX) / rect.width
        let y = (rect.maxY - p.y) / rect.height
        return (0...1).contains(x) && (0...1).contains(y) ? CGPoint(x: x, y: y) : nil
    }

    private func link(at point: CGPoint?) -> Documents.Link? {
        guard let point, let links = doc?.links, links.indices.contains(page) else { return nil }
        return links[page].first { $0.rect.contains(point) }
    }

    override func mouseDown(with event: NSEvent) {
        mouseDown = event
        dragged = false
    }

    /// Dragged, the frameless window moves.
    override func mouseDragged(with event: NSEvent) {
        guard !dragged, !isInFullScreenMode, let mouseDown else { return }
        dragged = true
        window?.performDrag(with: mouseDown)
    }

    override func mouseUp(with event: NSEvent) {
        clicks += 1
        if dragged || event.clickCount > 2 { return }
        if event.clickCount == 2 { return events("fullscreen", true) }
        if let link = link(at: fraction(event)) { return events("audienceFollow", link.to) }
        // A click steps forward, unless it turns out to be a double-click.
        let click = clicks
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.25) { [weak self] in
            if let self, self.clicks == click { self.events("audienceStep", 1) }
        }
    }

    override func rightMouseDown(with event: NSEvent) {
        events("audienceStep", -1)
    }

    override func mouseMoved(with event: NSEvent) {
        // The cursor hides once the pointer rests.
        moves += 1
        let move = moves
        DispatchQueue.main.asyncAfter(deadline: .now() + 2) { [weak self] in
            if self?.moves == move { NSCursor.setHiddenUntilMouseMoves(true) }
        }
        if let at = fraction(event) { events("audiencePointer", ["x": Double(at.x), "y": Double(at.y)]) } else { events("audiencePointer", NSNull()) }
    }

    override func mouseExited(with event: NSEvent) {
        events("audiencePointer", NSNull())
    }

    override func updateTrackingAreas() {
        super.updateTrackingAreas()
        if let tracking { removeTrackingArea(tracking) }
        let area = NSTrackingArea(rect: .zero, options: [.mouseMoved, .mouseEnteredAndExited, .activeAlways, .inVisibleRect], owner: self)
        addTrackingArea(area)
        tracking = area
    }

    override func resetCursorRects() {
        guard let rect = slideRect, let links = doc?.links, links.indices.contains(page) else { return }
        for link in links[page] {
            let r = link.rect
            addCursorRect(
                CGRect(x: rect.minX + r.minX * rect.width, y: rect.maxY - r.maxY * rect.height, width: r.width * rect.width, height: r.height * rect.height),
                cursor: .pointingHand
            )
        }
    }

    override func keyDown(with event: NSEvent) {
        guard let key = Self.press(event) else { return super.keyDown(with: event) }
        events("audienceKey", key)
    }

    override func performKeyEquivalent(with event: NSEvent) -> Bool {
        if event.modifierFlags.contains(.command), event.charactersIgnoringModifiers == "w" {
            events("close", true)
            return true
        }
        return super.performKeyEquivalent(with: event)
    }

    /// A key press as a browser names it (KeyboardEvent.key), for the page's key bindings. Command keys are the menus'.
    static func press(_ event: NSEvent) -> [String: Any]? {
        let flags = event.modifierFlags
        guard !flags.contains(.command) else { return nil }
        let named: [UInt16: String] = [
            123: "ArrowLeft", 124: "ArrowRight", 125: "ArrowDown", 126: "ArrowUp",
            116: "PageUp", 121: "PageDown", 115: "Home", 119: "End",
            36: "Enter", 76: "Enter", 49: " ", 51: "Backspace", 117: "Delete", 53: "Escape", 48: "Tab",
        ]
        guard let key = named[event.keyCode] ?? event.charactersIgnoringModifiers, !key.isEmpty else { return nil }
        return ["key": key, "ctrlKey": flags.contains(.control), "altKey": flags.contains(.option), "shiftKey": flags.contains(.shift), "metaKey": false]
    }
}
