"""实际 COS SDK + 合成 HTTP 响应；替换 send_request，禁止真实网络。"""
import hashlib
import io
from dataclasses import replace
from uuid import UUID

import pytest
from qcloud_cos import CosConfig, CosS3Client
from requests import Response
from requests.structures import CaseInsensitiveDict

from fileaction.db.session import ActorContext
from fileaction.storage_adapters.cos import CosBlobStore, CosConfiguration, ObjectRef, StorageError

ACTOR = ActorContext(UUID(int=1), UUID(int=2))
DOCUMENT, VERSION = UUID(int=3), UUID(int=4)
DIGEST = hashlib.sha256(b'abc').hexdigest()


def sdk_store(monkeypatch, headers=None, body=b'abc'):
    client = CosS3Client(CosConfig(Region='ap-test', SecretId='synthetic', SecretKey='synthetic', Scheme='https'), retry=0)
    calls, streams = [], []
    response_headers = headers if headers is not None else {'content-length': '3', 'x-cos-version-id': 'v1', 'x-cos-meta-sha256': DIGEST}

    def send_request(**kwargs):
        calls.append(kwargs)
        response = Response()
        response.status_code = 206 if 'Range' in kwargs['headers'] else 200
        response.headers = CaseInsensitiveDict(response_headers)
        response.raw = io.BytesIO(body)
        streams.append(response.raw)
        return response

    monkeypatch.setattr(client, 'send_request', send_request)
    store = CosBlobStore(CosConfiguration('synthetic-123', 'ap-test'), client)
    ref = ObjectRef('synthetic-123', store.object_key(ACTOR, DOCUMENT, VERSION), 'v1', DIGEST, 3)
    return store, ref, calls, streams


def test_real_sdk_put_maps_metadata_to_cos_header(monkeypatch):
    store, _, calls, _ = sdk_store(monkeypatch)
    store.put(ACTOR, DOCUMENT, VERSION, b'abc', DIGEST)
    assert calls[0]['headers']['x-cos-meta-sha256'] == DIGEST
    assert calls[0]['headers']['x-cos-acl'] == 'private'
    assert calls[0]['headers']['x-cos-server-side-encryption'] == 'AES256'


@pytest.mark.parametrize('version_header', ['x-cos-version-id', 'X-Cos-Version-Id'])
def test_real_sdk_put_preserves_version_header(monkeypatch, version_header):
    store, _, _, _ = sdk_store(monkeypatch, {version_header: 'v1'})
    assert store.put(ACTOR, DOCUMENT, VERSION, b'abc', DIGEST).version_id == 'v1'


@pytest.mark.parametrize('headers', [{}, {'x-cos-version-id': ''}, {'x-cos-version-id': 'null'}])
def test_versioned_put_rejects_missing_or_null_version(monkeypatch, headers):
    store, _, _, _ = sdk_store(monkeypatch, headers)
    with pytest.raises(StorageError, match='CONTENT_INTEGRITY_FAILED'):
        store.put(ACTOR, DOCUMENT, VERSION, b'abc', DIGEST)


@pytest.mark.parametrize('upper', [False, True])
def test_real_sdk_head_and_full_read_normalize_headers(monkeypatch, upper):
    headers = {'content-length': '3', 'x-cos-version-id': 'v1', 'x-cos-meta-sha256': DIGEST}
    if upper:
        headers = {k.upper(): v for k, v in headers.items()}
    store, ref, calls, streams = sdk_store(monkeypatch, headers)
    assert store.head(ACTOR, ref) == {'size_bytes': 3, 'version_id': 'v1'}
    assert store.read_range(ACTOR, ref).read() == b'abc'
    assert calls[0]['params'] == {'versionId': 'v1'}
    # get_object applies the SDK's format_values (UTF-8 bytes) to query values.
    assert calls[1]['params'] == {'versionId': b'v1'}
    assert streams[-1].closed


def test_real_sdk_range_is_validated_and_exact_version_deleted(monkeypatch):
    store, ref, calls, streams = sdk_store(monkeypatch, {'CONTENT-LENGTH': '2', 'X-Cos-Version-Id': 'v1', 'X-Cos-Meta-Sha256': DIGEST, 'CONTENT-RANGE': 'bytes 1-2/3'}, b'bc')
    assert store.read_range(ACTOR, ref, (1, 2)).read() == b'bc'
    assert calls[0]['headers']['Range'] == 'bytes=1-2'
    assert calls[0]['params'] == {'versionId': b'v1'}
    assert streams[0].closed
    store.delete_version(ACTOR, ref)
    assert calls[1]['method'] == 'DELETE'
    assert calls[1]['params'] == {'versionId': 'v1'}


@pytest.mark.parametrize('change', [{'x-cos-version-id': 'wrong'}, {'content-length': '4'}, {'x-cos-meta-sha256': 'wrong'}])
def test_real_sdk_rejects_wrong_response_integrity_headers(monkeypatch, change):
    headers = {'content-length': '3', 'x-cos-version-id': 'v1', 'x-cos-meta-sha256': DIGEST, **change}
    store, ref, _, streams = sdk_store(monkeypatch, headers)
    with pytest.raises(StorageError, match='CONTENT_INTEGRITY_FAILED'):
        store.head(ACTOR, ref)
    with pytest.raises(StorageError, match='CONTENT_INTEGRITY_FAILED'):
        store.read_range(ACTOR, ref)
    assert streams[-1].closed


@pytest.mark.parametrize('body', [b'ab', b'abcd', b'bad'])
def test_real_sdk_full_read_rejects_wrong_body_length_or_hash(monkeypatch, body):
    store, ref, _, streams = sdk_store(monkeypatch, body=body)
    with pytest.raises(StorageError, match='CONTENT_INTEGRITY_FAILED'):
        store.read_range(ACTOR, ref)
    assert streams[-1].closed


def test_real_sdk_range_rejects_wrong_content_range(monkeypatch):
    store, ref, _, streams = sdk_store(monkeypatch, {'content-length': '2', 'x-cos-version-id': 'v1', 'x-cos-meta-sha256': DIGEST, 'content-range': 'bytes 0-1/3'}, b'bc')
    with pytest.raises(StorageError, match='CONTENT_INTEGRITY_FAILED'):
        store.read_range(ACTOR, ref, (1, 2))
    assert streams[-1].closed


@pytest.mark.parametrize('version', [None, '', 'null'])
def test_no_operation_falls_back_to_unversioned_object(monkeypatch, version):
    store, ref, calls, _ = sdk_store(monkeypatch)
    ref = replace(ref, version_id=version)
    for operation in (store.head, store.read_range, store.delete_version):
        with pytest.raises(StorageError, match='CONTENT_INTEGRITY_FAILED'):
            operation(ACTOR, ref)
    assert calls == []
