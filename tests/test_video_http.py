"""合成媒体字节，仅测试 HTTP 视频分段，不代表有效视频或真实模型调用。"""
import tempfile
import threading
import unittest
from pathlib import Path
from unittest.mock import patch
from urllib.error import HTTPError
from urllib.request import build_opener, ProxyHandler, Request

from src.model import ModelClient
from src.server import create_server


class VideoHTTPTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.tmp = tempfile.TemporaryDirectory()
        root = Path(cls.tmp.name)
        (root / 'frontend').mkdir()
        cls.content = b'SYNTHETIC_MEDIA_BYTES_FOR_HTTP_RANGE_TEST'
        (root / 'frontend' / 'project-video.mp4').write_bytes(cls.content)
        cls.root_patch = patch('src.server.ROOT', root)
        cls.root_patch.start()
        cls.server = create_server(0, root / 'runtime', model=ModelClient(use_env=False), with_auth=True)
        threading.Thread(target=cls.server.serve_forever, daemon=True).start()
        cls.url = f'http://127.0.0.1:{cls.server.server_port}/intro/project-video.mp4'
        cls.opener = build_opener(ProxyHandler({}))

    @classmethod
    def tearDownClass(cls):
        cls.server.shutdown()
        cls.server.server_close()
        cls.root_patch.stop()
        cls.tmp.cleanup()

    def test_range_returns_only_requested_bytes(self):
        with self.opener.open(Request(self.url, headers={'Range': 'bytes=5-14'})) as response:
            self.assertEqual(response.status, 206)
            self.assertEqual(response.headers['Accept-Ranges'], 'bytes')
            self.assertEqual(response.headers['Content-Range'], f'bytes 5-14/{len(self.content)}')
            self.assertEqual(response.headers['Content-Type'], 'video/mp4')
            self.assertEqual(response.read(), self.content[5:15])

    def test_open_and_suffix_ranges_and_full_download(self):
        for range_value, expected in [('bytes=10-', self.content[10:]), ('bytes=-8', self.content[-8:])]:
            with self.subTest(range=range_value), self.opener.open(Request(self.url, headers={'Range': range_value})) as response:
                self.assertEqual(response.status, 206)
                self.assertEqual(response.read(), expected)
        with self.opener.open(self.url) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(response.read(), self.content)

    def test_bad_or_out_of_bounds_range_returns_416(self):
        for value in ['bytes=999-', 'bytes=4-1', 'bytes=-0', 'bytes=bad', 'bytes=0-1,4-5']:
            with self.subTest(range=value):
                with self.assertRaises(HTTPError) as raised:
                    self.opener.open(Request(self.url, headers={'Range': value}))
                self.assertEqual(raised.exception.code, 416)
                self.assertEqual(raised.exception.headers['Content-Range'], f'bytes */{len(self.content)}')
                raised.exception.close()

    def test_head_reports_size_without_body(self):
        with self.opener.open(Request(self.url, method='HEAD')) as response:
            self.assertEqual(response.status, 200)
            self.assertEqual(int(response.headers['Content-Length']), len(self.content))
            self.assertEqual(response.headers['Accept-Ranges'], 'bytes')
            self.assertEqual(response.read(), b'')


if __name__ == '__main__':
    unittest.main()
