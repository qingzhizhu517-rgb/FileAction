"""COS SDK 替身的边界测试，不代替真实腾讯云存储验收。"""
import io
import importlib.util
import tempfile
import unittest
from pathlib import Path

from src.core import AppError
from src.storage import COSStore


class MockCOS:
    def __init__(self, config):
        self.objects = {}
        self.calls = []
        self.fail = False

    def put_object(self, **kwargs):
        self.calls.append(('put', kwargs))
        if self.fail:
            raise RuntimeError('SYNTHETIC_SECRET')
        self.objects[kwargs['Key']] = kwargs['Body']
        return {'ETag': 'synthetic-etag'}

    def head_object(self, **kwargs):
        return {'Content-Length': str(len(self.objects[kwargs['Key']]))}

    def get_object(self, **kwargs):
        class Body:
            def __init__(self, value):
                self.value = value
            def get_raw_stream(self):
                return io.BytesIO(self.value)
        return {'Body': Body(self.objects[kwargs['Key']])}

    def get_presigned_url(self, **kwargs):
        self.calls.append(('sign', kwargs))
        return 'https://synthetic.cos.ap-guangzhou.myqcloud.com/object?synthetic-signature'

    def delete_object(self, **kwargs):
        self.calls.append(('delete', kwargs))
        del self.objects[kwargs['Key']]


class StorageTests(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.store = COSStore(Path(self.tmp.name) / 'files.json', factory=MockCOS, use_env=False)

    def tearDown(self):
        self.tmp.cleanup()

    def configure(self):
        return self.store.configure('synthetic-1234567890', 'ap-guangzhou', 'synthetic-id', 'synthetic-key')

    def test_unconfigured_cos_never_falls_back_to_local_file_storage(self):
        with self.assertRaisesRegex(AppError, 'COS 未配置'):
            self.store.save('合成.txt', b'synthetic', consent=True)
        self.assertFalse(self.store.path.exists())

    def test_cloud_upload_requires_separate_consent(self):
        self.configure()
        with self.assertRaises(AppError):
            self.store.save('合成.txt', b'synthetic', consent=False)
        self.assertEqual(self.store.client.calls, [])

    def test_upload_is_private_random_key_and_record_contains_no_credentials(self):
        self.configure()
        record = self.store.save('个人合成通知.txt', '合成正文'.encode(), consent=True)
        kwargs = self.store.client.calls[0][1]
        self.assertEqual(kwargs['ACL'], 'private')
        self.assertTrue(kwargs['EnableMD5'])
        self.assertTrue(kwargs['Key'].startswith('fileaction/'))
        self.assertNotIn('个人合成通知', kwargs['Key'])
        self.assertNotIn('synthetic-key', self.store.path.read_text())
        self.assertEqual(self.store.read(record['id']), (record['name'], '合成正文'.encode()))

    def test_download_checks_size_and_sha256(self):
        self.configure()
        record = self.store.save('合成.txt', b'1234', consent=True)
        self.store.client.objects[record['key']] = b'4321'
        with self.assertRaisesRegex(AppError, '校验'):
            self.store.read(record['id'])

    def test_failed_upload_does_not_create_success_record(self):
        self.configure()
        self.store.client.fail = True
        with self.assertRaises(AppError) as got:
            self.store.save('合成.txt', b'abc', consent=True)
        self.assertNotIn('SYNTHETIC_SECRET', str(got.exception))
        self.assertEqual(self.store.list_files(), [])

    def test_presigned_url_has_short_expiry_and_local_owned_key_only(self):
        self.configure()
        record = self.store.save('合成.txt', b'abc', consent=True)
        self.store.download_url(record['id'])
        kwargs = self.store.client.calls[-1][1]
        self.assertEqual(kwargs['Expired'], 300)
        self.assertEqual(kwargs['Method'], 'GET')
        self.assertEqual(kwargs['Key'], record['key'])
        with self.assertRaises(AppError):
            self.store.download_url('../../some-other-key')

    def test_cloud_delete_requires_confirmation_and_removes_index_only_after_success(self):
        self.configure()
        record = self.store.save('合成.txt', b'abc', consent=True)
        with self.assertRaises(AppError):
            self.store.delete(record['id'], consent=False)
        self.assertEqual(len(self.store.list_files()), 1)
        self.store.delete(record['id'], consent=True)
        self.assertEqual(self.store.list_files(), [])

    def test_validate_bucket_region_and_never_expose_secrets(self):
        for bucket, region in [('bad', 'ap-guangzhou'), ('synthetic-1234567890', '../evil')]:
            with self.assertRaises(AppError):
                self.store.configure(bucket, region, 'id', 'key')
        self.configure()
        self.assertNotIn('secret_key', self.store.status())

    def test_temporary_token_is_present_in_download_signature(self):
        self.store.configure('synthetic-1234567890', 'ap-guangzhou', 'id', 'key', 'temporary-token')
        record = self.store.save('合成.txt', b'abc', consent=True)
        self.store.download_url(record['id'])
        self.assertEqual(self.store.client.calls[-1][1]['Params']['x-cos-security-token'], 'temporary-token')

    @unittest.skipUnless(importlib.util.find_spec('qcloud_cos'), '未安装官方 SDK')
    def test_official_sdk_constructor_and_presign_api_work_offline(self):
        """官方SDK真实签名代码离线验证，不代表云端请求验证。"""
        store = COSStore(Path(self.tmp.name) / 'sdk.json', use_env=False)
        store.configure('synthetic-1234567890', 'ap-guangzhou', 'synthetic-id', 'synthetic-key', 'synthetic-token')
        store.records = [{'id': 'test', 'key': 'fileaction/test.txt', 'name': '合成.txt', 'bucket': 'synthetic-1234567890', 'region': 'ap-guangzhou'}]
        url = store.download_url('test')['url']
        self.assertTrue(url.startswith('https://'))
        self.assertIn('q-signature', url)
        self.assertIn('x-cos-security-token=synthetic-token', url)


if __name__ == '__main__':
    unittest.main()
