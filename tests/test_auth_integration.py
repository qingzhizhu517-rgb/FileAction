"""账号对接验收：合成账号与文件，不调用真实模型或 COS。"""
import base64
import http.cookiejar
import json
import os
import re
import tempfile
import threading
import unittest
from pathlib import Path
from urllib.error import HTTPError
from urllib.request import Request, HTTPCookieProcessor, build_opener
from src.server import create_server


class AccountIntegrationTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.server = create_server(port=0, data_dir=Path(self.tmp.name), with_auth=True)
        threading.Thread(target=self.server.serve_forever, daemon=True).start()
        self.base = f'http://127.0.0.1:{self.server.server_port}'
        self.client = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))
        self.other = build_opener(HTTPCookieProcessor(http.cookiejar.CookieJar()))

    def tearDown(self):
        self.server.shutdown(); self.server.server_close(); self.tmp.cleanup()

    def request(self, path, data=None, *, client=None, headers=None):
        request = Request(self.base+path, data=json.dumps(data).encode() if data is not None else None,
                          headers={'Content-Type':'application/json', **(headers or {})})
        try:
            response = (client or self.client).open(request, timeout=5)
        except HTTPError as error:
            response = error
        with response:
            body = response.read().decode()
            return response.status, json.loads(body) if body and response.headers.get('Content-Type','').startswith('application/json') else body, response.headers

    def auth(self, action, data=None, client=None):
        _, body, _ = self.request('/api/v1/auth/csrf', client=client)
        return self.request('/api/v1/auth/'+action, data or {}, client=client,
                            headers={'X-CSRF-Token':body['data']['csrf_token']})

    def signup(self, username='synthetic_alice', client=None):
        body={'username':username,'password':'Synthetic-Pass-123!','display_name':'合成测试用户'}
        self.assertEqual(self.auth('register',body,client)[0],201)
        code, data, headers=self.auth('login',body,client)
        self.assertEqual(code,200)
        self.assertIn('HttpOnly',headers['Set-Cookie']); self.assertIn('SameSite=Strict',headers['Set-Cookie'])
        return data['data']['user']

    def token(self, client=None):
        status, html, _=self.request('/files',client=client)
        self.assertEqual(status,200)
        return re.search(r'name="fileaction-token" content="([^"]+)"',html).group(1)

    def test_register_login_logout_and_invalid_password(self):
        self.assertEqual(self.request('/api/v1/auth/me')[0],401)
        user=self.signup()
        self.assertEqual(self.request('/api/v1/auth/me')[1]['data']['id'],user['id'])
        self.assertEqual(self.request('/api/v1/auth/options')[1]['data']['demo'],None)
        token=self.token()
        self.assertEqual(self.request('/api/status',headers={'X-FileAction-Token':token})[0],200)
        self.assertEqual(self.auth('logout')[0],204)
        self.assertEqual(self.request('/api/status',headers={'X-FileAction-Token':token})[0],401)
        self.assertEqual(self.auth('login',{'username':user['username'],'password':'Wrong-pass-123!'})[0],401)
        self.assertEqual(self.auth('login',{'username':'unknown_user','password':'Wrong-pass-123!'})[1]['error']['message'],
                         '账号或密码不正确。')

    def test_accounts_cannot_read_each_others_files_or_memory(self):
        alice=self.signup(); a=self.token(); headers={'X-FileAction-Token':a}
        code, doc, _=self.request('/api/documents',{'name':'合成私有文件.txt','content':base64.b64encode('合成通知：申请材料。'.encode()).decode()},headers=headers)
        self.assertEqual(code,200)
        self.request('/api/memory',{'action':'add','target':'user','content':'合成本人为老师','consent':True},headers=headers)
        self.signup('synthetic_bob',self.other); b=self.token(self.other)
        bob={'X-FileAction-Token':b}
        self.assertEqual(self.request('/api/workspaces',client=self.other,headers=bob)[1]['workspaces'],[])
        self.assertEqual(self.request('/api/memory',client=self.other,headers=bob)[1]['entries'],[])
        self.assertEqual(self.request('/api/workspace/open',{'file_id':doc['file_id']},client=self.other,headers=bob)[0],404)
        self.assertEqual(self.request('/api/workspaces',client=self.other,headers=headers)[0],403)
        self.auth('logout'); self.auth('login',{'username':alice['username'],'password':'Synthetic-Pass-123!'})
        self.assertEqual(len(self.request('/api/workspaces',headers={'X-FileAction-Token':self.token()})[1]['workspaces']),1)

    def test_csrf_duplicate_validation_and_no_plaintext_passwords(self):
        self.assertEqual(self.request('/api/v1/auth/register',{'username':'abc','password':'Synthetic-Pass-123!','display_name':'测试'})[0],403)
        self.signup()
        self.assertEqual(self.auth('register',{'username':'synthetic_alice','password':'Synthetic-Pass-123!','display_name':'测试'})[0],409)
        self.assertEqual(self.auth('register',{'username':'../bad','password':'short','display_name':'测试'})[0],400)
        self.assertEqual(self.request('/api/v1/auth/csrf',headers={'Origin':'https://evil.example'})[0],403)
        for p in Path(self.tmp.name).rglob('*'):
            if p.is_file():self.assertNotIn(b'Synthetic-Pass-123!',p.read_bytes())
        self.assertEqual(os.stat(Path(self.tmp.name)/'accounts.sqlite3').st_mode & 0o777,0o600)

    def test_session_survives_auth_store_reload_but_temp_files_are_explicit(self):
        self.signup()
        from src.accounts import AccountStore
        self.server.accounts=AccountStore(Path(self.tmp.name)/'accounts.sqlite3')
        self.assertEqual(self.request('/api/v1/auth/me')[0],200)
        self.assertEqual(self.request('/files')[0],200)
