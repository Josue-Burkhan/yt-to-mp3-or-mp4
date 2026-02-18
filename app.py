"""
YouTube Downloader
Author: Josue-Burkhan
GitHub: https://github.com/Josue-Burkhan
"""
from flask import Flask, render_template, request, jsonify
import yt_dlp
import os
import json
import webbrowser
import threading
import time
import subprocess
import platform
import uuid
import sys
import shutil

APP_NAME = 'yt-to-mp3-or-mp4'


def get_base_dir():
    if getattr(sys, 'frozen', False):
        return getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
    return os.path.abspath(os.path.dirname(__file__))


def get_user_data_dir():
    home = os.path.expanduser('~')
    system = platform.system()

    if system == 'Darwin':
        base = os.path.join(home, 'Library', 'Application Support', APP_NAME)
    elif system == 'Windows':
        base = os.path.join(os.environ.get('APPDATA', home), APP_NAME)
    else:
        base = os.path.join(os.environ.get('XDG_CONFIG_HOME', os.path.join(home, '.config')), APP_NAME)

    os.makedirs(base, exist_ok=True)
    return base


BASE_DIR = get_base_dir()
USER_DATA_DIR = get_user_data_dir()

app = Flask(
    __name__,
    template_folder=os.path.join(BASE_DIR, 'templates'),
    static_folder=os.path.join(BASE_DIR, 'static'),
)
app.config['SEND_FILE_MAX_AGE_DEFAULT'] = 0

CONFIG_FILE = os.path.join(USER_DATA_DIR, 'config.json')
DEFAULT_DOWNLOAD_DIR = os.path.join(os.path.expanduser('~'), 'Downloads')

# Heartbeat & Auto-Shutdown
last_heartbeat = time.time()
server_started = time.time()
SHUTDOWN_GRACE_PERIOD = 60
HEARTBEAT_TIMEOUT = 60

# Active downloads counter for shutdown guard
downloads_lock = threading.Lock()
active_downloads = 0

# In-memory task store for concurrent downloads
tasks_lock = threading.Lock()
download_tasks = {}


def now_ts():
    return int(time.time())


def mark_activity():
    global last_heartbeat
    last_heartbeat = time.time()


def has_active_downloads():
    with downloads_lock:
        return active_downloads > 0


def create_task(url, fmt, height):
    task_id = uuid.uuid4().hex
    task = {
        'id': task_id,
        'url': url,
        'format': fmt,
        'height': height,
        'status': 'pending',
        'percent': 0,
        'message': 'Queued...',
        'eta': None,
        'speed': None,
        'downloaded': None,
        'total': None,
        'title': None,
        'error': None,
        'target_dir': None,
        'created_at': now_ts(),
        'updated_at': now_ts(),
    }
    with tasks_lock:
        download_tasks[task_id] = task
    return dict(task)


def update_task(task_id, **kwargs):
    with tasks_lock:
        task = download_tasks.get(task_id)
        if not task:
            return None
        task.update(kwargs)
        task['updated_at'] = now_ts()
        return dict(task)


def get_task(task_id):
    with tasks_lock:
        task = download_tasks.get(task_id)
        return dict(task) if task else None


def list_tasks():
    with tasks_lock:
        tasks = [dict(task) for task in download_tasks.values()]
    tasks.sort(key=lambda t: t['created_at'])
    return tasks


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

        if now - server_started < SHUTDOWN_GRACE_PERIOD:
            continue

        if has_active_downloads():
            continue

        if now - last_heartbeat > HEARTBEAT_TIMEOUT:
            print("No heartbeat detected. Shutting down server...")
            os._exit(0)


monitor_thread = threading.Thread(target=monitor_activity, daemon=True)
monitor_thread.start()


def load_config():
    if os.path.exists(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, 'r') as f:
                return json.load(f)
        except Exception:
            pass
    return {'download_path': DEFAULT_DOWNLOAD_DIR}


def save_config(config):
    with open(CONFIG_FILE, 'w') as f:
        json.dump(config, f, indent=4)


