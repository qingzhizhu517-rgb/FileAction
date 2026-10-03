from __future__ import annotations

import sqlite3
import os
from pathlib import Path
from uuid import uuid4

from .schemas import Memory


PROJECT_ROOT = Path(__file__).resolve().parents[2]


class MemoryStore:
    def __init__(self, path: str | Path | None = None):
        self.path = Path(path) if path is not None else Path(os.environ.get("FILEACTION_DATA_DIR", PROJECT_ROOT / "var")) / "fileaction.db"
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as db:
            db.execute("CREATE TABLE IF NOT EXISTS memories (id TEXT PRIMARY KEY, text TEXT NOT NULL, source TEXT NOT NULL, version INTEGER NOT NULL, active INTEGER NOT NULL)")

    def connect(self):
        db = sqlite3.connect(self.path)
        db.row_factory = sqlite3.Row
        return db

    @staticmethod
    def _memory(row) -> Memory:
        return Memory.model_validate(dict(row))

    def list(self) -> list[Memory]:
        with self.connect() as db:
            return [self._memory(row) for row in db.execute("SELECT * FROM memories ORDER BY rowid")]

    def get(self, memory_id: str) -> Memory | None:
        with self.connect() as db:
            row = db.execute("SELECT * FROM memories WHERE id = ?", (memory_id,)).fetchone()
        return self._memory(row) if row else None

    def create(self, text: str, source: str) -> Memory:
        memory = Memory(id=str(uuid4()), text=text, source=source, version=1)
        with self.connect() as db:
            db.execute("INSERT INTO memories VALUES (?, ?, ?, ?, ?)", (memory.id, memory.text, memory.source, memory.version, 1))
        return memory

    def update(self, memory_id: str, text: str | None, active: bool | None) -> Memory | None:
        memory = self.get(memory_id)
        if memory is None:
            return None
        memory.version += 1
        if text is not None:
            memory.text = text
        if active is not None:
            memory.active = active
        with self.connect() as db:
            db.execute("UPDATE memories SET text=?, version=?, active=? WHERE id=?", (memory.text, memory.version, int(memory.active), memory.id))
        return memory

    def delete(self, memory_id: str) -> bool:
        with self.connect() as db:
            cursor = db.execute("DELETE FROM memories WHERE id=?", (memory_id,))
        return bool(cursor.rowcount)
