from __future__ import annotations

import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import urlsplit
from uuid import uuid4

from fastapi import Depends, FastAPI, Header, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import FileResponse, JSONResponse, Response

from .model import ModelConfig, ModelError, OpenAICompatibleModel
from .parsers import MAX_BYTES, MAX_PDF_PAGES, MAX_TEXT, ParseError, parse_document
from .schemas import (ArtifactInput, ArtifactPatch, ExportInput, Fact, FactInput, FactPatch, InterpretInput, MemoryCreate, MemoryPatch, Reading, Session)
from .sessions import SessionState, SessionStore
from .storage import MemoryStore


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.sessions = SessionStore()
    app.state.memories = MemoryStore()
    app.state.model = OpenAICompatibleModel(ModelConfig.from_env())

    async def cleanup():
        while True:
            await asyncio.sleep(60)
            app.state.sessions.cleanup()

    task = asyncio.create_task(cleanup())
    try:
        yield
    finally:
        task.cancel()
        for state in app.state.sessions.items.values():
            state.change()
        try:
            await task
        except asyncio.CancelledError:
            pass


app = FastAPI(lifespan=lifespan)


@app.exception_handler(RequestValidationError)
async def validation_error(_: Request, __: RequestValidationError):
    # 不把用户提交的原文带回错误响应或日志。
    return JSONResponse({"detail": "请求参数无效，请检查后重试"}, status_code=422)


@app.middleware("http")
async def local_only(request: Request, call_next):
    raw_host = request.headers.get("host", "")
    port = None
    try:
        parsed = urlsplit("http://" + raw_host)
        host = parsed.hostname
        port = parsed.port
    except ValueError:
        host = None
    if host not in {"127.0.0.1", "localhost"} or "@" in raw_host or parsed.path or parsed.query or parsed.fragment:
        return JSONResponse({"detail": "仅允许本机访问"}, status_code=400)
    origin = request.headers.get("origin")
    if origin:
        try:
            value = urlsplit(origin)
            allowed_hosts = {"127.0.0.1", "localhost"}
            allowed = value.scheme == "http" and value.hostname in allowed_hosts and (value.port or 80) in {port or 80, 5173} and not value.username and not value.path and value.query == "" and value.fragment == ""
        except ValueError:
            allowed = False
        if not allowed:
            return JSONResponse({"detail": "请求来源不受允许"}, status_code=403)
    if request.headers.get("content-length", "").isdigit() and int(request.headers["content-length"]) > MAX_BYTES:
        return JSONResponse({"detail": "请求超过 10 MiB 限制"}, status_code=413)
    return await call_next(request)


async def session_state(request: Request, x_session_id: str | None = Header(default=None)) -> SessionState:
    state = request.app.state.sessions.get(x_session_id or "")
    if not state:
        raise HTTPException(404, "会话不存在或已过期，请重新开始")
    return state


def require_live(state: SessionState) -> None:
    if state.value.ended:
        raise HTTPException(409, "本次会话已结束，请重置后重新开始")


def require_revision(state: SessionState, revision: int) -> None:
    require_live(state)
    if state.value.revision != revision:
        raise HTTPException(409, "内容已改变，请使用当前版本重新操作")


def validate_sources(result, state: SessionState) -> None:
    document = state.value.document
    segments = {segment.id: segment for segment in document.segments}
    facts = {fact.id: fact for fact in state.value.facts}
    items = result.items if isinstance(result, Reading) else [result]
    for item in items:
        if getattr(item, "kind", None) in {"fact", "inference"} and not item.citations:
            raise ModelError("模型引用校验失败，请重新解读")
        for citation in item.citations:
            segment = segments.get(citation.segment_id)
            if not segment or not citation.quote.strip() or citation.quote not in segment.text:
                raise ModelError("模型引用校验失败，请重新解读")
        if any(fact_id not in facts for fact_id in item.fact_ids):
            raise ModelError("模型背景引用校验失败，请重新解读")
    if isinstance(result, Reading):
        for candidate in result.candidates:
            if any(segment_id not in segments for segment_id in candidate.source_segment_ids):
                raise ModelError("模型候选来源校验失败，请重新解读")


@app.get("/api/config")
async def config(request: Request):
    config = request.app.state.model.config
    provider = urlsplit(config.base_url or "").hostname or "未连接"
    return {"configured": config.configured, "provider": provider, "model": config.model, "supported_formats": ["txt", "md", "pdf", "docx"], "limits": {"max_bytes": MAX_BYTES, "max_text_chars": MAX_TEXT, "max_pdf_pages": MAX_PDF_PAGES}}


