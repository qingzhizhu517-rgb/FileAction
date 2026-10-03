import pytest
import pytest_asyncio
import json
import httpx
from dataclasses import replace
from sqlalchemy import text
from test_runs import setup
from fileaction.indexing.dto import IndexPreviewRequest
from fileaction.indexing.embedding import EmbeddingProfile, EmbeddingGateway
from fileaction.indexing.repository import IndexRepository
from fileaction.indexing.service import IndexingService
from fileaction.retrieval.provider import RetrievalProvider
from fileaction.workspaces.dto import PreviewRequest
from fileaction.workspaces.service import WorkspaceError
from fileaction.runs.errors import RunError
from fileaction.workers.indexing import IndexingWorker
from fileaction.workers.generation import GenerationWorker
from fileaction.agent.gateway import JsonGateway

from fileaction.agent.graph import BoundedAgent
from fileaction.runs.routes import RunRequest


def test_run_request_carries_independent_embedding_consent():
    request = RunRequest.model_validate(
            {
                "preview_id": "p",
                "manifest_hash": "0" * 64,
                "expected_revision": 1,
                "consent_to_send": True,
                "consent_to_embed_query": True,
            }
        )
    assert request.consent_to_embed_query is True


@pytest.mark.asyncio
async def test_bounded_agent_accepts_hybrid_manifest_after_server_retrieval():
    manifest = {
        "kind": "interpret",
        "retrieval_mode": "hybrid",
        "documents": [
            {
                "document_id": "d",
                "document_version_id": "v",
                "segments": [
                    {
                        "segment_id": "s",
                        "char_start": 0,
                        "char_end": 6,
                        "text": "合成材料",
                        "location": "第1段",
                    }
                ],
            }
        ],
        "facts": [],
        "goal": "",
        "message": "合成问题",
        "coverage": "selected_excerpts",
    }

    async def call(stage, policy, payload):
        if stage == "planning":
            return {
                "intent": "answer_question",
                "evidence_requests": [],
                "needs_user_input": False,
                "question": None,
            }
        return {
            "summary": "合成回答",
            "claims": [
                {
                    "id": "c",
                    "text": "合成材料",
                    "kind": "document_fact",
                    "evidence": [
                        {
                            "type": "document",
                            "document_id": "d",
                            "version": "v",
                            "segment_id": "s",
                            "quote": "合成材料",
                        }
                    ],
                }
            ],
            "questions": [],
            "memory_candidates": [],
            "action_candidates": [],
            "unknowns": [],
            "coverage": "selected_excerpts",
            "artifact": None,
        }

    phases = []
    async def phase(name):
        phases.append(name)
    result = await BoundedAgent().run("run", manifest, call, phase)
    assert result["summary"] == "合成回答"


@pytest_asyncio.fixture
async def hybrid(setup):
    """真实合成 PG/Redis；索引仅用明确 HTTP MockTransport。"""
    svc, actor, ws, _, admin = setup
    indexing = IndexingService(
        svc.workspaces.temporary, svc.workspaces.documents,
        IndexRepository(svc.repository.factory, svc.repository.dispatcher),
        EmbeddingProfile("https://synthetic.invalid/v1", "synthetic", "synthetic", 768, "1"),
    )
    doc = ws["documents"][0]
    p = await indexing.preview(actor, doc["id"], IndexPreviewRequest(expected_revision=1, document_version_id=doc["current_version_id"]))
    job = await indexing.create(actor, doc["id"], "synthetic-index", dict(
        preview_id=p["preview_id"], manifest_hash=p["manifest_hash"],
        expected_revision=1, consent_to_embed=True,
    ))
    async def embedding(request):
        data = json.loads(request.content)
        return httpx.Response(200, json={"data": [{"index": i, "embedding": [1.] + [0.] * 767} for i in range(len(data["input"]))]})
    async with admin.begin() as db:
        await db.execute(text("UPDATE index_jobs SET status='running',lease_owner='hybrid-fixture',lease_epoch=1,lease_until=now()+interval '30 seconds',started_at=now() WHERE id=:id"), {"id": job["id"]})
    await IndexingWorker(indexing, EmbeddingGateway(indexing.profile, transport=httpx.MockTransport(embedding)), worker_id="hybrid-fixture").execute(actor, job["id"], 1)
    assert (await indexing.get(actor, job["id"]))["status"] == "succeeded"
    svc.workspaces.retrieval = RetrievalProvider(indexing)
    yield svc, actor, ws, admin, indexing
    async with admin.begin() as db:
        for table in ("embedding_calls", "run_retrievals", "index_jobs"):
            await db.execute(text("DELETE FROM " + table + " WHERE owner_id=:owner"), {"owner": actor.user_id})


