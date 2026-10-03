"""领域规则 for long-lived workspace retention and independent memories.

The service deliberately keeps the cross-store copy operation behind a repository
interface.  This lets the API freeze an exact scope before any COS write and lets
recovery retry a batch without treating a temporary Redis value as durable data.
"""
from __future__ import annotations

import hashlib
import json
from datetime import datetime, timezone
from typing import Any

from .dto import MemoryCreateRequest, MemoryPatchRequest, RetainRequest, RetentionPreviewRequest


class RetentionError(ValueError):
    pass


def build_scope_hash(scope: dict[str, Any]) -> str:
    encoded = json.dumps(scope, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def _ids(items: list[Any], key: str = "id") -> list[str]:
    values = [str(item[key]) if isinstance(item, dict) else str(item) for item in items]
    if len(values) != len(set(values)):
        raise RetentionError("INVALID_SELECTION")
    return values


def freeze_preview(workspace: dict[str, Any], request: RetentionPreviewRequest, *, now: datetime | None = None) -> dict[str, Any]:
    """Freeze selected identities and content hashes from a workspace snapshot.

    The input snapshot must already be authorized for the actor.  Only IDs listed
    by the request are copied into the scope, so later messages cannot enter a
    previously displayed preview merely because the workspace revision is stable.
    """
    if workspace.get("revision") != request.expected_revision:
        raise RetentionError("REVISION_CONFLICT")
    available = {
        "document_version_ids": {str(item["document_version_id"]): item for item in workspace.get("documents", [])},
        "message_ids": {str(item["id"]): item for item in workspace.get("messages", [])},
        "answer_ids": {str(item["id"]): item for item in workspace.get("answers", [])},
        "artifact_ids": {str(item["id"]): item for item in workspace.get("artifacts", [])},
        "fact_version_ids": {str(item.get("id", item.get("fact_version_id"))): item for item in workspace.get("facts", [])},
    }
    selected = {
        "document_version_ids": _ids(request.document_version_ids),
        "message_ids": _ids(request.message_ids),
        "answer_ids": _ids(request.answer_ids),
        "artifact_versions": [{"artifact_id": str(item.artifact_id), "version": item.version} for item in request.artifact_versions],
        "fact_version_ids": _ids(request.fact_version_ids),
        "index_ids": _ids(request.index_ids),
        "retain_indexes": request.retain_indexes,
    }
    for key, values in (("document_version_ids", selected["document_version_ids"]), ("message_ids", selected["message_ids"]),
                        ("answer_ids", selected["answer_ids"]), ("fact_version_ids", selected["fact_version_ids"])):
        if any(value not in available[key] for value in values):
            raise RetentionError("INVALID_SELECTION")
    artifact_map = available["artifact_ids"]
    for item in selected["artifact_versions"]:
        source = artifact_map.get(item["artifact_id"])
        if source is None or int(source.get("current_version", source.get("version", 0))) < item["version"]:
            raise RetentionError("INVALID_SELECTION")
    scope = {
        "workspace_id": str(workspace["id"]),
        "workspace_revision": request.expected_revision,
        "document_version_ids": selected["document_version_ids"],
        "message_ids": selected["message_ids"],
        "answer_ids": selected["answer_ids"],
        "fact_version_ids": selected["fact_version_ids"],
        "artifact_ids": [item["artifact_id"] for item in selected["artifact_versions"]],
        "document_versions": [{"id": item, "sha256": available["document_version_ids"][item].get("sha256")} for item in selected["document_version_ids"]],
        "messages": [{"id": item, "content_hash": _hash_value(available["message_ids"][item])} for item in selected["message_ids"]],
        "answers": [{"id": item, "content_hash": _hash_value(available["answer_ids"][item])} for item in selected["answer_ids"]],
        "artifact_versions": [{**item, "body_hash": _artifact_hash(artifact_map[item["artifact_id"]], item["version"])} for item in selected["artifact_versions"]],
        "fact_versions": [{"id": item, "content_hash": _hash_value(available["fact_version_ids"][item])} for item in selected["fact_version_ids"]],
        "index_ids": selected["index_ids"] if selected["retain_indexes"] else [],
    }
    expires_at = (now or datetime.now(timezone.utc)).timestamp() + 120
    return {
        "workspace_id": str(workspace["id"]),
        "expected_revision": request.expected_revision,
        "scope": scope,
        "scope_hash": build_scope_hash(scope),
        "documents": selected["document_version_ids"],
        "messages": selected["message_ids"],
        "answers": selected["answer_ids"],
        "artifact_versions": selected["artifact_versions"],
        "facts": selected["fact_version_ids"],
        "retained_indexes": selected["index_ids"] if selected["retain_indexes"] else [],
        "expires_at": datetime.fromtimestamp(expires_at, timezone.utc).isoformat(),
    }


def _hash_value(value: dict[str, Any]) -> str:
    if value.get("content_hash"):
        return str(value["content_hash"])
    return hashlib.sha256(json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":")).encode()).hexdigest()


