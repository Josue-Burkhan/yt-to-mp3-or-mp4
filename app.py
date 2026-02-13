"""
YouTube Downloader
Author: Josue-Burkhan
GitHub: https://github.com/Josue-Burkhan
"""
from flask import Flask, render_template, request, jsonify
import yt_dlp
import os
import shutil
import json
import webbrowser
import threading
import time
import subprocess
import sys
import platform

app = Flask(__name__)

CONFIG_FILE = 'config.json'
DEFAULT_DOWNLOAD_DIR = os.path.join(os.path.expanduser('~'), 'Downloads')

# Heartbeat & Auto-Shutdown Logic
last_heartbeat = time.time()
server_started = time.time()
SHUTDOWN_GRACE_PERIOD = 60  # Seconds to wait for first connection
HEARTBEAT_TIMEOUT = 60      # Seconds without heartbeat before shutdown
downloads_lock = threading.Lock()
active_downloads = 0
progress_lock = threading.Lock()
download_progress = {
    'status': 'idle',
    'percent': 0,
    'message': '',
    'eta': None,
    'speed': None,
    'downloaded': None,
    'total': None,
}

def mark_activity():
    global last_heartbeat
    last_heartbeat = time.time()

def has_active_downloads():
    with downloads_lock:
        return active_downloads > 0

def set_download_progress(**kwargs):
    with progress_lock:
        download_progress.update(kwargs)

def get_download_progress():
    with progress_lock:
        return dict(download_progress)

def format_bytes(num_bytes):
    if num_bytes is None:
        return None
    value = float(num_bytes)
    units = ['B', 'KiB', 'MiB', 'GiB', 'TiB']
    idx = 0
    while value >= 1024 and idx < len(units) - 1:
        value /= 1024
        idx += 1
    return f"{value:.1f} {units[idx]}"

def format_speed(speed_bytes):
    readable = format_bytes(speed_bytes)
    if readable is None:
        return None
    return f"{readable}/s"

def monitor_activity():
    while True:
        time.sleep(2)
        now = time.time()
        # If server just started, give it grace period
        if now - server_started < SHUTDOWN_GRACE_PERIOD:
            continue

        # Keep server alive while a download is in progress.
        if has_active_downloads():
            continue

        # Check heartbeat
        if now - last_heartbeat > HEARTBEAT_TIMEOUT:
            print("No heartbeat detected. Shutting down server...")
            os._exit(0)

# Start monitor thread
monitor_thread = threading.Thread(target=monitor_activity, daemon=True)
monitor_thread.start()

def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except:
            pass
    return {'download_path': DEFAULT_DOWNLOAD_DIR}

def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)

@app.route('/')
def index():
    mark_activity()
    return render_template('index.html')

@app.route('/api/heartbeat', methods=['GET', 'POST'])
def heartbeat():
    mark_activity()
    return jsonify({'status': 'alive'})

@app.route('/api/progress', methods=['GET'])
def progress():
    return jsonify(get_download_progress())

