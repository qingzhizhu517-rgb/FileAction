"""真实隔离PG/Redis的背景验收；所有账号和正文均为明确合成数据。"""
import asyncio
import os
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone
from uuid import uuid4

import psycopg
import pytest

from fileaction.api.application import create_app
from fileaction.core.config import Settings
from fileaction.db.models import memories
from fileaction.retention.dto import MemoryPatchRequest, MemoryUseRequest
from test_auth_integration import client as auth_client, csrf


def test_formal_routes_include_memory_lifecycle():
    paths = set(create_app(Settings()).openapi()["paths"])
    assert "/api/v1/workspaces/{workspace_id}/facts/{fact_id}/retain" in paths
    assert "/api/v1/memories/{memory_id}/use" in paths
    assert "revision" in memories.c


def test_use_requires_the_memory_revision_and_dates_accept_iso_strings():
    with pytest.raises(ValueError):
        MemoryUseRequest(workspace_id="synthetic", expected_revision=1)
    patch = MemoryPatchRequest.model_validate(dict(expected_revision=1, valid_until="2036-01-01T00:00:00Z"))
    assert patch.valid_until.tzinfo is not None
    with pytest.raises(ValueError):
        MemoryPatchRequest.model_validate(dict(expected_revision=1, valid_until="2036-01-01T00:00:00"))


@pytest.fixture
def client(auth_client):
    yield auth_client
    if auth_client.get("/api/v1/auth/me").status_code == 200:
        assert auth_client.post("/api/v1/auth/logout", headers=csrf(auth_client)).status_code == 204
    # 仅清理本fixture注册的合成账号。auth_client负责最后删除账户和会话。
    admin = os.environ.get("FILEACTION_TEST_ADMIN_DATABASE_URL")
    if admin and auth_client.created_usernames:
        with psycopg.connect(admin.replace("postgresql+psycopg://", "postgresql://", 1)) as connection:
            for table in ("workspace_memories", "memory_versions", "memories", "fact_evidence",
                          "fact_versions", "context_facts", "workspaces", "consents"):
                connection.execute(f"DELETE FROM {table} WHERE owner_id IN "
                                   "(SELECT id FROM users WHERE username_normalized=ANY(%s))",
                                   (auth_client.created_usernames,))


def login(client):
    username = "memory_" + uuid4().hex[:18]
    client.created_usernames.append(username)
    payload = dict(username=username, password="synthetic-background-only", display_name="合成背景验收")
    assert client.post("/api/v1/auth/register", headers=csrf(client), json=payload).status_code == 201
    assert client.post("/api/v1/auth/login", headers=csrf(client),
                       json={k: payload[k] for k in ("username", "password")}).status_code == 200
    return payload


def workspace_fact(client):
    ws = client.post("/api/v1/workspaces", headers=csrf(client), json={"title": "合成临时工作区"}).json()["data"]
    response = client.post(f"/api/v1/workspaces/{ws['id']}/facts", headers=csrf(client),
                           json=dict(expected_revision=ws["revision"], text="已确认的合成背景", confirmed=True))
    assert response.status_code == 200, response.text
    return response.json()["data"]


def retain(client, workspace, fact=None, **overrides):
    fact = fact or workspace["facts"][0]
    return client.post(f"/api/v1/workspaces/{workspace['id']}/facts/{fact['id']}/retain",
                       headers={**csrf(client), "Idempotency-Key": f"retain:{workspace['id']}:{fact['id']}:{fact['version']}"},
                       json=dict(expected_revision=workspace["revision"], fact_version=fact["version"],
                                 consent_to_retain=True) | overrides)


def use(client, memory, workspace, **overrides):
    return client.post(f"/api/v1/memories/{memory['id']}/use", headers=csrf(client),
                       json=dict(workspace_id=workspace["id"], expected_revision=workspace["revision"],
                                 expected_memory_revision=memory["revision"]) | overrides)


