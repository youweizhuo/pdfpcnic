import AppKit

/// Staying current without reinstalling. At launch the app looks at the latest
/// release; if it's newer, it downloads the app from it and puts it in place of
/// this one, wherever this one is. The new version opens at the next launch,
/// never mid-talk. What the app downloads itself isn't marked as from the
/// internet, so macOS doesn't stop the new version as it did the first one.
enum Updates {
    private static let releases = "https://github.com/youweizhuo/pdfpcnic/releases"
    static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }

    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }
        let y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) where (i < x.count ? x[i] : 0) != (i < y.count ? y[i] : 0) {
            return (i < x.count ? x[i] : 0) > (i < y.count ? y[i] : 0)
        }
        return false
    }

    /// The latest release's version: GitHub sends releases/latest on to its page, …/releases/tag/v1.2.3.
    static func latest() async throws -> String {
        var request = URLRequest(url: URL(string: "\(releases)/latest")!, cachePolicy: .reloadIgnoringLocalCacheData)
        request.httpMethod = "HEAD"
        let (_, response) = try await URLSession.shared.data(for: request)
        guard let page = response.url, page.deletingLastPathComponent().lastPathComponent == "tag", page.lastPathComponent.hasPrefix("v") else {
            throw Failure("GitHub didn't say which pdfpcnic is the latest.")
        }
        return String(page.lastPathComponent.dropFirst())
    }

    /// Where this app is. A downloaded app opened where it was unpacked runs
    /// from a read-only copy macOS makes of it (App Translocation): the update
    /// goes to the original.
    static var location: URL {
        let app = Bundle.main.bundleURL
        typealias Original = @convention(c) (CFURL, UnsafeMutablePointer<Unmanaged<CFError>?>?) -> Unmanaged<CFURL>?
        guard app.path.contains("/AppTranslocation/"),
              let security = dlopen("/System/Library/Frameworks/Security.framework/Security", RTLD_LAZY),
              let symbol = dlsym(security, "SecTranslocateCreateOriginalPathForURL"),
              let original = unsafeBitCast(symbol, to: Original.self)(app as CFURL, nil)
        else { return app }
        return original.takeRetainedValue() as URL
    }

    /// Installs the latest release if it's newer. Quietly, at launch, it says
    /// nothing; asked from the menu, it says how it went.
    static func check(quietly: Bool) async {
        do {
            let newest = try await latest()
            guard newer(newest, than: version) else {
                if !quietly { await tell("This is the latest pdfpcnic (\(version)).") }
                return
            }
            let (zip, response) = try await URLSession.shared.data(from: URL(string: "\(releases)/download/v\(newest)/pdfpcnic-mac.zip")!)
            guard (response as? HTTPURLResponse)?.statusCode == 200 else { throw Failure("pdfpcnic \(newest) didn't download.") }
            try await install(zip, over: location)
            if !quietly { await tell("pdfpcnic \(newest) is installed. It opens the next time you start the app.") }
        } catch {
            if !quietly { await offer(error) }
        }
    }

    /// Unpacks a release's zip and puts its app in place of the one at `app`.
    static func install(_ zip: Data, over app: URL) async throws {
        let files = FileManager.default
        // Unpacked on the app's disk, so it's swapped in at once.
        let folder = try files.url(for: .itemReplacementDirectory, in: .userDomainMask, appropriateFor: app, create: true)
        defer { try? files.removeItem(at: folder) }
        let archive = folder.appendingPathComponent("pdfpcnic-mac.zip")
        try zip.write(to: archive)
        try await unzip(archive, into: folder)
        let new = folder.appendingPathComponent("pdfpcnic.app")
        guard NSDictionary(contentsOf: new.appendingPathComponent("Contents/Info.plist"))?["CFBundleIdentifier"] as? String == Bundle.main.bundleIdentifier else {
            throw Failure("The download isn't pdfpcnic.")
        }
        // Its own attributes only: the old app's mark as downloaded from the internet stays behind.
        _ = try files.replaceItemAt(app, withItemAt: new, options: .usingNewMetadataOnly)
    }

    private static func unzip(_ archive: URL, into folder: URL) async throws {
        let ditto = Process()
        ditto.executableURL = URL(fileURLWithPath: "/usr/bin/ditto")
        ditto.arguments = ["-x", "-k", archive.path, folder.path]
        try await withCheckedThrowingContinuation { (done: CheckedContinuation<Void, Error>) in
            ditto.terminationHandler = { ditto in
                if ditto.terminationStatus == 0 { done.resume() } else { done.resume(throwing: Failure("The download didn't unpack.")) }
            }
            do { try ditto.run() } catch { done.resume(throwing: error) }
        }
    }

    @MainActor private static func tell(_ message: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
    }

    @MainActor private static func offer(_ error: Error) {
        let alert = NSAlert()
        alert.messageText = "pdfpcnic couldn't update itself"
        alert.informativeText = "\(error.localizedDescription) The latest version is on GitHub."
        alert.addButton(withTitle: "Download")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(URL(string: "\(releases)/latest")!) }
    }
}
