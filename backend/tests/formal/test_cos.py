"""COS SDK边界使用合成替身；不触及真实桶。"""
from dataclasses import replace
from uuid import UUID

import pytest

from fileaction.storage_adapters.cos import CosBlobStore, CosConfiguration, ObjectRef, StorageError
from fileaction.db.session import ActorContext


ALICE = ActorContext(UUID(int=1), UUID(int=2))
BOB = ActorContext(UUID(int=3), UUID(int=4))
DOCUMENT = UUID(int=5)
VERSION = UUID(int=6)


class SyntheticCos:
    def __init__(self):
        self.calls = []
    def put_object(self, **kwargs):
        self.calls.append(("put", kwargs))
        return {"x-cos-version-id": "synthetic-version", "ETag": "not-a-sha256"}
    def delete_object(self, **kwargs):
        self.calls.append(("delete", kwargs))
        return {}
    def head_object(self, **kwargs):
        self.calls.append(("head", kwargs))
        return {"Content-Length": "3"}


def store(client):
    return CosBlobStore(CosConfiguration("synthetic-123", "ap-test", "fileaction/", "AES256"), client)


def test_put_validates_digest_and_uses_private_unique_scoped_key():
    import hashlib
    client = SyntheticCos()
    blob = store(client).put(ALICE, DOCUMENT, VERSION, b"abc", hashlib.sha256(b"abc").hexdigest())
    name, request = client.calls[0]
    assert name == "put"
    assert request["Key"] == "fileaction/originals/00000000-0000-0000-0000-000000000001/00000000-0000-0000-0000-000000000005/00000000-0000-0000-0000-000000000006"
    assert request["ACL"] == "private"
    assert request["ServerSideEncryption"] == "AES256"
    assert blob.version_id == "synthetic-version"
    assert blob.sha256 == hashlib.sha256(b"abc").hexdigest()
    with pytest.raises(StorageError, match="CONTENT_HASH_MISMATCH"):
        store(client).put(ALICE, DOCUMENT, UUID(int=7), b"abc", "wrong")
    assert len(client.calls) == 1


def test_cross_owner_and_unmanaged_key_fail_before_sdk_call():
    client = SyntheticCos()
    ref = ObjectRef("synthetic-123", "fileaction/originals/" + str(ALICE.user_id) + "/" + str(DOCUMENT) + "/" + str(VERSION), "v1", "x", 3)
    with pytest.raises(StorageError, match="RESOURCE_NOT_FOUND"):
        store(client).delete_version(BOB, ref)
    with pytest.raises(StorageError, match="RESOURCE_NOT_FOUND"):
        store(client).head(ALICE, replace(ref, key=ref.key + "/../../elsewhere"))
    with pytest.raises(StorageError, match="RESOURCE_NOT_FOUND"):
        store(client).head(ALICE, replace(ref, bucket="different-bucket"))
    assert client.calls == []


def test_delete_exact_version_never_falls_back_to_unversioned_delete():
    client = SyntheticCos()
    ref = ObjectRef("synthetic-123", "fileaction/originals/" + str(ALICE.user_id) + "/" + str(DOCUMENT) + "/" + str(VERSION), "v1", "x", 3)
    store(client).delete_version(ALICE, ref)
    assert client.calls[0][1]["VersionId"] == "v1"


def test_sdk_error_is_sanitized():
    class BrokenCos(SyntheticCos):
        def head_object(self, **kwargs): raise RuntimeError("synthetic SECRET signed URL")
    ref = ObjectRef("synthetic-123", "fileaction/originals/" + str(ALICE.user_id) + "/" + str(DOCUMENT) + "/" + str(VERSION), "v1", "x", 3)
    with pytest.raises(StorageError, match="COS_UNAVAILABLE") as error:
        store(BrokenCos()).head(ALICE, ref)
    assert "SECRET" not in str(error.value)


def test_head_rejects_changed_size_or_version_and_full_read_rejects_hash():
    import hashlib
    import io
    ref = ObjectRef("synthetic-123", "fileaction/originals/" + str(ALICE.user_id) + "/" + str(DOCUMENT) + "/" + str(VERSION), "v1", hashlib.sha256(b"abc").hexdigest(), 3)
    class ChangedCos(SyntheticCos):
        def head_object(self, **kwargs):
            return {"Content-Length": "999", "x-cos-version-id": "v1", "x-cos-meta-sha256": ref.sha256}
        def get_object(self, **kwargs):
            class Body:
                def get_raw_stream(self): return io.BytesIO(b"bad")
            return {"Body": Body(), "Content-Length": "3", "x-cos-version-id": "v1", "x-cos-meta-sha256": ref.sha256}
    with pytest.raises(StorageError, match="CONTENT_INTEGRITY_FAILED"):
        store(ChangedCos()).head(ALICE, ref)
    with pytest.raises(StorageError, match="CONTENT_INTEGRITY_FAILED"):
        store(ChangedCos()).read_range(ALICE, ref)
