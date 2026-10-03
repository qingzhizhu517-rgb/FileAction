from __future__ import annotations

import asyncio
import base64
import hashlib
import hmac
import json
import mimetypes
import sys
import subprocess
from dataclasses import asdict
from pathlib import Path
from typing import Any
from uuid import UUID, uuid4

from fileaction.db.session import ActorContext
from fileaction.schemas import Document
from fileaction.storage_adapters.cos import CosBlobStore, ObjectRef, StorageError
from fileaction.storage_adapters.temporary import TemporaryStore, TemporaryError


class DocumentError(ValueError):
    pass


async def _settle(task: asyncio.Task):
    """Cancellation cannot stop a synchronous SDK call; keep owning its result."""
    cancelled = False
    while not task.done():
        try:
            await asyncio.shield(task)
        except asyncio.CancelledError:
            cancelled = True
        except Exception:
            break
    return cancelled


async def parse_isolated(filename: str, content: bytes) -> Document:
    if not content or len(content) > 10 * 1024 * 1024 or "\n" in filename or "\r" in filename:
        raise DocumentError("FILE_TOO_LARGE")
    try:
        task = asyncio.create_task(asyncio.to_thread(subprocess.run,
            [sys.executable, "-m", "fileaction.documents.parse_worker"],
            input=filename.encode("utf-8") + b"\n" + content,
            stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, timeout=20,
            cwd=Path(__file__).resolve().parents[2],
        ))
        cancelled = await _settle(task)
        if cancelled:
            # Retrieve exceptions too, so no abandoned background work remains.
            if not task.cancelled():
                task.exception()
            raise asyncio.CancelledError()
        result = task.result()
        output = result.stdout
        if result.returncode != 0 or len(output) > 2 * 1024 * 1024:
            raise DocumentError("DOCUMENT_PARSE_FAILED")
        return Document.model_validate_json(output)
    except (subprocess.TimeoutExpired, ValueError):
        raise DocumentError("DOCUMENT_PARSE_FAILED") from None


