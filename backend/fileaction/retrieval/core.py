from __future__ import annotations

import hashlib
import math
import re
import unicodedata
from dataclasses import dataclass
from typing import Literal


class RetrievalError(ValueError):
    """稳定错误码；不包含原文或个人信息。"""


@dataclass(frozen=True)
class SourceSegment:
    id: str
    owner_id: str
    document_version_id: str
    locator: str
    text: str


@dataclass(frozen=True)
class Span:
    segment_id: str
    start: int
    end: int
    text: str
    locator: str


@dataclass(frozen=True)
class Chunk:
    id: str
    owner_id: str
    document_version_id: str
    index_id: str
    profile_key: str
    spans: tuple[Span, ...]
    vector: tuple[float, ...] | None = None
    session_id: str | None = None
    deleted: bool = False

    @property
    def text(self) -> str:
        return "\n".join(span.text for span in self.spans)


@dataclass(frozen=True)
class Scope:
    owner_id: str
    session_id: str
    document_version_ids: frozenset[str]
    segment_ids: frozenset[str]
    index_ids: frozenset[str]
    profile_key: str
    # Empty means explicitly authorized whole segments; otherwise every span
    # must fit in a server-confirmed range of that immutable segment.
    authorized_ranges: tuple[tuple[str, int, int], ...] = ()

    def allows(self, chunk: Chunk) -> bool:
        return bool(chunk.spans) and (
            chunk.owner_id == self.owner_id
            and chunk.document_version_id in self.document_version_ids
            and chunk.index_id in self.index_ids
            and chunk.profile_key == self.profile_key
            and not chunk.deleted
            and chunk.session_id in (None, self.session_id)
            and all(span.segment_id in self.segment_ids for span in chunk.spans)
            and (not self.authorized_ranges or all(
                any(sid == span.segment_id and 0 <= start <= span.start and span.end <= end for sid, start, end in self.authorized_ranges)
                for span in chunk.spans
            ))
        )


@dataclass(frozen=True)
class RetrievalResult:
    evidence: tuple[Span, ...]
    chunk_ids: tuple[str, ...]
    lexical_ids: tuple[str, ...]
    vector_ids: tuple[str, ...]
    mode: str
    trimmed_for_budget: bool


def build_chunks(segments: list[SourceSegment], *, index_id: str, profile_key: str) -> tuple[Chunk, ...]:
    if not segments:
        return ()
    identities = {(s.owner_id, s.document_version_id) for s in segments}
    if len(identities) != 1 or len({s.id for s in segments}) != len(segments):
        raise RetrievalError("DOCUMENT_SCOPE_INVALID")
    if sum(len(s.text) for s in segments) > 1000000:
        raise RetrievalError("CONTEXT_BUDGET_EXCEEDED")
    owner, version = next(iter(identities))
    chunks: list[Chunk] = []
    pending: list[Span] = []

    def flush():
        if not pending:
            return
        material = repr((owner, version, index_id, profile_key, pending)).encode("utf-8")
        chunks.append(Chunk(hashlib.sha256(material).hexdigest(), owner, version, index_id, profile_key, tuple(pending)))
        pending.clear()
        if len(chunks) > 1024:
            raise RetrievalError("CHUNK_LIMIT_EXCEEDED")

    for segment in segments:
        if not segment.text:
            continue
        if len(segment.text) <= 800:
            if sum(len(s.text) + 1 for s in pending) + len(segment.text) > 800:
                flush()
            pending.append(Span(segment.id, 0, len(segment.text), segment.text, segment.locator))
            continue
        flush()
        start = 0
        while start < len(segment.text):
            end = min(start + 800, len(segment.text))
            if end < len(segment.text):
                boundaries = [m.end() for m in re.finditer(r"[。；！？\n]", segment.text[start:end]) if m.end() >= 500]
                if boundaries:
                    end = start + boundaries[-1]
            pending.append(Span(segment.id, start, end, segment.text[start:end], segment.locator))
            flush()
            if end == len(segment.text):
                break
            start = max(start + 1, end - 100)
    flush()
    return tuple(chunks)


def _norm(text: str) -> str:
    return unicodedata.normalize("NFKC", text).casefold()


