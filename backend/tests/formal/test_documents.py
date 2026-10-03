"""合成文本与真实隔离Redis；不调用云服务。"""
import os
from uuid import uuid4
import pytest
import pytest_asyncio
from redis.asyncio import Redis
from fileaction.db.session import ActorContext
from fileaction.storage_adapters.temporary import TemporaryStore
from fileaction.documents.service import DocumentService, DocumentError


@pytest_asyncio.fixture
async def service():
    url = os.getenv("FILEACTION_TEST_REDIS_URL")
    if not url:
        pytest.skip("需要显式隔离 FILEACTION_TEST_REDIS_URL")
    client = Redis.from_url(url, decode_responses=True)
    actor = ActorContext(uuid4(), uuid4())
    temporary = TemporaryStore(client)
    yield DocumentService(temporary), actor
    await temporary.end_session(actor)
    await client.delete(temporary.session_key(actor))
    await client.aclose()


@pytest.mark.asyncio
async def test_temporary_upload_parses_in_subprocess_and_remains_private(service):
    documents, actor = service
    result = await documents.upload(actor, "合成.txt", "合成通知：可以只理解，不继续。".encode(), retention="temporary", consent_to_store=False, storage_notice_version="")
    assert result["parse_status"] == "ready"
    assert result["index_status"] == "not_requested"
    assert result["retention"] == "temporary"
    assert (await documents.segments(actor, result["id"]))[0]["text"] == "合成通知：可以只理解，不继续。"
    assert await documents.source(actor, result["id"]) == "合成通知：可以只理解，不继续。".encode()
    with pytest.raises(DocumentError, match="RESOURCE_NOT_FOUND"):
        await documents.get(ActorContext(actor.user_id, uuid4()), result["id"])
    with pytest.raises(DocumentError, match="DEPENDENCY_UNAVAILABLE"):
        await documents.list_retained(actor)


@pytest.mark.asyncio
async def test_retained_upload_requires_current_cloud_consent_before_any_store(service):
    documents, actor = service
    with pytest.raises(DocumentError, match="CONSENT_REQUIRED"):
        await documents.upload(actor, "合成.txt", b"synthetic", retention="retained", consent_to_store=False, storage_notice_version="1")
    with pytest.raises(DocumentError, match="COS_NOT_CONFIGURED"):
        await documents.upload(actor, "合成.txt", b"synthetic", retention="retained", consent_to_store=True, storage_notice_version="1")


@pytest.mark.asyncio
async def test_parser_failure_creates_no_usable_document(service):
    documents, actor = service
    with pytest.raises(DocumentError, match="DOCUMENT_PARSE_FAILED"):
        await documents.upload(actor, "合成.exe", b"synthetic", retention="temporary", consent_to_store=False, storage_notice_version="")
    assert await documents.temporary.list(actor, "document") == []
