"""本机合成模型 HTTP 服务验收；不使用密钥、不冒充真实 LLM。"""
import json
import base64
import os
import tempfile
import threading
import unittest
from unittest.mock import patch
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from src.core import AppError
from src.model import ModelClient
from src.server import create_server
from src.storage import COSStore
from tests.test_storage import MockCOS
from tests.test_core import MockModel, result


class SyntheticProvider(BaseHTTPRequestHandler):
    calls = []
    agents = []
    status = 200
    content = '{"ok":true}'

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.__class__.calls.append((self.path, body, self.headers.get('Authorization')))
        self.__class__.agents.append(self.headers.get('User-Agent'))
        self.send_response(self.status)
        self.send_header('Content-Type', 'application/json')
        self.end_headers()
        if self.status == 200:
            self.wfile.write(json.dumps({'choices': [{'message': {'content': self.content}}]}).encode())
        else:
            self.wfile.write(b'{"error":"SYNTHETIC_SECRET_MUST_NOT_LEAK"}')

    def log_message(self, *args):
        pass


class HTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.proxy_env = patch.dict(os.environ, {'NO_PROXY': 'localhost,127.0.0.1,::1', 'no_proxy': 'localhost,127.0.0.1,::1'})
        cls.proxy_env.start()
        cls.provider = ThreadingHTTPServer(('127.0.0.1', 0), SyntheticProvider)
        cls.thread = threading.Thread(target=cls.provider.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.provider.shutdown()
        cls.provider.server_close()
        cls.proxy_env.stop()

    def setUp(self):
        SyntheticProvider.calls = []
        SyntheticProvider.agents = []
        SyntheticProvider.status = 200
        SyntheticProvider.content = '{"ok":true}'
        self.client = ModelClient(use_env=False)
        self.url = f'http://127.0.0.1:{self.provider.server_port}/v1'

    def test_missing_configuration_fails_honestly(self):
        with self.assertRaisesRegex(AppError, '模型未配置'):
            self.client.complete('test', {})
        self.assertFalse(self.client.status()['configured'])

    def test_backend_provider_config_loads_without_exposing_key(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / 'model-config.json'
            config.write_text(json.dumps({'npm': '@ai-sdk/openai-compatible', 'options': {
                'baseURL': self.url, 'apiKey': 'synthetic-private-key', 'setCacheKey': True},
                'models': {'synthetic-model': {'name': 'synthetic-model'}, 'other-model': {'name': 'other-model'}},
                'default_model': 'synthetic-model'}))
            client = ModelClient(use_env=False, config_path=config)
            status = client.status()
            self.assertTrue(status['configured'])
            self.assertTrue(status['persistent'])
            self.assertEqual(status['models'], ['synthetic-model', 'other-model'])
            self.assertNotIn('synthetic-private-key', json.dumps(status))
            client.complete('test', {'document': {'id': 'synthetic-session'}})
            self.assertIn('prompt_cache_key', SyntheticProvider.calls[0][1])
            self.assertNotIn('setCacheKey', SyntheticProvider.calls[0][1])
            first = SyntheticProvider.calls[0][1]['prompt_cache_key']
            client.complete('test', {'document': {'id': 'synthetic-session'}})
            self.assertEqual(first, SyntheticProvider.calls[1][1]['prompt_cache_key'])

    def test_bad_backend_configuration_does_not_silently_use_other_model(self):
        with tempfile.TemporaryDirectory() as tmp:
            config = Path(tmp) / 'model-config.json'
            config.write_text('{broken-json')
            with self.assertRaises(AppError):
                ModelClient(use_env=False, config_path=config)

    def test_real_http_transport_uses_configured_model_and_json(self):
        self.client.configure(self.url, 'synthetic-key', 'synthetic-model')
        self.assertEqual(self.client.complete('合成测试', {'text': '合成数据'}), {'ok': True})
        path, payload, auth = SyntheticProvider.calls[0]
        self.assertEqual(path, '/v1/chat/completions')
        self.assertEqual(payload['model'], 'synthetic-model')
        self.assertEqual(auth, 'Bearer synthetic-key')
        self.assertNotIn('api_key', self.client.status())

    def test_request_identifies_product_instead_of_default_python_user_agent(self):
        self.client.configure(self.url, 'synthetic-key', 'synthetic-model')
        self.client.complete('test', {})
        self.assertEqual(SyntheticProvider.agents[-1], 'FileAction/0.1')

    def test_upstream_errors_are_sanitized_without_fake_fallback(self):
        self.client.configure(self.url, 'synthetic-key', 'synthetic-model')
        SyntheticProvider.status = 401
        with self.assertRaises(AppError) as got:
            self.client.complete('test', {})
        self.assertIn('401', str(got.exception))
        self.assertNotIn('SYNTHETIC_SECRET', str(got.exception))

    def test_non_json_output_is_failure(self):
        self.client.configure(self.url, 'synthetic-key', 'synthetic-model')
        SyntheticProvider.content = '不能解析的回复'
        with self.assertRaises(AppError):
            self.client.complete('test', {})

    def test_reject_insecure_remote_url_credentials_and_query(self):
        for url in ['http://example.com/v1', 'https://u:p@example.com/v1', 'https://example.com/v1?key=abc', 'file:///etc/passwd']:
            with self.subTest(url=url), self.assertRaises(AppError):
                self.client.configure(url, 'key', 'model')

    def test_server_rejects_cross_origin_and_missing_token(self):
        with tempfile.TemporaryDirectory() as tmp:
            server = create_server(port=0, data_dir=Path(tmp), model=self.client)
            worker = threading.Thread(target=server.serve_forever, daemon=True)
            worker.start()
            base = f'http://127.0.0.1:{server.server_port}'
            try:
                with urlopen(base) as response:
                    self.assertIn('文启', response.read().decode())
                for headers in [{}, {'X-FileAction-Token': server.token, 'Origin': 'https://example.com'}]:
                    req = Request(base + '/api/memory', headers=headers)
                    with self.assertRaises(HTTPError) as e:
                        urlopen(req)
                    self.assertEqual(e.exception.code, 403)
                    e.exception.close()
                req = Request(base + '/api/status', headers={'X-FileAction-Token': server.token})
                with urlopen(req) as response:
                    self.assertFalse(json.load(response)['configured'])
            finally:
                server.shutdown()
                server.server_close()

    def test_workspace_http_close_edit_and_restart_from_cos(self):
        with tempfile.TemporaryDirectory() as tmp:
            root=Path(tmp);storage=COSStore(root/'files.json',factory=MockCOS,use_env=False)
            storage.configure('synthetic-1234567890','ap-guangzhou','id','key')
            model=MockModel();model.reply=result()
            model.reply['insights'][0]['background_refs']=[]
            model.reply['insights'][0]['evidence']=[{'source_id':'L1','quote':'合成'}]
            server=create_server(0,root,model,storage)
            worker=threading.Thread(target=server.serve_forever,daemon=True);worker.start()
            def request(path,data=None):
                headers={'X-FileAction-Token':server.token,'Content-Type':'application/json'}
                body=json.dumps(data).encode() if data is not None else None
                with urlopen(Request(f'http://127.0.0.1:{server.server_port}'+path,data=body,headers=headers)) as response:return json.load(response)
            try:
                doc=request('/api/documents',{'name':'合成.txt','content':base64.b64encode('合成通知正文'.encode()).decode(),'persist':True})
                self.assertTrue(doc['persistent'])
                request('/api/chat',{'id':doc['id'],'message':'合成用户自述','consent':True})
                request('/api/workspace/knowledge',{'file_id':doc['file_id'],'field':'role','value':'合成教师','expected_revision':0})
                other=request('/api/workspace/thread',{'file_id':doc['file_id'],'title':'合成第二会话'})
                self.assertEqual(other['messages'],[]);self.assertEqual(other['knowledge']['entries'][0]['value'],'合成教师')
                request('/api/workspace/close',{'id':doc['id']})
                self.assertEqual(len(request('/api/workspaces')['workspaces']),1)
            finally:server.shutdown();server.server_close()
            # 新HTTP服务和新Application，复用同一COS测试对象，证明恢复来自快照而非旧应用缓存。
            cos_objects=storage.client
            new_storage=COSStore(root/'files.json',factory=lambda c:cos_objects,use_env=False)
            new_storage.configure('synthetic-1234567890','ap-guangzhou','id','key')
            server=create_server(0,root,model,new_storage)
            threading.Thread(target=server.serve_forever,daemon=True).start()
            try:
                opened=request('/api/workspace/open',{'file_id':doc['file_id'],'thread_id':doc['id']})
                self.assertEqual(len(opened['messages']),2);self.assertEqual(len(opened['threads']),2)
                self.assertEqual(opened['knowledge']['entries'][0]['value'],'合成教师')
                self.assertTrue(opened['persistent']);self.assertTrue(opened['outdated'])
                with self.assertRaises(HTTPError) as got:request('/api/workspace/delete',{'file_id':doc['file_id'],'consent':False})
                self.assertEqual(got.exception.code,403);got.exception.close()
            finally:server.shutdown();server.server_close()


if __name__ == '__main__':
    unittest.main()
