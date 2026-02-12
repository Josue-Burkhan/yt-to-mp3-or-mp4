#!/bin/bash
# Get the directory where the script is located
DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "Checking system dependencies..."

# Check for FFmpeg
if ! command -v ffmpeg &> /dev/null; then
    echo "FFmpeg not found. Installing via Homebrew..."
    if command -v brew &> /dev/null; then
        brew install ffmpeg
    else
        echo "⚠️ Homebrew not found. Cannot auto-install FFmpeg."
        echo "Please install Homebrew (https://brew.sh) or FFmpeg manually."
        read -p "Press Enter to continue anyway (PDF/Video features might fail)..."
    fi
fi

# Setup Python Environment
if [ ! -d "venv" ]; then
    echo "Creating virtual environment..."
    python3 -m venv venv
fi

source venv/bin/activate

echo "Ensuring Python dependencies are installed..."
pip install -r requirements.txt > /dev/null 2>&1

echo "Starting YouTube Downloader..."
# Run app in background
nohup python app.py > app.log 2>&1 &

# Close the terminal window
osascript -e 'tell application "Terminal" to close first window' & exit
