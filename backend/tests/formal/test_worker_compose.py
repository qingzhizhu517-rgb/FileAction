"""Compose configuration contracts; all values come from synthetic examples."""

import json
import os
from pathlib import Path
import subprocess
from urllib.parse import urlsplit


def test_worker_gets_restricted_dispatcher_dsn_without_exposing_it_to_api():
    root = Path(__file__).resolve().parents[3]
    # Do not allow developer credentials or the real .env to enter this check.
    environment = {
        key: value
        for key, value in os.environ.items()
        if not key.startswith("FILEACTION_") and not key.startswith("COMPOSE_")
    }
    result = subprocess.run(
        [
            "docker", "compose", "--env-file", ".env.example", "--profile",
            "worker", "config", "--format", "json",
        ],
        cwd=root,
        env=environment,
        check=True,
        capture_output=True,
        text=True,
        encoding="utf-8",
        timeout=30,
    )
    services = json.loads(result.stdout)["services"]
    worker_environment = services["worker"]["environment"]
    assert "FILEACTION_DISPATCHER_DATABASE_URL" in worker_environment
    dispatcher = urlsplit(worker_environment["FILEACTION_DISPATCHER_DATABASE_URL"])
    assert dispatcher.username == "fileaction_dispatch_login"
    assert dispatcher.password == "replace-dispatcher-password"
    assert "FILEACTION_DISPATCHER_DATABASE_URL" not in services["api"]["environment"]