def get_target_dir(fmt):
    config = load_config()
    base_path = config.get('download_path', DEFAULT_DOWNLOAD_DIR)
    if fmt == 'audio':
        target_dir = os.path.join(base_path, 'audios')
    else:
        target_dir = os.path.join(base_path, 'videos')
    os.makedirs(target_dir, exist_ok=True)
    return target_dir


    return target_dir


def get_ffmpeg_path():
    """Locate ffmpeg executable in predictable locations."""
    # 1. Check if running from PyInstaller bundle
    if getattr(sys, 'frozen', False):
        bundle_dir = getattr(sys, '_MEIPASS', os.path.dirname(sys.executable))
        bundled_ffmpeg = os.path.join(bundle_dir, 'ffmpeg')
        if os.path.exists(bundled_ffmpeg):
            return bundled_ffmpeg
        if os.path.exists(bundled_ffmpeg + '.exe'):
            return bundled_ffmpeg + '.exe'

    # 2. Check system PATH (shutil.which)
    path = shutil.which('ffmpeg')
    if path:
        return path

    # 3. Check current working directory (e.g. if user put it there)
    local_ffmpeg = os.path.join(os.getcwd(), 'ffmpeg')
    if os.path.exists(local_ffmpeg):
        return local_ffmpeg
    if os.path.exists(local_ffmpeg + '.exe'):
        return local_ffmpeg + '.exe'
        
    # 4. Check common macOS/Linux locations
    common_paths = [
        '/opt/homebrew/bin/ffmpeg',
        '/usr/local/bin/ffmpeg',
        '/usr/bin/ffmpeg',
        '/var/lib/flatpak/exports/bin/ffmpeg' # Linux Flatpak
    ] 
    for p in common_paths:
        if os.path.exists(p):
            return p
            
    return None


def build_ydl_options(fmt, height, target_dir, progress_hook):
    ydl_opts = {
        'nocheckcertificate': True,
        'noplaylist': True,
        'quiet': True,
        'paths': {'home': target_dir},
        'outtmpl': '%(title)s.%(ext)s',
        'progress_hooks': [progress_hook],
    }
    
    # Inject FFmpeg location
    ffmpeg_loc = get_ffmpeg_path()
    if ffmpeg_loc:
        ydl_opts['ffmpeg_location'] = ffmpeg_loc

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

    return ydl_opts


def run_download_task(task_id):
    global active_downloads

    task = get_task(task_id)
    if not task:
        return

    url = task['url']
    fmt = task['format']
    height = task['height']
    target_dir = get_target_dir(fmt)

    update_task(
        task_id,
        status='downloading',
        percent=0,
        message='Starting download...',
        target_dir=target_dir,
        error=None,
    )

    with downloads_lock:
        active_downloads += 1

    try:
        def progress_hook(data):
            mark_activity()
            status = data.get('status')

            if status == 'downloading':
                downloaded_bytes = data.get('downloaded_bytes')
                total_bytes = data.get('total_bytes') or data.get('total_bytes_estimate')
                eta = data.get('eta')
                speed = data.get('speed')
                percent = 0
                if total_bytes:
                    percent = max(0, min(100, int((downloaded_bytes or 0) * 100 / total_bytes)))

                update_task(
                    task_id,
                    status='downloading',
                    percent=percent,
                    message='Downloading...',
                    eta=eta,
                    speed=format_speed(speed),
                    downloaded=format_bytes(downloaded_bytes),
                    total=format_bytes(total_bytes),
                    target_dir=target_dir,
                )
            elif status == 'finished':
                update_task(
                    task_id,
                    status='processing',
                    percent=100,
                    message='Download finished. Processing file...',
                    eta=0,
                    speed=None,
                    target_dir=target_dir,
                )

        ydl_opts = build_ydl_options(fmt, height, target_dir, progress_hook)
        with yt_dlp.YoutubeDL(ydl_opts) as ydl:
            info = ydl.extract_info(url, download=True)
            title = info.get('title', 'download')

        update_task(
            task_id,
            status='success',
            percent=100,
            title=title,
            message=f'Downloaded to {target_dir}',
            eta=0,
            speed=None,
            error=None,
            target_dir=target_dir,
        )
    except Exception as e:
        update_task(
            task_id,
            status='error',
            message=str(e),
            error=str(e),
            speed=None,
            target_dir=target_dir,
        )
    finally:
        with downloads_lock:
            active_downloads = max(0, active_downloads - 1)


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
    tasks = list_tasks()
    if not tasks:
        return jsonify({
            'status': 'idle',
            'percent': 0,
            'message': '',
            'eta': None,
            'speed': None,
            'downloaded': None,
            'total': None,
        })

    for task in reversed(tasks):
        if task['status'] in ('pending', 'downloading', 'processing'):
            return jsonify(task)
    return jsonify(tasks[-1])


