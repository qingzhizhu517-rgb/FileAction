"""合成COS；repository fixture用真实隔离PG，不调用云端或Worker。"""
import asyncio
from types import SimpleNamespace
from uuid import uuid4

import pytest
from sqlalchemy import select

from test_document_repository import repository
from fileaction.db.models import blob_cleanup_jobs
from fileaction.db.session import ActorContext, tenant_transaction
from fileaction.documents.service import DocumentError, DocumentService
from fileaction.storage_adapters.cos import ObjectRef


class SyntheticCos:
    def __init__(self):
        self.deleted = []
    def object_key(self, actor, document, version):
        return f"synthetic/{actor.user_id}/{document}/{version}"
    def put(self, actor, document, version, content, digest):
        return ObjectRef("synthetic-bucket", self.object_key(actor, document, version), "exact-synthetic-version", digest, len(content))
    def delete_version(self, actor, ref):
        self.deleted.append(ref.version_id)


async def synthetic_parse(*args):
    return SimpleNamespace(name="synthetic.txt", hash="a" * 64, warnings=[], segments=[])


async def upload(repo, actor, cos, monkeypatch):
    monkeypatch.setattr("fileaction.documents.service.parse_isolated", synthetic_parse)
    return await DocumentService(None, repo, cos).upload(actor, "synthetic.txt", b"test", retention="retained", consent_to_store=True, storage_notice_version="1")


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["committed_cancel", "committed_error", "rollback", "unknown"])
async def test_service_only_deletes_after_durable_cleanup_claim(monkeypatch, outcome):
    class SyntheticRepository:
        status = "uploading"
        async def reserve_upload(self, *args): return uuid4()
        async def finish_upload(self, *args):
            if outcome.startswith("committed"):
                self.status = "attached"
            if outcome == "committed_cancel":
                asyncio.current_task().cancel()
                await asyncio.sleep(0)
            raise RuntimeError("synthetic uncertain response")
        async def mark_cleanup(self, *args):
            if outcome == "unknown":
                raise ConnectionError("synthetic state unavailable")
            if self.status != "uploading": return False
            self.status = "pending"
            return True
        async def complete_cleanup(self, *args): self.status = "complete"
    repo, cos = SyntheticRepository(), SyntheticCos()
    task = asyncio.create_task(upload(repo, ActorContext(uuid4(), uuid4()), cos, monkeypatch))
    with pytest.raises(asyncio.CancelledError if outcome == "committed_cancel" else DocumentError):
        await task
    assert cos.deleted == (["exact-synthetic-version"] if outcome == "rollback" else [])
    assert repo.status == ("complete" if outcome == "rollback" else "uploading" if outcome == "unknown" else "attached")


@pytest.mark.asyncio
@pytest.mark.parametrize("commit_fails", [False, True])
async def test_caller_cancellation_waits_for_commit_to_settle(monkeypatch, commit_fails):
    started, finish = asyncio.Event(), asyncio.Event()
    class SyntheticRepository:
        status = "uploading"
        async def reserve_upload(self, *args): return uuid4()
        async def finish_upload(self, *args):
            started.set()
            await finish.wait()
            if commit_fails: raise RuntimeError("synthetic commit failure")
            self.status = "attached"
        async def mark_cleanup(self, *args):
            if self.status != "uploading": return False
            self.status = "pending"
            return True
        async def complete_cleanup(self, *args): self.status = "complete"
    repo, cos = SyntheticRepository(), SyntheticCos()
    task = asyncio.create_task(upload(repo, ActorContext(uuid4(), uuid4()), cos, monkeypatch))
    try:
        await asyncio.wait_for(started.wait(), 2)
        task.cancel()
        await asyncio.sleep(.02)
        assert not task.done()
        finish.set()
        with pytest.raises(asyncio.CancelledError): await task
        assert repo.status == ("complete" if commit_fails else "attached")
        assert cos.deleted == (["exact-synthetic-version"] if commit_fails else [])
    finally:
        finish.set()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["committed_cancel", "committed_error", "rollback", "unknown"])
async def test_real_pg_commit_response_does_not_delete_attached_source(repository, monkeypatch, outcome):
    repo, actor = repository
    cos = SyntheticCos()
    original_finish = repo.finish_upload
    async def finish_with_response_failure(actor, value, journal):
        if outcome == "rollback": value["name"] = None
        await original_finish(actor, value, journal)
        if outcome == "committed_cancel":
            asyncio.current_task().cancel()
            await asyncio.sleep(0)
        raise RuntimeError("synthetic response lost after real PG commit")
    monkeypatch.setattr(repo, "finish_upload", finish_with_response_failure)
    if outcome == "unknown":
        async def unavailable(*args): raise ConnectionError("synthetic verification outage")
        monkeypatch.setattr(repo, "mark_cleanup", unavailable)
    task = asyncio.create_task(upload(repo, actor, cos, monkeypatch))
    with pytest.raises(asyncio.CancelledError if outcome == "committed_cancel" else DocumentError): await task
    async with tenant_transaction(repo.factory, actor) as db:
        status = await db.scalar(select(blob_cleanup_jobs.c.status).where(blob_cleanup_jobs.c.owner_id == actor.user_id))
    assert status == ("complete" if outcome == "rollback" else "attached")
    assert len(await repo.list(actor)) == (0 if outcome == "rollback" else 1)
    assert cos.deleted == (["exact-synthetic-version"] if outcome == "rollback" else [])