async def preview_hybrid(svc, actor, ws, **extra):
    return await svc.workspaces.preview(actor, ws["id"], PreviewRequest(
        expected_revision=1, retrieval_mode="hybrid", query="申请", **extra))


def run_body(p, **extra):
    return dict(preview_id=p["preview_id"], manifest_hash=p["manifest_hash"], expected_revision=1, consent_to_send=True, **extra)


@pytest.mark.asyncio
async def test_hybrid_preview_freezes_active_index_profile_query_and_zero_external_calls(hybrid):
    svc, actor, ws, admin, indexing = hybrid
    p = await preview_hybrid(svc, actor, ws)
    m = p["manifest"]
    assert m["index_versions"][0]["index_id"] == (await svc.workspaces.retrieval.active_indexes(actor, [ws["documents"][0]["id"]]))[0]["index_id"]
    assert m["embedding"]["domain"] == "synthetic.invalid"
    assert m["embedding"]["dimensions"] == 768
    assert m["query_embedding_authorization"]["query"] == "申请"
    assert m["query_embedding_authorization"]["max_requests"] == 1
    assert m["coverage"] == "selected_excerpts"
    async with admin.connect() as db:
        assert await db.scalar(text("SELECT count(*) FROM embedding_calls WHERE run_id IS NOT NULL AND owner_id=:owner"), {"owner": actor.user_id}) == 0
    assert await svc.workspaces.validate_preview(actor, ws["id"], p["preview_id"], p["manifest_hash"], 1) == m


@pytest.mark.asyncio
async def test_hybrid_dual_consent_and_config_change_are_enforced(hybrid):
    svc, actor, ws, admin, indexing = hybrid
    p = await preview_hybrid(svc, actor, ws)
    with pytest.raises(RunError, match="EMBEDDING_CONSENT_REQUIRED"):
        await svc.create(actor, ws["id"], "no-embedding", run_body(p))
    async with admin.connect() as db:
        assert await db.scalar(text("SELECT count(*) FROM runs WHERE owner_id=:owner"), {"owner": actor.user_id}) == 0
    run = await svc.create(actor, ws["id"], "both", run_body(p, consent_to_embed_query=True))
    async with admin.connect() as db:
        operations = (await db.execute(text("SELECT operation FROM consents WHERE manifest_hash=:hash"), {"hash": p["manifest_hash"]})).scalars().all()
    assert set(operations) == {"generate_answer", "embed_query"}
    indexing.profile = replace(indexing.profile, model="changed")
    with pytest.raises((RunError, WorkspaceError), match="EMBEDDING_PROFILE_MISMATCH"):
        await svc.validate_snapshot(actor, run["id"])


@pytest.mark.asyncio
async def test_hybrid_changed_index_and_uncovered_span_rejected(hybrid):
    svc, actor, ws, admin, indexing = hybrid
    p = await preview_hybrid(svc, actor, ws)
    await indexing.delete_indexes(actor, ws["documents"][0]["id"], 1, True)
    with pytest.raises(WorkspaceError, match="INDEX_NOT_READY"):
        await svc.workspaces.validate_preview(actor, ws["id"], p["preview_id"], p["manifest_hash"], 1)


