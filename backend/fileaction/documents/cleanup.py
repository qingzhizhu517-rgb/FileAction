"""Exact, retryable cleanup of server-owned versioned objects."""
from __future__ import annotations

from contextlib import suppress
from uuid import UUID

from sqlalchemy import func, select, update

from fileaction.db.models import blob_cleanup_jobs, documents
from fileaction.db.session import ActorContext, tenant_transaction
from fileaction.storage_adapters.cos import CosBlobStore, ObjectRef, StorageError
from .repository import DocumentRepository


class CleanupWorker:
    def __init__(self, repository: DocumentRepository, cos: CosBlobStore, bucket: str):
        self.repository = repository
        self.cos = cos
        self.bucket = bucket

    async def run_once(self, actor: ActorContext) -> dict:
        async with tenant_transaction(self.repository.factory, actor) as session:
            row = (await session.execute(select(blob_cleanup_jobs).where(
                blob_cleanup_jobs.c.owner_id == actor.user_id,
                blob_cleanup_jobs.c.status.in_(("queued", "pending", "failed")),
            ).order_by(blob_cleanup_jobs.c.created_at, blob_cleanup_jobs.c.id).with_for_update(skip_locked=True).limit(1))).mappings().first()
            if row is None:
                return {"status": "idle"}
            await session.execute(update(blob_cleanup_jobs).where(blob_cleanup_jobs.c.id == row["id"]).values(
                status="running", attempts=blob_cleanup_jobs.c.attempts + 1, updated_at=func.now()))
        ref = ObjectRef(self.bucket, row["exact_blob_key"], row["cos_version_id"], "0" * 64, 0)
        if row["cos_version_id"]:
            try:
                await __import__("asyncio").to_thread(self.cos.delete_version, actor, ref)
            except Exception:
                async with tenant_transaction(self.repository.factory, actor) as session:
                    await session.execute(update(blob_cleanup_jobs).where(blob_cleanup_jobs.c.id == row["id"]).values(status="failed", updated_at=func.now()))
                return {"status": "failed", "job_id": str(row["id"])}
        async with tenant_transaction(self.repository.factory, actor) as session:
            await session.execute(update(blob_cleanup_jobs).where(blob_cleanup_jobs.c.id == row["id"]).values(status="succeeded", updated_at=func.now()))
            reason = row["reason"] or ""
            if reason.startswith("document_delete:"):
                document_id = reason.split(":", 1)[1]
                try:
                    doc_id = UUID(document_id)
                except ValueError:
                    doc_id = None
                if doc_id:
                    pending = await session.scalar(select(func.count()).select_from(blob_cleanup_jobs).where(
                        blob_cleanup_jobs.c.owner_id == actor.user_id,
                        blob_cleanup_jobs.c.reason == reason,
                        blob_cleanup_jobs.c.status != "succeeded"))
                    if not pending:
                        await session.execute(update(documents).where(documents.c.id == doc_id,
                            documents.c.owner_id == actor.user_id, documents.c.deletion_state == "deleting").values(
                                deletion_state="deleted", parse_status="deleted", redacted_at=func.now(), updated_at=func.now()))
        return {"status": "succeeded", "job_id": str(row["id"])}
