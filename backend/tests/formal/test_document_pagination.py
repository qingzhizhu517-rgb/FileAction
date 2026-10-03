"""真实PostgreSQL合成资料，验证游标隔离与完整遍历。"""
from uuid import uuid4

import pytest
from sqlalchemy import insert

from test_document_repository import repository
from fileaction.db.models import documents, document_versions
from fileaction.db.session import ActorContext, tenant_transaction
from fileaction.documents.service import DocumentError


@pytest.mark.asyncio
async def test_signed_document_cursor_reads_all_pages_and_rejects_other_scope(repository):
    repo, actor = repository
    repo.cursor_secret = "synthetic-pagination-secret"
    async with tenant_transaction(repo.factory, actor) as db:
        for number in range(23):
            doc, version = uuid4(), uuid4()
            await db.execute(insert(documents).values(id=doc, owner_id=actor.user_id,
                name=f"合成通知-{number}.txt", category="notice", parse_status="ready"))
            await db.execute(insert(document_versions).values(id=version, owner_id=actor.user_id,
                document_id=doc, version=1, sha256="a"*64, size_bytes=3, blob_key="synthetic/" + str(doc)))
    first = await repo.list_page(actor, query="合成", category="notice")
    assert len(first["items"]) == 20 and first["has_more"]
    second = await repo.list_page(actor, cursor=first["next_cursor"], query="合成", category="notice")
    assert len(second["items"]) == 3 and not second["has_more"]
    assert second["next_cursor"] is None
    assert len({row["id"] for row in first["items"] + second["items"]}) == 23
    assert first["total"] == 23
    for kwargs in (
        {"cursor": first["next_cursor"] + "x", "query": "合成", "category": "notice"},
        {"cursor": first["next_cursor"], "query": "另一个筛选", "category": "notice"},
    ):
        with pytest.raises(DocumentError, match="CURSOR_INVALID"):
            await repo.list_page(actor, **kwargs)
    with pytest.raises(DocumentError, match="CURSOR_INVALID"):
        await repo.list_page(ActorContext(uuid4(), uuid4()), cursor=first["next_cursor"],
                             query="合成", category="notice")
    with pytest.raises(DocumentError, match="INVALID_REQUEST"):
        await repo.list_page(actor, limit=101)
