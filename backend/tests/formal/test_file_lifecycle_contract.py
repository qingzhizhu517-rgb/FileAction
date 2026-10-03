import base64
from uuid import uuid4

import pytest
from pydantic import ValidationError

from fileaction.db.session import ActorContext
from fileaction.documents.dto import DocumentDeleteRequest, DocumentMetadataPatch
from fileaction.documents.service import DocumentService
from fileaction.storage_adapters.temporary import TemporaryStore
from test_temporary import temporary


def test_metadata_and_delete_dtos_reject_owner_or_unknown_fields():
    with pytest.raises(ValidationError):
        DocumentMetadataPatch(name="合成通知", expected_revision=1, owner_id="other")
    with pytest.raises(ValidationError):
        DocumentDeleteRequest(expected_revision=1, impact_hash="0" * 64, confirmed=True, cascade=True)


@pytest.mark.asyncio
async def test_temporary_delete_impact_lists_and_revokes_dependent_resources(temporary):
    fake_redis, _ = temporary
    actor = ActorContext(uuid4(), uuid4())
    temporary = TemporaryStore(fake_redis)
    documents = DocumentService(temporary, cursor_secret="synthetic-secret")
    document = await temporary.create(actor, "document", {
        "id": str(uuid4()), "name": "合成.txt", "revision": 1, "retention": "temporary",
        "category": "uncategorized", "parse_status": "ready", "index_status": "ready",
        "current_version_id": str(uuid4()), "size_bytes": 4, "sha256": "0" * 64,
        "source_base64": base64.b64encode(b"test").decode(), "segments": [],
    })
    await temporary.create(actor, "workspace", {"id": str(uuid4()), "documents": [{"id": document.id}], "revision": 1})
    await temporary.create(actor, "run", {"document_id": document.id})
    await temporary.create(actor, "index", {"document_id": document.id})
    impact = await documents.deletion_impact(actor, document.id)
    assert impact["workspaces"] and impact["runs"] and impact["indexes"]
    await documents.delete(actor, document.id, expected_revision=1, impact_hash=impact["impact_hash"], confirmed=True)
    assert await temporary.list(actor, "run") == []
    assert await temporary.list(actor, "index") == []
    assert await temporary.list(actor, "document") == []
    await temporary.end_session(actor)
    await fake_redis.delete(temporary.session_key(actor))
