"""查询 Embedding 合成传输边界；无真实模型调用。"""
import asyncio
import json
import time

import httpx
import pytest

from fileaction.indexing.embedding import CallBudget, EmbeddingConsent, EmbeddingError, EmbeddingGateway, EmbeddingProfile

PROFILE = EmbeddingProfile('https://synthetic.invalid/v1', 'synthetic-key', 'synthetic', 2, 'v1')


def consent(texts, purpose='query', profile=PROFILE):
    return EmbeddingConsent.for_texts(texts, purpose=purpose, profile=profile)


def answer(request):
    texts = json.loads(request.content)['input']
    return httpx.Response(200, json={'data': [{'index': i, 'embedding': [1, 0]} for i in range(len(texts))]})


@pytest.mark.asyncio
async def test_six_queries_1200_chinese_characters_use_one_batch_and_one_budget():
    calls = []
    async def handle(request):
        calls.append(request)
        return answer(request)
    texts = ['中' * 200 for _ in range(6)]
    budget = CallBudget(1)
    gateway = EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle))
    result = await gateway.embed(texts, consent=consent(texts), budget=budget)
    assert len(result.vectors) == 6
    assert json.loads(calls[0].content)['input'] == texts
    assert len(calls) == budget.requests == 1
    with pytest.raises(EmbeddingError, match='EMBEDDING_BUDGET_EXCEEDED'):
        await gateway.embed(texts, consent=consent(texts), budget=budget)
    assert len(calls) == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('texts,code', [(['中'] * 7, 'EMBEDDING_BATCH_TOO_LARGE'), (['中' * 1201], 'EMBEDDING_INPUT_TOO_LARGE')])
async def test_query_limits_reject_before_network(texts, code):
    calls = []
    async def handle(request):
        calls.append(request)
        return answer(request)
    with pytest.raises(EmbeddingError, match=code):
        await EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle)).embed(texts, consent=consent(texts), budget=CallBudget(1))
    assert calls == []


@pytest.mark.asyncio
async def test_query_http_timeout_uses_remaining_15_second_total_budget():
    timeouts = []
    async def handle(request):
        timeouts.append(request.extensions['timeout'])
        return answer(request)
    texts = ['合成查询']
    await EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle)).embed(texts, consent=consent(texts), budget=CallBudget(1, started_at=time.monotonic() - 10))
    assert all(0 < seconds <= 5 for seconds in timeouts[0].values())


@pytest.mark.asyncio
async def test_expired_query_budget_rejects_before_network():
    calls = []
    async def handle(request):
        calls.append(request)
        return answer(request)
    texts = ['合成查询']
    with pytest.raises(EmbeddingError, match='EMBEDDING_BUDGET_EXCEEDED'):
        await EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle)).embed(texts, consent=consent(texts), budget=CallBudget(1, started_at=time.monotonic() - 16))
    assert calls == []


class SlowBody(httpx.AsyncByteStream):
    async def __aiter__(self):
        yield b'{"data":'
        await asyncio.sleep(.1)
        yield b'[{"index":0,"embedding":[1,0]}]}'


@pytest.mark.asyncio
async def test_streaming_response_cannot_exceed_query_total_deadline_and_failure_consumes_budget():
    calls = []
    async def handle(request):
        calls.append(request)
        return httpx.Response(200, stream=SlowBody())
    texts = ['合成查询']
    budget = CallBudget(1, started_at=time.monotonic() - 14.95)
    gateway = EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle))
    with pytest.raises(EmbeddingError, match='EMBEDDING_TIMEOUT'):
        await gateway.embed(texts, consent=consent(texts), budget=budget)
    assert budget.requests == 1
    with pytest.raises(EmbeddingError, match='EMBEDDING_BUDGET_EXCEEDED'):
        await gateway.embed(texts, consent=consent(texts), budget=budget)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_query_requires_one_request_budget_even_when_inputs_valid():
    texts = ['合成查询']
    with pytest.raises(EmbeddingError, match='EMBEDDING_BUDGET_EXCEEDED'):
        await EmbeddingGateway(PROFILE).embed(texts, consent=consent(texts), budget=CallBudget(2))


@pytest.mark.asyncio
async def test_index_batches_keep_separate_longer_budget_and_larger_input():
    calls = []
    async def handle(request):
        calls.append(request)
        return answer(request)
    texts = ['中' * 200 for _ in range(10)]
    budget = CallBudget(2, started_at=time.monotonic() - 16)
    gateway = EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle))
    for _ in range(2):
        result = await gateway.embed(texts, consent=consent(texts, 'document_index'), budget=budget)
        assert len(result.vectors) == 10
    assert len(calls) == budget.requests == 2
    assert calls[0].extensions['timeout']['read'] == 30


@pytest.mark.asyncio
async def test_query_respects_smaller_provider_batch_limit_without_splitting():
    smaller = EmbeddingProfile('https://synthetic.invalid/v1', 'synthetic-key', 'synthetic', 2, 'v1', max_batch_items=2)
    texts = ['合成查询'] * 3
    with pytest.raises(EmbeddingError, match='EMBEDDING_BATCH_TOO_LARGE'):
        await EmbeddingGateway(smaller).embed(texts, consent=consent(texts, profile=smaller), budget=CallBudget(1))


@pytest.mark.asyncio
async def test_cancelled_query_propagates_cancellation_and_spends_attempt():
    entered = asyncio.Event()
    calls = []
    async def handle(request):
        calls.append(request)
        entered.set()
        await asyncio.Event().wait()
    texts = ['合成查询']
    budget = CallBudget(1)
    gateway = EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle))
    task = asyncio.create_task(gateway.embed(texts, consent=consent(texts), budget=budget))
    await asyncio.wait_for(entered.wait(), timeout=1)
    task.cancel()
    with pytest.raises(asyncio.CancelledError):
        await task
    assert budget.requests == 1
    with pytest.raises(EmbeddingError, match='EMBEDDING_BUDGET_EXCEEDED'):
        await gateway.embed(texts, consent=consent(texts), budget=budget)
    assert len(calls) == 1


@pytest.mark.asyncio
async def test_query_honors_shorter_caller_budget():
    timeouts = []
    async def handle(request):
        timeouts.append(request.extensions['timeout'])
        return answer(request)
    texts = ['合成查询']
    budget = CallBudget(1, max_seconds=2)
    await EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle)).embed(texts, consent=consent(texts), budget=budget)
    assert all(0 < seconds <= 2 for seconds in timeouts[0].values())


@pytest.mark.asyncio
async def test_late_response_without_suspension_is_not_published_after_deadline():
    async def handle(request):
        # Simulates bounded synchronous response decoding consuming the remainder.
        time.sleep(.08)
        return answer(request)
    texts = ['合成查询']
    with pytest.raises(EmbeddingError, match='EMBEDDING_TIMEOUT'):
        await EmbeddingGateway(PROFILE, transport=httpx.MockTransport(handle)).embed(texts, consent=consent(texts), budget=CallBudget(1, started_at=time.monotonic() - 14.95))
