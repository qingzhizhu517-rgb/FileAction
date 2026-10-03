from __future__ import annotations

import asyncio
import hashlib
import math
import time
from dataclasses import dataclass, field
from typing import Literal
from urllib.parse import urlsplit

import httpx


class EmbeddingError(ValueError):
    """对外稳定错误码，禁止包含上游响应或配置。"""


@dataclass(frozen=True)
class EmbeddingProfile:
    base_url: str
    api_key: str = field(repr=False)
    model: str
    dimensions: int
    version: str
    max_batch_items: int = 10
    max_batch_input_units: int = 32000

    def __post_init__(self):
        url = urlsplit(self.base_url)
        if url.scheme != "https" or not url.hostname or url.username or url.password or url.query or url.fragment:
            raise EmbeddingError("EMBEDDING_CONFIGURATION_INVALID")
        if not self.api_key or not self.model or not self.version or not 1 <= self.dimensions <= 4096 or not 1 <= self.max_batch_items <= 32:
            raise EmbeddingError("EMBEDDING_CONFIGURATION_INVALID")


def content_hash(text: str) -> str:
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


@dataclass(frozen=True)
class EmbeddingConsent:
    text_hashes: tuple[str, ...]
    purpose: Literal["document_index", "query"]
    profile_hash: str

    @classmethod
    def for_texts(cls, texts: list[str], *, purpose: Literal["document_index", "query"], profile: EmbeddingProfile):
        # Only the service may construct this after validating a server-side preview.
        # This DTO is never accepted directly as an HTTP authorization token.
        if purpose not in ("document_index", "query"):
            raise EmbeddingError("CONSENT_REQUIRED")
        return cls(tuple(content_hash(text) for text in texts), purpose, profile_hash(profile))


def profile_hash(profile: EmbeddingProfile) -> str:
    return content_hash(repr((profile.base_url, profile.model, profile.dimensions, profile.version)))


@dataclass
class CallBudget:
    max_requests: int
    started_at: float = field(default_factory=time.monotonic)
    requests: int = 0
    max_seconds: float = 300

    def consume(self):
        if not 1 <= self.max_requests <= 16 or self.requests >= self.max_requests or time.monotonic() - self.started_at >= self.max_seconds:
            raise EmbeddingError("EMBEDDING_BUDGET_EXCEEDED")
        self.requests += 1


@dataclass(frozen=True)
class EmbeddingResult:
    vectors: tuple[tuple[float, ...], ...]
    text_hashes: tuple[str, ...]
    profile_version: str
    usage_tokens: int | None


class EmbeddingGateway:
    def __init__(self, profile: EmbeddingProfile, *, transport: httpx.AsyncBaseTransport | None = None):
        self.profile = profile
        self.transport = transport

    async def embed(self, texts: list[str], *, consent: EmbeddingConsent | None, budget: CallBudget) -> EmbeddingResult:
        if consent is None:
            raise EmbeddingError("CONSENT_REQUIRED")
        hashes = tuple(content_hash(text) for text in texts)
        if hashes != consent.text_hashes or consent.profile_hash != profile_hash(self.profile):
            raise EmbeddingError("EMBEDDING_SCOPE_CHANGED")
        if not texts or len(texts) > self.profile.max_batch_items:
            raise EmbeddingError("EMBEDDING_BATCH_TOO_LARGE")
        if any(not text.strip() for text in texts) or sum(len(t.encode("utf-8")) for t in texts) > self.profile.max_batch_input_units:
            raise EmbeddingError("EMBEDDING_INPUT_TOO_LARGE")
        query = consent.purpose == "query"
        if query:
            if budget.max_requests != 1:
                raise EmbeddingError("EMBEDDING_BUDGET_EXCEEDED")
            if len(texts) > 6:
                raise EmbeddingError("EMBEDDING_BATCH_TOO_LARGE")
            if sum(len(text) for text in texts) > 1200:
                raise EmbeddingError("EMBEDDING_INPUT_TOO_LARGE")
        total_seconds = min(15, budget.max_seconds) if query else budget.max_seconds
        remaining = total_seconds - (time.monotonic() - budget.started_at)
        if remaining <= 0:
            raise EmbeddingError("EMBEDDING_BUDGET_EXCEEDED")
        budget.consume()
        payload = {"model": self.profile.model, "input": texts, "dimensions": self.profile.dimensions, "encoding_format": "float"}
        try:
            # HTTPX timeouts bound individual I/O waits, not the full streamed call.
            async with asyncio.timeout(remaining), httpx.AsyncClient(transport=self.transport, timeout=min(30, remaining), follow_redirects=False, trust_env=False) as client:
                async with client.stream("POST", self.profile.base_url.rstrip("/") + "/embeddings", headers={"Authorization": "Bearer " + self.profile.api_key}, json=payload) as response:
                    if response.status_code != 200:
                        raise EmbeddingError("EMBEDDING_UNAVAILABLE")
                    content = bytearray()
                    async for chunk in response.aiter_bytes():
                        content.extend(chunk)
                        if len(content) > 2 * 1024 * 1024:
                            raise EmbeddingError("EMBEDDING_OUTPUT_INVALID")
                    import json
                    data = json.loads(content)
        except (httpx.TimeoutException, TimeoutError):
            raise EmbeddingError("EMBEDDING_TIMEOUT") from None
        except httpx.HTTPError:
            raise EmbeddingError("EMBEDDING_UNAVAILABLE") from None
        except (ValueError, UnicodeError) as exc:
            if isinstance(exc, EmbeddingError):
                raise
            raise EmbeddingError("EMBEDDING_OUTPUT_INVALID") from None
        rows = data.get("data") if isinstance(data, dict) else None
        if not isinstance(rows, list) or len(rows) != len(texts):
            raise EmbeddingError("EMBEDDING_OUTPUT_INVALID")
        vectors = {}
        for row in rows:
            if not isinstance(row, dict):
                raise EmbeddingError("EMBEDDING_OUTPUT_INVALID")
            index, vector = row.get("index"), row.get("embedding")
            if type(index) is not int or index < 0 or index >= len(texts) or index in vectors:
                raise EmbeddingError("EMBEDDING_OUTPUT_INVALID")
            if not isinstance(vector, list) or len(vector) != self.profile.dimensions:
                raise EmbeddingError("EMBEDDING_OUTPUT_INVALID")
            if not all(type(v) in (int, float) and math.isfinite(v) and abs(v) < 1e20 for v in vector) or sum(v * v for v in vector) == 0:
                raise EmbeddingError("EMBEDDING_OUTPUT_INVALID")
            vectors[index] = tuple(float(v) for v in vector)
        usage = data.get("usage", {})
        tokens = usage.get("total_tokens") if isinstance(usage, dict) else None
        tokens = tokens if type(tokens) is int and tokens >= 0 else None
        # Synchronous decoding/validation can cross the deadline without yielding
        # to the cancellation callback; never publish such a late result.
        if time.monotonic() - budget.started_at >= total_seconds:
            raise EmbeddingError("EMBEDDING_TIMEOUT")
        return EmbeddingResult(tuple(vectors[i] for i in range(len(texts))), hashes, self.profile.version, tokens)
