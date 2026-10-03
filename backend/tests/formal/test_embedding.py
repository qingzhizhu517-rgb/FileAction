"""使用HTTP MockTransport验证外发合同，非真实Embedding验收。"""
import json

import httpx
import pytest

from fileaction.indexing.embedding import EmbeddingGateway, EmbeddingProfile, EmbeddingConsent, CallBudget, EmbeddingError


def profile():
    return EmbeddingProfile("https://synthetic.invalid/v1", "synthetic-key", "synthetic-model", 2, "synthetic-profile", max_batch_items=10)


@pytest.mark.asyncio
async def test_explicit_scope_consent_required_before_any_network_call():
    calls = []
    async def handle(request):
        calls.append(request)
        return httpx.Response(200, json={"data": []})
    gateway = EmbeddingGateway(profile(), transport=httpx.MockTransport(handle))
    with pytest.raises(EmbeddingError, match="CONSENT_REQUIRED"):
        await gateway.embed(["合成资料"], consent=None, budget=CallBudget(1))
    consent = EmbeddingConsent.for_texts(["另一个范围"], purpose="document_index", profile=profile())
    with pytest.raises(EmbeddingError, match="EMBEDDING_SCOPE_CHANGED"):
        await gateway.embed(["合成资料"], consent=consent, budget=CallBudget(1))
    assert calls == []


@pytest.mark.asyncio
async def test_response_indices_are_verified_and_restored_to_input_order():
    async def handle(request):
        body = json.loads(request.content)
        assert body["input"] == ["合成甲", "合成乙"]
        assert body["dimensions"] == 2
        return httpx.Response(200, json={"data": [{"index": 1, "embedding": [0, 1]}, {"index": 0, "embedding": [1, 0]}], "usage": {"total_tokens": 8}})
    texts = ["合成甲", "合成乙"]
    result = await EmbeddingGateway(profile(), transport=httpx.MockTransport(handle)).embed(texts, consent=EmbeddingConsent.for_texts(texts, purpose="document_index", profile=profile()), budget=CallBudget(1))
    assert result.vectors == ((1.0, 0.0), (0.0, 1.0))
    assert result.usage_tokens == 8


@pytest.mark.asyncio
@pytest.mark.parametrize("data", [[{"index": 0, "embedding": [1]}], [{"index": 0, "embedding": [0, 0]}], [{"index": 2, "embedding": [1, 0]}], [{"index": True, "embedding": [1, 0]}], [{"index": 0, "embedding": [True, 0]}]])
async def test_invalid_vectors_or_indices_are_rejected(data):
    async def handle(request): return httpx.Response(200, json={"data": data})
    texts = ["合成甲"]
    with pytest.raises(EmbeddingError, match="EMBEDDING_OUTPUT_INVALID"):
        await EmbeddingGateway(profile(), transport=httpx.MockTransport(handle)).embed(texts, consent=EmbeddingConsent.for_texts(texts, purpose="query", profile=profile()), budget=CallBudget(1))


@pytest.mark.asyncio
async def test_failures_consume_budget_without_automatic_retries_or_secret_leak():
    calls = []
    async def handle(request):
        calls.append(request)
        return httpx.Response(500, text="synthetic secret upstream trace")
    texts = ["合成甲"]
    gateway = EmbeddingGateway(profile(), transport=httpx.MockTransport(handle))
    budget = CallBudget(1)
    consent = EmbeddingConsent.for_texts(texts, purpose="query", profile=profile())
    with pytest.raises(EmbeddingError, match="EMBEDDING_UNAVAILABLE") as first:
        await gateway.embed(texts, consent=consent, budget=budget)
    assert "secret" not in str(first.value)
    with pytest.raises(EmbeddingError, match="EMBEDDING_BUDGET_EXCEEDED"):
        await gateway.embed(texts, consent=consent, budget=budget)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_provider_batch_limit_rejected_before_request():
    texts = ["合成" + str(i) for i in range(11)]
    with pytest.raises(EmbeddingError, match="EMBEDDING_BATCH_TOO_LARGE"):
        await EmbeddingGateway(profile()).embed(texts, consent=EmbeddingConsent.for_texts(texts, purpose="document_index", profile=profile()), budget=CallBudget(1))
