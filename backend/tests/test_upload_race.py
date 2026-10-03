import asyncio

import httpx
import pytest

from fileaction.app import app


@pytest.mark.asyncio
async def test_upload_started_before_reset_cannot_restore_old_document(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    async with app.router.lifespan_context(app):
        first = app.state.sessions.create()
        session_id = first.value.id
        started = asyncio.Event()
        release = asyncio.Event()

        async def body_stream():
            started.set()
            await release.wait()
            yield b"old content"

        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://127.0.0.1:8766") as client:
            upload_task = asyncio.create_task(client.post("/api/document?filename=old.txt", headers={"X-Session-ID": session_id}, content=body_stream()))
            await started.wait()
            await client.post("/api/reset", headers={"X-Session-ID": session_id})
            release.set()
            response = await upload_task
            assert response.status_code == 409
            current = (await client.get("/api/session", headers={"X-Session-ID": session_id})).json()
            assert current["document"] is None


@pytest.mark.asyncio
async def test_newer_upload_wins_even_when_older_upload_finishes_first(tmp_path, monkeypatch):
    monkeypatch.chdir(tmp_path)
    async with app.router.lifespan_context(app):
        state = app.state.sessions.create()
        headers = {"X-Session-ID": state.value.id}
        started = [asyncio.Event(), asyncio.Event()]
        release = [asyncio.Event(), asyncio.Event()]
        async def body(index):
            started[index].set()
            await release[index].wait()
            yield b"synthetic text"
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app), base_url="http://127.0.0.1:8766") as client:
            old = asyncio.create_task(client.post("/api/document?filename=old.txt", headers=headers, content=body(0)))
            await started[0].wait()
            new = asyncio.create_task(client.post("/api/document?filename=new.txt", headers=headers, content=body(1)))
            await started[1].wait()
            release[0].set()
            assert (await old).status_code == 409
            release[1].set()
            assert (await new).status_code == 200
            current = (await client.get("/api/session", headers=headers)).json()
            assert current["document"]["name"] == "new.txt"

