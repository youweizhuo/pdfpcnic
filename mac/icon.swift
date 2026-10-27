// Draws the app's icon, the website's tab icon on a dark tile: a slide in a
// yellow frame, with the laser's red dot. Run by mac/build.sh:
//   swift mac/icon.swift out.iconset
import AppKit

let out = URL(fileURLWithPath: CommandLine.arguments[1], isDirectory: true)
try FileManager.default.createDirectory(at: out, withIntermediateDirectories: true)

for size in [16, 32, 128, 256, 512] {
    for scale in [1, 2] {
        let px = size * scale
        let rep = NSBitmapImageRep(
            bitmapDataPlanes: nil, pixelsWide: px, pixelsHigh: px, bitsPerSample: 8, samplesPerPixel: 4,
            hasAlpha: true, isPlanar: false, colorSpaceName: .deviceRGB, bytesPerRow: 0, bitsPerPixel: 0
        )!
        NSGraphicsContext.saveGraphicsState()
        NSGraphicsContext.current = NSGraphicsContext(bitmapImageRep: rep)
        // In units of a 32-point grid, origin at the bottom left.
        let u = CGFloat(px) / 32
        NSColor(white: 0.1, alpha: 1).setFill()
        NSBezierPath(roundedRect: NSRect(x: 1.5 * u, y: 1.5 * u, width: 29 * u, height: 29 * u), xRadius: 6.5 * u, yRadius: 6.5 * u).fill()
        let slide = NSBezierPath(roundedRect: NSRect(x: 5 * u, y: 9 * u, width: 22 * u, height: 14 * u), xRadius: 2 * u, yRadius: 2 * u)
        NSColor(white: 0.04, alpha: 1).setFill()
        slide.fill()
        NSColor(srgbRed: 1, green: 0.84, blue: 0.04, alpha: 1).setStroke()
        slide.lineWidth = 1.6 * u
        slide.stroke()
        NSColor(srgbRed: 1, green: 0.27, blue: 0.23, alpha: 1).setFill()
        NSBezierPath(ovalIn: NSRect(x: 17.6 * u, y: 13.6 * u, width: 4.8 * u, height: 4.8 * u)).fill()
        NSGraphicsContext.restoreGraphicsState()
        let name = scale == 1 ? "icon_\(size)x\(size).png" : "icon_\(size)x\(size)@2x.png"
        try rep.representation(using: .png, properties: [:])!.write(to: out.appendingPathComponent(name))
    }
}
