from __future__ import annotations

import asyncio
import secrets
import time
from dataclasses import dataclass, field

from .schemas import Session


@dataclass
class SessionState:
    value: Session
    last_seen: float = field(default_factory=time.monotonic)
    task: asyncio.Task | None = None
    upload_generation: int = 0

    def change(self, *, clear_results: bool = True) -> None:
        self.value.revision += 1
        self.upload_generation += 1
        self.value.busy = False
        if self.task and not self.task.done():
            self.task.cancel()
        self.task = None
        if clear_results:
            self.value.reading = None
            self.value.artifact = None


class SessionStore:
    def __init__(self, *, ttl: float = 3600, max_sessions: int = 100):
        self.ttl = ttl
        self.max_sessions = max_sessions
        self.items: dict[str, SessionState] = {}

    def cleanup(self) -> None:
        now = time.monotonic()
        for session_id, state in list(self.items.items()):
            if now - state.last_seen > self.ttl:
                state.change()
                del self.items[session_id]

    def create(self) -> SessionState:
        self.cleanup()
        if len(self.items) >= self.max_sessions:
            raise ValueError("会话数量已达上限，请结束其他会话后重试")
        state = SessionState(Session(id=secrets.token_urlsafe(32)))
        self.items[state.value.id] = state
        return state

    def get(self, session_id: str) -> SessionState | None:
        self.cleanup()
        state = self.items.get(session_id)
        if state:
            state.last_seen = time.monotonic()
        return state

    def invalidate_memory(self, memory_id: str, memory=None) -> None:
        for state in self.items.values():
            if any(f.memory_id == memory_id for f in state.value.facts):
                state.change()
                state.value.facts = [fact for fact in state.value.facts if fact.memory_id != memory_id]

