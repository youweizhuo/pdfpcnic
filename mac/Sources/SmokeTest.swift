import AppKit
import WebKit

/// `pdfpcnic --smoke-test deck.pdf deck.pdfpc out/ pdfpcnic-mac.zip`, for CI.
/// It opens the deck as the Finder would, with the audience window behind the
/// presenter, steps through it, makes both windows fullscreen, checks that both
/// drew the slide and what Esc leaves, saves a run's times beside the PDF,
/// installs the zip as an update would, reloads to check the talk resumes,
/// saves screenshots, and quits: status 1 if anything failed.
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
        func js(_ body: String, arguments: [String: Any] = [:]) async throws -> Any? {
            try await web.callAsyncJavaScript(body, arguments: arguments, in: nil, contentWorld: .page)
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
        await check("the Mac start screen has the file picker and the source link beside its title") {
            try await until("the start screen") {
                try await js("return !!document.querySelector('#drop input') && !!document.querySelector('#start-header .source')") as? Bool == true
            }
            let aligned = try await js("""
                const title = document.querySelector('#start-header h1').getBoundingClientRect();
                const source = document.querySelector('#start-header .source').getBoundingClientRect();
                const centerDifference = Math.abs((source.top + source.bottom - title.top - title.bottom) / 2);
                return source.left >= title.right && centerDifference < 2;
                """) as? Bool
            guard aligned == true else { throw Failure("the source link isn't aligned with the title") }
            let clean = try await js("return !document.querySelector('.start-intro, .deck-link, .deck-progress')") as? Bool
            guard clean == true else { throw Failure("the start screen shows the intro or deck-link controls") }
            try await Self.save(web, to: out.appendingPathComponent("start.png"))
            let drag = try await js("""
                const drop = document.querySelector('#drop');
                const dataTransfer = new DataTransfer();
                dataTransfer.items.add(new File([''], 'talk.pdf', { type: 'application/pdf' }));
                window.dispatchEvent(new DragEvent('dragenter', { dataTransfer }));
                const highlighted = drop.classList.contains('over');
                window.dispatchEvent(new DragEvent('dragleave', { dataTransfer }));
                return highlighted && !drop.classList.contains('over');
                """) as? Bool
            guard drag == true else { throw Failure("the file drag highlight didn't follow the drag") }
        }
        await check("a newer release is shown while it downloads and installs") {
            app.reportUpdate(.init(phase: .downloading, version: "9.9.9"))
            try await until("the update download notice") {
                try await js("return document.querySelector('#update:not([hidden])').textContent.includes('9.9.9 available. Downloading')") as? Bool == true
            }
            app.reportUpdate(.init(phase: .installing, version: "9.9.9"))
            try await until("the installation notice") {
                try await js("return document.querySelector('#update:not([hidden])').textContent.includes('Installing update 9.9.9')") as? Bool == true
            }
        }
        // The PDF alone: its notes come from the .pdfpc file beside it.
        app.open([files[0]])
        await check("a file opened from the Finder waits for Present and its nearby notes come along") {
            let name = files.map(\.lastPathComponent).joined(separator: " + ")
            try await until("the Finder deck ready") {
                try await js("return !document.querySelector('#ready').hidden && document.querySelector('#ready-name').textContent === name", arguments: ["name": name]) as? Bool == true
            }
            guard app.audience.view.window == nil else { throw Failure("the audience window opened before Present") }
            _ = try await js("document.querySelector('#present').click(); return null")
            try await until("the deck") { (try await js("return window.pdfpcnic.deck?.slides.length ?? 0") as? Int ?? 0) > 0 }
            try await until("the notes") { (try await js("return document.querySelector('#notes-body').textContent.length") as? Int ?? 0) > 20 }
            try await until("the current slide drawn") { try await js(Self.painted("#current canvas")) as? Bool == true }
            try await until("the thumbnails drawn") { try await js(Self.painted("#strip li canvas")) as? Bool == true }
            try await until("the display kept awake") { app.presenter.keepingAwake }
        }
        await check("the audience window opens with the deck, behind the presenter, and Quartz draws the slide in it") {
            try await until("the audience window") { app.audience.view.window != nil }
            let windows = NSApp.orderedWindows
            guard let audience = windows.firstIndex(where: { $0 === app.audience.view.window }),
                  let presenter = windows.firstIndex(where: { $0 === app.presenter.window }), presenter < audience
            else { throw Failure("it isn't behind the presenter") }
            try await until("the slide in it") { Self.painted(app.audience.view) }
            try await until("the guide's next step") {
                // On a machine with one screen, the guide offers Sharing or a projector.
                let line = try await js("return document.querySelector('#guide').textContent") as? String ?? ""
                return line.hasPrefix("Click Projector for fullscreen on") || line.hasPrefix("One screen:")
            }
        }
        await check("the arrow advances with the clock idle; s starts it on the chosen slide") {
            try await press("ArrowRight")
            try await until("page 2 with the clock still idle") {
                try await js("return window.pdfpcnic.state.page === 1 && window.pdfpcnic.state.timer.startedAt === null") as? Bool == true
            }
            try await press("s")
            try await until("the clock started on page 2") {
                try await js("return window.pdfpcnic.state.page === 1 && window.pdfpcnic.state.timer.startedAt !== null") as? Bool == true
            }
        }
        await check("Shift+W makes the audience fullscreen, and the presenter knows") {
            try await press("W", shift: true)
            try await until("fullscreen") { app.audience.isFullscreen }
            try await until("its button lit") {
                try await js("return document.querySelector('#audience-button.on') !== null") as? Bool == true
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
        await check("w makes the presenter fullscreen and back") {
            try await press("w")
            try await until("fullscreen") { app.presenter.fullscreen }
            try await press("w")
            try await until("windowed") { !app.presenter.fullscreen }
        }
        let oneScreen = NSScreen.screens.count == 1
        await check(oneScreen
            ? "One screen: Esc steps back, the laser first, then the audience's fullscreen, then the presenter's"
            : "Esc steps back, the laser first, then the presenter's fullscreen; never the audience's") {
            func laser() async throws -> Bool { try await js("return window.pdfpcnic.state.laser") as? Bool ?? false }
            try await press("w")
            try await press("l")
            try await until("fullscreen, with the laser") {
                let on = try await laser()
                return on && app.presenter.fullscreen
            }
            try await press("Escape")
            try await until("the laser off") { try await laser() == false }
            guard app.presenter.fullscreen, app.audience.isFullscreen else { throw Failure("the first Esc left fullscreen") }
            if oneScreen {
                try await press("Escape")
                try await until("the audience windowed") { !app.audience.isFullscreen }
                // The next Esc is routed by the page's copy of the native state.
                try await until("the page knows the audience is windowed") {
                    try await js("return window.pdfpcnic.audience.status.mode === 'window'") as? Bool == true
                }
                guard app.presenter.fullscreen else { throw Failure("Esc left both fullscreens at once") }
            }
            try await press("Escape")
            try await until("windowed") { !app.presenter.fullscreen }
            try await press("Escape")
            try await Task.sleep(nanoseconds: 300_000_000)
            if !oneScreen, !app.audience.isFullscreen { throw Failure("Esc took the audience out of fullscreen") }
        }
        await check("Screen sharing fills the same window, including after fullscreen, and slides keep updating") {
            guard try await js("return !document.querySelector('#sharing-controls').hidden && document.querySelector('[data-action=prepareSharing]').textContent.startsWith('Sharing')") as? Bool == true else {
                throw Failure("the Sharing button is missing")
            }
            @MainActor func prepare(click: Bool = false) async throws {
                // Repeated calls must await completion: the already-ready state can't acknowledge a new call.
                _ = try await js(click
                    ? "document.querySelector('[data-action=prepareSharing]').click(); return null"
                    : """
                      await Promise.race([
                        window.pdfpcnic.audience.prepareSharing(),
                        new Promise((_, reject) => setTimeout(() => reject(new Error('Preparing the audience for sharing timed out')), 8000)),
                      ]);
                      return null;
                      """)
                try await until("the audience prepared for sharing") {
                    app.audience.status["forSharing"] as? Bool == true && !app.audience.isFullscreen
                }
                guard let window = app.audience.view.window, let screen = window.screen,
                      window.frame == Audience.fittedFrame(in: screen.visibleFrame, aspect: app.audience.slideAspect)
                else { throw Failure("the audience didn't fit the slide's proportions on the desktop") }
            }
            try await prepare(click: true)
            let window = app.audience.view.window
            try await prepare()
            _ = try await js("document.querySelector('#audience-button').click(); return null")
            try await until("the fullscreen button lit") {
                try await js("return document.querySelector('#audience-button.on') !== null") as? Bool == true
            }
            try await prepare()
            guard app.audience.view.window === window else { throw Failure("sharing replaced the audience window") }
            app.presenter.window.makeKeyAndOrderFront(nil)
            try await press("ArrowRight")
            try await until("the covered audience updated") { app.audience.view.page == 2 && Self.painted(app.audience.view) }
            try Self.save(app.audience.view, to: out.appendingPathComponent("sharing.png"))
            try await press("ArrowLeft")
            try await until("page 2 again") { try await page() == 1 }
        }
        await check("Save run saves the run's times beside the PDF") {
            let folder = files[0].deletingLastPathComponent()
            let stem = files[0].deletingPathExtension().lastPathComponent
            func runs() -> [URL] {
                ((try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? [])
                    .filter { $0.lastPathComponent.range(of: "^\(stem)-\\d{8}-\\d{4}(-\\d+)?\\.pdfpc$", options: .regularExpression) != nil }
            }
            for url in runs() { try? FileManager.default.removeItem(at: url) }
            // A second and a half on this slide, so the run has some time to save, however quick the checks before.
            try await Task.sleep(nanoseconds: 1_500_000_000)
            try await press("End")
            _ = try await js("document.querySelector('#save-run:not([hidden])').click(); return null")
            try await press("Backspace", shift: true)
            try await until("the file") { !runs().isEmpty }
            let text = try String(contentsOf: runs()[0], encoding: .utf8)
            for url in runs() { try? FileManager.default.removeItem(at: url) }
            guard text.contains("\"pdfpcFormat\": 2"), text.range(of: #"\[\d+s\]"#, options: .regularExpression) != nil else { throw Failure("it isn't a run's lengths: \(text.prefix(200))") }
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
        await check("a version that installed itself is named for the next launch") {
            app.reportUpdate(.init(phase: .installed, version: "9.9.9"))
            try await until("the hint") {
                (try await js("return document.querySelector('#update:not([hidden])')?.textContent ?? ''") as? String ?? "").hasPrefix("9.9.9 is installed")
            }
        }
        await check("after a reload, Resume picks up the talk at its page, and the update is still named") {
            try await Task.sleep(nanoseconds: 800_000_000)
            _ = try await js("window.smokeBeforeReload = true; return null")
            web.reload()
            // reload() returns before navigation; don't click the previous document's hidden Resume button.
            try await until("the new document") {
                try await js("return !window.smokeBeforeReload && !!window.pdfpcnic") as? Bool == true
            }
            try await until("the Resume button") {
                (try await js("return document.querySelector('#resume:not([hidden])')?.textContent ?? ''") as? String ?? "").contains("at page 2")
            }
            _ = try await js("document.querySelector('#resume').click(); return null")
            try await until("page 2") { try await page() == 1 }
            guard (try await js("return document.querySelector('#update:not([hidden])')?.textContent ?? ''") as? String ?? "").hasPrefix("9.9.9 is installed") else {
                throw Failure("the update's word went with the reload")
            }
        }
        await check("Command-W closes the focused window and the Dock reopens the presenter") {
            NSApp.activate(ignoringOtherApps: true)
            @MainActor func closeWithShortcut(_ window: NSWindow) async throws {
                window.makeKeyAndOrderFront(nil)
                do {
                    try await until("\(window.title) focused", seconds: 5) { (NSApp.keyWindow ?? NSApp.mainWindow) === window }
                } catch {
                    throw Failure("Couldn't focus \(window.title). App active: \(NSApp.isActive), key: \(NSApp.keyWindow?.title ?? "none"), main: \(NSApp.mainWindow?.title ?? "none"), visible: \(window.isVisible).")
                }
                guard let event = NSEvent.keyEvent(
                    with: .keyDown, location: .zero, modifierFlags: .command, timestamp: 0,
                    windowNumber: window.windowNumber, context: nil, characters: "w", charactersIgnoringModifiers: "w",
                    isARepeat: false, keyCode: 13
                ), NSApp.mainMenu?.performKeyEquivalent(with: event) == true else { throw Failure("Command-W was not handled") }
                try await until("the window closed") { !window.isVisible }
            }
            guard let audience = app.audience.view.window else { throw Failure("the audience window is missing") }
            try await closeWithShortcut(audience)
            guard app.presenter.window.isVisible else { throw Failure("closing the audience also closed the presenter") }
            try await press("o")
            try await until("the audience reopened") { app.audience.status["mode"] as? String == "window" }
            try await closeWithShortcut(app.presenter.window)
            try await until("both windows closed and the display released") {
                app.audience.status["mode"] as? String == "closed" && !app.presenter.keepingAwake
            }
            _ = app.applicationShouldHandleReopen(NSApp, hasVisibleWindows: true)
            try await until("the presenter reopened") { app.presenter.window.isVisible && app.presenter.keepingAwake }
            guard try await page() == 1 else { throw Failure("reopening lost the current page") }
        }
        await check("minimizing and restoring the presenter releases and renews the display wake lock") {
            let window = app.presenter.window
            window.miniaturize(nil)
            try await until("the presenter minimized and the display released") {
                window.isMiniaturized && !app.presenter.keepingAwake
            }
            window.deminiaturize(nil)
            try await until("the presenter restored and the display kept awake") {
                !window.isMiniaturized && app.presenter.keepingAwake
            }
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
