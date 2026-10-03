"""真实隔离Redis、合成内容，验证跨会话账号总量而非单资源限制。"""
import asyncio
import base64
import json
from uuid import uuid4

import pytest
from redis.exceptions import RedisError

from test_temporary import temporary
from fileaction.db.session import ActorContext
from fileaction.storage_adapters.temporary import TemporaryStore, TemporaryError


@pytest.mark.asyncio
async def test_original_quota_is_shared_across_sessions_and_released(temporary):
    store, actor = temporary
    other = ActorContext(actor.user_id, uuid4())
    limited = TemporaryStore(store.redis, max_original_bytes=8, max_derived_bytes=1024)
    body = {"source_base64": base64.b64encode(b"12345").decode(), "text": "合成"}
    resource = await limited.create(actor, "document", body)
    try:
        with pytest.raises(TemporaryError, match="QUOTA_EXCEEDED"):
            await limited.create(other, "document", body)
        await limited.delete(actor, "document", resource.id)
        await limited.create(other, "document", body)
    finally:
        await limited.end_session(other)
        await store.redis.delete(limited.session_key(other))


@pytest.mark.asyncio
async def test_concurrent_growth_has_one_winner_without_partial_overwrite(temporary):
    store, actor = temporary
    limited = TemporaryStore(store.redis, max_derived_bytes=400)
    first = await limited.create(actor, "workspace", {"text": "合成"})
    second = await limited.create(actor, "workspace", {"text": "合成"})
    outcomes = await asyncio.gather(*(
        limited.replace(actor, "workspace", item.id, {"text": "a" * 260}, expected_revision=1)
        for item in (first, second)
    ), return_exceptions=True)
    assert sum(isinstance(result, TemporaryError) for result in outcomes) == 1
    resources = [await limited.get(actor, "workspace", item.id) for item in (first, second)]
    assert sorted(item.revision for item in resources) == [1, 2]


@pytest.mark.asyncio
async def test_expired_resources_do_not_hold_account_capacity(temporary):
    store, actor = temporary
    limited = TemporaryStore(store.redis, idle_seconds=.05, hard_seconds=.1, max_derived_bytes=180)
    await limited.create(actor, "workspace", {"text": "a" * 120})
    await asyncio.sleep(.15)
    item = await limited.create(actor, "workspace", {"text": "b" * 120})
    assert item.revision == 1


@pytest.mark.asyncio
async def test_upload_slots_are_shared_released_and_revocation_checked(temporary):
    store, actor = temporary
    other = ActorContext(actor.user_id, uuid4())
    async with store.upload_slot(actor):
        async with store.upload_slot(other):
            with pytest.raises(TemporaryError, match="UPLOAD_LIMIT_EXCEEDED"):
                async with store.upload_slot(actor):
                    pytest.fail("第三个上传不能进入")
        async with store.upload_slot(actor):
            pass
    await store.end_session(actor)
    with pytest.raises(TemporaryError, match="SESSION_REVOKED"):
        async with store.upload_slot(actor):
            pytest.fail("退出后不能开始上传")


@pytest.mark.asyncio
async def test_cancelled_upload_releases_slot_without_waiting_for_lease(temporary):
    store, actor = temporary
    with pytest.raises(asyncio.CancelledError):
        async with store.upload_slot(actor):
            raise asyncio.CancelledError()
    async with store.upload_slot(actor):
        async with store.upload_slot(actor):
            pass


@pytest.mark.asyncio
@pytest.mark.parametrize("original", [False, True])
async def test_legacy_cross_session_resources_are_accounted_without_deletion(temporary, original):
    store, actor = temporary
    other = ActorContext(actor.user_id, uuid4())
    identifier = str(uuid4())
    kind = "document" if original else "workspace"
    key = store._key(other, kind, identifier)
    body = {"source_base64": base64.b64encode(b"123456").decode(), "text": "旧合成"} if original else {"text": "s" * 40}
    now = (await store.redis.time())[0]
    await store.redis.hset(key, mapping={"value": json.dumps(body), "revision": "1", "expires": str(now + 60)})
    await store.redis.expire(key, 60)
    await store.redis.sadd(store._registry(other), key)
    await store.redis.expire(store._registry(other), 60)
    limited = TemporaryStore(store.redis, max_original_bytes=8, max_derived_bytes=1024 if original else 60)
    try:
        with pytest.raises(TemporaryError, match="QUOTA_EXCEEDED"):
            await limited.create(actor, kind, body)
        assert (await limited.get(other, kind, identifier)).value == body
        await limited.replace(other, kind, identifier, body, expected_revision=1)
        with pytest.raises(TemporaryError, match="QUOTA_EXCEEDED"):
            await limited.create(actor, kind, body)
        assert await store.redis.sismember(store._account_registry(actor), key)
    finally:
        await store.end_session(other)
        await store.redis.delete(store.session_key(other))


@pytest.mark.asyncio
@pytest.mark.parametrize("hard", [.05, .3, 2])
async def test_short_preview_never_shortens_shared_session_registry(temporary, hard):
    store, actor = temporary
    document = await store.create(actor, "document", {"text": "long lived"})
    before = await store.redis.pttl(store._registry(actor))
    short = TemporaryStore(store.redis, idle_seconds=hard, hard_seconds=hard)
    await short.create(actor, "preview", {"text": "short lived"})
    assert await store.redis.pttl(store._registry(actor)) >= before - 1000
    await store.end_session(actor)
    assert not await store.redis.exists(store._key(actor, "document", document.id))


@pytest.mark.asyncio
async def test_legacy_scan_failure_never_admits_unaccounted_content(temporary, monkeypatch):
    store, actor = temporary
    async def fail_scan(*args, **kwargs):
        raise RedisError("synthetic scan failure")
    monkeypatch.setattr(store.redis, "scan", fail_scan)
    with pytest.raises(TemporaryError, match="DEPENDENCY_UNAVAILABLE"):
        await store.create(actor, "workspace", {"text": "synthetic"})
    assert await store.redis.scard(store._registry(actor)) == 0


@pytest.mark.asyncio
async def test_malformed_legacy_original_fails_closed_without_deleting_it(temporary):
    store, actor = temporary
    key = store._key(actor, "document", str(uuid4()))
    body = json.dumps({"source_base64": "===="})
    now = (await store.redis.time())[0]
    await store.redis.hset(key, mapping={"value": body, "revision": 1, "expires": now + 60})
    await store.redis.expire(key, 60)
    await store.redis.sadd(store._registry(actor), key)
    with pytest.raises(TemporaryError, match="TEMPORARY_MIGRATION_REQUIRED"):
        await store.create(actor, "workspace", {"text": "synthetic"})
    assert await store.redis.hget(key, "value") == body


@pytest.mark.asyncio
async def test_lease_renewal_failure_cancels_request_and_reports_dependency(temporary, monkeypatch):
    store, actor = temporary
    store.UPLOAD_RENEW_SECONDS = .02
    original_eval = store.redis.eval
    async def eval_with_renewal_failure(script, *args):
        if "ZSCORE" in script:
            raise RedisError("synthetic renewal failure")
        return await original_eval(script, *args)
    monkeypatch.setattr(store.redis, "eval", eval_with_renewal_failure)
    with pytest.raises(TemporaryError, match="DEPENDENCY_UNAVAILABLE"):
        async with store.upload_slot(actor):
            await asyncio.Event().wait()
    assert await store.redis.zcard(f"tmp-uploads:{actor.user_id}") == 0