def _artifact_hash(value: dict[str, Any], version: int) -> str | None:
    if int(value.get("version", value.get("current_version", 0))) == version and value.get("body_hash"):
        return str(value["body_hash"])
    versions = value.get("versions", {})
    if isinstance(versions, dict) and isinstance(versions.get(str(version)), dict):
        return _hash_value(versions[str(version)])
    return _hash_value({"artifact_id": value.get("id"), "version": version})


class RetentionService:
    """Orchestrates scope freezing and delegates durable copy/recovery to a repository."""

    def __init__(self, repository):
        self.repository = repository

    async def preview(self, actor, workspace_id: str, request: RetentionPreviewRequest) -> dict[str, Any]:
        workspace = await self.repository.workspace_snapshot(actor, workspace_id)
        preview = freeze_preview(workspace, request)
        return await self.repository.save_preview(actor, preview)

    async def retain(self, actor, workspace_id: str, request: RetainRequest, idempotency_key: str) -> dict[str, Any]:
        if not idempotency_key or len(idempotency_key) > 160:
            raise RetentionError("IDEMPOTENCY_KEY_REQUIRED")
        preview = await self.repository.get_preview(actor, request.preview_id)
        if preview.get("workspace_id") != workspace_id or preview.get("scope_hash") != request.scope_hash:
            raise RetentionError("PREVIEW_STALE")
        if preview.get("expected_revision") != request.expected_revision:
            raise RetentionError("REVISION_CONFLICT")
        if _expired(preview.get("expires_at")):
            raise RetentionError("PREVIEW_EXPIRED")
        return await self.repository.retain_batch(actor, workspace_id, request, preview, idempotency_key)


def _expired(value: Any) -> bool:
    try:
        return datetime.now(timezone.utc).timestamp() >= datetime.fromisoformat(str(value)).timestamp()
    except (TypeError, ValueError):
        return True


class MemoryService:
    """Independent background lifecycle; every operation remains owner scoped."""

    def __init__(self, repository):
        self.repository = repository

    async def create(self, actor, request: MemoryCreateRequest) -> dict[str, Any]:
        if request.consent_to_retain is not True:
            raise RetentionError("CONSENT_REQUIRED")
        return await self.repository.create_memory(actor, request)

    async def list(self, actor, *, limit: int = 20, cursor: str | None = None) -> dict[str, Any]:
        if not 1 <= limit <= 100:
            raise RetentionError("INVALID_REQUEST")
        return await self.repository.list_memories(actor, limit=limit, cursor=cursor)

    async def get(self, actor, memory_id: str) -> dict[str, Any]:
        return await self.repository.get_memory(actor, memory_id)

    async def patch(self, actor, memory_id: str, request: MemoryPatchRequest) -> dict[str, Any]:
        if request.text is None and request.active is None and request.valid_from is None and request.valid_until is None:
            raise RetentionError("INVALID_REQUEST")
        if request.valid_from and request.valid_until and request.valid_until <= request.valid_from:
            raise RetentionError("INVALID_REQUEST")
        return await self.repository.patch_memory(actor, memory_id, request)

    async def delete(self, actor, memory_id: str, *, expected_revision: int, confirmed: bool) -> dict[str, Any]:
        if not confirmed:
            raise RetentionError("CONFIRMATION_REQUIRED")
        return await self.repository.delete_memory(actor, memory_id, expected_revision)

    async def use(self, actor, memory_id: str, workspace_id: str, expected_revision: int) -> dict[str, Any]:
        return await self.repository.use_memory(actor, memory_id, workspace_id, expected_revision)
