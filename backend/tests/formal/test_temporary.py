"""真实本机Redis，仅在明确测试URL下使用随机合成会话。"""
import asyncio
import os
from uuid import uuid4

import pytest
import pytest_asyncio
from redis.asyncio import Redis

from fileaction.db.session import ActorContext
from fileaction.storage_adapters.temporary import TemporaryStore, TemporaryError


@pytest_asyncio.fixture
async def temporary():
    url = os.getenv("FILEACTION_TEST_REDIS_URL")
    if not url:
        pytest.skip("需要显式隔离 FILEACTION_TEST_REDIS_URL")
    client = Redis.from_url(url, decode_responses=True)
    actor = ActorContext(uuid4(), uuid4())
    store = TemporaryStore(client)
    yield store, actor
    await store.end_session(actor)
    await client.delete(store.session_key(actor))
    await client.aclose()


@pytest.mark.asyncio
async def test_owner_and_session_isolation_and_revision_cas(temporary):
    store, alice = temporary
    resource = await store.create(alice, "document", {"text": "合成临时正文"})
    for other in (ActorContext(uuid4(), alice.session_id), ActorContext(alice.user_id, uuid4())):
        with pytest.raises(TemporaryError, match="TEMPORARY_CONTENT_EXPIRED"):
            await store.get(other, "document", resource.id)
    changed = await store.replace(alice, "document", resource.id, {"text": "更正的合成正文"}, expected_revision=1)
    assert changed.revision == 2
    with pytest.raises(TemporaryError, match="REVISION_CONFLICT"):
        await store.replace(alice, "document", resource.id, {"text": "迟到结果"}, expected_revision=1)
    assert (await store.get(alice, "document", resource.id)).value["text"] == "更正的合成正文"


@pytest.mark.asyncio
async def test_end_session_blocks_late_writes_and_new_resources(temporary):
    store, actor = temporary
    resource = await store.create(actor, "workspace", {"goal": "合成目标"})
    await store.end_session(actor)
    with pytest.raises(TemporaryError, match="TEMPORARY_CONTENT_EXPIRED"):
        await store.replace(actor, "workspace", resource.id, {"goal": "晚到"}, expected_revision=1)
    with pytest.raises(TemporaryError, match="SESSION_REVOKED"):
        await store.create(actor, "document", {"text": "晚到上传"})
    assert await store.list(actor, "workspace") == []


@pytest.mark.asyncio
async def test_hard_expiry_cannot_be_extended_by_reads(temporary):
    store, actor = temporary
    short = TemporaryStore(store.redis, idle_seconds=1, hard_seconds=2)
    resource = await short.create(actor, "document", {"text": "合成"})
    await asyncio.sleep(.6)
    await short.get(actor, "document", resource.id)
    await asyncio.sleep(.6)
    await short.get(actor, "document", resource.id)
    await asyncio.sleep(.9)
    with pytest.raises(TemporaryError, match="TEMPORARY_CONTENT_EXPIRED"):
        await short.get(actor, "document", resource.id)


@pytest.mark.asyncio
async def test_quota_rejects_growth_without_overwriting_existing_content(temporary):
    store, actor = temporary
    limited = TemporaryStore(store.redis, max_resource_bytes=512)
    resource = await limited.create(actor, "document", {"text": "合成"})
    with pytest.raises(TemporaryError, match="QUOTA_EXCEEDED"):
        await limited.replace(actor, "document", resource.id, {"text": "甲" * 1000}, expected_revision=1)
    assert (await limited.get(actor, "document", resource.id)).revision == 1