@app.post("/api/session", response_model=Session)
async def create_session(request: Request):
    try:
        return request.app.state.sessions.create().value
    except ValueError as exc:
        raise HTTPException(429, str(exc)) from exc


@app.get("/api/session", response_model=Session)
async def get_session(state: SessionState = Depends(session_state)):
    return state.value


@app.post("/api/document", response_model=Session)
async def upload(request: Request, filename: str, state: SessionState = Depends(session_state)):
    require_live(state)
    upload_revision = state.value.revision
    state.upload_generation += 1
    upload_generation = state.upload_generation
    data = bytearray()
    async for chunk in request.stream():
        data.extend(chunk)
        if len(data) > MAX_BYTES:
            raise HTTPException(413, "文件超过 10 MiB 限制")
    try:
        document = parse_document(filename, bytes(data))
    except ParseError as exc:
        raise HTTPException(400, str(exc)) from exc
    if state.value.ended or state.value.revision != upload_revision or state.upload_generation != upload_generation:
        raise HTTPException(409, "会话内容已改变，已丢弃本次上传")
    state.change()
    state.value.document = document
    return state.value


@app.post("/api/facts", response_model=Session)
async def add_fact(body: FactInput, state: SessionState = Depends(session_state)):
    require_live(state)
    if not body.text.strip():
        raise HTTPException(400, "背景不能为空")
    state.change()
    state.value.facts.append(Fact(id=str(uuid4()), text=body.text.strip(), source="用户明确确认"))
    return state.value


@app.patch("/api/facts/{fact_id}", response_model=Session)
async def edit_fact(fact_id: str, body: FactPatch, state: SessionState = Depends(session_state)):
    require_live(state)
    fact = next((fact for fact in state.value.facts if fact.id == fact_id), None)
    if not fact:
        raise HTTPException(404, "背景不存在")
    if not body.text.strip():
        raise HTTPException(400, "背景不能为空")
    state.change()
    fact.text = body.text.strip()
    fact.version += 1
    fact.memory_id = None
    return state.value


@app.delete("/api/facts/{fact_id}", response_model=Session)
async def delete_fact(fact_id: str, state: SessionState = Depends(session_state)):
    require_live(state)
    if not any(fact.id == fact_id for fact in state.value.facts):
        raise HTTPException(404, "背景不存在")
    state.change()
    state.value.facts = [fact for fact in state.value.facts if fact.id != fact_id]
    return state.value


@app.get("/api/memories")
async def memories(request: Request, state: SessionState = Depends(session_state)):
    return {"items": request.app.state.memories.list()}


@app.post("/api/memories")
async def save_memory(request: Request, body: MemoryCreate, state: SessionState = Depends(session_state)):
    require_live(state)
    if not body.consent:
        raise HTTPException(400, "请明确同意保留供下次使用")
    fact = next((fact for fact in state.value.facts if fact.id == body.fact_id), None)
    if not fact:
        raise HTTPException(404, "背景不存在")
    memory = request.app.state.memories.create(fact.text, fact.source)
    fact.memory_id = memory.id
    return memory


@app.patch("/api/memories/{memory_id}")
async def edit_memory(request: Request, memory_id: str, body: MemoryPatch, state: SessionState = Depends(session_state)):
    if body.text is None and body.active is None:
        raise HTTPException(400, "请选择要修改的内容")
    if body.text is not None and not body.text.strip():
        raise HTTPException(400, "背景不能为空")
    memory = request.app.state.memories.update(memory_id, body.text, body.active)
    if memory is None:
        raise HTTPException(404, "保留背景不存在")
    request.app.state.sessions.invalidate_memory(memory_id)
    return memory


@app.delete("/api/memories/{memory_id}")
async def delete_memory(request: Request, memory_id: str, confirmed: bool = False, state: SessionState = Depends(session_state)):
    if not confirmed:
        raise HTTPException(400, "请确认删除保留背景")
    if not request.app.state.memories.delete(memory_id):
        raise HTTPException(404, "保留背景不存在")
    request.app.state.sessions.invalidate_memory(memory_id)
    return {"deleted": True}


@app.post("/api/memories/{memory_id}/use", response_model=Session)
async def use_memory(request: Request, memory_id: str, state: SessionState = Depends(session_state)):
    require_live(state)
    memory = request.app.state.memories.get(memory_id)
    if not memory or not memory.active:
        raise HTTPException(400, "保留背景不存在或已停用")
    state.change()
    state.value.facts = [fact for fact in state.value.facts if fact.memory_id != memory_id]
    state.value.facts.append(Fact(id=str(uuid4()), text=memory.text, source=memory.source, version=memory.version, memory_id=memory.id))
    return state.value


