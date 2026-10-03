"""本机合成模型 HTTP 服务验收；不使用密钥、不冒充真实 LLM。"""
import json
import tempfile
import threading
import unittest
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError

from src.core import AppError
from src.model import ModelClient
from src.server import create_server


class SyntheticProvider(BaseHTTPRequestHandler):
    calls = []
    status = 200
    content = '{"ok":true}'

    def do_POST(self):
        body = json.loads(self.rfile.read(int(self.headers['Content-Length'])))
        self.__class__.calls.append((self.path, body, self.headers.get('Authorization')))
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
        cls.provider = ThreadingHTTPServer(('127.0.0.1', 0), SyntheticProvider)
        cls.thread = threading.Thread(target=cls.provider.serve_forever, daemon=True)
        cls.thread.start()

    @classmethod
    def tearDownClass(cls):
        cls.provider.shutdown()
        cls.provider.server_close()

    def setUp(self):
        SyntheticProvider.calls = []
        SyntheticProvider.status = 200
        SyntheticProvider.content = '{"ok":true}'
        self.client = ModelClient(use_env=False)
        self.url = f'http://127.0.0.1:{self.provider.server_port}/v1'

    def test_missing_configuration_fails_honestly(self):
        with self.assertRaisesRegex(AppError, '模型未配置'):
            self.client.complete('test', {})
        self.assertFalse(self.client.status()['configured'])

    def test_real_http_transport_uses_configured_model_and_json(self):
        self.client.configure(self.url, 'synthetic-key', 'synthetic-model')
        self.assertEqual(self.client.complete('合成测试', {'text': '合成数据'}), {'ok': True})
        path, payload, auth = SyntheticProvider.calls[0]
        self.assertEqual(path, '/v1/chat/completions')
        self.assertEqual(payload['model'], 'synthetic-model')
        self.assertEqual(auth, 'Bearer synthetic-key')
        self.assertNotIn('api_key', self.client.status())

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


if __name__ == '__main__':
    unittest.main()