@app.route('/api/pick-folder', methods=['GET'])
def pick_folder():
    path = None
    system = platform.system()
    
    try:
        if system == 'Darwin':  # macOS
            cmd = "osascript -e 'POSIX path of (choose folder with prompt \"Select Download Folder\")'"
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                path = result.stdout.strip()
        elif system == 'Windows':
            cmd = "powershell -command \"(new-object -COM 'Shell.Application').BrowseForFolder(0,'Select Download Folder',0,0).self.path\""
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                path = result.stdout.strip()
        else: # Linux/Other (Try zenity or kdialog, or tkinter fallback)
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                path = filedialog.askdirectory()
                root.destroy()
            except:
                pass

        if path:
            return jsonify({'path': path})
        return jsonify({'error': 'No folder selected'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    if request.method == 'POST':
        new_path = request.json.get('path')
        if new_path:
            expanded_path = os.path.expanduser(new_path)
            if not os.path.exists(expanded_path):
                try:
                    os.makedirs(expanded_path)
                except Exception as e:
                    return jsonify({'error': f'Could not create directory: {str(e)}'}), 400
            
            config = load_config()
            config['download_path'] = expanded_path
            save_config(config)
            return jsonify({'success': True, 'path': expanded_path})
        return jsonify({'error': 'Path required'}), 400
    else:
        config = load_config()
        return jsonify(config)

@app.route('/api/info', methods=['POST'])
def get_info():
    mark_activity()
    url = request.json.get('url')
    if not url:
        return jsonify({'error': 'URL is required'}), 400

    try:
        ydl_opts = {
            'quiet': True,
            'nocheckcertificate': True,
            'noplaylist': True,
        }
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=False)
            
            seen_heights = set()
            video_qualities = []
            for f in info.get('formats', []):
                height = f.get('height')
                vcodec = f.get('vcodec', 'none')
                if vcodec == 'none' or not height:
                    continue
                if height not in seen_heights:
                    seen_heights.add(height)
                    video_qualities.append({'height': height, 'label': f'{height}p'})
            
            video_qualities.sort(key=lambda x: x['height'])

            return jsonify({
                'title': info.get('title'),
                'thumbnail': info.get('thumbnail'),
                'duration': info.get('duration_string', ''),
                'video_qualities': video_qualities,
            })
    except Exception as e:
        return jsonify({'error': str(e)}), 500

@app.route('/api/download', methods=['POST'])
def download():
    global active_downloads
    mark_activity()
    data = request.json
    url = data.get('url')
    fmt = data.get('format')
    height = data.get('height')

    if not url:
        return jsonify({'error': 'URL is required'}), 400

    config = load_config()
    base_path = config.get('download_path', DEFAULT_DOWNLOAD_DIR)
    
    if fmt == 'audio':
        target_dir = os.path.join(base_path, 'audios')
    else:
        target_dir = os.path.join(base_path, 'videos')
    
    if not os.path.exists(target_dir):
        os.makedirs(target_dir)

    try:
        with downloads_lock:
            active_downloads += 1

        set_download_progress(
            status='downloading',
            percent=0,
            message='Starting download...',
            eta=None,
            speed=None,
            downloaded=None,
            total=None,
        )

        def progress_activity_hook(_):
            mark_activity()

        def progress_hook(data):
            progress_activity_hook(data)
            status = data.get('status')

            if status == 'downloading':
                downloaded_bytes = data.get('downloaded_bytes')
                total_bytes = data.get('total_bytes') or data.get('total_bytes_estimate')
                eta = data.get('eta')
                speed = data.get('speed')
                percent = 0
                if total_bytes:
                    percent = max(0, min(100, int((downloaded_bytes or 0) * 100 / total_bytes)))

                set_download_progress(
                    status='downloading',
                    percent=percent,
                    message='Downloading...',
                    eta=eta,
                    speed=format_speed(speed),
                    downloaded=format_bytes(downloaded_bytes),
                    total=format_bytes(total_bytes),
                )
            elif status == 'finished':
                set_download_progress(
                    status='processing',
                    percent=100,
                    message='Download complete. Processing file...',
                    eta=0,
                    speed=None,
                )

        ydl_opts = {
            'nocheckcertificate': True,
            'noplaylist': True,
            'quiet': True,
            'paths': {'home': target_dir},
            'outtmpl': '%(title)s.%(ext)s',
            'progress_hooks': [progress_hook],
        }

        if fmt == 'audio':
            ydl_opts.update({
                'format': 'bestaudio/best',
                'postprocessors': [{
                    'key': 'FFmpegExtractAudio',
                    'preferredcodec': 'mp3',
                    'preferredquality': '192',
                }],
            })
        else:
            if height:
                ydl_opts['format'] = (
                    f'bestvideo[height<={height}][vcodec^=avc1]+bestaudio[ext=m4a]/'
                    f'bestvideo[height<={height}][vcodec^=avc1]+bestaudio/'
                    f'best[height<={height}][vcodec^=avc1]/'
                    f'bestvideo[height<={height}]+bestaudio/'
                    f'best[height<={height}][vcodec!=none]'
                )
            else:
                ydl_opts['format'] = (
                    'bestvideo[vcodec^=avc1]+bestaudio[ext=m4a]/'
                    'bestvideo[vcodec^=avc1]+bestaudio/'
                    'best[vcodec^=avc1]/'
                    'bestvideo+bestaudio/'
                    'best[vcodec!=none]'
                )

            ydl_opts['merge_output_format'] = 'mp4'
            
            ydl_opts['postprocessors'] = [{
                'key': 'FFmpegVideoConvertor',
                'preferedformat': 'mp4',
            }]
            ydl_opts['postprocessor_args'] = {
                'VideoConvertor': ['-c:v', 'libx264', '-preset', 'fast', '-crf', '23', '-c:a', 'aac'],
            }

        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title', 'download')

        set_download_progress(
            status='success',
            percent=100,
            message=f'"{title}" downloaded successfully.',
            eta=0,
            speed=None,
        )

        return jsonify({
            'success': True,
            'title': title,
            'message': f'Downloaded to {target_dir}',
        })

    except Exception as e:
        set_download_progress(
            status='error',
            message=str(e),
            speed=None,
        )
        return jsonify({'error': str(e)}), 500
    finally:
        with downloads_lock:
            active_downloads = max(0, active_downloads - 1)

def open_browser():
    webbrowser.open_new('http://127.0.0.1:8000/')

if __name__ == '__main__':
    if not os.environ.get("WERKZEUG_RUN_MAIN"):
        threading.Timer(1, open_browser).start()
    app.run(debug=False, port=8000, threaded=True)
