#!/bin/sh
# Builds the Mac app, on a Mac: dist-mac/pdfpcnic.app, its zip for the
# release, the page it carries (for installed apps to update to), and
# pdfpcnic-mac.json, which tells installed apps what the release holds.
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
native=$(cat mac/Package.swift mac/Info.plist mac/Sources/*.swift | shasum -a 256 | cut -c1-12)
sed -e "s/@VERSION@/$version/g" -e "s/@NATIVE@/$native/g" mac/Info.plist > "$app/Contents/Info.plist"
# Signed for running only, with no Apple Developer ID: the first launch takes Open Anyway.
codesign --force --sign - "$app"

cd dist-mac
rm -f pdfpcnic-mac.zip
ditto -c -k --keepParent pdfpcnic.app pdfpcnic-mac.zip
cp index.html pdfpcnic-mac-page.html
bridge=$(sed -n 's/.*<meta name="pdfpcnic-bridge" content="\([0-9]*\)".*/\1/p' index.html | head -n 1)
printf '{ "version": "%s", "native": "%s", "bridge": %s }\n' "$version" "$native" "$bridge" > pdfpcnic-mac.json
cat pdfpcnic-mac.json