def synthetic_value(actor):
    doc, version = uuid4(), uuid4()
    key = f"synthetic/{actor.user_id}/{doc}/{version}"
    return {"id": str(doc), "current_version_id": str(version), "name": "synthetic.txt", "sha256": "a" * 64, "size_bytes": 4, "warnings": [], "segments": [], "object_ref": {"key": key, "version_id": "exact-synthetic-version"}}


@pytest.mark.asyncio
async def test_cleanup_claim_prevents_late_document_attachment(repository):
    repo, actor = repository
    value = synthetic_value(actor)
    journal = await repo.reserve_upload(actor, value["object_ref"]["key"])
    assert await repo.mark_cleanup(actor, journal, "exact-synthetic-version") is True
    with pytest.raises(DocumentError): await repo.finish_upload(actor, value, journal)
    assert await repo.get(actor, value["id"]) is None


@pytest.mark.asyncio
async def test_attached_journal_cannot_be_downgraded_or_completed(repository):
    repo, actor = repository
    value = synthetic_value(actor)
    journal = await repo.reserve_upload(actor, value["object_ref"]["key"])
    await repo.finish_upload(actor, value, journal)
    assert await repo.mark_cleanup(actor, journal, "exact-synthetic-version") is False
    await repo.complete_cleanup(actor, journal)
    async with tenant_transaction(repo.factory, actor) as db:
        assert await db.scalar(select(blob_cleanup_jobs.c.status).where(blob_cleanup_jobs.c.id == journal)) == "attached"


@pytest.mark.asyncio
async def test_commit_and_cleanup_claim_have_only_one_winner(repository):
    repo, actor = repository
    value = synthetic_value(actor)
    journal = await repo.reserve_upload(actor, value["object_ref"]["key"])
    finished, claimed = await asyncio.gather(repo.finish_upload(actor, value, journal), repo.mark_cleanup(actor, journal, "exact-synthetic-version"), return_exceptions=True)
    document = await repo.get(actor, value["id"])
    assert (document is not None and claimed is False) or (document is None and claimed is True and isinstance(finished, DocumentError))


@pytest.mark.asyncio
@pytest.mark.parametrize("after_commit", [False, True])
async def test_real_pg_external_cancellation_settles_commit(repository, monkeypatch, after_commit):
    repo, actor = repository
    cos = SyntheticCos()
    entered, release = asyncio.Event(), asyncio.Event()
    original_finish = repo.finish_upload
    async def controlled_finish(actor, value, journal):
        if after_commit: await original_finish(actor, value, journal)
        entered.set()
        await release.wait()
        if not after_commit: await original_finish(actor, value, journal)
    monkeypatch.setattr(repo, "finish_upload", controlled_finish)
    task = asyncio.create_task(upload(repo, actor, cos, monkeypatch))
    try:
        await asyncio.wait_for(entered.wait(), 2)
        task.cancel()
        await asyncio.sleep(.02)
        assert not task.done()
        release.set()
        with pytest.raises(asyncio.CancelledError): await task
        assert len(await repo.list(actor)) == 1
        assert cos.deleted == []
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)


@pytest.mark.asyncio
async def test_cleanup_claim_response_lost_keeps_journal_without_delete(repository, monkeypatch):
    repo, actor = repository
    cos = SyntheticCos()
    original_finish, original_claim = repo.finish_upload, repo.mark_cleanup
    async def fail_commit(actor, value, journal):
        value["name"] = None
        await original_finish(actor, value, journal)
    async def lost_claim_response(*args):
        assert await original_claim(*args) is True
        raise ConnectionError("synthetic lost reply after durable cleanup claim")
    monkeypatch.setattr(repo, "finish_upload", fail_commit)
    monkeypatch.setattr(repo, "mark_cleanup", lost_claim_response)
    with pytest.raises(DocumentError): await upload(repo, actor, cos, monkeypatch)
    async with tenant_transaction(repo.factory, actor) as db:
        assert await db.scalar(select(blob_cleanup_jobs.c.status).where(blob_cleanup_jobs.c.owner_id == actor.user_id)) == "pending"
    assert await repo.list(actor) == [] and cos.deleted == []