@pytest.mark.asyncio
async def test_hybrid_worker_embeds_once_and_records_separate_query_ledger(hybrid):
    svc, actor, ws, admin, indexing = hybrid
    p = await preview_hybrid(svc, actor, ws)
    run = await svc.create(actor, ws["id"], "query-run", run_body(p, consent_to_embed_query=True))
    queries = []
    generated = []
    async def embedding(request):
        payload = json.loads(request.content)
        queries.append(payload["input"])
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.] + [0.] * 767}], "usage": {"total_tokens": 2}})
    async def model(request):
        generated.append(json.loads(request.content))
        answer = dict(summary="合成混合检索答案", claims=[], questions=[], memory_candidates=[], action_candidates=[], unknowns=[], coverage="full_selected_text", artifact=None)
        return httpx.Response(200, json={"choices": [{"finish_reason": "stop", "message": {"content": json.dumps(answer)}}]})
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='hybrid-test',lease_until=now()+interval '30 seconds' WHERE id=:id"), {"id": run["id"]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(model)) as client:
        worker = GenerationWorker(svc, JsonGateway("https://synthetic.invalid/v1", "synthetic", "synthetic", client=client), worker_id="hybrid-test", embedding_gateway=EmbeddingGateway(indexing.profile, transport=httpx.MockTransport(embedding)))
        await worker.execute(actor, run["id"])
    assert queries == [["申请"]]
    assert len(generated) == 1
    assert (await svc.result(actor, run["id"]))["envelope"]["coverage"] == "selected_excerpts"
    async with admin.connect() as db:
        calls = (await db.execute(text("SELECT state,usage_json FROM embedding_calls WHERE run_id=:id"), {"id": run["id"]})).mappings().all()
        assert len(calls) == 1 and calls[0]["state"] == "committed"
        assert calls[0]["usage_json"]["total_tokens"] == 2
        assert await db.scalar(text("SELECT count(*) FROM model_calls WHERE run_id=:id"), {"id": run["id"]}) == 1
        assert await db.scalar(text("SELECT count(*) FROM run_retrievals WHERE run_id=:id"), {"id": run["id"]}) == 1


@pytest.mark.asyncio
async def test_query_sent_crash_recovery_never_requeues_or_resends(hybrid):
    svc, actor, ws, admin, _ = hybrid
    p = await preview_hybrid(svc, actor, ws)
    run = await svc.create(actor, ws["id"], "query-crash", run_body(p, consent_to_embed_query=True))
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='crashed',lease_until=now()-interval '1 second' WHERE id=:id"), {"id": run["id"]})
        await db.execute(text("INSERT INTO embedding_calls(id,owner_id,run_id,batch_no,request_hash,content_ref,state) VALUES(gen_random_uuid(),:owner,:id,0,:hash,:ref,'sent')"), {"owner": actor.user_id, "id": run["id"], "hash": "0" * 64, "ref": run["id"]})
    await svc.recover()
    status = await svc.get(actor, run["id"])
    assert status["status"] == "interrupted"
    assert status["error_code"] == "EMBEDDING_OUTCOME_UNKNOWN"


@pytest.mark.asyncio
async def test_received_query_recovery_reuses_vectors_without_second_http(hybrid):
    svc, actor, ws, admin, indexing = hybrid
    p = await preview_hybrid(svc, actor, ws)
    run = await svc.create(actor, ws["id"], "received-crash", run_body(p, consent_to_embed_query=True))
    calls = []
    async def embedding(request):
        calls.append(request)
        return httpx.Response(200, json={"data": [{"index": 0, "embedding": [1.] + [0.] * 767}]})
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='recovery-test',lease_until=now()+interval '30 seconds' WHERE id=:id"), {"id": run["id"]})
    worker = GenerationWorker(svc, None, worker_id="recovery-test", embedding_gateway=EmbeddingGateway(indexing.profile, transport=httpx.MockTransport(embedding)))
    first = await worker._hybrid_context(actor, run["id"], p["manifest"])
    second = await worker._hybrid_context(actor, run["id"], p["manifest"])
    assert first == second
    assert len(calls) == 1
    async with admin.connect() as db:
        assert await db.scalar(text("SELECT count(*) FROM embedding_calls WHERE run_id=:id"), {"id": run["id"]}) == 1
        row = (await db.execute(text("SELECT row_to_json(run_retrievals) FROM run_retrievals WHERE run_id=:id"), {"id": run["id"]})).scalar_one()
        assert "申请" not in json.dumps(row, ensure_ascii=False)