async def run_model(request: Request, state: SessionState, revision: int, consent: bool, goal: str | None = None):
    require_revision(state, revision)
    if not consent:
        raise HTTPException(400, "请明确同意将当前内容发送给模型")
    if state.value.document is None:
        raise HTTPException(400, "请先上传文件")
    if goal is not None and state.value.reading is None:
        raise HTTPException(400, "请先完成当前版本的文件解读")
    state.change(clear_results=False)
    revision = state.value.revision
    state.value.busy = True
    document = state.value.document.model_copy(deep=True)
    facts = [fact.model_copy(deep=True) for fact in state.value.facts]
    task = asyncio.create_task(request.app.state.model.generate(document, facts, goal=goal))
    state.task = task
    try:
        result = await task
        if state.value.revision != revision or state.value.ended:
            raise HTTPException(409, "内容已改变，本次响应已丢弃")
        validate_sources(result, state)
        if goal is None:
            state.value.reading = result
            state.value.artifact = None
        else:
            state.value.artifact = result
        return state.value
    except asyncio.CancelledError as exc:
        raise HTTPException(409, "请求已取消，本次响应已丢弃") from exc
    except ModelError as exc:
        status = 503 if not request.app.state.model.config.configured else 502
        raise HTTPException(status, str(exc)) from exc
    finally:
        if state.value.revision == revision:
            state.value.busy = False
            state.task = None


@app.post("/api/interpret", response_model=Session)
async def interpret(request: Request, body: InterpretInput, state: SessionState = Depends(session_state)):
    return await run_model(request, state, body.revision, body.consent)


@app.post("/api/artifact", response_model=Session)
async def artifact(request: Request, body: ArtifactInput, state: SessionState = Depends(session_state)):
    return await run_model(request, state, body.revision, body.consent, body.goal)


@app.patch("/api/artifact", response_model=Session)
async def edit_artifact(body: ArtifactPatch, state: SessionState = Depends(session_state)):
    require_revision(state, body.revision)
    if state.value.artifact is None or state.value.busy:
        raise HTTPException(409, "草稿不存在、已失效或正在生成")
    state.value.artifact.text = body.text
    return state.value


@app.post("/api/export")
async def export(body: ExportInput, state: SessionState = Depends(session_state)):
    require_revision(state, body.revision)
    artifact = state.value.artifact
    if artifact is None or state.value.busy:
        raise HTTPException(409, "草稿不存在或已失效，请先生成当前版本草稿")
    segments = {segment.id: segment for segment in state.value.document.segments}
    sources = "\n".join(f"- {segments[c.segment_id].locator}：{c.quote}" for c in artifact.citations)
    facts = "\n".join(f"- {fact.text}" for fact in state.value.facts if fact.id in artifact.fact_ids)
    unknowns = "\n".join(f"- {text}" for text in state.value.reading.unknowns)
    generated = datetime.now(timezone.utc).isoformat()
    document = state.value.document
    text = f"{artifact.text}\n\n## 原文来源\n文件：{document.name}\n\nSHA-256：{document.hash}\n\n版本：{state.value.revision}\n\n生成时间：{generated}\n\n{sources or '无'}\n\n## 已确认背景\n{facts or '无'}\n\n## 待核实事项\n{unknowns or '无'}\n\n生成标识：文启模型草稿，经用户编辑；不代表已提交或资格通过。\n"
    return Response(text, media_type="text/markdown; charset=utf-8", headers={"Content-Disposition": 'attachment; filename="fileaction-draft.md"'})


@app.post("/api/cancel", response_model=Session)
async def cancel(state: SessionState = Depends(session_state)):
    state.change(clear_results=False)
    return state.value


@app.post("/api/reset", response_model=Session)
async def reset(state: SessionState = Depends(session_state)):
    state.change()
    state.value.document = None
    state.value.facts = []
    state.value.ended = False
    return state.value


@app.post("/api/end", response_model=Session)
async def end(state: SessionState = Depends(session_state)):
    state.change()
    state.value.document = None
    state.value.facts = []
    state.value.ended = True
    return state.value


@app.get("/{path:path}")
def static(path: str):
    dist = Path(__file__).resolve().parents[2] / "front" / "dist"
    target = (dist / path).resolve()
    if not target.is_relative_to(dist.resolve()):
        raise HTTPException(404, "页面不存在")
    if target.is_file():
        return FileResponse(target)
    if not path.startswith("api/") and (dist / "legacy.html").is_file() and "." not in path:
        return FileResponse(dist / "legacy.html")
    raise HTTPException(404, "前端尚未构建或页面不存在")

