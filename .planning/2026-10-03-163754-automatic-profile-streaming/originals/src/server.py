"""本机单用户 HTTP 服务；文件默认仅内存，后台模型配置受控保存。"""
import argparse
import base64
import binascii
import json
import mimetypes
import secrets
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .core import AppError, MemoryStore
from .model import ModelClient
from .storage import COSStore
from .workspaces import WorkspaceApplication

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / 'src' / 'web'


class Handler(BaseHTTPRequestHandler):
    def log_message(self, *args):
        pass  # 不记录用户文件、背景、密钥或请求体。

    def _guard(self, api=False):
        allowed = {f'127.0.0.1:{self.server.server_port}', f'localhost:{self.server.server_port}'}
        host = self.headers.get('Host', '')
        if host not in allowed:
            raise AppError('只接受本机访问。', 403)
        origin = self.headers.get('Origin')
        if origin and origin not in {'http://' + h for h in allowed}:
            raise AppError('不允许跨站访问本机服务。', 403)
        if api and not secrets.compare_digest(self.headers.get('X-FileAction-Token', ''), self.server.token):
            raise AppError('本机会话校验失败，请刷新页面。', 403)

    def _send(self, status, body, mime='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        try:
            path = urlsplit(self.path).path
            self._guard(path.startswith('/api/'))
            if path == '/api/status':
                import importlib.util
                self._send(200, {**self.server.app.model.status(), 'pdf': bool(importlib.util.find_spec('pypdf')),
                                 'storage': self.server.app.storage.status()})
            elif path == '/api/memory':
                self._send(200, self.server.app.memory.snapshot())
            elif path == '/api/files':
                self._send(200, {'files': self.server.app.storage.list_files()})
            elif path == '/api/workspaces':
                self._send(200, {'workspaces': self.server.app.list_workspaces()})
            elif path in ('/api/memory/user.md', '/api/memory/memory.md'):
                target = 'user' if path.endswith('/user.md') else 'memory'
                self._send(200, self.server.app.memory.markdown(target).encode(), 'text/markdown; charset=utf-8')
            elif path in ('/', '/index.html'):
                html = (WEB / 'index.html').read_text(encoding='utf-8').replace('__TOKEN__', self.server.token)
                self._send(200, html.encode(), 'text/html; charset=utf-8')
            elif path in ('/app.js', '/style.css'):
                file = WEB / path[1:]
                self._send(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] + '; charset=utf-8')
            elif path == '/logo.svg':
                self._send(200, (ROOT / 'docs/01-产品方案/品牌视觉/可行动事务Agent-Logo.svg').read_bytes(), 'image/svg+xml')
            else:
                self._send(404, {'error': '页面不存在。'})
        except AppError as e:
            self._send(e.status, {'error': str(e)})

    def do_POST(self):
        try:
            self._guard(True)
            if self.headers.get('Content-Type', '').split(';')[0] != 'application/json':
                raise AppError('请求须为 JSON。', 415)
            try:
                length = int(self.headers.get('Content-Length', '0'))
            except ValueError:
                raise AppError('请求长度不正确。') from None
            if not 0 < length <= 12 * 1024 * 1024:
                raise AppError('请求为空或超过12 MB。', 413)
            self.connection.settimeout(20)
            try:
                data = json.loads(self.rfile.read(length))
            except (ValueError, TimeoutError):
                raise AppError('请求不是有效 JSON。') from None
            if not isinstance(data, dict):
                raise AppError('请求须为 JSON 对象。')
            app = self.server.app
            path = urlsplit(self.path).path
            if path == '/api/config':
                result = app.model.configure(data.get('base_url'), data.get('api_key'), data.get('model'), data.get('json_mode', False))
            elif path == '/api/cos/config':
                result = app.storage.configure(data.get('bucket'), data.get('region'), data.get('secret_id'), data.get('secret_key'), data.get('token', ''))
            elif path == '/api/cos/store':
                result = app.store_document(data.get('id'), data.get('consent'))
            elif path == '/api/cos/open':
                result = app.open_stored(data.get('id'))
            elif path == '/api/cos/download':
                result = app.storage.download_url(data.get('id'))
            elif path == '/api/cos/delete':
                result = app.storage.delete(data.get('id'), data.get('consent'))
            elif path == '/api/cos/draft':
                from .core import text
                title = text(data.get('title'), '产物标题', 160)
                markdown = text(data.get('markdown'), '产物正文', 30000)
                result = app.storage.save(title + '.md', markdown.encode(), consent=data.get('consent'), kind='draft')
            elif path == '/api/connect':
                app.model.complete('只返回 JSON 对象 {"ok":true}。本请求用于连接测试。', {'purpose': '文启模型连接测试，无用户文件和背景'})
                result = {'ok': True, 'message': '模型已返回有效 JSON。可以开始解读。'}
            elif path == '/api/documents':
                try:
                    raw = base64.b64decode(data.get('content', ''), validate=True)
                except (ValueError, TypeError, binascii.Error):
                    raise AppError('上传内容不正确。') from None
                result = app.upload(data.get('name'), raw)
                if data.get('persist') is True:
                    try:
                        app.store_document(result['id'], True)
                        result = app.open_workspace(result['file_id'], result['id'])
                    except AppError as error:
                        result['sync'] = {'pending': True, 'error': str(error), 'persistent': False}
            elif path == '/api/workspace/open':
                result = app.open_workspace(data.get('file_id'), data.get('thread_id'))
            elif path == '/api/workspace/thread':
                result = app.new_thread(data.get('file_id'), data.get('title', '新的对话'))
            elif path == '/api/workspace/knowledge':
                result = app.edit_knowledge(data.get('file_id'), data.get('field'), data.get('value'), data.get('expected_revision'))
            elif path == '/api/workspace/sync':
                result = app.sync_workspace(data.get('file_id'), data.get('consent'))
            elif path == '/api/workspace/draft':
                result = app.save_draft(data.get('id'), data.get('markdown'))
            elif path == '/api/workspace/close':
                result = app.close_thread(data.get('id'))
            elif path == '/api/workspace/delete':
                result = app.delete_workspace(data.get('file_id'), data.get('consent'))
            elif path == '/api/analyze':
                result = app.analyze(data.get('id'), data.get('background', []), data.get('consent'))
            elif path == '/api/chat':
                result = app.chat(data.get('id'), data.get('message', ''), data.get('consent'))
            elif path == '/api/action':
                result = app.action(data.get('id'), data.get('revision'), data.get('goal'), data.get('confirmed'), data.get('consent'))
            elif path == '/api/cancel':
                result = app.cancel(data.get('id'))
            elif path == '/api/forget':
                result = app.forget(data.get('id'))
            elif path == '/api/refresh-memory':
                result = app.refresh_memory(data.get('id'))
            elif path == '/api/memory':
                result = app.memory.apply(data.get('action'), data.get('target'), data.get('content', ''),
                                          data.get('entry_id', ''), data.get('consent'), data.get('source', '用户手动确认'),
                                          data.get('expected_revision'))
            else:
                raise AppError('接口不存在。', 404)
            self._send(200, result)
        except AppError as e:
            self._send(e.status, {'error': str(e)})
        except Exception:
            self._send(500, {'error': '服务处理失败，请重新尝试。未生成替代结果。'})


def create_server(port=8787, data_dir=None, model=None, storage=None):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.token = secrets.token_urlsafe(32)
    folder = Path(data_dir or ROOT / 'var')
    server.app = WorkspaceApplication(MemoryStore(folder / 'memory.json'), model or ModelClient(config_path=folder / 'model-config.json'), storage or COSStore(folder / 'files.json'), folder / 'workspaces.json')
    return server


def main():
    parser = argparse.ArgumentParser(description='文启个人端 MVP，本机单用户运行。')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'var')
    args = parser.parse_args()
    server = create_server(args.port, args.data_dir)
    print(f'文启已启动：http://127.0.0.1:{server.server_port}/\n按 Ctrl+C 停止。文件持久化使用腾讯云 COS；后台模型读取受控配置。COS 页面密钥仅在内存中，本机记忆和对象索引在 {args.data_dir}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
