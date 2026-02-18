#!/bin/bash
echo "🚀 Starting detailed build process for macOS..."

# 1. Activate Virtual Environment
if [ -d "venv" ]; then
    echo "Using existing venv..."
    source venv/bin/activate
else
    echo "Creating venv..."
    python3 -m venv venv
    source venv/bin/activate
fi

# 2. Install dependencies
echo "📦 Installing Requirements..."
pip install -r requirements.txt
pip install pyinstaller

# 3. Locate and Copy FFmpeg/FFprobe binaries
echo "🎥 Locating FFmpeg..."
FFMPEG_PATH=$(which ffmpeg)
FFPROBE_PATH=$(which ffprobe)

if [ -z "$FFMPEG_PATH" ]; then
    # Fallback to homebrew path if not in PATH
    if [ -f "/opt/homebrew/bin/ffmpeg" ]; then
        FFMPEG_PATH="/opt/homebrew/bin/ffmpeg"
        FFPROBE_PATH="/opt/homebrew/bin/ffprobe"
    else
        echo "❌ Error: FFmpeg not found! Please install it via Homebrew: brew install ffmpeg"
        exit 1
    fi
fi

echo "Found FFmpeg at: $FFMPEG_PATH"
echo "Found FFprobe at: $FFPROBE_PATH"

echo "Copying binaries to build context..."
cp "$FFMPEG_PATH" ./ffmpeg
cp "$FFPROBE_PATH" ./ffprobe
chmod +x ./ffmpeg ./ffprobe

# 4. Clean previous builds
echo "🧹 Cleaning up..."
rm -rf build dist
rm -f "YT Downloader.spec"

# 5. Build with PyInstaller
echo "🔨 Building Application..."
pyinstaller --noconfirm --clean \
    --name "YT Downloader" \
    --onefile \
    --windowed \
    --icon "yt-to-mp3-4-icon.icns" \
    --add-data "templates:templates" \
    --add-data "static:static" \
    --add-binary "ffmpeg:." \
    --add-binary "ffprobe:." \
    --hidden-import "engineio.async_drivers.threading" \
    app.py

# 6. Cleanup local copies
rm ./ffmpeg ./ffprobe

# 7. Create DMG
echo "💿 Creating DMG Installer..."
mkdir -p dist/dmg_content
cp -r "dist/YT Downloader.app" dist/dmg_content/
# Create a symlink to Applications folder
ln -s /Applications dist/dmg_content/Applications

# Create the DMG
hdiutil create -volname "YT Downloader Installer" -srcfolder dist/dmg_content -ov -format UDZO "dist/YT to MP3 or MP4.dmg"

# Cleanup DMG staging
rm -rf dist/dmg_content

echo "✅ Build Complete!"
echo "📂 App is located in: dist/YT Downloader.app"
echo "💿 Installer is located in: dist/YT to MP3 or MP4.dmg"
echo ""
echo "To distribute: Send the .dmg file to Mac users."

