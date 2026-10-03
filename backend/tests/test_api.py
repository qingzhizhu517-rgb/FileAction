import io
import json
import asyncio

import httpx
import pytest
from fastapi.testclient import TestClient

from fileaction.app import app
from fileaction.model import ModelConfig, OpenAICompatibleModel
from fileaction.storage import MemoryStore


@pytest.fixture()
def client(monkeypatch, tmp_path):
    monkeypatch.setenv("FILEACTION_DATA_DIR", str(tmp_path))
    monkeypatch.delenv("FILEACTION_MODEL_BASE_URL", raising=False)
    monkeypatch.delenv("FILEACTION_MODEL_API_KEY", raising=False)
    monkeypatch.delenv("FILEACTION_MODEL_NAME", raising=False)
    monkeypatch.chdir(tmp_path)
    with TestClient(app, base_url="http://127.0.0.1:8000") as test_client:
        app.state.memories = MemoryStore(tmp_path / "test.db")
        yield test_client


def create_session(client):
    response = client.post("/api/session", headers={"host": "127.0.0.1"})
    assert response.status_code == 200
    return response.json(), {"X-Session-ID": response.json()["id"]}


def test_session_upload_fact_and_memory_consent_boundary(client):
    session, headers = create_session(client)
    uploaded = client.post("/api/document?filename=通知.txt", headers=headers, content="通知\n截止".encode())
    assert uploaded.status_code == 200
    assert uploaded.json()["document"]["segments"][1]["locator"] == "第2行"
    fact = client.post("/api/facts", headers=headers, json={"text": "关注教育实习"})
    assert fact.status_code == 200
    assert client.get("/api/memories", headers=headers).json() == {"items": []}
    assert fact.json()["facts"][0]["version"] == 1


def test_interpret_requires_consent_and_unconfigured_model_is_explicit(client):
    _, headers = create_session(client)
    client.post("/api/document?filename=a.txt", headers=headers, content=b"hello")
    response = client.post("/api/interpret", headers=headers, json={"revision": 1, "consent": False})
    assert response.status_code == 400
    response = client.post("/api/interpret", headers=headers, json={"revision": 1, "consent": True})
    assert response.status_code == 503
    assert "模型" in response.json()["detail"]
    assert "hello" not in response.text


def test_host_and_origin_are_rejected(client):
    assert client.post("/api/session", headers={"host": "evil.example"}).status_code == 400
    assert client.post("/api/session", headers={"origin": "https://evil.example", "host": "127.0.0.1"}).status_code == 403


def test_revision_change_invalidates_export_and_reset_clears_data(client):
    _, headers = create_session(client)
    client.post("/api/document?filename=a.txt", headers=headers, content=b"hello")
    fact = client.post("/api/facts", headers=headers, json={"text": "背景"}).json()
    stale = client.post("/api/export", headers=headers, json={"revision": 1})
    assert stale.status_code in (400, 409)
    reset = client.post("/api/reset", headers=headers)
    assert reset.status_code == 200
    assert reset.json()["document"] is None
    assert reset.json()["facts"] == []


def test_cancel_marks_busy_request_invalid(client):
    _, headers = create_session(client)
    cancelled = client.post("/api/cancel", headers=headers)
    assert cancelled.status_code == 200
    assert cancelled.json()["busy"] is False


def install_test_model(handler):
    """仅测试用 HTTP 替身，不代表真实模型验收。"""
    app.state.model = OpenAICompatibleModel(
        ModelConfig("https://synthetic.test/v1", "test-only-key", "synthetic-test"),
        transport=httpx.MockTransport(handler),
    )


def valid_model_reply(request, *, bad_quote=False):
    payload = json.loads(request.content)
    user = json.loads(next(message["content"] for message in payload["messages"] if message["role"] == "user"))
    segment = user["segments"][0]
    citation = {"segment_id": segment["id"], "quote": "伪造文本" if bad_quote else segment["text"]}
    if user["goal"]:
        content = {"text": "合成模型草稿", "citations": [citation], "fact_ids": []}
    else:
        content = {"items": [{"title": "合成标题", "meaning": "合成含义", "kind": "fact", "citations": [citation], "fact_ids": []}], "questions": [], "unknowns": ["待确认日期"], "candidates": []}
    return httpx.Response(200, json={"choices": [{"message": {"content": json.dumps(content, ensure_ascii=False)}}]})


