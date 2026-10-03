"""真实隔离Redis；COS及repository为明确合成替身，不是云端验收。"""
import asyncio
import threading
from types import SimpleNamespace

import pytest

from test_temporary import temporary
from fileaction.documents.service import DocumentService
from fileaction.storage_adapters.cos import ObjectRef
from fileaction.storage_adapters.temporary import TemporaryError


@pytest.mark.asyncio
@pytest.mark.parametrize("uncertain", [False, True])
@pytest.mark.parametrize("deadline", [False, True])
async def test_cancelled_cos_thread_holds_slot_until_cleanup_or_journal(temporary, monkeypatch, uncertain, deadline):
    store, actor = temporary
    store.UPLOAD_LEASE_SECONDS = .12
    store.UPLOAD_RENEW_SECONDS = .02
    store.UPLOAD_TIMEOUT_SECONDS = .04 if deadline else 90
    entered, release = threading.Event(), threading.Event()
    journal = {"status": None}

    class SyntheticCos:
        def object_key(self, *args): return "synthetic-key"
        def put(self, *args):
            entered.set()
            release.wait(5)
            if uncertain:
                raise RuntimeError("synthetic lost response")
            return ObjectRef("synthetic-bucket", "synthetic-key", "exact-version", "hash", 4)
        def delete_version(self, actor, ref):
            assert ref.version_id == "exact-version"
            journal["deleted"] = True

    class SyntheticRepository:
        async def reserve_upload(self, *args): journal["status"] = "uploading"; return "journal"
        async def finish_upload(self, *args): pytest.fail("取消不得完成文档")
        async def mark_cleanup(self, actor, identifier, version):
            journal.update(status="pending", version=version)
            return True
        async def complete_cleanup(self, *args): journal["status"] = "complete"

    async def synthetic_parse(*args):
        return SimpleNamespace(name="synthetic.txt", hash="hash", warnings=[], segments=[])
    monkeypatch.setattr("fileaction.documents.service.parse_isolated", synthetic_parse)
    service = DocumentService(store, SyntheticRepository(), SyntheticCos())

    async def upload():
        async with store.upload_slot(actor):
            await service.upload(actor, "synthetic.txt", b"test", retention="retained", consent_to_store=True, storage_notice_version="1")

    task = asyncio.create_task(upload())
    try:
        assert await asyncio.to_thread(entered.wait, 3)
        lease_key = f"tmp-uploads:{actor.user_id}"
        lease_tokens = await store.redis.zrange(lease_key, 0, -1)
        seconds, microseconds = await store.redis.time()
        await store.redis.zadd(lease_key, {lease_tokens[0]: seconds + microseconds / 1000000 + .06})
        if not deadline:
            task.cancel()
        await asyncio.sleep(.2)
        assert not task.done(), "取消不能在同步线程结束前释放上传槽"
        async with store.upload_slot(actor):
            with pytest.raises(TemporaryError, match="UPLOAD_LIMIT_EXCEEDED"):
                async with store.upload_slot(actor):
                    pytest.fail("第三个上传进入")
        release.set()
        with pytest.raises(TemporaryError if deadline else asyncio.CancelledError, match="UPLOAD_TIMEOUT" if deadline else None):
            await task
        assert journal["status"] == ("pending" if uncertain else "complete")
        assert journal.get("version") == (None if uncertain else "exact-version")
    finally:
        release.set()
        await asyncio.gather(task, return_exceptions=True)
