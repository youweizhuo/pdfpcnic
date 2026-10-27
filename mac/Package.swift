// swift-tools-version:5.9
// The Mac app's native half. Its presenter page is the website's, built for the
// app (vite --mode mac); mac/build.sh puts the two together into pdfpcnic.app.
import PackageDescription

let package = Package(
    name: "pdfpcnic",
    platforms: [.macOS(.v12)],
    targets: [
        .executableTarget(name: "pdfpcnic", path: "Sources"),
    ]
)
