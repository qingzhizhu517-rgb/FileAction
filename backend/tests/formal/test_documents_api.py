"""真实PG/Redis身份与临时上传API；合成输入，不调用模型或COS。"""
from uuid import uuid4
from test_auth_integration import client, csrf


def test_authenticated_upload_source_and_logout_lifecycle(client):
    assert client.get("/api/v1/documents").status_code == 401
    username = "d" + uuid4().hex[:20]
    client.created_usernames.append(username)
    payload = {"username": username, "password": "synthetic-password-doc", "display_name": "合成文件用户"}
    assert client.post("/api/v1/auth/register", headers=csrf(client), json=payload).status_code == 201
    assert client.post("/api/v1/auth/login", headers=csrf(client), json=payload | {"display_name": None}).status_code == 422
    assert client.post("/api/v1/auth/login", headers=csrf(client), json={"username": username, "password": payload["password"]}).status_code == 200
    result = client.post("/api/v1/documents", headers=csrf(client), data={"retention": "temporary", "consent_to_store": "false", "storage_notice_version": ""}, files={"file": ("synthetic.txt", "合成通知：请核对材料。".encode(), "text/plain")})
    assert result.status_code == 202, result.text
    data = result.json()["data"]
    assert data["parse_status"] == "ready"
    assert "source_base64" not in data
    document_id = data["id"]
    assert client.get("/api/v1/documents/" + document_id + "/source").content == "合成通知：请核对材料。".encode()
    segments = client.get("/api/v1/documents/" + document_id + "/segments").json()["data"]
    assert segments[0]["text"] == "合成通知：请核对材料。"
    assert client.post("/api/v1/auth/logout", headers=csrf(client)).status_code == 204
    assert client.get("/api/v1/documents/" + document_id).status_code == 401