@app.route('/api/tasks', methods=['GET'])
def tasks():
    return jsonify({'tasks': list_tasks()})


@app.route('/api/tasks/<task_id>', methods=['GET'])
def task_details(task_id):
    task = get_task(task_id)
    if not task:
        return jsonify({'error': 'Task not found'}), 404
    return jsonify(task)


@app.route('/api/pick-folder', methods=['GET'])
def pick_folder():
    path = None
    system = platform.system()

    try:
        if system == 'Darwin':
            cmd = "osascript -e 'POSIX path of (choose folder with prompt \"Select Download Folder\")'"
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                path = result.stdout.strip()
        elif system == 'Windows':
            cmd = "powershell -command \"(new-object -COM 'Shell.Application').BrowseForFolder(0,'Select Download Folder',0,0).self.path\""
            result = subprocess.run(cmd, shell=True, capture_output=True, text=True)
            if result.returncode == 0:
                path = result.stdout.strip()
        else:
            try:
                import tkinter as tk
                from tkinter import filedialog
                root = tk.Tk()
                root.withdraw()
                root.attributes('-topmost', True)
                path = filedialog.askdirectory()
                root.destroy()
            except Exception:
                pass

        if path:
            return jsonify({'path': path})
        return jsonify({'error': 'No folder selected'}), 400
    except Exception as e:
        return jsonify({'error': str(e)}), 500


@app.route('/api/settings', methods=['GET', 'POST'])
def handle_settings():
    if request.method == 'POST':
        data = request.get_json(silent=True) or {}
        new_path = data.get('path')
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
        return jsonify({'error': 'Path is required'}), 400

    config = load_config()
    return jsonify(config)


@app.route('/api/info', methods=['POST'])
def get_info():
    mark_activity()
    data = request.get_json(silent=True) or {}
    url = (data.get('url') or '').strip()
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
    mark_activity()
    data = request.get_json(silent=True) or {}

    url = (data.get('url') or '').strip()
    fmt = (data.get('format') or 'video').strip()
    raw_height = data.get('height')

    if not url:
        return jsonify({'error': 'URL is required'}), 400

    if fmt not in ('video', 'audio'):
        return jsonify({'error': 'Invalid format'}), 400

    height = None
    if fmt == 'video' and raw_height is not None:
        try:
            height = int(raw_height)
        except (ValueError, TypeError):
            return jsonify({'error': 'Invalid quality'}), 400

    task = create_task(url, fmt, height)
    worker = threading.Thread(target=run_download_task, args=(task['id'],), daemon=True)
    worker.start()

    return jsonify({
        'success': True,
        'task_id': task['id'],
        'task': task,
    })


def open_browser():
    webbrowser.open_new('http://127.0.0.1:8000/')


@app.after_request
def add_no_cache_headers(response):
    response.headers['Cache-Control'] = 'no-store, no-cache, must-revalidate, max-age=0'
    response.headers['Pragma'] = 'no-cache'
    response.headers['Expires'] = '0'
    return response


def run_server(open_external_browser=False):
    if open_external_browser:
        threading.Timer(1, open_browser).start()
    app.run(debug=False, port=8000, threaded=True, use_reloader=False)


if __name__ == '__main__':
    run_server(open_external_browser=True)
