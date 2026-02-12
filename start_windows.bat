@echo off
cd /d "%~dp0"
echo Checking system dependencies...

:: Check for FFmpeg
where ffmpeg >nul 2>nul
if %errorlevel% neq 0 (
    echo FFmpeg not found. Attempting to install via Winget...
    winget install -e --id Gyan.FFmpeg
    if %errorlevel% neq 0 (
        echo Failed to auto-install FFmpeg. Please install manually.
        pause
    ) else (
        echo FFmpeg installed. Please restart this script to reload PATH.
        pause
        exit
    )
)

if not exist venv (
    echo Creating virtual environment...
    python -m venv venv
)

call venv\Scripts\activate.bat
echo Ensuring Python dependencies are installed...
pip install -r requirements.txt >nul 2>&1

echo Starting YouTube Downloader...
start /B pythonw app.py
exit
