#!/usr/bin/env python3
"""仅供本机使用的交互 Demo 静态服务。"""
import argparse
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import quote, urlsplit
import webbrowser


class DemoHandler(SimpleHTTPRequestHandler):
    def do_GET(self):
        if urlsplit(self.path).path == '/':
            self.send_response(302)
            self.send_header('Location', '/' + quote('05-交互Demo') + '/demo-no-memory.html')
            self.end_headers()
            return
        super().do_GET()

    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()


def main():
    parser = argparse.ArgumentParser(description='启动两份可点击 Demo，仅监听本机。')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    root = Path(__file__).resolve().parent.parent
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), partial(DemoHandler, directory=str(root)))
    except OSError as exc:
        parser.exit(1, f'启动失败：{exc}\n端口可能已被占用，可使用 --port 8766。\n')
    url = f'http://127.0.0.1:{server.server_port}/'
    print(f'两份 Demo 已启动：{url}\n只在本机访问。按 Control+C 停止。', flush=True)
    if not args.no_browser:
        webbrowser.open(url)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
