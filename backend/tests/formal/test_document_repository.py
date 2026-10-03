"""真实隔离PG中的合成保存记录；COS仅SDK替身。"""
import hashlib
import os
from uuid import uuid4
import pytest
import pytest_asyncio
from sqlalchemy import delete, insert
from sqlalchemy.ext.asyncio import create_async_engine, async_sessionmaker
from fileaction.db.models import User, documents, document_versions, document_segments, blob_cleanup_jobs
from fileaction.db.session import ActorContext
from fileaction.documents.repository import DocumentRepository


@pytest_asyncio.fixture
async def repository():
    runtime = os.getenv("FILEACTION_TEST_DATABASE_URL")
    admin = os.getenv("FILEACTION_TEST_ADMIN_DATABASE_URL")
    if not runtime or not admin:
        pytest.skip("需要隔离PG管理与runtime测试URL")
    runtime = runtime.replace("postgresql://", "postgresql+psycopg://", 1)
    admin = admin.replace("postgresql://", "postgresql+psycopg://", 1)
    engine = create_async_engine(runtime)
    root_engine = create_async_engine(admin)
    actor = ActorContext(uuid4(), uuid4())
    async with root_engine.begin() as conn:
        await conn.execute(insert(User).values(id=actor.user_id, username_normalized=str(actor.user_id), display_name="合成用户", password_hash="synthetic"))
    yield DocumentRepository(async_sessionmaker(engine)), actor
    async with root_engine.begin() as conn:
        for table in (document_segments, document_versions, documents, blob_cleanup_jobs):
            await conn.execute(delete(table).where(table.c.owner_id == actor.user_id))
        await conn.execute(delete(User).where(User.id == actor.user_id))
    await engine.dispose()
    await root_engine.dispose()


@pytest.mark.asyncio
async def test_atomic_saved_metadata_segments_and_owner_isolation(repository):
    repo, actor = repository
    identifier, version, segment = uuid4(), uuid4(), uuid4()
    key = f"fileaction/originals/{actor.user_id}/{identifier}/{version}"
    journal = await repo.reserve_upload(actor, key)
    text = "合成原文"
    digest = hashlib.sha256(text.encode()).hexdigest()
    value = {"id": str(identifier), "current_version_id": str(version), "name": "合成.txt", "size_bytes": len(text.encode()), "sha256": digest, "warnings": [], "segments": [{"id": str(segment), "text": text, "location": "第1行"}], "object_ref": {"bucket": "synthetic-123", "key": key, "version_id": "v-synthetic", "sha256": digest, "size_bytes": len(text.encode())}}
    await repo.finish_upload(actor, value, journal)
    result = await repo.get(actor, str(identifier))
    assert result["segments"][0]["text"] == text
    assert result["object_ref"]["version_id"] == "v-synthetic"
    assert len(await repo.list(actor)) == 1
    assert await repo.get(ActorContext(uuid4(), uuid4()), str(identifier)) is None
