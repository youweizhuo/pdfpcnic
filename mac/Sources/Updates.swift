import AppKit

/// Staying current without reinstalling. The presenter page, where nearly all
/// changes are, updates by itself: the latest release's page is downloaded in
/// the background and opens at the next launch, never mid-talk. The app's own
/// code changes rarely; when a release changes it, the app says so once and
/// links to the download.
enum Updates {
    private static let releases = "https://github.com/youweizhuo/pdfpcnic/releases"
    static var version: String { Bundle.main.infoDictionary?["CFBundleShortVersionString"] as? String ?? "0" }
    /// Which build of the app's own code this is: a hash of mac/, from mac/build.sh.
    private static var native: String { Bundle.main.infoDictionary?["PdfpcnicNative"] as? String ?? "" }
    /// The page the app carries.
    static var bundled: URL { Bundle.main.url(forResource: "page", withExtension: "html") ?? URL(fileURLWithPath: "/dev/null") }
    /// Pages downloaded from releases, named by version.
    static var folder: URL {
        FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("pdfpcnic/pages", isDirectory: true)
    }
    /// The version of the page this launch shows.
    private static var pageVersion = version

    /// The page to show: the newest one downloaded that this app can run, else its own.
    static func page() -> URL {
        let mine = bridge(of: bundled)
        let downloaded = (try? FileManager.default.contentsOfDirectory(at: folder, includingPropertiesForKeys: nil)) ?? []
        let usable = downloaded.filter { newer(name($0), than: version) && bridge(of: $0) == mine }
        guard let best = usable.max(by: { newer(name($1), than: name($0)) }) else { return bundled }
        pageVersion = name(best)
        return best
    }

    private static func name(_ page: URL) -> String { page.deletingPathExtension().lastPathComponent }

    /// The bridge a page speaks, from its `<meta name="pdfpcnic-bridge" content="1">`.
    private static func bridge(of page: URL) -> String? {
        guard let html = try? String(contentsOf: page, encoding: .utf8),
              let found = html.range(of: #"<meta name="pdfpcnic-bridge" content="\d+""#, options: .regularExpression)
        else { return nil }
        return html[found].split(separator: "\"").last.map(String.init)
    }

    static func newer(_ a: String, than b: String) -> Bool {
        let x = a.split(separator: ".").map { Int($0) ?? 0 }
        let y = b.split(separator: ".").map { Int($0) ?? 0 }
        for i in 0..<max(x.count, y.count) where (i < x.count ? x[i] : 0) != (i < y.count ? y[i] : 0) {
            return (i < x.count ? x[i] : 0) > (i < y.count ? y[i] : 0)
        }
        return false
    }

    /// What the latest release says about the Mac app (pdfpcnic-mac.json, from mac/build.sh).
    private struct Release: Decodable {
        let version: String
        let native: String
        let bridge: Int
    }

    /// Looks at the latest release. Quietly, at launch, it says nothing unless
    /// the app itself needs a new download, and that once per version.
    static func check(quietly: Bool) async {
        guard let got = try? await URLSession.shared.data(from: URL(string: "\(releases)/latest/download/pdfpcnic-mac.json")!),
              (got.1 as? HTTPURLResponse)?.statusCode == 200,
              let release = try? JSONDecoder().decode(Release.self, from: got.0)
        else {
            if !quietly { await tell("Couldn't reach GitHub to look for updates.") }
            return
        }
        var said = false
        // The page: downloaded now, opened at the next launch.
        if newer(release.version, than: pageVersion), String(release.bridge) == bridge(of: bundled),
           let page = try? await URLSession.shared.data(from: URL(string: "\(releases)/download/v\(release.version)/pdfpcnic-mac-page.html")!),
           (page.1 as? HTTPURLResponse)?.statusCode == 200 {
            let file = folder.appendingPathComponent("\(release.version).html")
            try? FileManager.default.createDirectory(at: folder, withIntermediateDirectories: true)
            try? page.0.write(to: file, options: .atomic)
            if bridge(of: file) != String(release.bridge) {
                try? FileManager.default.removeItem(at: file)
            } else if !quietly {
                await tell("pdfpcnic \(release.version) is ready. It opens the next time you start the app.")
                said = true
            }
        }
        // The app itself: a new download, offered once per version unless asked.
        if release.native != native, newer(release.version, than: version),
           !quietly || UserDefaults.standard.string(forKey: "offered") != release.version {
            UserDefaults.standard.set(release.version, forKey: "offered")
            await offer(release.version)
            said = true
        }
        if !quietly, !said { await tell("This is the latest pdfpcnic (\(pageVersion)).") }
    }

    @MainActor private static func tell(_ message: String) {
        let alert = NSAlert()
        alert.messageText = message
        alert.runModal()
    }

    @MainActor private static func offer(_ version: String) {
        let alert = NSAlert()
        alert.messageText = "pdfpcnic \(version) for Mac is out"
        alert.informativeText = "This update changes the app itself, so it's a new download. Put it in Applications in place of this one, and open it once with Open Anyway, as the first time."
        alert.addButton(withTitle: "Download")
        alert.addButton(withTitle: "Later")
        if alert.runModal() == .alertFirstButtonReturn { NSWorkspace.shared.open(URL(string: "\(releases)/latest")!) }
    }
}
