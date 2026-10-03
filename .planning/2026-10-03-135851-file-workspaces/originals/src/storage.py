"""腾讯云 COS 私有文件存储。只在用户明确确认后上传或删除。"""
import copy
import hashlib
import json
import mimetypes
import os
import re
import threading
import uuid
from datetime import datetime, timezone, timedelta
from pathlib import Path
from urllib.parse import quote

from .core import AppError, text


def sdk_client(config):
    try:
        from qcloud_cos import CosConfig, CosS3Client
    except ImportError:
        raise AppError('COS SDK 未安装，请先运行 .venv/bin/python -m pip install -r requirements.txt。', 503) from None
    return CosS3Client(CosConfig(Region=config['region'], SecretId=config['secret_id'],
                                SecretKey=config['secret_key'], Token=config['token'] or None,
                                Scheme='https', Timeout=20), retry=0)


class COSStore:
    def __init__(self, path, factory=sdk_client, use_env=True):
        self.path = Path(path)
        self.factory = factory
        self.lock = threading.RLock()
        self.config = None
        self.client = None
        self.records = []
        if self.path.exists():
            try:
                self.records = json.loads(self.path.read_text(encoding='utf-8'))
                assert isinstance(self.records, list)
            except Exception:
                raise AppError('本机 COS 文件索引损坏，请备份检查。原文件仍在 COS，索引没有被覆盖。', 500)
        if use_env and os.environ.get('COS_SECRET_ID'):
            self.configure(os.environ.get('COS_BUCKET', ''), os.environ.get('COS_REGION', ''),
                           os.environ['COS_SECRET_ID'], os.environ.get('COS_SECRET_KEY', ''), os.environ.get('COS_TOKEN', ''))

    def configure(self, bucket, region, secret_id, secret_key, token=''):
        bucket = text(bucket, 'Bucket', 100)
        region = text(region, 'Region', 60)
        if not re.fullmatch(r'[a-z0-9][a-z0-9-]{0,62}-\d{5,20}', bucket) or not re.fullmatch(r'[a-z]{2}-[a-z0-9-]+', region):
            raise AppError('Bucket 须包含 APPID，Region 须为地域标识（例如 ap-guangzhou）。')
        config = {'bucket': bucket, 'region': region, 'secret_id': text(secret_id, 'SecretId', 300),
                  'secret_key': text(secret_key, 'SecretKey', 1000), 'token': text(token, '临时Token', 4000, empty=True)}
        try:
            client = self.factory(config)
        except AppError:
            raise
        except Exception:
            raise AppError('COS 配置失败，请检查参数。未保存密钥到磁盘。') from None
        with self.lock:
            self.config, self.client = config, client
        return self.status()

    def status(self):
        with self.lock:
            c = self.config
            return {'configured': bool(c), 'provider': '腾讯云 COS', 'bucket': c['bucket'] if c else '',
                    'region': c['region'] if c else ''}

    def _configured(self):
        if not self.config:
            raise AppError('COS 未配置，请先填写 Bucket、Region 和访问密钥。未改用本地文件存储。', 503)
        return dict(self.config), self.client

    def _record(self, uid):
        c, client = self._configured()
        match = next((r for r in self.records if r['id'] == uid and r['bucket'] == c['bucket'] and r['region'] == c['region']), None)
        if match is None or not match['key'].startswith('fileaction/'):
            raise AppError('文件不在本机登记的当前 COS 存储桶中。', 404)
        return copy.deepcopy(match), client

    def _persist(self):
        self.path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        temp = self.path.with_suffix('.tmp')
        with temp.open('w', encoding='utf-8') as stream:
            os.chmod(temp, 0o600)
            json.dump(self.records, stream, ensure_ascii=False, indent=2)
            stream.flush()
            os.fsync(stream.fileno())
        os.replace(temp, self.path)

    def list_files(self):
        with self.lock:
            if not self.config:
                return []
            return copy.deepcopy([r for r in self.records if r['bucket'] == self.config['bucket'] and r['region'] == self.config['region']])

    def save(self, name, raw, consent=False, kind='original'):
        if consent is not True:
            raise AppError('将文件保存到腾讯云 COS 需要你明确确认。', 403)
        name = text(name, '文件名', 180)
        if not isinstance(raw, bytes) or not 0 < len(raw) <= 8 * 1024 * 1024 or kind not in ('original', 'draft'):
            raise AppError('文件为空、格式不正确或超过8 MB。')
        suffix = Path(name).suffix.lower()
        if suffix not in ('.txt', '.md', '.docx', '.pdf'):
            raise AppError('COS 文件存储只接受本产品支持的文件格式。')
        uid = uuid.uuid4().hex
        key = f'fileaction/{kind}/{uid}{suffix}'
        with self.lock:
            c, client = self._configured()
            try:
                response = client.put_object(Bucket=c['bucket'], Key=key, Body=raw, ACL='private', EnableMD5=True,
                                             ContentType=mimetypes.guess_type(name)[0] or 'application/octet-stream')
                head = client.head_object(Bucket=c['bucket'], Key=key)
                if int(head['Content-Length']) != len(raw):
                    raise ValueError('size')
            except Exception:
                # 不自动删对象：可能上传成功但 HEAD 因权限失败，需用户检查。
                raise AppError('COS 上传或校验失败，请检查权限、Bucket、Region 和网络。未登记成功；若上传已到达云端，请在控制台检查 fileaction/ 下的对象。', 502) from None
            record = {'id': uid, 'key': key, 'name': name, 'kind': kind, 'bucket': c['bucket'], 'region': c['region'],
                      'size': len(raw), 'sha256': hashlib.sha256(raw).hexdigest(), 'etag': response.get('ETag', ''),
                      'created': datetime.now(timezone(timedelta(hours=8))).isoformat(timespec='seconds')}
            self.records.append(record)
            try:
                self._persist()
            except OSError:
                self.records.remove(record)
                raise AppError('COS 对象已上传，但本机索引保存失败。请在控制台检查 fileaction/ 下的对象。', 500) from None
            return copy.deepcopy(record)

    def read(self, uid):
        with self.lock:
            record, client = self._record(uid)
            try:
                response = client.get_object(Bucket=record['bucket'], Key=record['key'])
                stream = response['Body'].get_raw_stream()
                try:
                    raw = stream.read(8 * 1024 * 1024 + 1)
                finally:
                    stream.close()
            except Exception:
                raise AppError('COS 读取失败，请检查访问权限、配置和网络。', 502) from None
            if len(raw) != record['size'] or hashlib.sha256(raw).hexdigest() != record['sha256']:
                raise AppError('COS 文件完整性校验失败，未使用被替换的文件。', 502)
            return record['name'], raw

    def download_url(self, uid):
        with self.lock:
            record, client = self._record(uid)
            try:
                params = {'response-content-disposition': "attachment; filename*=UTF-8''" + quote(record['name'], safe='')}
                if self.config['token']:
                    params['x-cos-security-token'] = self.config['token']
                url = client.get_presigned_url(Bucket=record['bucket'], Key=record['key'], Method='GET', Expired=300, Params=params)
            except Exception:
                raise AppError('COS 下载签名失败，请检查配置。', 502) from None
            return {'url': url, 'expires_in': 300, 'name': record['name']}

    def delete(self, uid, consent=False):
        if consent is not True:
            raise AppError('删除云端文件需要明确确认。', 403)
        with self.lock:
            record, client = self._record(uid)
            try:
                client.delete_object(Bucket=record['bucket'], Key=record['key'])
            except Exception:
                raise AppError('COS 删除失败，本机索引没有移除。', 502) from None
            self.records = [r for r in self.records if r['id'] != uid]
            self._persist()
        return {'deleted': True}
