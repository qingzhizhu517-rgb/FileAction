"""PostgreSQL repositories for retention batches and independent memories."""
from __future__ import annotations

import base64
import hashlib
import hmac
import json
from datetime import datetime, timezone
from uuid import UUID, uuid4

from sqlalchemy import delete, func, insert, select, update

from fileaction.db.models import (
    context_facts,
    fact_versions,
    memories,
    memory_versions,
    workspace_memories,
    workspaces,
    retention_batches,
)
from fileaction.db.session import tenant_transaction

from .dto import MemoryCreateRequest, MemoryPatchRequest, RetainRequest
from .service import RetentionError, build_scope_hash


def uid(value: str) -> UUID:
    try:
        return UUID(str(value))
    except (TypeError, ValueError, AttributeError):
        raise RetentionError("RESOURCE_NOT_FOUND") from None


def _json(value):
    if isinstance(value, UUID):
        return str(value)
    if isinstance(value, datetime):
        return value.isoformat()
    return value


def _public(row: dict) -> dict:
    return {key: _json(value) for key, value in row.items() if key != "owner_id"}


class RetentionRepository:
    """Persistence adapter used by :class:`RetentionService`.

    The cross-store copy worker is intentionally injected as ``batch_worker``;
    this repository only commits a frozen manifest and exposes its state.  A
    failed worker can mark the same batch failed without deleting temporary data.
    """

    def __init__(self, factory, *, cursor_secret: str = "", batch_worker=None):
        self.factory = factory
        self.cursor_secret = cursor_secret
        self.batch_worker = batch_worker

    async def workspace_snapshot(self, actor, workspace_id: str) -> dict:
        """Load a caller-owned snapshot through an injected provider.

        Production wiring supplies the temporary WorkspaceService snapshot;
        the database adapter refuses to invent temporary正文 rows.
        """
        if self.batch_worker is None or not hasattr(self.batch_worker, "workspace_snapshot"):
            raise RetentionError("DEPENDENCY_UNAVAILABLE")
        return await self.batch_worker.workspace_snapshot(actor, workspace_id)

    async def save_preview(self, actor, preview: dict) -> dict:
        if self.batch_worker is None or not hasattr(self.batch_worker, "save_preview"):
            return preview
        return await self.batch_worker.save_preview(actor, preview)

    async def get_preview(self, actor, preview_id: str) -> dict:
        if self.batch_worker is None or not hasattr(self.batch_worker, "get_preview"):
            raise RetentionError("PREVIEW_EXPIRED")
        return await self.batch_worker.get_preview(actor, preview_id)

    async def retain_batch(self, actor, workspace_id: str, request: RetainRequest, preview: dict, idempotency_key: str) -> dict:
        if self.batch_worker is not None and hasattr(self.batch_worker, "retain_batch"):
            return await self.batch_worker.retain_batch(actor, workspace_id, request, preview, idempotency_key)
        # The durable queued row is still useful when the asynchronous copier
        # is not running; it can be claimed and retried later without losing the
        # temporary input or manufacturing a ready result.
        return await self.create_or_get_batch(actor, workspace_id, request, preview, idempotency_key)

    async def create_or_get_batch(self, actor, workspace_id: str, request: RetainRequest, preview: dict, idempotency_key: str) -> dict:
        """Create the invisible retaining row exactly once for an idempotency key."""
        if preview.get("scope_hash") != request.scope_hash:
            raise RetentionError("PREVIEW_STALE")
        async with tenant_transaction(self.factory, actor) as db:
            existing = (await db.execute(select(retention_batches).where(
                retention_batches.c.owner_id == actor.user_id,
                retention_batches.c.idempotency_key == idempotency_key,
            ).with_for_update())).mappings().first()
            if existing:
                if existing["scope_hash"] != request.scope_hash or existing["workspace_ref"] != workspace_id:
                    raise RetentionError("IDEMPOTENCY_CONFLICT")
                return _public(existing)
            identifier = uuid4()
            await db.execute(insert(retention_batches).values(
                id=identifier, owner_id=actor.user_id, workspace_ref=workspace_id,
                expected_revision=request.expected_revision, state="queued",
                idempotency_key=idempotency_key, scope_hash=request.scope_hash,
                manifest_json=preview,
            ))
            row = (await db.execute(select(retention_batches).where(retention_batches.c.id == identifier))).mappings().one()
            return _public(row)

    async def batch(self, actor, batch_id: str) -> dict:
        async with tenant_transaction(self.factory, actor) as db:
            row = (await db.execute(select(retention_batches).where(
                retention_batches.c.id == uid(batch_id), retention_batches.c.owner_id == actor.user_id,
            ))).mappings().first()
            if row is None:
                raise RetentionError("RESOURCE_NOT_FOUND")
            return _public(row)

    async def transition_batch(self, actor, batch_id: str, state: str, *, failure_code: str | None = None, compensation: dict | None = None) -> dict:
        if state not in {"queued", "retaining", "ready", "failed", "cancelled"}:
            raise RetentionError("INVALID_REQUEST")
        async with tenant_transaction(self.factory, actor) as db:
            row = (await db.execute(select(retention_batches).where(
                retention_batches.c.id == uid(batch_id), retention_batches.c.owner_id == actor.user_id,
            ).with_for_update())).mappings().first()
            if row is None:
                raise RetentionError("RESOURCE_NOT_FOUND")
            values = {"state": state, "updated_at": func.now()}
            if failure_code is not None:
                values["failure_code"] = failure_code
            if compensation is not None:
                values["compensation_json"] = compensation
            if state in {"ready", "failed", "cancelled"}:
                values["completed_at"] = func.now()
            await db.execute(update(retention_batches).where(retention_batches.c.id == row["id"], retention_batches.c.owner_id == actor.user_id).values(**values))
            return _public((await db.execute(select(retention_batches).where(retention_batches.c.id == row["id"]))).mappings().one())


