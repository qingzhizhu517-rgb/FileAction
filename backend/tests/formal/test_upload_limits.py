"""真实本机合成账号，模拟其另两个正在上传的租约。"""
import os
import time
from uuid import uuid4

from redis import Redis
from test_auth_integration import client, csrf


def test_upload_api_reserves_before_accepting_a_third_request(client):
    username = "quota" + uuid4().hex[:16]
    client.created_usernames.append(username)
    credentials = {"username": username, "password": "synthetic-password-quota"}
    created = client.post("/api/v1/auth/register", headers=csrf(client),
                          json=credentials | {"display_name": "合成配额账号"})
    assert created.status_code == 201
    assert client.post("/api/v1/auth/login", headers=csrf(client), json=credentials).status_code == 200
    owner = created.json()["data"]["id"]
    key = f"tmp-uploads:{owner}"
    redis = Redis.from_url(os.environ["FILEACTION_TEST_REDIS_URL"])
    try:
        redis.zadd(key, {"synthetic-upload-one": time.time() + 120, "synthetic-upload-two": time.time() + 120})
        redis.expire(key, 121)
        response = client.post("/api/v1/documents", headers=csrf(client),
                              data={"retention": "temporary"},
                              files={"file": ("synthetic.txt", b"synthetic only", "text/plain")})
        assert response.status_code == 429, response.text
        assert response.json()["error"]["code"] == "UPLOAD_LIMIT_EXCEEDED"
    finally:
        redis.delete(key)
        redis.close()
