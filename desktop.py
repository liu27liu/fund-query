"""
Desktop App Entry Point
Starts Flask backend in background, opens native desktop window via pywebview.
No browser, no command line - pure native window.
"""
import sys
import os
import threading
import time

# Set working directory to the exe's location (for PyInstaller)
if getattr(sys, 'frozen', False):
    os.chdir(os.path.dirname(sys.executable))

import webview
from server import app


def start_flask():
    """Start Flask in background thread"""
    app.run(host='127.0.0.1', port=18080, debug=False, use_reloader=False)


def main():
    # Start Flask in background
    flask_thread = threading.Thread(target=start_flask, daemon=True)
    flask_thread.start()

    # Wait for Flask to be ready
    import requests
    for i in range(30):
        try:
            r = requests.get('http://127.0.0.1:18080', timeout=1)
            if r.status_code == 200:
                break
        except:
            pass
        time.sleep(0.5)

    # Create native desktop window
    webview.create_window(
        title='基金股票查询平台',
        url='http://127.0.0.1:18080',
        width=1400,
        height=900,
        min_size=(1000, 600),
        text_select=True,
    )

    # Start the window (this blocks until window is closed)
    webview.start(debug=False, http_server=True)


if __name__ == '__main__':
    main()
