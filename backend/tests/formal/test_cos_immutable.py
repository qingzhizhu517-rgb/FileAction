"""未版本桶的合成 SDK/HTTP 合同；真实云端验收单独运行。"""
import hashlib
import io
from dataclasses import replace
from types import SimpleNamespace
from uuid import UUID

import pytest
from qcloud_cos import CosConfig, CosS3Client
from requests import Response
from requests.structures import CaseInsensitiveDict

from fileaction.db.session import ActorContext
from fileaction.documents.service import DocumentError, DocumentService
from fileaction.storage_adapters.cos import CosBlobStore, CosConfiguration, StorageError


ACTOR = ActorContext(UUID(int=1), UUID(int=2))
DOCUMENT, VERSION = UUID(int=3), UUID(int=4)
CONTENT = b"synthetic immutable source"
DIGEST = hashlib.sha256(CONTENT).hexdigest()


class SyntheticUnversionedCos:
    def __init__(self, status=None, version_header=None):
        self.calls, self.objects = [], {}
        self.status, self.version_header = status, version_header
        self.changed_body = None

    def get_bucket_versioning(self, **kwargs):
        self.calls.append(("versioning", kwargs))
        return {"Status": self.status} if self.status else {"VersioningConfiguration": None}

    def put_object(self, **kwargs):
        self.calls.append(("put", kwargs))
        assert kwargs["Metadata"]["x-cos-forbid-overwrite"] == "true"
        if kwargs["Key"] in self.objects:
            class Conflict(Exception):
                def get_error_code(self): return "FileAlreadyExists"
            raise Conflict("synthetic conflict with sensitive request details")
        self.objects[kwargs["Key"]] = (kwargs["Body"].read(), kwargs["Metadata"]["x-cos-meta-sha256"])
        return {"x-cos-version-id": self.version_header} if self.version_header is not None else {}

    def get_object(self, **kwargs):
        self.calls.append(("get", kwargs))
        body, digest = self.objects[kwargs["Key"]]
        if self.changed_body is not None:
            body = self.changed_body
        stream = io.BytesIO(body)
        return {"Body": SimpleNamespace(get_raw_stream=lambda: stream), "Content-Length": str(len(body)),
                "x-cos-meta-sha256": digest, "x-cos-version-id": "null"}

    def delete_object(self, **kwargs):
        self.calls.append(("delete", kwargs))
        del self.objects[kwargs["Key"]]


def store(client):
    return CosBlobStore(CosConfiguration("synthetic-123", "ap-test", object_mode="immutable_key"), client)


@pytest.mark.parametrize("version_header", [None, "null"])
def test_explicit_immutable_upload_verifies_body_and_never_overwrites(version_header):
    client = SyntheticUnversionedCos(version_header=version_header)
    blobs = store(client)
    ref = blobs.put(ACTOR, DOCUMENT, VERSION, CONTENT, DIGEST)
    assert "/immutable-originals/" in ref.key and ref.version_id == "null"
    assert [name for name, _ in client.calls] == ["versioning", "put", "get"]
    assert client.calls[-1][1]["VersionId"] == "null"
    with pytest.raises(StorageError, match="COS_OBJECT_EXISTS"):
        blobs.put(ACTOR, DOCUMENT, VERSION, b"replacement", hashlib.sha256(b"replacement").hexdigest())
    assert blobs.read_range(ACTOR, ref).read() == CONTENT


@pytest.mark.parametrize("status", ["Enabled", "Suspended", "unknown"])
def test_immutable_mode_refuses_bucket_with_versioning_before_writing(status):
    client = SyntheticUnversionedCos(status=status)
    with pytest.raises(StorageError, match="COS_BUCKET_MODE_MISMATCH"):
        store(client).put(ACTOR, DOCUMENT, VERSION, CONTENT, DIGEST)
    assert [name for name, _ in client.calls] == ["versioning"]


def test_immutable_upload_and_range_reject_tampered_full_body():
    client = SyntheticUnversionedCos()
    blobs = store(client)
    client.changed_body = b"x" * len(CONTENT)
    with pytest.raises(StorageError, match="CONTENT_INTEGRITY_FAILED"):
        blobs.put(ACTOR, DOCUMENT, VERSION, CONTENT, DIGEST)
    client.changed_body = None
    ref = blobs.put(ACTOR, DOCUMENT, UUID(int=5), CONTENT, DIGEST)
    client.changed_body = CONTENT[:-1] + b"X"
    with pytest.raises(StorageError, match="CONTENT_INTEGRITY_FAILED"):
        blobs.read_range(ACTOR, ref, (0, 2))
    assert "Range" not in client.calls[-1][1], "不可变键模式必须核验整份内容后再截取范围"