def test_full_read_edit_export_and_invalidated_artifact(client):
    install_test_model(valid_model_reply)
    _, headers = create_session(client)
    uploaded = client.post("/api/document?filename=合成.txt", headers=headers, content="合成通知".encode()).json()
    reading = client.post("/api/interpret", headers=headers, json={"revision": uploaded["revision"], "consent": True})
    assert reading.status_code == 200
    result = reading.json()
    assert result["reading"]["items"][0]["citations"][0]["quote"] == "合成通知"
    artifact = client.post("/api/artifact", headers=headers, json={"revision": result["revision"], "consent": True, "goal": "准备清单"})
    assert artifact.status_code == 200
    draft = artifact.json()
    client.patch("/api/artifact", headers=headers, json={"revision": draft["revision"], "text": "用户实际编辑正文"})
    exported = client.post("/api/export", headers=headers, json={"revision": draft["revision"]})
    assert exported.status_code == 200
    assert "用户实际编辑正文" in exported.text
    assert "合成通知" in exported.text
    assert "待确认日期" in exported.text
    assert "attachment" in exported.headers["content-disposition"]
    assert "合成.txt" in exported.text
    assert draft["document"]["hash"] in exported.text
    assert "版本" in exported.text and "生成时间" in exported.text
    changed = client.post("/api/facts", headers=headers, json={"text": "更正背景"}).json()
    assert changed["reading"] is None and changed["artifact"] is None
    assert client.post("/api/export", headers=headers, json={"revision": changed["revision"]}).status_code == 409


def test_fabricated_citation_is_not_displayed(client):
    install_test_model(lambda request: valid_model_reply(request, bad_quote=True))
    _, headers = create_session(client)
    uploaded = client.post("/api/document?filename=a.txt", headers=headers, content="合成通知".encode()).json()
    response = client.post("/api/interpret", headers=headers, json={"revision": uploaded["revision"], "consent": True})
    assert response.status_code == 502
    assert client.get("/api/session", headers=headers).json()["reading"] is None


def test_memory_edits_disable_and_delete_invalidate_other_session(client):
    _, h1 = create_session(client)
    _, h2 = create_session(client)
    fact = client.post("/api/facts", headers=h1, json={"text": "合成背景"}).json()["facts"][0]
    assert client.post("/api/memories", headers=h1, json={"fact_id": fact["id"], "consent": False}).status_code == 400
    memory = client.post("/api/memories", headers=h1, json={"fact_id": fact["id"], "consent": True}).json()
    used = client.post(f"/api/memories/{memory['id']}/use", headers=h2).json()
    client.patch(f"/api/memories/{memory['id']}", headers=h1, json={"text": "更正后的背景"})
    refreshed = client.get("/api/session", headers=h2).json()
    assert refreshed["revision"] > used["revision"]
    assert refreshed["facts"] == []
    client.patch(f"/api/memories/{memory['id']}", headers=h1, json={"active": False})
    assert client.post(f"/api/memories/{memory['id']}/use", headers=h2).status_code == 400
    assert client.delete(f"/api/memories/{memory['id']}", headers=h1).status_code == 400
    assert client.delete(f"/api/memories/{memory['id']}?confirmed=true", headers=h1).json() == {"deleted": True}


def test_local_wrong_origin_port_rejected_and_validation_does_not_echo_input(client):
    response = client.post("/api/session", headers={"origin": "http://localhost:9999"})
    assert response.status_code == 403
    _, headers = create_session(client)
    response = client.post("/api/facts", headers=headers, json={"text": "sensitive" * 10001})
    assert response.status_code == 422
    assert "sensitive" not in response.text


def test_foreign_session_cannot_mutate_fact_and_reserved_host_rejected(client):
    _, h1 = create_session(client)
    _, h2 = create_session(client)
    fact = client.post("/api/facts", headers=h1, json={"text": "合成背景"}).json()["facts"][0]
    assert client.patch(f"/api/facts/{fact['id']}", headers=h2, json={"text": "其他会话"}).status_code == 404
    assert client.post("/api/session", headers={"host": "testserver"}).status_code == 400


def test_local_origin_requires_known_port_and_host_is_exact(client):
    assert client.post("/api/session", headers={"origin": "http://127.0.0.1:5173"}).status_code == 200
    assert client.post("/api/session", headers={"origin": "http://localhost"}).status_code == 403
    assert client.post("/api/session", headers={"host": "127.0.0.1/path"}).status_code == 400


@pytest.mark.asyncio
async def test_inflight_cancel_discards_late_http_result(monkeypatch, tmp_path):
    """合成 HTTP 替身故意吞取消，验证 revision 可阻止迟到结果。"""
    entered = asyncio.Event()
    release = asyncio.Event()
    async def handler(request):
        entered.set()
        try:
            await release.wait()
        except asyncio.CancelledError:
            await release.wait()
        return valid_model_reply(request)
    monkeypatch.chdir(tmp_path)
    async with app.router.lifespan_context(app):
        app.state.memories = MemoryStore(tmp_path / "late.db")
        install_test_model(handler)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://127.0.0.1:8766") as client:
            session = (await client.post("/api/session")).json()
            headers = {"X-Session-ID": session["id"]}
            uploaded = (await client.post("/api/document?filename=a.txt", headers=headers, content=b"synthetic")).json()
            pending = asyncio.create_task(client.post("/api/interpret", headers=headers, json={"revision": uploaded["revision"], "consent": True}))
            await entered.wait()
            cancelled = await client.post("/api/cancel", headers=headers)
            release.set()
            response = await pending
            assert response.status_code == 409
            current = (await client.get("/api/session", headers=headers)).json()
            assert current["reading"] is None and current["busy"] is False
            assert current["revision"] == cancelled.json()["revision"]