def _keyword_score(text: str, query: str) -> int:
    content = _norm(text)
    words = re.findall(r"[a-z0-9_]+|[\u4e00-\u9fff]+", _norm(query))
    terms = set(words)
    for word in words:
        if re.fullmatch(r"[\u4e00-\u9fff]{3,}", word):
            terms.update(word[i:i + 2] for i in range(len(word) - 1))
    return sum(min(content.count(term), 3) * len(term) for term in terms)


def _valid_vector(vector: tuple[float, ...], dimensions: int) -> bool:
    return len(vector) == dimensions and all(type(v) in (int, float) and math.isfinite(v) for v in vector) and sum(v * v for v in vector) > 0


def _merge_spans(chunks: list[Chunk]) -> tuple[Span, ...]:
    groups: dict[str, list[Span]] = {}
    for chunk in chunks:
        for span in chunk.spans:
            groups.setdefault(span.segment_id, []).append(span)
    merged = []
    for spans in groups.values():
        ordered = sorted(spans, key=lambda s: (s.start, s.end))
        current = ordered[0]
        for span in ordered[1:]:
            if span.start <= current.end:
                if span.end > current.end:
                    current = Span(current.segment_id, current.start, span.end, current.text + span.text[current.end - span.start:], current.locator)
            else:
                merged.append(current)
                current = span
        merged.append(current)
    return tuple(merged)


def retrieve(chunks: list[Chunk] | tuple[Chunk, ...], query: str, scope: Scope, *, mode: Literal["keyword", "hybrid"], query_vector: tuple[float, ...] | None = None, max_chars: int = 40000, max_input_units: int = 16000) -> RetrievalResult:
    if mode not in ("keyword", "hybrid") or len(query) > 4000 or not 1 <= max_chars <= 40000 or not 1 <= max_input_units <= 16000:
        raise RetrievalError("RETRIEVAL_REQUEST_INVALID")
    if len(chunks) > 5120:
        raise RetrievalError("CONTEXT_BUDGET_EXCEEDED")
    # Filter before scoring. Repositories must constrain the SQL query identically.
    allowed = {c.id: c for c in chunks if scope.allows(c)}
    scores = {cid: _keyword_score(c.text, query) for cid, c in allowed.items()}
    lexical = sorted((cid for cid in allowed if scores[cid] > 0), key=lambda cid: (-scores[cid], cid))[:20]
    vector_ids: list[str] = []
    if mode == "hybrid":
        if not query_vector or not _valid_vector(query_vector, len(query_vector)):
            raise RetrievalError("EMBEDDING_OUTPUT_INVALID")
        similarity = {}
        query_norm = math.sqrt(sum(v * v for v in query_vector))
        for cid, chunk in allowed.items():
            if chunk.vector is None:
                raise RetrievalError("INDEX_NOT_READY")
            if not _valid_vector(chunk.vector, len(query_vector)):
                raise RetrievalError("EMBEDDING_OUTPUT_INVALID")
            norm = math.sqrt(sum(v * v for v in chunk.vector))
            similarity[cid] = sum(x * y for x, y in zip(query_vector, chunk.vector, strict=True)) / (query_norm * norm)
        vector_ids = sorted(allowed, key=lambda cid: (-similarity[cid], cid))[:20]
    rrf: dict[str, float] = {}
    for ranking in (lexical, vector_ids):
        for rank, cid in enumerate(ranking, 1):
            rrf[cid] = rrf.get(cid, 0) + 1 / (60 + rank)
    ranked = sorted(rrf, key=lambda cid: (-rrf[cid], cid))
    selected: list[Chunk] = []
    trimmed = False
    for cid in ranked:
        if len(selected) >= 12:
            break
        candidate = selected + [allowed[cid]]
        spans = _merge_spans(candidate)
        # Conservative request estimate, never a billing measurement.
        if sum(len(s.text) for s in spans) > max_chars or sum(len(s.text.encode("utf-8")) for s in spans) > max_input_units:
            trimmed = True
            continue
        selected = candidate
    return RetrievalResult(_merge_spans(selected), tuple(c.id for c in selected), tuple(lexical), tuple(vector_ids), mode, trimmed)