def test_selected_background_survives_end_login_and_is_explicitly_reused(client):
    credentials = login(client)
    ws = workspace_fact(client)
    ws = client.post(f"/api/v1/workspaces/{ws['id']}/facts", headers=csrf(client),
                     json=dict(expected_revision=ws["revision"], text="不应被保留的合成背景", confirmed=True)).json()["data"]
    response = retain(client, ws)
    assert response.status_code == 201, response.text
    memory = response.json()["data"]
    assert memory["text"] == "已确认的合成背景"
    assert memory["retention"] == "retained" and memory["revision"] == 1
    assert memory["source_fact_version_id"] is None
    assert retain(client, ws).json()["data"]["id"] == memory["id"]
    # 工作区其他内容更新后，稳定键仍指向同一个独立背景。
    ws = client.patch(f"/api/v1/workspaces/{ws['id']}", headers=csrf(client),
                      json=dict(expected_revision=ws["revision"], goal="更新合成目标")).json()["data"]
    assert retain(client, ws).json()["data"]["id"] == memory["id"]
    assert len(client.get("/api/v1/memories").json()["data"]["items"]) == 1
    assert client.post(f"/api/v1/workspaces/{ws['id']}/end", headers=csrf(client),
                       json=dict(expected_revision=ws["revision"])).status_code == 200
    assert client.post("/api/v1/auth/logout", headers=csrf(client)).status_code == 204
    assert client.post("/api/v1/auth/login", headers=csrf(client),
                       json={k: credentials[k] for k in ("username", "password")}).status_code == 200
    assert client.get(f"/api/v1/memories/{memory['id']}").json()["data"]["text"] == memory["text"]
    second = client.post("/api/v1/workspaces", headers=csrf(client), json={}).json()["data"]
    assert second["facts"] == []
    applied = use(client, memory, second)
    assert applied.status_code == 200, applied.text
    second = applied.json()["data"]
    assert second["revision"] == 2 and second["facts"][0]["text"] == memory["text"]
    preview = client.post(f"/api/v1/workspaces/{second['id']}/context-preview", headers=csrf(client),
                          json=dict(expected_revision=2, fact_ids=[second["facts"][0]["id"]]))
    assert preview.status_code == 200, preview.text
    assert preview.json()["data"]["manifest"]["facts"][0]["text"] == memory["text"]


def test_memory_consent_revisions_availability_and_delete(client):
    login(client)
    ws = workspace_fact(client)
    assert retain(client, ws, consent_to_retain=False).status_code == 422
    assert retain(client, ws, fact_version=2).status_code == 409
    assert retain(client, ws, expected_revision=1).status_code == 409
    memory = retain(client, ws).json()["data"]
    path = f"/api/v1/memories/{memory['id']}"
    assert use(client, memory, ws, expected_memory_revision=99).status_code == 409
    changed = client.patch(path, headers=csrf(client), json=dict(expected_revision=1, text="用户编辑的合成背景", active=False))
    assert changed.status_code == 200, changed.text
    memory = changed.json()["data"]
    assert memory["revision"] == 2 and memory["version"] == 2
    assert use(client, memory, ws).status_code == 422
    future = (datetime.now(timezone.utc) + timedelta(days=3)).isoformat()
    memory = client.patch(path, headers=csrf(client), json=dict(expected_revision=2, active=True, valid_from=future)).json()["data"]
    assert use(client, memory, ws).status_code == 422
    past = (datetime.now(timezone.utc) - timedelta(days=3)).isoformat()
    memory = client.patch(path, headers=csrf(client), json=dict(expected_revision=3, valid_from=None, valid_until=past)).json()["data"]
    assert use(client, memory, ws).status_code == 422
    memory = client.patch(path, headers=csrf(client), json=dict(expected_revision=4, valid_until=None)).json()["data"]
    assert client.patch(path, headers=csrf(client), json=dict(expected_revision=1, text="过期编辑")).status_code == 409
    assert client.delete(path+f"?expected_revision={memory['revision']}", headers=csrf(client)).status_code == 422
    assert client.delete(path+f"?expected_revision={memory['revision']}&confirmed=true", headers=csrf(client)).status_code == 200
    assert client.get(path).status_code == 404
    assert retain(client, ws).status_code == 404  # 旧键不能重新创建已删除背景。