def test_missing_version_or_legacy_key_never_becomes_an_immutable_reference():
    client = SyntheticUnversionedCos()
    blobs = store(client)
    ref = blobs.put(ACTOR, DOCUMENT, VERSION, CONTENT, DIGEST)
    for changed in (replace(ref, version_id=None), replace(ref, version_id=""),
                    replace(ref, key=ref.key.replace("immutable-originals", "originals"))):
        before = len(client.calls)
        with pytest.raises(StorageError):
            blobs.read_range(ACTOR, changed)
        with pytest.raises(StorageError):
            blobs.delete_version(ACTOR, changed)
        assert len(client.calls) == before
    assert blobs.read_range(ACTOR, ref, (1, 3)).read() == CONTENT[1:4]
    blobs.delete_version(ACTOR, ref)
    assert client.calls[-1][1]["VersionId"] == "null"


def test_immutable_reference_preserves_owner_isolation_and_strict_default():
    client = SyntheticUnversionedCos()
    blobs = store(client)
    ref = blobs.put(ACTOR, DOCUMENT, VERSION, CONTENT, DIGEST)
    before = len(client.calls)
    other = ActorContext(UUID(int=9), UUID(int=10))
    for operation in (blobs.head, blobs.read_range, blobs.delete_version):
        with pytest.raises(StorageError, match="RESOURCE_NOT_FOUND"):
            operation(other, ref)
    strict = CosBlobStore(CosConfiguration("synthetic-123", "ap-test"), client)
    with pytest.raises(StorageError):
        strict.read_range(ACTOR, ref)
    assert len(client.calls) == before


def test_immutable_mode_keeps_existing_exact_version_reads():
    client = SyntheticUnversionedCos()
    blobs = store(client)
    from fileaction.storage_adapters.cos import ObjectRef
    ref = ObjectRef("synthetic-123", f"fileaction/originals/{ACTOR.user_id}/{DOCUMENT}/{VERSION}", "v1", DIGEST, len(CONTENT))
    assert blobs._arguments(ACTOR, ref)["VersionId"] == "v1"


def test_real_sdk_sends_forbid_overwrite_and_null_version_as_signed_request_inputs(monkeypatch):
    client = CosS3Client(CosConfig(Region="ap-test", SecretId="synthetic", SecretKey="synthetic", Scheme="https"), retry=0)
    calls = []
    def send_request(**kwargs):
        calls.append(kwargs)
        response = Response()
        response.status_code = 200
        response.headers = CaseInsensitiveDict({"Content-Length": str(len(CONTENT)), "x-cos-meta-sha256": DIGEST})
        if kwargs.get("params") == {"versioning": ""}:
            response._content = b'<VersioningConfiguration xmlns="http://s3.amazonaws.com/doc/2006-03-01/" />'
        response.raw = io.BytesIO(CONTENT)
        return response
    monkeypatch.setattr(client, "send_request", send_request)
    blobs = store(client)
    ref = blobs.put(ACTOR, DOCUMENT, VERSION, CONTENT, DIGEST)
    put = next(call for call in calls if call["method"] == "PUT")
    assert put["headers"]["x-cos-forbid-overwrite"] == "true"
    assert put["headers"]["x-cos-meta-sha256"] == DIGEST
    assert calls[-1]["params"] == {"versionId": b"null"}
    blobs.delete_version(ACTOR, ref)
    assert calls[-1]["params"] == {"versionId": "null"}


@pytest.mark.asyncio
async def test_storage_failure_preserves_safe_code_and_unknown_upload_journal(monkeypatch):
    journal = {}
    class SyntheticRepository:
        async def reserve_upload(self, actor, key, **kwargs): journal.update(key=key, status="uploading"); return "journal"
        async def mark_cleanup(self, actor, identifier, version): journal.update(status="pending", version=version); return True
        async def complete_cleanup(self, *args): pytest.fail("未知上传结果不能标记已清理")
    class BrokenCos:
        def object_key(self, *args): return "synthetic-target-key"
        def put(self, *args): raise StorageError("COS_UNAVAILABLE")
        def delete_version(self, *args): pytest.fail("未知上传结果不能删除对象")
    async def parse(*args): return SimpleNamespace(name="synthetic.txt", hash=DIGEST, warnings=[], segments=[])
    monkeypatch.setattr("fileaction.documents.service.parse_isolated", parse)
    with pytest.raises(DocumentError, match="^COS_UNAVAILABLE$"):
        await DocumentService(None, SyntheticRepository(), BrokenCos()).upload(ACTOR, "synthetic.txt", CONTENT,
            retention="retained", consent_to_store=True, storage_notice_version="1")
    assert journal == {"key": "synthetic-target-key", "status": "pending", "version": None}


@pytest.mark.asyncio
@pytest.mark.parametrize("code,status", [("COS_UNAVAILABLE", 503), ("COS_BUCKET_MODE_MISMATCH", 503),
    ("COS_OBJECT_EXISTS", 409), ("CONTENT_INTEGRITY_FAILED", 503)])
async def test_storage_error_response_explains_the_failure_without_raw_sdk_details(code, status):
    from fileaction.auth.service import AuthError
    from fileaction.documents.routes import operation
    async def failure(): raise DocumentError(code)
    with pytest.raises(AuthError) as caught:
        await operation(failure())
    assert caught.value.code == code and caught.value.status == status
    assert caught.value.message != "文件操作失败，请重试"
