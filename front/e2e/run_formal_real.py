"""本机真实PG/Redis合成浏览器验收；不会读取用户.env或调用外部模型。"""
import json
import os
from pathlib import Path
import socket
import subprocess
import sys
import time
import urllib.request
from uuid import uuid4

ROOT = Path(__file__).resolve().parents[2]
CONFIG = ROOT / ".superpowers/sdd/可行动事务Agent-正式个人版实施计划/synthetic-services.json"


def main():
    # Test DB details are explicitly synthetic, created by this development task.
    config = json.loads(CONFIG.read_text(encoding="utf-8-sig"))["postgres"]
    if not config.get("synthetic_only") or config["database"] != "fileaction_test":
        raise RuntimeError("只允许运行在明确标记的隔离合成数据库")
    for port in (8786, 8787):
        with socket.socket() as probe:
            probe.bind(("127.0.0.1", port))
    environment = {k: v for k, v in os.environ.items() if not k.startswith("FILEACTION_")}
    username = "e2e" + uuid4().hex[:20]
    environment.update({
        "PYTHONPATH": str(ROOT / "backend"),
        "FILEACTION_ENV": "test", "FILEACTION_DATABASE_URL": config["runtime_url"],
        "FILEACTION_AUTH_DATABASE_URL": config["auth_url"],
        # Dedicated logical database separates browser rate limits from API tests.
        "FILEACTION_REDIS_URL": "redis://:synthetic-redis-test-only@127.0.0.1:16379/1",
        "FILEACTION_APP_SECRET": "synthetic-browser-application-secret-only",
        "FILEACTION_REGISTRATION_ENABLED": "true",
        "FILEACTION_ALLOWED_ORIGINS": "http://127.0.0.1:8787",
        "FILEACTION_DEV_API_TARGET": "http://127.0.0.1:8786",
        "FILEACTION_E2E_USERNAME": username,
    })
    flags = subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
    processes = []
    try:
        processes.append(subprocess.Popen([sys.executable, "-m", "fileaction", "--no-env-file", "--port", "8786"], cwd=ROOT / "backend", env=environment, creationflags=flags))
        processes.append(subprocess.Popen(["node", "node_modules/vite/bin/vite.js", "--host", "127.0.0.1", "--port", "8787", "--strictPort"], cwd=ROOT / "front", env=environment, creationflags=flags, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL))
        for url in ("http://127.0.0.1:8786/api/v1/health/live", "http://127.0.0.1:8787/"):
            deadline = time.monotonic() + 20
            while time.monotonic() < deadline:
                if any(p.poll() is not None for p in processes): raise RuntimeError("验收服务启动失败")
                try:
                    with urllib.request.urlopen(url, timeout=1) as response:
                        if response.status == 200: break
                except Exception: time.sleep(.2)
            else: raise RuntimeError("验收服务未就绪")
        result = subprocess.run(["node", "node_modules/@playwright/test/cli.js", "test", "--config", "playwright.real.config.ts"], cwd=ROOT / "front", env=environment)
        return result.returncode
    finally:
        for process in processes:
            if process.poll() is None:
                process.terminate()
                try: process.wait(timeout=5)
                except subprocess.TimeoutExpired: process.kill(); process.wait(timeout=5)
        # Only this exact synthetic account is removed; never clear the database.
        import psycopg
        with psycopg.connect(config["test_admin_url"]) as connection:
            connection.execute("DELETE FROM document_versions WHERE owner_id IN (SELECT id FROM users WHERE username_normalized=%s)", (username,))
            connection.execute("DELETE FROM documents WHERE owner_id IN (SELECT id FROM users WHERE username_normalized=%s)", (username,))
            connection.execute("DELETE FROM auth_sessions WHERE user_id IN (SELECT id FROM users WHERE username_normalized=%s)", (username,))
            connection.execute("DELETE FROM users WHERE username_normalized=%s", (username,))


if __name__ == "__main__":
    raise SystemExit(main())
