#!/bin/sh
# Builds the Mac app, on a Mac: dist-mac/pdfpcnic.app, and its zip for the
# release, which installed apps also update themselves from.
#   sh mac/build.sh
set -eu
cd "$(dirname "$0")/.."
version=$(node -p 'require("./package.json").version')

# The presenter page, built for the app: one file, on the Mac platform.
npx vite build --mode mac

# The native half, for Apple silicon and Intel.
swift build --package-path mac -c release --arch arm64 --arch x86_64
bin=$(swift build --package-path mac -c release --arch arm64 --arch x86_64 --show-bin-path)

app=dist-mac/pdfpcnic.app
mkdir -p "$app/Contents/MacOS" "$app/Contents/Resources"
cp "$bin/pdfpcnic" "$app/Contents/MacOS/pdfpcnic"
cp dist-mac/index.html "$app/Contents/Resources/page.html"
cat LICENSE dist-mac/licenses.txt > "$app/Contents/Resources/licenses.txt"
swift mac/icon.swift dist-mac/AppIcon.iconset
iconutil -c icns dist-mac/AppIcon.iconset -o "$app/Contents/Resources/AppIcon.icns"
sed "s/@VERSION@/$version/g" mac/Info.plist > "$app/Contents/Info.plist"
# Signed for running only, with no Apple Developer ID: macOS stops it when a
# browser downloaded it (Open Anyway), not when curl or the app itself did.
codesign --force --sign - "$app"
codesign --verify --deep --strict "$app"

cd dist-mac
rm -f pdfpcnic-mac.zip
ditto -c -k --keepParent pdfpcnic.app pdfpcnic-mac.zip