class MemoryRepository:
    def __init__(self, factory, *, cursor_secret: str = ""):
        self.factory = factory
        self.cursor_secret = cursor_secret

    async def _row(self, db, actor, memory_id: str, *, lock: bool = False):
        query = select(memories).where(memories.c.id == uid(memory_id), memories.c.owner_id == actor.user_id)
        if lock:
            query = query.with_for_update(of=memories)
        row = (await db.execute(query)).mappings().first()
        if row is None:
            raise RetentionError("RESOURCE_NOT_FOUND")
        return row

    async def create_memory(self, actor, request: MemoryCreateRequest) -> dict:
        fact_id = uid(request.fact_version_id)
        async with tenant_transaction(self.factory, actor) as db:
            fact = (await db.execute(select(fact_versions).where(
                fact_versions.c.id == fact_id,
                fact_versions.c.owner_id == actor.user_id,
                fact_versions.c.confirmed_at.is_not(None),
                fact_versions.c.redacted_at.is_(None),
                fact_versions.c.consent_to_retain.is_(True),
            ).with_for_update(read=True))).mappings().first()
            if fact is None:
                raise RetentionError("FACT_NOT_ELIGIBLE")
            memory_id, version_id = uuid4(), uuid4()
            text = request.text or fact["text"]
            await db.execute(insert(memories).values(
                id=memory_id, owner_id=actor.user_id, current_version=1, active=True,
                valid_from=request.valid_from, valid_until=request.valid_until, revision=1,
            ))
            await db.execute(insert(memory_versions).values(
                id=version_id, owner_id=actor.user_id, memory_id=memory_id, version=1,
                text=text, source_fact_version_id=fact_id, provenance_state="user_confirmed",
            ))
            return await self.get_memory(actor, str(memory_id), db=db)

    async def get_memory(self, actor, memory_id: str, *, db=None) -> dict:
        if db is None:
            async with tenant_transaction(self.factory, actor) as session:
                return await self.get_memory(actor, memory_id, db=session)
        row = await self._row(db, actor, memory_id)
        version = (await db.execute(select(memory_versions).where(
            memory_versions.c.owner_id == actor.user_id,
            memory_versions.c.memory_id == row["id"],
            memory_versions.c.version == row["current_version"],
            memory_versions.c.redacted_at.is_(None),
        ))).mappings().first()
        if version is None:
            raise RetentionError("RESOURCE_NOT_FOUND")
        return {**_public(row), **{k: _json(v) for k, v in version.items() if k not in {"id", "owner_id", "memory_id", "created_at"}}, "retention": "retained"}

    async def list_memories(self, actor, *, limit: int = 20, cursor: str | None = None) -> dict:
        if not 1 <= limit <= 100:
            raise RetentionError("INVALID_REQUEST")
        after = self._decode_cursor(actor, cursor) if cursor else None
        async with tenant_transaction(self.factory, actor) as db:
            query = select(memories).where(memories.c.owner_id == actor.user_id)
            if after:
                updated, identifier = after
                query = query.where((memories.c.updated_at > updated) | ((memories.c.updated_at == updated) & (memories.c.id > uid(identifier))))
            rows = (await db.execute(query.order_by(memories.c.updated_at, memories.c.id).limit(limit + 1))).mappings().all()
            more = len(rows) > limit
            rows = rows[:limit]
            items = [await self.get_memory(actor, str(row["id"]), db=db) for row in rows]
            next_cursor = self._encode_cursor(actor, rows[-1]) if more and rows else None
            return {"items": items, "next_cursor": next_cursor, "has_more": bool(next_cursor)}

    async def patch_memory(self, actor, memory_id: str, request: MemoryPatchRequest) -> dict:
        async with tenant_transaction(self.factory, actor) as db:
            row = await self._row(db, actor, memory_id, lock=True)
            if row["revision"] != request.expected_revision:
                raise RetentionError("REVISION_CONFLICT")
            fields = {}
            if request.active is not None:
                fields["active"] = request.active
            if request.valid_from is not None:
                fields["valid_from"] = request.valid_from
            if request.valid_until is not None:
                fields["valid_until"] = request.valid_until
            if fields:
                fields["revision"] = row["revision"] + 1
                fields["updated_at"] = func.now()
                await db.execute(update(memories).where(memories.c.id == row["id"], memories.c.owner_id == actor.user_id).values(**fields))
            if request.text is not None:
                latest = (await db.execute(select(memory_versions).where(
                    memory_versions.c.owner_id == actor.user_id,
                    memory_versions.c.memory_id == row["id"],
                    memory_versions.c.version == row["current_version"],
                ).with_for_update())).mappings().first()
                if latest is None:
                    raise RetentionError("RESOURCE_NOT_FOUND")
                version = latest["version"] + 1
                await db.execute(insert(memory_versions).values(
                    id=uuid4(), owner_id=actor.user_id, memory_id=row["id"], version=version,
                    text=request.text, source_fact_version_id=latest["source_fact_version_id"], provenance_state="user_edited",
                ))
                await db.execute(update(memories).where(memories.c.id == row["id"], memories.c.owner_id == actor.user_id).values(
                    current_version=version, revision=(row["revision"] + 1 if not fields else row["revision"] + 1), updated_at=func.now()))
            return await self.get_memory(actor, memory_id, db=db)

    async def delete_memory(self, actor, memory_id: str, expected_revision: int) -> dict:
        async with tenant_transaction(self.factory, actor) as db:
            row = await self._row(db, actor, memory_id, lock=True)
            if row["revision"] != expected_revision:
                raise RetentionError("REVISION_CONFLICT")
            await db.execute(delete(workspace_memories).where(workspace_memories.c.memory_version_id.in_(
                select(memory_versions.c.id).where(memory_versions.c.memory_id == row["id"], memory_versions.c.owner_id == actor.user_id))))
            await db.execute(delete(memory_versions).where(memory_versions.c.memory_id == row["id"], memory_versions.c.owner_id == actor.user_id))
            await db.execute(delete(memories).where(memories.c.id == row["id"], memories.c.owner_id == actor.user_id))
        return {"id": memory_id, "deleted": True}

    async def use_memory(self, actor, memory_id: str, workspace_id: str, expected_revision: int) -> dict:
        async with tenant_transaction(self.factory, actor) as db:
            memory = await self._row(db, actor, memory_id)
            if not memory["active"] or (memory["valid_until"] and memory["valid_until"] <= datetime.now(timezone.utc)):
                raise RetentionError("MEMORY_NOT_AVAILABLE")
            workspace = (await db.execute(select(workspaces).where(
                workspaces.c.id == uid(workspace_id), workspaces.c.owner_id == actor.user_id,
            ).with_for_update())).mappings().first()
            if workspace is None:
                raise RetentionError("RESOURCE_NOT_FOUND")
            if workspace["revision"] != expected_revision:
                raise RetentionError("REVISION_CONFLICT")
            version = (await db.execute(select(memory_versions).where(
                memory_versions.c.owner_id == actor.user_id, memory_versions.c.memory_id == memory["id"],
                memory_versions.c.version == memory["current_version"], memory_versions.c.redacted_at.is_(None),
            ))).mappings().first()
            if version is None:
                raise RetentionError("MEMORY_NOT_AVAILABLE")
            existing = await db.scalar(select(workspace_memories.c.id).where(
                workspace_memories.c.owner_id == actor.user_id,
                workspace_memories.c.workspace_id == workspace["id"],
                workspace_memories.c.memory_version_id == version["id"],
            ))
            if not existing:
                await db.execute(insert(workspace_memories).values(
                    id=uuid4(), owner_id=actor.user_id, workspace_id=workspace["id"],
                    memory_version_id=version["id"], confirmed_at=func.now(),
                ))
            await db.execute(update(workspaces).where(workspaces.c.id == workspace["id"], workspaces.c.owner_id == actor.user_id).values(revision=expected_revision + 1, updated_at=func.now()))
            return {"memory_id": memory_id, "memory_version_id": str(version["id"]), "workspace_id": workspace_id, "revision": expected_revision + 1}

    def _encode_cursor(self, actor, row) -> str:
        body = base64.urlsafe_b64encode(json.dumps({"updated_at": row["updated_at"].isoformat(), "id": str(row["id"])}, separators=(",", ":")).encode()).decode().rstrip("=")
        if not self.cursor_secret:
            return body
        return body + "." + hmac.new(self.cursor_secret.encode(), body.encode(), hashlib.sha256).hexdigest()

    def _decode_cursor(self, actor, cursor: str):
        try:
            if self.cursor_secret:
                body, signature = cursor.split(".", 1)
                if not hmac.compare_digest(signature, hmac.new(self.cursor_secret.encode(), body.encode(), hashlib.sha256).hexdigest()):
                    raise ValueError
            else:
                body = cursor
            payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
            return datetime.fromisoformat(payload["updated_at"]), payload["id"]
        except (ValueError, TypeError, KeyError, json.JSONDecodeError):
            raise RetentionError("CURSOR_INVALID") from None
