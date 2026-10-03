from __future__ import annotations

import hashlib
import io
from dataclasses import dataclass
from typing import Any
from uuid import UUID

from fileaction.db.session import ActorContext


class StorageError(ValueError):
    """稳定存储错误，不附带SDK原始异常。"""


@dataclass(frozen=True)
class CosConfiguration:
    bucket: str
    region: str
    prefix: str = "fileaction/"
    sse_mode: str = "AES256"
    object_mode: str = "versioned"

    def __post_init__(self):
        if not self.bucket or not self.region or self.sse_mode != "AES256" or self.object_mode not in {"versioned", "immutable_key"}:
            raise StorageError("COS_CONFIGURATION_INVALID")
        if not self.prefix.endswith("/") or self.prefix.startswith("/") or any(p in ("", ".", "..") for p in self.prefix[:-1].split("/")):
            raise StorageError("COS_CONFIGURATION_INVALID")


@dataclass(frozen=True)
class ObjectRef:
    bucket: str
    key: str
    version_id: str | None
    sha256: str
    size_bytes: int


class CosBlobStore:
    """同步SDK适配器；API须通过有界线程池/Worker调用。

    调用前由领域服务核验所有权、删除状态和COS授权，并先持久记录
    唯一目标对象键用于不确定上传的补偿。客户端不得提供ObjectRef。
    默认严格绑定非空 COS 版本。显式 immutable_key 模式仅在未开启版本的
    桶写入独立 UUID 键命名空间，服务端禁止覆盖，完整回读核验后才返回引用。
    null 仅是该命名空间的明确版本哨兵；未知/缺失引用仍然拒绝操作。
    """
    def __init__(self, configuration: CosConfiguration, client: Any):
        self.configuration = configuration
        self.client = client

    def object_key(self, actor: ActorContext, document_id: UUID, version_id: UUID) -> str:
        if not isinstance(actor, ActorContext) or not isinstance(document_id, UUID) or not isinstance(version_id, UUID):
            raise StorageError("RESOURCE_NOT_FOUND")
        namespace = "immutable-originals" if self.configuration.object_mode == "immutable_key" else "originals"
        return f"{self.configuration.prefix}{namespace}/{actor.user_id}/{document_id}/{version_id}"

    def _arguments(self, actor: ActorContext, ref: ObjectRef) -> dict:
        prefix = f"{self.configuration.prefix}originals/{actor.user_id}/"
        immutable_prefix = f"{self.configuration.prefix}immutable-originals/{actor.user_id}/"
        immutable = self.configuration.object_mode == "immutable_key" and ref.key.startswith(immutable_prefix)
        if immutable:
            prefix = immutable_prefix
        if ref.bucket != self.configuration.bucket or not ref.key.startswith(prefix):
            raise StorageError("RESOURCE_NOT_FOUND")
        suffix = ref.key[len(prefix):].split("/")
        try:
            if len(suffix) != 2 or any(str(UUID(part)) != part for part in suffix):
                raise ValueError
        except ValueError:
            raise StorageError("RESOURCE_NOT_FOUND") from None
        if immutable:
            if ref.version_id != "null":
                raise StorageError("CONTENT_INTEGRITY_FAILED")
        elif not isinstance(ref.version_id, str) or not ref.version_id.strip() or ref.version_id == "null":
            raise StorageError("CONTENT_INTEGRITY_FAILED")
        return {"Bucket": ref.bucket, "Key": ref.key, "VersionId": ref.version_id}

    def put(self, actor: ActorContext, document_id: UUID, version_id: UUID, content: bytes, expected_sha256: str) -> ObjectRef:
        if not content or len(content) > 10 * 1024 * 1024:
            raise StorageError("FILE_TOO_LARGE")
        digest = hashlib.sha256(content).hexdigest()
        if digest != expected_sha256:
            raise StorageError("CONTENT_HASH_MISMATCH")
        key = self.object_key(actor, document_id, version_id)
        immutable = self.configuration.object_mode == "immutable_key"
        try:
            metadata = {"x-cos-meta-sha256": digest}
            if immutable:
                # Forbid-overwrite does not protect versioned/suspended buckets.
                # A failed/unknown status lookup must never authorize a write.
                state = self.client.get_bucket_versioning(Bucket=self.configuration.bucket)
                if state not in ({}, {"VersioningConfiguration": None}):
                    raise StorageError("COS_BUCKET_MODE_MISMATCH")
                # Current qcloud_cos rejects ForbidOverwrite as a named parameter;
                # Metadata passes these exact headers into the signed PUT request.
                metadata["x-cos-forbid-overwrite"] = "true"
            response = self.client.put_object(
                Bucket=self.configuration.bucket, Key=key, Body=io.BytesIO(content),
                ContentLength=str(len(content)), ACL="private", ContentType="application/octet-stream",
                ServerSideEncryption=self.configuration.sse_mode,
                Metadata=metadata,
            )
        except StorageError:
            raise
        except Exception as error:
            if callable(getattr(error, "get_error_code", None)) and error.get_error_code() in {"FileAlreadyExists", "ObjectAlreadyExists", "PreconditionFailed"}:
                raise StorageError("COS_OBJECT_EXISTS") from None
            raise StorageError("COS_UNAVAILABLE") from None
        # ETag can be multipart/encryption-specific and is not a SHA-256.
        version = self._headers(response).get("x-cos-version-id")
        if immutable:
            if version not in (None, "null"):
                raise StorageError("COS_BUCKET_MODE_MISMATCH")
            ref = ObjectRef(self.configuration.bucket, key, "null", digest, len(content))
            # Headers and ETag alone cannot establish content integrity. Only a
            # full read with expected size and SHA-256 can publish this reference.
            with self.read_range(actor, ref):
                pass
            return ref
        if not isinstance(version, str) or not version.strip() or version == "null":
            raise StorageError("CONTENT_INTEGRITY_FAILED")
        return ObjectRef(self.configuration.bucket, key, version, digest, len(content))

    def head(self, actor: ActorContext, ref: ObjectRef) -> dict:
        args = self._arguments(actor, ref)
        if ref.version_id == "null":
            with self.read_range(actor, ref):
                pass
            return {"size_bytes": ref.size_bytes, "version_id": "null"}
        try:
            result = self._headers(self.client.head_object(**args))
            self._verify_headers(result, ref, ref.size_bytes)
            return {"size_bytes": int(result["content-length"]), "version_id": result["x-cos-version-id"]}
        except StorageError:
            raise
        except Exception:
            raise StorageError("COS_UNAVAILABLE") from None

    def delete_version(self, actor: ActorContext, ref: ObjectRef) -> None:
        args = self._arguments(actor, ref)
        try:
            self.client.delete_object(**args)
        except Exception:
            raise StorageError("COS_UNAVAILABLE") from None

    def read_range(self, actor: ActorContext, ref: ObjectRef, byte_range: tuple[int, int] | None = None):
        args = self._arguments(actor, ref)
        if byte_range is not None:
            start, end = byte_range
            if type(start) is not int or type(end) is not int or not 0 <= start <= end < ref.size_bytes:
                raise StorageError("RANGE_INVALID")
            if ref.version_id == "null":
                # Without a native immutable version, validate the entire object
                # even when the caller needs only a source preview range.
                with self.read_range(actor, ref) as full:
                    return io.BytesIO(full.getvalue()[start:end + 1])
            args["Range"] = f"bytes={start}-{end}"
        try:
            response = self.client.get_object(**args)
            stream = response["Body"].get_raw_stream()
            try:
                expected_size = ref.size_bytes if byte_range is None else byte_range[1] - byte_range[0] + 1
                headers = self._headers(response)
                self._verify_headers(headers, ref, expected_size)
                if byte_range is not None and headers.get("content-range") != f"bytes {byte_range[0]}-{byte_range[1]}/{ref.size_bytes}":
                    raise StorageError("CONTENT_INTEGRITY_FAILED")
                if not 0 < expected_size <= 10 * 1024 * 1024:
                    raise StorageError("CONTENT_INTEGRITY_FAILED")
                data = bytearray()
                while len(data) <= expected_size:
                    block = stream.read(min(65536, expected_size + 1 - len(data)))
                    if not block:
                        break
                    data.extend(block)
                if len(data) != expected_size:
                    raise StorageError("CONTENT_INTEGRITY_FAILED")
                if byte_range is None and hashlib.sha256(data).hexdigest() != ref.sha256:
                    raise StorageError("CONTENT_INTEGRITY_FAILED")
                return io.BytesIO(data)
            finally:
                stream.close()
        except StorageError:
            raise
        except Exception:
            raise StorageError("COS_UNAVAILABLE") from None

    @staticmethod
    def _headers(response: dict) -> dict:
        # Tencent's SDK returns raw HTTP header names, not AWS-style fields.
        return {key.lower(): value for key, value in response.items()}

    @staticmethod
    def _verify_headers(response: dict, ref: ObjectRef, expected_size: int) -> None:
        try:
            valid = (
                int(response["content-length"]) == expected_size
                and (response.get("x-cos-version-id") in (None, "null") if ref.version_id == "null"
                     else response.get("x-cos-version-id") == ref.version_id)
                and response.get("x-cos-meta-sha256") == ref.sha256
            )
        except (KeyError, ValueError, TypeError):
            valid = False
        if not valid:
            raise StorageError("CONTENT_INTEGRITY_FAILED")
