#!/bin/bash
set -euo pipefail

PROJECT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$PROJECT_DIR"

APP_NAME="YT to MP3 or MP4"
ENTRY_SCRIPT="desktop.py"
ICON_PNG="yt-to-mp3-4-icon.png"
ICON_ICNS="yt-to-mp3-4-icon.icns"
ICONSET_DIR="/tmp/yt-to-mp3-4-icon.iconset"

if [ ! -f "$ICON_PNG" ]; then
  echo "Icon not found: $ICON_PNG"
  exit 1
fi

if [ ! -d "venv" ]; then
  python3 -m venv venv
fi

source venv/bin/activate
python -m pip install -r requirements.txt
python -m pip install pyinstaller

rm -rf "$ICONSET_DIR"
mkdir -p "$ICONSET_DIR"

sips -z 16 16     "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16.png" >/dev/null
sips -z 32 32     "$ICON_PNG" --out "$ICONSET_DIR/icon_16x16@2x.png" >/dev/null
sips -z 32 32     "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32.png" >/dev/null
sips -z 64 64     "$ICON_PNG" --out "$ICONSET_DIR/icon_32x32@2x.png" >/dev/null
sips -z 128 128   "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128.png" >/dev/null
sips -z 256 256   "$ICON_PNG" --out "$ICONSET_DIR/icon_128x128@2x.png" >/dev/null
sips -z 256 256   "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256.png" >/dev/null
sips -z 512 512   "$ICON_PNG" --out "$ICONSET_DIR/icon_256x256@2x.png" >/dev/null
sips -z 512 512   "$ICON_PNG" --out "$ICONSET_DIR/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$ICON_PNG" --out "$ICONSET_DIR/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$ICONSET_DIR" -o "$ICON_ICNS"

rm -rf build dist "$APP_NAME.spec"

pyinstaller \
  --noconfirm \
  --clean \
  --windowed \
  --name "$APP_NAME" \
  --icon "$ICON_ICNS" \
  --add-data "templates:templates" \
  --add-data "static:static" \
  --hidden-import webview.platforms.cocoa \
  --hidden-import webview.platforms.gtk \
  "$ENTRY_SCRIPT"

APP_PATH="dist/${APP_NAME}.app"
DMG_PATH="dist/${APP_NAME}.dmg"
DMG_ROOT="dist/dmg-root"

if [ -d "$APP_PATH" ]; then
  rm -f "$DMG_PATH"
  rm -rf "$DMG_ROOT"
  mkdir -p "$DMG_ROOT"
  cp -R "$APP_PATH" "$DMG_ROOT/"
  ln -s /Applications "$DMG_ROOT/Applications"
  hdiutil create -volname "$APP_NAME" -srcfolder "$DMG_ROOT" -ov -format UDZO "$DMG_PATH" >/dev/null
  rm -rf "$DMG_ROOT"
  echo "Build complete:"
  echo "- App: $APP_PATH"
  echo "- DMG: $DMG_PATH"
else
  echo "Build failed: app bundle not found."
  exit 1
fi
