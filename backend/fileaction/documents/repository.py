from __future__ import annotations

import hashlib
import base64
import hmac
import json
from datetime import datetime
from uuid import UUID, uuid4
from sqlalchemy import insert, select, update, delete, func, text, and_, tuple_
from sqlalchemy.ext.asyncio import async_sessionmaker

from fileaction.db.models import (documents, document_versions, document_segments, document_indexes,
                                  blob_cleanup_jobs, workspaces, workspace_documents, run_documents,
                                  runs, answers, artifact_versions, fact_evidence, fact_versions)
from fileaction.db.session import ActorContext, tenant_transaction
from .service import DocumentError


class DocumentRepository:
    def __init__(self, factory: async_sessionmaker, bucket: str = "", *, cursor_secret: str | None = None):
        self.factory = factory
        self.bucket = bucket
        self.cursor_secret = cursor_secret

    async def reserve_upload(self, actor: ActorContext, key: str, *, reserved_bytes: int = 0,
                             reserved_file: bool = True) -> UUID:
        identifier = uuid4()
        async with tenant_transaction(self.factory, actor) as session:
            await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"), {"owner": str(actor.user_id)})
            count = await session.scalar(select(func.count()).select_from(documents).where(
                documents.c.owner_id == actor.user_id, documents.c.deletion_state.in_(("active", "deleting"))))
            used = await session.scalar(select(func.coalesce(func.sum(document_versions.c.size_bytes), 0)).where(
                document_versions.c.owner_id == actor.user_id, document_versions.c.redacted_at.is_(None))) or 0
            reserved = await session.scalar(select(func.coalesce(func.sum(blob_cleanup_jobs.c.reserved_bytes), 0)).where(
                blob_cleanup_jobs.c.owner_id == actor.user_id, blob_cleanup_jobs.c.status == "uploading")) or 0
            files_reserved = await session.scalar(select(func.coalesce(func.sum(blob_cleanup_jobs.c.reserved_files), 0)).where(
                blob_cleanup_jobs.c.owner_id == actor.user_id, blob_cleanup_jobs.c.status == "uploading")) or 0
            if (reserved_file and count + files_reserved >= 200) or used + reserved + reserved_bytes > 500 * 1024 * 1024:
                raise DocumentError("QUOTA_EXCEEDED")
            await session.execute(insert(blob_cleanup_jobs).values(id=identifier, owner_id=actor.user_id, exact_blob_key=key,
                reason="upload_intent", status="uploading", reserved_bytes=reserved_bytes, reserved_files=1 if reserved_file else 0))
        return identifier

    async def finish_upload(self, actor: ActorContext, value: dict, journal: UUID):
        doc_id, version_id = UUID(value["id"]), UUID(value["current_version_id"])
        ref = value["object_ref"]
        async with tenant_transaction(self.factory, actor) as session:
            # Serialize capacity changes for the same owner without locking cloud I/O.
            await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"), {"owner": str(actor.user_id)})
            intent = (await session.execute(select(blob_cleanup_jobs).where(
                blob_cleanup_jobs.c.id == journal, blob_cleanup_jobs.c.owner_id == actor.user_id,
            ).with_for_update())).mappings().first()
            if intent is None or intent["status"] != "uploading" or intent["exact_blob_key"] != ref["key"]:
                raise DocumentError("DOCUMENT_SAVE_FAILED")
            count = await session.scalar(select(func.count()).select_from(documents).where(documents.c.owner_id == actor.user_id, documents.c.deletion_state == "active"))
            size = await session.scalar(select(func.coalesce(func.sum(document_versions.c.size_bytes), 0)).where(document_versions.c.owner_id == actor.user_id))
            if count >= 200 or size + value["size_bytes"] > 500 * 1024 * 1024:
                raise DocumentError("QUOTA_EXCEEDED")
            await session.execute(insert(documents).values(id=doc_id, owner_id=actor.user_id, name=value["name"], category="uncategorized", current_version=1, parse_status="ready", revision=1))
            await session.execute(insert(document_versions).values(id=version_id, owner_id=actor.user_id, document_id=doc_id, version=1, sha256=value["sha256"], size_bytes=value["size_bytes"], mime_type=value.get("mime_type", "application/octet-stream"), blob_key=ref["key"], cos_version_id=ref["version_id"], extracted_chars=sum(len(s["text"]) for s in value["segments"]), parse_warnings=value["warnings"]))
            for ordinal, segment in enumerate(value["segments"]):
                await session.execute(insert(document_segments).values(id=UUID(segment["id"]), owner_id=actor.user_id, document_version_id=version_id, ordinal=ordinal, locator_json={"label": segment["location"]}, text=segment["text"], text_hash=hashlib.sha256(segment["text"].encode()).hexdigest(), char_count=len(segment["text"])))
            await session.execute(update(blob_cleanup_jobs).where(blob_cleanup_jobs.c.id == journal, blob_cleanup_jobs.c.owner_id == actor.user_id).values(status="attached", cos_version_id=ref["version_id"], reserved_bytes=0, reserved_files=0))

    async def mark_cleanup(self, actor: ActorContext, journal: UUID, version: str | None) -> bool:
        """Claim only unattached upload intent, returning after the claim commits."""
        async with tenant_transaction(self.factory, actor) as session:
            intent = (await session.execute(select(blob_cleanup_jobs).where(
                blob_cleanup_jobs.c.id == journal, blob_cleanup_jobs.c.owner_id == actor.user_id,
            ).with_for_update())).mappings().first()
            if intent is None or intent["status"] != "uploading":
                return False
            attached = await session.scalar(select(document_versions.c.id).where(
                document_versions.c.owner_id == actor.user_id,
                document_versions.c.blob_key == intent["exact_blob_key"],
            ).limit(1))
            if attached is not None:
                return False
            await session.execute(update(blob_cleanup_jobs).where(blob_cleanup_jobs.c.id == journal, blob_cleanup_jobs.c.owner_id == actor.user_id).values(status="pending", cos_version_id=version, reason="upload_not_committed", reserved_bytes=0, reserved_files=0))
        return True

    async def complete_cleanup(self, actor: ActorContext, journal: UUID):
        async with tenant_transaction(self.factory, actor) as session:
            await session.execute(update(blob_cleanup_jobs).where(blob_cleanup_jobs.c.id == journal, blob_cleanup_jobs.c.owner_id == actor.user_id, blob_cleanup_jobs.c.status == "pending", blob_cleanup_jobs.c.reason == "upload_not_committed").values(status="complete"))

    async def get(self, actor: ActorContext, identifier: str) -> dict | None:
        try:
            doc_id = UUID(identifier)
        except ValueError:
            return None
        async with tenant_transaction(self.factory, actor) as session:
            row = (await session.execute(select(documents).where(documents.c.id == doc_id, documents.c.owner_id == actor.user_id, documents.c.deletion_state == "active"))).mappings().first()
            if row is None: return None
            version = (await session.execute(select(document_versions).where(document_versions.c.owner_id == actor.user_id, document_versions.c.document_id == doc_id, document_versions.c.version == row["current_version"], document_versions.c.redacted_at.is_(None)))).mappings().first()
            if version is None: return None
            segments = (await session.execute(select(document_segments).where(document_segments.c.owner_id == actor.user_id, document_segments.c.document_version_id == version["id"], document_segments.c.redacted_at.is_(None)).order_by(document_segments.c.ordinal))).mappings().all()
            return {
                "id": str(row["id"]), "name": row["name"], "revision": row["revision"], "retention": "retained", "category": row["category"],
                "parse_status": row["parse_status"], "index_status": "not_requested" if not version["active_index_id"] else "ready",
                "current_version_id": str(version["id"]), "size_bytes": version["size_bytes"], "mime_type": version["mime_type"] or "application/octet-stream", "warnings": version["parse_warnings"] or [],
                "segments": [{"id": str(s["id"]), "text": s["text"], "location": s["locator_json"]["label"]} for s in segments],
                "sha256": version["sha256"],
                "object_ref": {"bucket": self.bucket, "key": version["blob_key"], "version_id": version["cos_version_id"], "sha256": version["sha256"], "size_bytes": version["size_bytes"]},
            }

    async def patch_metadata(self, actor: ActorContext, identifier: str, *, name: str | None,
                             category: str | None, expected_revision: int) -> dict:
        try:
            doc_id = UUID(identifier)
        except ValueError:
            raise DocumentError("RESOURCE_NOT_FOUND") from None
        async with tenant_transaction(self.factory, actor) as session:
            row = (await session.execute(select(documents).where(documents.c.id == doc_id,
                documents.c.owner_id == actor.user_id, documents.c.deletion_state == "active").with_for_update())).mappings().first()
            if row is None:
                raise DocumentError("RESOURCE_NOT_FOUND")
            if row["revision"] != expected_revision:
                raise DocumentError("REVISION_CONFLICT")
            values = {"revision": expected_revision + 1, "updated_at": func.now()}
            if name is not None:
                values["name"] = name.strip()
            if category is not None:
                values["category"] = category
            await session.execute(update(documents).where(documents.c.id == doc_id,
                documents.c.owner_id == actor.user_id).values(**values))
        result = await self.get(actor, identifier)
        if result is None:
            raise DocumentError("RESOURCE_NOT_FOUND")
        return result

    async def save_version(self, actor: ActorContext, identifier: str, expected_revision: int,
                           value: dict, cos: CosBlobStore, content: bytes) -> dict:
        try:
            doc_id = UUID(identifier)
            version_id = UUID(value["current_version_id"])
        except (ValueError, KeyError):
            raise DocumentError("RESOURCE_NOT_FOUND") from None
        key = cos.object_key(actor, doc_id, version_id)
        journal = await self.reserve_upload(actor, key, reserved_bytes=len(content), reserved_file=False)
        ref = None
        try:
            ref = await __import__("asyncio").to_thread(cos.put, actor, doc_id, version_id, content, value["sha256"])
            async with tenant_transaction(self.factory, actor) as session:
                await session.execute(text("SELECT pg_advisory_xact_lock(hashtextextended(:owner, 0))"), {"owner": str(actor.user_id)})
                row = (await session.execute(select(documents).where(documents.c.id == doc_id,
                    documents.c.owner_id == actor.user_id, documents.c.deletion_state == "active").with_for_update())).mappings().first()
                if row is None:
                    raise DocumentError("RESOURCE_NOT_FOUND")
                if row["revision"] != expected_revision:
                    raise DocumentError("REVISION_CONFLICT")
                number = row["current_version"] + 1
                await session.execute(insert(document_versions).values(id=version_id, owner_id=actor.user_id,
                    document_id=doc_id, version=number, sha256=value["sha256"], size_bytes=value["size_bytes"],
                    mime_type="application/octet-stream", blob_key=ref.key, cos_version_id=ref.version_id,
                    extracted_chars=sum(len(s["text"]) for s in value["segments"]), parse_warnings=value.get("warnings", [])))
                for ordinal, segment in enumerate(value["segments"]):
                    await session.execute(insert(document_segments).values(id=UUID(segment["id"]), owner_id=actor.user_id,
                        document_version_id=version_id, ordinal=ordinal, locator_json={"label": segment["location"]},
                        text=segment["text"], text_hash=hashlib.sha256(segment["text"].encode()).hexdigest(), char_count=len(segment["text"])))
                old_indexes = (await session.execute(select(document_versions.c.active_index_id).where(document_versions.c.document_id == doc_id,
                    document_versions.c.owner_id == actor.user_id, document_versions.c.active_index_id.is_not(None)))).scalars().all()
                if old_indexes:
                    await session.execute(update(document_indexes).where(document_indexes.c.id.in_(old_indexes),
                        document_indexes.c.owner_id == actor.user_id).values(status="stale", updated_at=func.now()))
                await session.execute(update(document_versions).where(document_versions.c.document_id == doc_id,
                    document_versions.c.owner_id == actor.user_id, document_versions.c.active_index_id.is_not(None)).values(active_index_id=None))
                await session.execute(update(documents).where(documents.c.id == doc_id, documents.c.owner_id == actor.user_id)
                    .values(current_version=number, revision=expected_revision + 1, parse_status="ready", updated_at=func.now()))
                await session.execute(update(blob_cleanup_jobs).where(blob_cleanup_jobs.c.id == journal,
                    blob_cleanup_jobs.c.owner_id == actor.user_id).values(status="attached", cos_version_id=ref.version_id, reserved_bytes=0, reserved_files=0))
        except Exception:
            # Claim the durable journal before compensating. A lost DB response
            # may have committed the version; in that case mark_cleanup returns
            # false and the attached object is retained for reconciliation.
            try:
                claimed = await self.mark_cleanup(actor, journal, ref.version_id if ref is not None else None)
            except Exception:
                claimed = False
            if claimed and ref is not None:
                try:
                    await __import__("asyncio").to_thread(cos.delete_version, actor, ref)
                    await self.complete_cleanup(actor, journal)
                except Exception:
                    pass
            raise
        return await self.get(actor, identifier) or (_ for _ in ()).throw(DocumentError("RESOURCE_NOT_FOUND"))

    async def deletion_impact(self, actor: ActorContext, identifier: str) -> dict:
        try:
            doc_id = UUID(identifier)
        except ValueError:
            raise DocumentError("RESOURCE_NOT_FOUND") from None
        async with tenant_transaction(self.factory, actor) as session:
            doc = (await session.execute(select(documents).where(documents.c.id == doc_id,
                documents.c.owner_id == actor.user_id, documents.c.deletion_state == "active"))).mappings().first()
            if doc is None:
                raise DocumentError("RESOURCE_NOT_FOUND")
            versions = (await session.execute(select(document_versions.c.id).where(document_versions.c.document_id == doc_id,
                document_versions.c.owner_id == actor.user_id, document_versions.c.redacted_at.is_(None)))).scalars().all()
            if not versions:
                raise DocumentError("RESOURCE_NOT_FOUND")
            version_ids = list(versions)
            workspace_ids = (await session.execute(select(workspaces.c.id).join(workspace_documents,
                and_(workspace_documents.c.workspace_id == workspaces.c.id, workspace_documents.c.owner_id == workspaces.c.owner_id))
                .where(workspace_documents.c.document_version_id.in_(version_ids), workspaces.c.owner_id == actor.user_id))).scalars().all()
            run_ids = (await session.execute(select(run_documents.c.run_id).where(run_documents.c.document_version_id.in_(version_ids),
                run_documents.c.owner_id == actor.user_id))).scalars().all()
            answer_ids = (await session.execute(select(answers.c.id).where(answers.c.run_id.in_(run_ids), answers.c.owner_id == actor.user_id))).scalars().all() if run_ids else []
            artifact_ids = (await session.execute(select(artifact_versions.c.artifact_id).where(artifact_versions.c.run_id.in_(run_ids), artifact_versions.c.owner_id == actor.user_id))).scalars().all() if run_ids else []
            fact_ids = (await session.execute(select(fact_versions.c.fact_id).join(fact_evidence,
                and_(fact_evidence.c.fact_version_id == fact_versions.c.id, fact_evidence.c.owner_id == fact_versions.c.owner_id)).where(
                    fact_evidence.c.document_version_id.in_(version_ids), fact_evidence.c.owner_id == actor.user_id))).scalars().all()
            index_ids = (await session.execute(select(document_indexes.c.id).where(document_indexes.c.document_version_id.in_(version_ids), document_indexes.c.owner_id == actor.user_id))).scalars().all()
        return {"document_id": identifier, "revision": doc["revision"],
                "workspaces": sorted({str(x) for x in workspace_ids}), "runs": sorted({str(x) for x in run_ids}),
                "answers": sorted({str(x) for x in answer_ids}), "facts": sorted({str(x) for x in fact_ids}),
                "artifacts": sorted({str(x) for x in artifact_ids}), "indexes": sorted({str(x) for x in index_ids}),
                "derived_content_warning": True, "cascade_derived": False}

    async def begin_delete(self, actor: ActorContext, identifier: str, expected_revision: int, impact_hash: str) -> dict:
        try:
            doc_id = UUID(identifier)
        except ValueError:
            raise DocumentError("RESOURCE_NOT_FOUND") from None
        async with tenant_transaction(self.factory, actor) as session:
            row = (await session.execute(select(documents).where(documents.c.id == doc_id,
                documents.c.owner_id == actor.user_id, documents.c.deletion_state == "active").with_for_update())).mappings().first()
            if row is None:
                raise DocumentError("RESOURCE_NOT_FOUND")
            if row["revision"] != expected_revision:
                raise DocumentError("REVISION_CONFLICT")
            await session.execute(update(documents).where(documents.c.id == doc_id, documents.c.owner_id == actor.user_id)
                .values(deletion_state="deleting", parse_status="deleting", revision=expected_revision + 1, updated_at=func.now()))
            versions = (await session.execute(select(document_versions).where(document_versions.c.document_id == doc_id,
                document_versions.c.owner_id == actor.user_id))).mappings().all()
            for version in versions:
                if version["blob_key"] and version["cos_version_id"]:
                    await session.execute(insert(blob_cleanup_jobs).values(id=uuid4(), owner_id=actor.user_id,
                        exact_blob_key=version["blob_key"], cos_version_id=version["cos_version_id"], reason=f"document_delete:{identifier}", status="queued"))
                await session.execute(update(document_segments).where(document_segments.c.document_version_id == version["id"],
                    document_segments.c.owner_id == actor.user_id).values(text=None, redacted_at=func.now()))
                await session.execute(update(document_versions).where(document_versions.c.id == version["id"],
                    document_versions.c.owner_id == actor.user_id).values(sha256=None, blob_key=None, cos_version_id=None, redacted_at=func.now(), active_index_id=None))
            await session.execute(update(document_indexes).where(document_indexes.c.document_version_id.in_([v["id"] for v in versions]),
                document_indexes.c.owner_id == actor.user_id).values(status="deleted", updated_at=func.now()))
            if versions:
                await session.execute(update(fact_versions).where(fact_versions.c.id.in_(select(fact_evidence.c.fact_version_id).where(
                    fact_evidence.c.document_version_id.in_([v["id"] for v in versions]), fact_evidence.c.owner_id == actor.user_id)),
                    fact_versions.c.owner_id == actor.user_id).values(text=None, provenance_state="source_deleted", redacted_at=func.now()))
                await session.execute(update(runs).where(runs.c.id.in_(select(run_documents.c.run_id).where(run_documents.c.document_version_id.in_([v["id"] for v in versions]))),
                    runs.c.owner_id == actor.user_id, runs.c.status.in_(("queued", "running"))).values(status="cancelled", error_code="SOURCE_DELETED", updated_at=func.now()))
                await session.execute(update(answers).where(answers.c.run_id.in_(select(run_documents.c.run_id).where(run_documents.c.document_version_id.in_([v["id"] for v in versions]))),
                    answers.c.owner_id == actor.user_id).values(validity="source_deleted", envelope_json=None, redacted_at=func.now()))
                await session.execute(update(artifact_versions).where(artifact_versions.c.run_id.in_(select(run_documents.c.run_id).where(run_documents.c.document_version_id.in_([v["id"] for v in versions]))),
                    artifact_versions.c.owner_id == actor.user_id, artifact_versions.c.author_kind == "model").values(validity="source_deleted", body=None, redacted_at=func.now()))
        return {"id": identifier, "status": "deleting", "revision": expected_revision + 1, "impact_hash": impact_hash}

    async def list(self, actor: ActorContext) -> list[dict]:
        async with tenant_transaction(self.factory, actor) as session:
            rows = (await session.execute(select(documents).where(documents.c.owner_id == actor.user_id, documents.c.deletion_state == "active").order_by(documents.c.updated_at.desc(), documents.c.id.desc()).limit(200))).mappings().all()
            return [{"id": str(r["id"]), "name": r["name"], "revision": r["revision"], "retention": "retained", "category": r["category"], "parse_status": r["parse_status"], "index_status": "not_requested", "created_at": r["created_at"].isoformat()} for r in rows]

    async def list_page(self, actor: ActorContext, *, limit: int = 20, cursor: str | None = None, query: str = "", category: str = "") -> dict:
        if type(limit) is not int or not 1 <= limit <= 100 or len(query) > 100 or category not in {"", "uncategorized", "notice", "material"}:
            raise DocumentError("INVALID_REQUEST")
        if not self.cursor_secret:
            raise DocumentError("DEPENDENCY_UNAVAILABLE")
        scope = [str(actor.user_id), query, category, "documents-v1"]
        conditions = [documents.c.owner_id == actor.user_id, documents.c.deletion_state == "active",
                      document_versions.c.redacted_at.is_(None)]
        if query:
            conditions.append(documents.c.name.icontains(query, autoescape=True))
        if category:
            conditions.append(documents.c.category == category)
        source = documents.join(document_versions, and_(
            documents.c.owner_id == document_versions.c.owner_id,
            documents.c.id == document_versions.c.document_id,
            documents.c.current_version == document_versions.c.version,
        )).outerjoin(document_indexes, and_(
            document_versions.c.owner_id == document_indexes.c.owner_id,
            document_versions.c.id == document_indexes.c.document_version_id,
            document_versions.c.active_index_id == document_indexes.c.id,
        ))
        filtered = list(conditions)
        if cursor:
            try:
                if len(cursor) > 4096:
                    raise ValueError()
                body, signature = cursor.split(".")
                expected = hmac.new(self.cursor_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
                if not hmac.compare_digest(expected, signature):
                    raise ValueError()
                payload = json.loads(base64.urlsafe_b64decode(body + "=" * (-len(body) % 4)))
                if payload["scope"] != scope:
                    raise ValueError()
                timestamp = datetime.fromisoformat(payload["time"])
                if timestamp.tzinfo is None:
                    raise ValueError()
                identifier = UUID(payload["id"])
                filtered.append(tuple_(documents.c.updated_at, documents.c.id) < tuple_(timestamp, identifier))
            except (ValueError, TypeError, KeyError):
                raise DocumentError("CURSOR_INVALID") from None
        statement = select(documents, document_versions.c.id.label("version_id"),
            document_versions.c.size_bytes, document_indexes.c.status.label("index_status")).select_from(source)
        async with tenant_transaction(self.factory, actor) as session:
            total = await session.scalar(select(func.count()).select_from(source).where(*conditions))
            rows = (await session.execute(statement.where(*filtered).order_by(
                documents.c.updated_at.desc(), documents.c.id.desc()).limit(limit + 1))).mappings().all()
        has_more = len(rows) > limit
        rows = rows[:limit]
        next_cursor = None
        if has_more:
            last = rows[-1]
            body = base64.urlsafe_b64encode(json.dumps({"scope": scope, "time": last["updated_at"].isoformat(),
                "id": str(last["id"])}, ensure_ascii=False, separators=(",", ":")).encode()).decode().rstrip("=")
            next_cursor = body + "." + hmac.new(self.cursor_secret.encode(), body.encode(), hashlib.sha256).hexdigest()
        return {"items": [{
            "id": str(row["id"]), "name": row["name"], "revision": row["revision"], "retention": "retained",
            "category": row["category"], "parse_status": row["parse_status"],
            "index_status": row["index_status"] or "not_requested", "current_version_id": str(row["version_id"]),
            "size_bytes": row["size_bytes"], "created_at": row["created_at"].isoformat(),
        } for row in rows], "next_cursor": next_cursor, "has_more": has_more, "total": total}