def test_memory_other_owner_and_temporary_session_are_isolated(client):
    login(client)
    ws = workspace_fact(client)
    memory = retain(client, ws).json()["data"]
    assert client.post("/api/v1/auth/logout", headers=csrf(client)).status_code == 204
    login(client)
    assert client.get(f"/api/v1/memories/{memory['id']}").status_code == 404
    assert client.get("/api/v1/memories").json()["data"]["items"] == []
    new_ws = workspace_fact(client)
    assert use(client, memory, new_ws).status_code == 404
    assert retain(client, ws).status_code == 404


def test_legacy_workspace_retention_does_not_claim_success(client):
    login(client)
    ws = workspace_fact(client)
    response = client.post(f"/api/v1/workspaces/{ws['id']}/retention-preview", headers=csrf(client),
                           json=dict(expected_revision=ws["revision"]))
    assert response.status_code in {404, 503}


def test_retain_concurrent_requests_and_transaction_failure_retry(client, monkeypatch):
    from fileaction.retention.repository import MemoryRepository
    login(client)
    ws = workspace_fact(client)
    original = MemoryRepository.get_memory
    failures = []

    async def fail_once(self, *args, **kwargs):
        if kwargs.get("db") is not None and not failures:
            failures.append(True)
            raise RuntimeError("synthetic transaction rollback")
        return await original(self, *args, **kwargs)

    monkeypatch.setattr(MemoryRepository, "get_memory", fail_once)
    # TestClient 默认重新抛出服务端错误；业务事务必须仍然回滚。
    with pytest.raises(RuntimeError, match="synthetic transaction rollback"):
        retain(client, ws)
    assert client.get("/api/v1/memories").json()["data"]["items"] == []
    monkeypatch.setattr(MemoryRepository, "get_memory", original)
    fact = ws["facts"][0]
    headers = {**csrf(client), "Idempotency-Key": f"retain:{ws['id']}:{fact['id']}:{fact['version']}"}
    def send():
        return client.post(f"/api/v1/workspaces/{ws['id']}/facts/{fact['id']}/retain", headers=headers,
                           json=dict(expected_revision=ws["revision"], fact_version=1, consent_to_retain=True))
    with ThreadPoolExecutor(max_workers=2) as pool:
        responses = list(pool.map(lambda _: send(), range(2)))
    assert [r.status_code for r in responses] == [201, 201], [r.text for r in responses]
    assert responses[0].json()["data"]["id"] == responses[1].json()["data"]["id"]
    assert len(client.get("/api/v1/memories").json()["data"]["items"]) == 1


def test_linked_source_redaction_prevents_reuse(client):
    login(client)
    ws = workspace_fact(client)
    memory = retain(client, ws).json()["data"]
    admin = os.environ["FILEACTION_TEST_ADMIN_DATABASE_URL"].replace("postgresql+psycopg://", "postgresql://", 1)
    with psycopg.connect(admin) as connection:
        owner = connection.execute("SELECT owner_id FROM memories WHERE id=%s", (memory["id"],)).fetchone()[0]
        fact, version = uuid4(), uuid4()
        connection.execute("INSERT INTO workspaces(id,owner_id,title) VALUES(%s,%s,'合成来源')", (ws["id"], owner))
        connection.execute("INSERT INTO context_facts(id,owner_id,workspace_id) VALUES(%s,%s,%s)", (fact, owner, ws["id"]))
        connection.execute("INSERT INTO fact_versions(id,owner_id,fact_id,version,text,origin_kind,confirmed_at,consent_to_retain,provenance_state) "
                           "VALUES(%s,%s,%s,1,'合成来源','user_confirmed',now(),true,'user_confirmed')", (version, owner, fact))
        connection.execute("UPDATE memory_versions SET source_fact_version_id=%s WHERE memory_id=%s", (version, memory["id"]))
        connection.execute("UPDATE fact_versions SET text=NULL,redacted_at=now(),provenance_state='source_deleted' WHERE id=%s", (version,))
    assert use(client, memory, ws).status_code == 422
