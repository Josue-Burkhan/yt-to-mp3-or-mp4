"""
Desktop launcher for macOS/Windows/Linux using pywebview.
Runs Flask in the background and shows the app in a native window.
"""
import os
import threading
import time
import urllib.request

from app import run_server

APP_URL = 'http://127.0.0.1:8000/'
WINDOW_TITLE = 'YT to MP3/MP4 Downloader'


def wait_for_server(url, timeout=25):
    deadline = time.time() + timeout
    while time.time() < deadline:
        try:
            with urllib.request.urlopen(url, timeout=1):
                return
        except Exception:
            time.sleep(0.25)
    raise RuntimeError('Flask server did not start in time.')


def on_window_closed():
    os._exit(0)


def main():
    try:
        import webview
    except ImportError as exc:
        raise RuntimeError('pywebview is required to run desktop mode.') from exc

    server_thread = threading.Thread(
        target=lambda: run_server(open_external_browser=False),
        daemon=True,
    )
    server_thread.start()

    wait_for_server(APP_URL)

    window = webview.create_window(
        WINDOW_TITLE,
        APP_URL,
        width=1180,
        height=800,
        min_size=(980, 640),
        resizable=True,
    )
    window.events.closed += on_window_closed
    webview.start(debug=False)


if __name__ == '__main__':
    main()