class DocumentService:
    def __init__(self, temporary: TemporaryStore, repository=None, cos: CosBlobStore | None = None,
                 cursor_secret: str | None = None):
        self.temporary = temporary
        self.repository = repository
        self.cos = cos
        self.cursor_secret = cursor_secret

    async def upload(self, actor: ActorContext, filename: str, content: bytes, *, retention: str, consent_to_store: bool, storage_notice_version: str) -> dict:
        if retention not in ("temporary", "retained"):
            raise DocumentError("RETENTION_INVALID")
        if retention == "retained":
            if not consent_to_store or storage_notice_version != "1":
                raise DocumentError("CONSENT_REQUIRED")
            if self.cos is None or self.repository is None:
                raise DocumentError("COS_NOT_CONFIGURED")
        parsed = await parse_isolated(filename, content)
        identifier, version = str(uuid4()), str(uuid4())
        value: dict[str, Any] = {
            "id": identifier, "name": parsed.name, "revision": 1, "retention": retention,
            "category": "uncategorized", "parse_status": "ready", "index_status": "not_requested",
            "current_version_id": version, "size_bytes": len(content), "sha256": parsed.hash,
            "mime_type": mimetypes.guess_type(filename)[0] or "application/octet-stream",
            "warnings": parsed.warnings,
            "segments": [{"id": s.id, "text": s.text, "location": s.locator} for s in parsed.segments],
        }
        if retention == "temporary":
            value["source_base64"] = base64.b64encode(content).decode("ascii")
            await self.temporary.create(actor, "document", value, resource_id=identifier)
        else:
            key = self.cos.object_key(actor, UUID(identifier), UUID(version))
            try:
                journal = await self.repository.reserve_upload(actor, key, reserved_bytes=len(content), reserved_file=True)
            except TypeError as error:
                # Keep the upload journal contract compatible with older test/adaptor
                # implementations; the production repository accepts reservations.
                if "unexpected keyword" not in str(error):
                    raise
                journal = await self.repository.reserve_upload(actor, key)
            ref = None
            try:
                put = asyncio.create_task(asyncio.to_thread(self.cos.put, actor, UUID(identifier), UUID(version), content, parsed.hash))
                cancelled = await _settle(put)
                try:
                    ref = put.result()
                except Exception:
                    if cancelled:
                        raise asyncio.CancelledError() from None
                    raise
                if cancelled:
                    raise asyncio.CancelledError()
                value["object_ref"] = asdict(ref)
                commit = asyncio.create_task(self.repository.finish_upload(actor, value, journal))
                cancelled = await _settle(commit)
                try:
                    commit.result()
                except Exception:
                    if cancelled:
                        raise asyncio.CancelledError() from None
                    raise
                if cancelled:
                    raise asyncio.CancelledError()
            except (Exception, asyncio.CancelledError) as error:
                async def compensate():
                    # Unknown outcomes retain the durable target-key journal for
                    # reconciliation. Never claim an unknown version was deleted.
                    claimed = await self.repository.mark_cleanup(actor, journal, ref.version_id if ref else None)
                    # The transaction may have committed before its response was
                    # cancelled/lost. Only a committed cleanup claim allows delete.
                    if claimed is True and ref is not None:
                        await asyncio.to_thread(self.cos.delete_version, actor, ref)
                        await self.repository.complete_cleanup(actor, journal)
                cleanup = asyncio.create_task(compensate())
                cleanup_cancelled = await _settle(cleanup)
                # Failed cleanup keeps the durable uploading/pending journal.
                if not cleanup.cancelled():
                    cleanup.exception()
                if isinstance(error, asyncio.CancelledError) or cleanup_cancelled:
                    raise asyncio.CancelledError() from None
                if isinstance(error, StorageError):
                    raise DocumentError(str(error)) from None
                raise DocumentError("DOCUMENT_SAVE_FAILED") from None
        return self.public(value)

    async def patch_metadata(self, actor: ActorContext, document_id: str, *, name: str | None,
                             category: str | None, expected_revision: int) -> dict:
        if name is None and category is None:
            raise DocumentError("INVALID_REQUEST")
        if name is not None and not name.strip():
            raise DocumentError("INVALID_REQUEST")
        if category is not None and category not in {"uncategorized", "notice", "material"}:
            raise DocumentError("INVALID_REQUEST")
        try:
            current = await self.temporary.get(actor, "document", document_id)
        except TemporaryError as error:
            if str(error) not in ("TEMPORARY_CONTENT_EXPIRED", "RESOURCE_NOT_FOUND"):
                raise
            current = None
        if current is not None:
            if current.revision != expected_revision:
                raise DocumentError("REVISION_CONFLICT")
            value = dict(current.value)
            if name is not None:
                value["name"] = name.strip()
            if category is not None:
                value["category"] = category
            return self.public((await self.temporary.replace(actor, "document", document_id, value,
                                                              expected_revision=expected_revision)).value)
        if self.repository is None:
            raise DocumentError("RESOURCE_NOT_FOUND")
        return await self.repository.patch_metadata(actor, document_id, name=name, category=category,
                                                    expected_revision=expected_revision)

    async def upload_version(self, actor: ActorContext, document_id: str, filename: str, content: bytes,
                             *, expected_revision: int) -> dict:
        """Parse and publish a new immutable version after a revision check.

        A failed parse is raised before any current version is touched. Retained objects
        receive a fresh server-generated key and are attached only after the DB commit.
        """
        current = await self._value(actor, document_id)
        if current["revision"] != expected_revision:
            raise DocumentError("REVISION_CONFLICT")
        parsed = await parse_isolated(filename, content)
        version = str(uuid4())
        value = dict(current)
        value.update({"current_version_id": version, "size_bytes": len(content), "sha256": parsed.hash,
                      "mime_type": mimetypes.guess_type(filename)[0] or "application/octet-stream",
                      "warnings": parsed.warnings, "parse_status": "ready", "index_status": "stale",
                      "segments": [{"id": s.id, "text": s.text, "location": s.locator} for s in parsed.segments]})
        if current["retention"] == "temporary":
            value["revision"] = expected_revision + 1
            value["source_base64"] = base64.b64encode(content).decode("ascii")
            history = list(value.get("versions", []))
            history.append({"id": current["current_version_id"], "sha256": current.get("sha256"),
                            "size_bytes": current.get("size_bytes", 0), "segments": current.get("segments", []),
                            "source_base64": current.get("source_base64")})
            value["versions"] = history
            return self.public((await self.temporary.replace(actor, "document", document_id, value,
                                                              expected_revision=expected_revision)).value)
        if self.repository is None or self.cos is None:
            raise DocumentError("DEPENDENCY_UNAVAILABLE")
        return await self.repository.save_version(actor, document_id, expected_revision, value, self.cos, content)

    @staticmethod
    def public(value: dict) -> dict:
        return {k: v for k, v in value.items() if k not in {"source_base64", "segments", "object_ref", "sha256"}}

    async def _value(self, actor: ActorContext, document_id: str) -> dict:
        try:
            return (await self.temporary.get(actor, "document", document_id)).value
        except TemporaryError as error:
            if str(error) not in ("TEMPORARY_CONTENT_EXPIRED", "RESOURCE_NOT_FOUND"):
                raise
        value = await self.repository.get(actor, document_id) if self.repository else None
        if value is None:
            raise DocumentError("RESOURCE_NOT_FOUND")
        return value

    async def get(self, actor: ActorContext, document_id: str) -> dict:
        return self.public(await self._value(actor, document_id))

    async def segments(self, actor: ActorContext, document_id: str, *, limit: int | None = None,
                       cursor: str | None = None) -> list[dict] | dict:
        value = await self._value(actor, document_id)
        segments = value["segments"]
        if limit is None and cursor is None:
            return segments
        if limit is None or type(limit) is not int or not 1 <= limit <= 100:
            raise DocumentError("INVALID_REQUEST")
        start = 0
        if cursor:
            try:
                if not self.cursor_secret:
                    raise ValueError
                body, signature = cursor.split(".", 1)
                expected = hmac.new(self.cursor_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, signature):
                    raise ValueError
                payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
                if payload.get("document_id") != document_id or payload.get("owner_id") != str(actor.user_id):
                    raise ValueError
                start = int(payload["offset"])
            except (ValueError, TypeError, KeyError, json.JSONDecodeError):
                raise DocumentError("CURSOR_INVALID") from None
            if start < 0:
                raise DocumentError("CURSOR_INVALID")
        page = segments[start:start + limit]
        next_cursor = None
        if start + limit < len(segments):
            payload = json.dumps({"document_id": document_id, "owner_id": str(actor.user_id), "offset": start + limit}, separators=(",", ":")).encode()
            body = base64.urlsafe_b64encode(payload).decode().rstrip("=")
            if self.cursor_secret:
                next_cursor = body + "." + hmac.new(self.cursor_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
            else:
                next_cursor = str(start + limit)
        return {"items": page, "next_cursor": next_cursor, "has_more": next_cursor is not None}

    async def source(self, actor: ActorContext, document_id: str, byte_range: tuple[int, int] | None = None) -> bytes:
        value = await self._value(actor, document_id)
        if value["retention"] == "temporary":
            content = base64.b64decode(value["source_base64"], validate=True)
            if byte_range is None:
                return content
            start, end = byte_range
            if type(start) is not int or type(end) is not int or not 0 <= start <= end < len(content):
                raise DocumentError("RANGE_INVALID")
            return content[start:end + 1]
        if self.cos is None:
            raise DocumentError("COS_NOT_CONFIGURED")
        stream = await asyncio.to_thread(self.cos.read_range, actor, ObjectRef(**value["object_ref"]), byte_range)
        try:
            return stream.read()
        finally:
            stream.close()

    async def deletion_impact(self, actor: ActorContext, document_id: str) -> dict:
        value = await self._value(actor, document_id)
        if value["retention"] == "temporary" or self.repository is None:
            workspaces: list[str] = []
            runs: list[str] = []
            indexes: list[str] = []
            previews: list[str] = []
            for resource in await self.temporary.list(actor, "workspace"):
                raw = json.dumps(resource.value, ensure_ascii=False)
                if document_id in raw:
                    workspaces.append(resource.id)
            for resource in await self.temporary.list(actor, "run"):
                if document_id in json.dumps(resource.value, ensure_ascii=False):
                    runs.append(resource.id)
            for resource in await self.temporary.list(actor, "index"):
                if document_id in json.dumps(resource.value, ensure_ascii=False):
                    indexes.append(resource.id)
            for resource in await self.temporary.list(actor, "preview"):
                if document_id in json.dumps(resource.value, ensure_ascii=False):
                    previews.append(resource.id)
            impact = {"document_id": document_id, "revision": value["revision"],
                      "workspaces": sorted(workspaces), "runs": sorted(runs), "answers": [], "facts": [], "artifacts": [], "indexes": sorted(indexes), "previews": sorted(previews),
                      "derived_content_warning": True, "cascade_derived": False}
        else:
            impact = await self.repository.deletion_impact(actor, document_id)
        canonical = json.dumps(impact, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()
        impact["impact_hash"] = hashlib.sha256(canonical).hexdigest()
        return impact

    async def delete(self, actor: ActorContext, document_id: str, *, expected_revision: int,
                     impact_hash: str, confirmed: bool) -> dict:
        if not confirmed:
            raise DocumentError("CONFIRMATION_REQUIRED")
        impact = await self.deletion_impact(actor, document_id)
        if impact["revision"] != expected_revision or impact["impact_hash"] != impact_hash:
            raise DocumentError("REVISION_CONFLICT")
        # Recompute after the user confirmation boundary so a newly attached
        # workspace/run cannot be deleted under an old impact acknowledgement.
        fresh_impact = await self.deletion_impact(actor, document_id)
        if fresh_impact["impact_hash"] != impact_hash:
            raise DocumentError("REVISION_CONFLICT")
        current = await self._value(actor, document_id)
        if current["retention"] == "temporary":
            for resource in await self.temporary.list(actor, "run"):
                if document_id in json.dumps(resource.value, ensure_ascii=False):
                    await self.temporary.delete(actor, "run", resource.id)
            for kind in ("index", "preview"):
                for resource in await self.temporary.list(actor, kind):
                    if document_id in json.dumps(resource.value, ensure_ascii=False):
                        await self.temporary.delete(actor, kind, resource.id)
            for resource in await self.temporary.list(actor, "workspace"):
                if document_id not in json.dumps(resource.value, ensure_ascii=False):
                    continue
                value = dict(resource.value)
                value["documents"] = [d for d in value.get("documents", []) if d.get("id") != document_id]
                value["source_deleted_documents"] = sorted(set(value.get("source_deleted_documents", [])) | {document_id})
                value["facts"] = [dict(f, source_deleted=True) if document_id in json.dumps(f, ensure_ascii=False) else f for f in value.get("facts", [])]
                answers = {}
                for key, answer in value.get("answers", {}).items():
                    answers[key] = (dict(answer, validity="source_deleted", envelope=None)
                                    if document_id in json.dumps(answer, ensure_ascii=False) else answer)
                value["answers"] = answers
                artifacts = []
                for artifact in value.get("artifacts", []):
                    if artifact.get("author_kind") == "model" and document_id in json.dumps(artifact, ensure_ascii=False):
                        artifacts.append(dict(artifact, validity="source_deleted", body=None, sources=[]))
                    else:
                        artifacts.append(artifact)
                value["artifacts"] = artifacts
                await self.temporary.replace(actor, "workspace", resource.id, value, expected_revision=resource.revision)
            await self.temporary.delete(actor, "document", document_id)
            return {"id": document_id, "status": "deleted", "revision": expected_revision + 1}
        return await self.repository.begin_delete(actor, document_id, expected_revision, impact_hash)

    async def list_retained(self, actor: ActorContext, **pagination) -> dict:
        if self.repository is None:
            raise DocumentError("DEPENDENCY_UNAVAILABLE")
        return await self.repository.list_page(actor, **pagination)