@pytest.mark.asyncio
async def test_open_hybrid_plan_batches_all_queries_once(hybrid):
    svc, actor, ws, admin, indexing = hybrid
    p = await preview_hybrid(svc, actor, ws, kind="chat")
    run = await svc.create(actor, ws["id"], "multi-query", run_body(p, consent_to_embed_query=True))
    batches = []
    model_calls = []
    async def embedding(request):
        queries = json.loads(request.content)["input"]
        batches.append(queries)
        return httpx.Response(200,json={"data":[{"index":i,"embedding":[1.]+[0.]*767} for i in range(len(queries))]})
    async def model(request):
        model_calls.append(request)
        if len(model_calls)==1:
            raw=dict(intent="answer_question", evidence_requests=[
                dict(tool="search_evidence",arguments=dict(query=q, document_ids=[ws["documents"][0]["id"]], limit=3)) for q in ["申请资格","申请条件"]
            ],needs_user_input=False,question=None)
        else:
            raw=dict(summary="合成批量结果", claims=[], questions=[], memory_candidates=[], action_candidates=[], unknowns=[], coverage="selected_excerpts",artifact=None)
        return httpx.Response(200,json={"choices":[{"finish_reason":"stop","message":{"content":json.dumps(raw)}}]})
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='batch-test',lease_until=now()+interval '30 seconds' WHERE id=:id"), {"id":run["id"]})
    async with httpx.AsyncClient(transport=httpx.MockTransport(model)) as client:
        await GenerationWorker(svc,JsonGateway("https://synthetic.invalid/v1","synthetic","synthetic",client=client),worker_id="batch-test",embedding_gateway=EmbeddingGateway(indexing.profile,transport=httpx.MockTransport(embedding))).execute(actor,run["id"])
    assert batches == [["申请资格","申请条件"]]
    assert len(model_calls)==2
    assert (await svc.get(actor,run["id"]))["status"]=="succeeded"


@pytest.mark.asyncio
@pytest.mark.parametrize("outcome", ["failure", "cancel", "profile", "index"])
async def test_embedding_failure_or_changed_scope_never_calls_generation(hybrid, outcome):
    svc, actor, ws, admin, indexing = hybrid
    p = await preview_hybrid(svc, actor, ws)
    run = await svc.create(actor, ws["id"], "external-boundary", run_body(p,consent_to_embed_query=True))
    async def embedding(request):
        if outcome=="failure": return httpx.Response(503)
        if outcome=="cancel": await svc.cancel(actor,run["id"])
        if outcome=="profile": indexing.profile=replace(indexing.profile,model="changed")
        if outcome=="index": await indexing.delete_indexes(actor,ws["documents"][0]["id"],1,True)
        return httpx.Response(200,json={"data":[{"index":0,"embedding":[1.]+[0.]*767}]})
    class Forbidden:
        async def generate(self,*args): raise AssertionError("不得生成")
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='boundary-test',lease_until=now()+interval '30 seconds' WHERE id=:id"),{"id":run["id"]})
    await GenerationWorker(svc,Forbidden(),worker_id="boundary-test",embedding_gateway=EmbeddingGateway(indexing.profile,transport=httpx.MockTransport(embedding))).execute(actor,run["id"])
    status=await svc.get(actor,run["id"])
    assert status["status"]=="cancelled" if outcome=="cancel" else status["status"] in {"failed","stale","interrupted"}
    with pytest.raises(RunError,match="RESULT_NOT_AVAILABLE"): await svc.result(actor,run["id"])
    async with admin.connect() as db:
        ledger=(await db.execute(text("SELECT state,usage_json FROM embedding_calls WHERE run_id=:id"),{"id":run["id"]})).mappings().one()
        assert ledger["state"]=="interrupted"
        assert ledger["usage_json"]["cost_status"]=="unknown"


@pytest.mark.asyncio
async def test_batch_limit_and_foreign_tool_scope_reject_before_embedding(hybrid):
    from fileaction.agent.contracts import Plan, AgentError
    svc,actor,ws,admin,indexing=hybrid
    indexing.profile=replace(indexing.profile,max_batch_items=1)
    p=await preview_hybrid(svc,actor,ws,kind="chat")
    run=await svc.create(actor,ws["id"],"budget",run_body(p,consent_to_embed_query=True))
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='budget',lease_until=now()+interval '30 seconds' WHERE id=:id"),{"id":run["id"]})
    async def forbidden(request): raise AssertionError("不得外发")
    worker=GenerationWorker(svc,None,worker_id="budget",embedding_gateway=EmbeddingGateway(indexing.profile,transport=httpx.MockTransport(forbidden)))
    plan=Plan.model_validate(dict(intent="answer_question",evidence_requests=[dict(tool="search_evidence",arguments=dict(query=q,document_ids=[],limit=2)) for q in ["申请","条件"]],needs_user_input=False,question=None))
    with pytest.raises(AgentError,match="EMBEDDING_BUDGET_EXCEEDED"): await worker._hybrid_context(actor,run["id"],p["manifest"],plan)
    plan.evidence_requests[0].arguments.document_ids=["foreign-document"]
    with pytest.raises(AgentError,match="TOOL_SCOPE_INVALID"): await worker._hybrid_context(actor,run["id"],p["manifest"],plan)
    async with admin.connect() as db:
        assert await db.scalar(text("SELECT count(*) FROM embedding_calls WHERE run_id=:id"),{"id":run["id"]})==0


