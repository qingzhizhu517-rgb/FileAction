"""真实隔离 PG 补偿记录与合成 COS；不连接真实云端。"""
from uuid import uuid4

import pytest
from sqlalchemy import select

from test_document_repository import repository
from fileaction.db.models import blob_cleanup_jobs
from fileaction.db.session import tenant_transaction
from fileaction.documents.cleanup import CleanupWorker


@pytest.mark.asyncio
async def test_unknown_upload_result_never_becomes_successful_cleanup(repository):
    repo, actor = repository
    key = f"fileaction/immutable-originals/{actor.user_id}/{uuid4()}/{uuid4()}"
    journal = await repo.reserve_upload(actor, key)
    assert await repo.mark_cleanup(actor, journal, None)
    class SyntheticCos:
        def delete_version(self, *args): pytest.fail("未知上传结果不得冒险删除")
    worker = CleanupWorker(repo, SyntheticCos(), "synthetic-123")
    for expected in ("failed", "idle"):
        assert (await worker.run_once(actor))["status"] == expected
        async with tenant_transaction(repo.factory, actor) as session:
            row = (await session.execute(select(blob_cleanup_jobs).where(blob_cleanup_jobs.c.id == journal))).mappings().one()
            assert row["status"] == "failed"
            assert row["exact_blob_key"] == key and row["cos_version_id"] is None


@pytest.mark.asyncio
async def test_explicit_null_reference_remains_a_known_cleanup_target(repository):
    repo, actor = repository
    key = f"fileaction/immutable-originals/{actor.user_id}/{uuid4()}/{uuid4()}"
    journal = await repo.reserve_upload(actor, key)
    assert await repo.mark_cleanup(actor, journal, "null")
    calls = []
    class SyntheticCos:
        def delete_version(self, owner, ref): calls.append((owner, ref))
    assert (await CleanupWorker(repo, SyntheticCos(), "synthetic-123").run_once(actor))["status"] == "succeeded"
    assert len(calls) == 1 and calls[0][1].key == key and calls[0][1].version_id == "null"
