"""合成授权与超时边界，无真实外发。"""
import httpx
import pytest
from fileaction.indexing.embedding import EmbeddingGateway, EmbeddingProfile, EmbeddingConsent, CallBudget, EmbeddingError


@pytest.mark.asyncio
async def test_changed_embedding_profile_invalidates_confirmed_scope():
    original = EmbeddingProfile("https://synthetic.invalid/v1", "synthetic", "model-a", 2, "v1")
    changed = EmbeddingProfile("https://synthetic.invalid/v1", "synthetic", "model-b", 2, "v1")
    consent = EmbeddingConsent.for_texts(["合成"], purpose="query", profile=original)
    calls = []
    async def handler(request):
        calls.append(request)
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1, 0]}]})
    with pytest.raises(EmbeddingError, match="EMBEDDING_SCOPE_CHANGED"):
        await EmbeddingGateway(changed, transport=httpx.MockTransport(handler)).embed(["合成"], consent=consent, budget=CallBudget(1))
    assert calls == []