@pytest.mark.asyncio
async def test_hybrid_unconfigured_and_partial_chunk_never_falls_back(hybrid):
    svc,actor,ws,_,indexing=hybrid
    document=await svc.workspaces.documents._value(actor,ws["documents"][0]["id"])
    segment=document["segments"][0]
    with pytest.raises(WorkspaceError,match="INDEX_SCOPE_EMPTY"):
        await preview_hybrid(svc,actor,ws,selections=[dict(document_version_id=document["current_version_id"],segment_id=segment["id"],char_start=0,char_end=2)])
    indexing.profile=None
    with pytest.raises(WorkspaceError,match="EMBEDDING_NOT_CONFIGURED"):
        await preview_hybrid(svc,actor,ws)


@pytest.mark.asyncio
async def test_unmatched_original_text_is_not_restored_by_fact_tool(hybrid, monkeypatch):
    from fileaction.agent.contracts import Plan
    from fileaction.retrieval.core import RetrievalResult
    svc,actor,ws,admin,indexing=hybrid
    p=await preview_hybrid(svc,actor,ws,kind="chat")
    run=await svc.create(actor,ws["id"],"no-fallback",run_body(p,consent_to_embed_query=True))
    async def empty(*args,**kwargs): return RetrievalResult((),(),(),(),"hybrid",False)
    monkeypatch.setattr(svc.workspaces.retrieval,"search",empty)
    async def embedding(request):
        return httpx.Response(200,json={"data":[{"index":0,"embedding":[1.]+[0.]*767}]})
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='no-fallback',lease_until=now()+interval '30 seconds' WHERE id=:id"),{"id":run["id"]})
    plan=Plan.model_validate(dict(intent="answer_question",evidence_requests=[dict(tool="inspect_confirmed_facts",arguments=dict(fact_ids=[]))],needs_user_input=False,question=None))
    worker=GenerationWorker(svc,None,worker_id="no-fallback",embedding_gateway=EmbeddingGateway(indexing.profile,transport=httpx.MockTransport(embedding)))
    context=await worker._hybrid_context(actor,run["id"],p["manifest"],plan)
    assert context["documents"]==[]


@pytest.mark.asyncio
async def test_index_expiry_between_validation_and_commit_blocks_answer(hybrid,monkeypatch):
    from fileaction.storage_adapters.temporary import TemporaryError
    svc,actor,ws,admin,indexing=hybrid
    p=await preview_hybrid(svc,actor,ws)
    run=await svc.create(actor,ws["id"],"index-race",run_body(p,consent_to_embed_query=True))
    async with admin.begin() as db:
        await db.execute(text("UPDATE runs SET status='running',lease_owner='index-race',lease_until=now()+interval '30 seconds' WHERE id=:id"),{"id":run["id"]})
    original=svc.validate_snapshot
    async def validate_then_expire(*args,**kwargs):
        result=await original(*args,**kwargs)
        await svc.workspaces.temporary.delete(actor,"index",p["manifest"]["index_versions"][0]["index_id"])
        return result
    monkeypatch.setattr(svc,"validate_snapshot",validate_then_expire)
    answer=dict(summary="合成已失效",claims=[],questions=[],memory_candidates=[],action_candidates=[],unknowns=[],coverage="selected_excerpts",artifact=None)
    with pytest.raises((RunError,TemporaryError),match="SOURCE_CHANGED"):
        await svc.commit(actor,run["id"],"index-race",answer)
    assert not (await svc.content.get(actor,run["id"])).value.get("commit")
