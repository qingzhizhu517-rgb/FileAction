"""本机单用户 HTTP 服务；文件默认仅内存，后台模型配置受控保存。"""
import argparse
import base64
import binascii
import json
import mimetypes
import secrets
import threading
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit

from .core import AppError, MemoryStore
from .model import ModelClient
from .storage import COSStore
from .workspaces import WorkspaceApplication

ROOT = Path(__file__).resolve().parent.parent
WEB = ROOT / 'src' / 'web'
FRONT = ROOT / 'front' / 'dist'


class Handler(BaseHTTPRequestHandler):
    @property
    def app(self):
        if not self.server.accounts:
            return self.server.app
        user = self.authenticated_user()
        return self.server.account_app(user['id'])[0]

    def authenticated_user(self):
        from .accounts import cookies, SESSION_COOKIE
        session = self.server.accounts.session(cookies(self.headers.get('Cookie')).get(SESSION_COOKIE))
        if not session:
            raise AppError('请先登录。',401)
        return session[0]

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
        if api:
            token = self.server.account_app(self.authenticated_user()['id'])[1] if self.server.accounts else self.server.token
            if not secrets.compare_digest(self.headers.get('X-FileAction-Token', ''), token):
                raise AppError('本机会话校验失败，请刷新页面。', 403)

    def _redirect(self, location):
        self.send_response(302)
        self.send_header('Location',location)
        self.send_header('Cache-Control','no-store')
        self.send_header('Content-Length','0')
        self.end_headers()

    def _auth_response(self, status, data=None, cookie=None):
        body = b'' if status==204 else json.dumps({'data':data},ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type','application/json; charset=utf-8')
        self.send_header('Content-Length',str(len(body)))
        self.send_header('Cache-Control','no-store')
        self.send_header('X-Content-Type-Options','nosniff')
        if cookie:
            self.send_header('Set-Cookie',cookie)
        self.end_headers()
        self.wfile.write(body)

    def _auth(self, path, data=None):
        from .accounts import SESSION_COOKIE, NONCE_COOKIE, cookies
        store = self.server.accounts
        action = path.removeprefix('/api/v1/auth/')
        if data is None:
            if action=='options':
                self._auth_response(200,{'registration_enabled':True,'demo':None})
            elif action=='me':
                self._auth_response(200,self.authenticated_user())
            elif action=='csrf':
                token,nonce=store.csrf(self.headers.get('Cookie'))
                self._auth_response(200,{'csrf_token':token},f'{NONCE_COOKIE}={nonce}; Path=/; HttpOnly; SameSite=Strict; Max-Age=600' if nonce else None)
            else:
                raise AppError('接口不存在。',404)
            return
        store.verify_csrf(self.headers.get('Cookie'),self.headers.get('X-CSRF-Token',''))
        if action in ('register','login'):
            store.throttle(data.get('username'))
        if action=='register':
            self._auth_response(201,store.register(data))
        elif action=='login':
            user,session=store.login(data,cookies(self.headers.get('Cookie')).get(SESSION_COOKIE))
            self._auth_response(200,{'user':user},f'{SESSION_COOKIE}={session}; Path=/; HttpOnly; SameSite=Strict; Max-Age=43200')
        elif action=='logout':
            store.logout(self.headers.get('Cookie'))
            self._auth_response(204,cookie=f'{SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0')
        else:
            raise AppError('接口不存在。',404)

    def _error(self,error,path):
        if self.server.accounts and path.startswith('/api/v1/'):
            self._send(error.status,{'error':{'code':'AUTH_ERROR','message':str(error)}})
        else:
            self._send(error.status,{'error':str(error)})

    def _entry_asset(self,path):
        if path.startswith('/intro/'):
            filename=path.removeprefix('/intro/') or 'index.html'
            folder=ROOT/'frontend'
        elif path.startswith('/assets/'):
            filename=path.removeprefix('/assets/')
            folder=FRONT/'assets'
        else:
            return False
        import re
        if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]*\.(html|css|js|svg|mp4|png|woff2)',filename):
            raise AppError('页面不存在。',404)
        file=folder/filename
        if not file.is_file() or file.is_symlink():
            raise AppError('页面不存在。',404)
        self._send(200,file.read_bytes(),(mimetypes.guess_type(file.name)[0] or 'application/octet-stream')+'; charset=utf-8')
        return True

    def _send(self, status, body, mime='application/json; charset=utf-8'):
        if not isinstance(body, bytes):
            body = json.dumps(body, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        style_extra=" 'unsafe-inline'" if self.server.accounts and urlsplit(self.path).path.startswith(('/intro/','/login','/register','/assets/')) else ''
        self.send_header('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'"+style_extra+"; img-src 'self' data:; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
        self.end_headers()
        try:
            self.wfile.write(body)
        except (BrokenPipeError, ConnectionResetError):
            pass

    def do_GET(self):
        try:
            path = urlsplit(self.path).path
            auth_path = self.server.accounts and path.startswith('/api/v1/auth/')
            self._guard(path.startswith('/api/') and not auth_path)
            if self.server.accounts:
                if auth_path:
                    self._auth(path);return
                if path in ('/','/index.html','/intro'):
                    self._redirect('/intro/');return
                if self._entry_asset(path):
                    return
                if path in ('/login','/register'):
                    file=FRONT/'personal.html'
                    if not file.is_file():
                        raise AppError('账号界面尚未构建，请先运行 npm --prefix front run build。',503)
                    self._send(200,file.read_bytes(),'text/html; charset=utf-8');return
                if path=='/files':
                    try:
                        user=self.authenticated_user()
                    except AppError:
                        self._redirect('/login');return
                    token=self.server.account_app(user['id'])[1]
                    html=(WEB/'index.html').read_text().replace('__TOKEN__',token).replace('__ACCOUNT_MODE__','true')
                    self._send(200,html.encode(),'text/html; charset=utf-8');return
            if path == '/api/status':
                import importlib.util
                self._send(200, {**self.app.model.status(), 'pdf': bool(importlib.util.find_spec('pypdf')),
                                 'storage': self.app.storage.status(), 'account':self.authenticated_user() if self.server.accounts else None})
            elif path == '/api/memory':
                self._send(200, self.app.memory.snapshot())
            elif path == '/api/files':
                self._send(200, {'files': self.app.storage.list_files()})
            elif path == '/api/workspaces':
                self._send(200, {'workspaces': self.app.list_workspaces()})
            elif path in ('/api/memory/user.md', '/api/memory/memory.md'):
                target = 'user' if path.endswith('/user.md') else 'memory'
                self._send(200, self.app.memory.markdown(target).encode(), 'text/markdown; charset=utf-8')
            elif path in ('/', '/index.html'):
                html = (WEB / 'index.html').read_text(encoding='utf-8').replace('__TOKEN__', self.server.token).replace('__ACCOUNT_MODE__','false')
                self._send(200, html.encode(), 'text/html; charset=utf-8')
            elif path in ('/app.js', '/style.css'):
                file = WEB / path[1:]
                self._send(200, file.read_bytes(), mimetypes.guess_type(file.name)[0] + '; charset=utf-8')
            elif path == '/logo.svg':
                self._send(200, (ROOT / 'frontend/wenqi-icon.svg').read_bytes(), 'image/svg+xml')
            else:
                self._send(404, {'error': '页面不存在。'})
        except AppError as e:
            self._error(e,path)

    def _stream(self, work):
        started=False
        def emit(event):
            nonlocal started
            if not started:
                self.send_response(200)
                self.send_header('Content-Type','application/x-ndjson; charset=utf-8')
                self.send_header('Cache-Control','no-store')
                self.send_header('X-Content-Type-Options','nosniff')
                self.send_header('Connection','close')
                self.end_headers();self.close_connection=True;started=True
            self.wfile.write((json.dumps(event,ensure_ascii=False)+'\n').encode())
            self.wfile.flush()
        try:
            result=work(lambda field,value:emit({'type':'delta','field':field,'text':value}))
            emit({'type':'done','result':result})
        except (BrokenPipeError,ConnectionResetError,TimeoutError):pass
        except Exception as error:
            if isinstance(error,AppError):message=str(error);status=error.status
            else:message='流式处理失败，未保存不完整结果。请重试。';status=500
            if not started:self._send(status,{'error':message})
            else:
                try:emit({'type':'error','error':message,'status':status})
                except (BrokenPipeError,ConnectionResetError,TimeoutError):pass

    def do_POST(self):
        try:
            path = urlsplit(self.path).path
            auth_path = self.server.accounts and path.startswith('/api/v1/auth/')
            self._guard(not auth_path)
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
            if auth_path:
                self._auth(path,data);return
            app = self.app
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
                if data.get('stream') is True:
                    self._stream(lambda delta:app.chat(data.get('id'),data.get('message',''),data.get('consent'),delta));return
                result = app.chat(data.get('id'), data.get('message', ''), data.get('consent'))
            elif path == '/api/action':
                if data.get('stream') is True:
                    self._stream(lambda delta:app.action(data.get('id'),data.get('revision'),data.get('goal'),data.get('confirmed'),data.get('consent'),delta));return
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
            self._error(e,path)
        except Exception:
            self._send(500, {'error': '服务处理失败，请重新尝试。未生成替代结果。'})


def create_server(port=8787, data_dir=None, model=None, storage=None, with_auth=False, app_factory=None):
    server = ThreadingHTTPServer(('127.0.0.1', port), Handler)
    server.daemon_threads = True
    server.token = secrets.token_urlsafe(32)
    folder = Path(data_dir or ROOT / 'var')
    server.app = WorkspaceApplication(MemoryStore(folder / 'memory.json'), model or ModelClient(config_path=folder / 'model-config.json'), storage or COSStore(folder / 'files.json'), folder / 'workspaces.json')
    server.accounts=None
    if with_auth:
        from .accounts import AccountStore
        server.accounts=AccountStore(folder/'accounts.sqlite3')
        applications={}
        lock=threading.RLock()
        def account_app(uid):
            with lock:
                if uid not in applications:
                    account_folder=folder/'users'/uid
                    if app_factory:
                        app=app_factory(account_folder)
                    else:
                        client=ModelClient(use_env=False,config_path=account_folder/'model-config.json')
                        if not client.config and server.app.model.config:
                            c=server.app.model.config
                            client.configure(c['base_url'],c['api_key'],c['model'],c['json_mode'],c['set_cache_key'])
                        app=WorkspaceApplication(MemoryStore(account_folder/'memory.json'),client,COSStore(account_folder/'files.json'),account_folder/'workspaces.json')
                    applications[uid]=(app,secrets.token_urlsafe(32))
                return applications[uid]
        server.account_app=account_app
    return server


def main():
    parser = argparse.ArgumentParser(description='文启个人端 MVP，本机单用户运行。')
    parser.add_argument('--port', type=int, default=8787)
    parser.add_argument('--data-dir', type=Path, default=ROOT / 'var')
    parser.add_argument('--with-auth',action='store_true',help='main 首页与账号入口，账号各有独立文件、档案和配置')
    args = parser.parse_args()
    server = create_server(args.port, args.data_dir, with_auth=args.with_auth)
    print(f'文启已启动：http://127.0.0.1:{server.server_port}/\n按 Ctrl+C 停止。文件持久化使用腾讯云 COS；后台模型读取受控配置。COS 页面密钥仅在内存中，本机记忆和对象索引在 {args.data_dir}', flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()


if __name__ == '__main__':
    main()
