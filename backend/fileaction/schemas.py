from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, field_validator


class StrictModel(BaseModel):
    model_config = ConfigDict(extra="forbid")

    @field_validator("*", mode="before")
    @classmethod
    def reject_blank_strings(cls, value):
        if isinstance(value, str) and not value.strip():
            raise ValueError("内容不能为空")
        if isinstance(value, list) and any(isinstance(item, str) and not item.strip() for item in value):
            raise ValueError("内容不能为空")
        return value


class Segment(StrictModel):
    id: str
    locator: str
    text: str


class Document(StrictModel):
    id: str
    name: str
    hash: str
    segments: list[Segment]
    warnings: list[str] = []


class Fact(StrictModel):
    id: str
    text: str
    source: str = "user"
    version: int = 1
    memory_id: str | None = None


class Citation(StrictModel):
    segment_id: str
    quote: str


class ReadingItem(StrictModel):
    title: str
    meaning: str
    kind: Literal["fact", "inference", "unknown"]
    citations: list[Citation]
    fact_ids: list[str]


class ReadingQuestion(StrictModel):
    question: str
    reason: str


class Candidate(StrictModel):
    text: str
    source_segment_ids: list[str] = Field(min_length=1)


class Reading(StrictModel):
    items: list[ReadingItem]
    questions: list[ReadingQuestion]
    unknowns: list[str]
    candidates: list[Candidate]


class Artifact(StrictModel):
    text: str
    citations: list[Citation]
    fact_ids: list[str]

    @field_validator("text")
    @classmethod
    def nonblank(cls, value: str) -> str:
        if not value.strip():
            raise ValueError("草稿正文不能为空")
        return value


class Session(StrictModel):
    id: str
    revision: int = 0
    document: Document | None = None
    facts: list[Fact] = []
    reading: Reading | None = None
    artifact: Artifact | None = None
    ended: bool = False
    busy: bool = False


class Memory(StrictModel):
    id: str
    text: str
    source: str
    version: int
    active: bool = True


class ConfigResponse(StrictModel):
    configured: bool
    provider: str
    model: str | None
    supported_formats: list[str]
    limits: dict[str, int]


class FactInput(StrictModel):
    text: str = Field(min_length=1, max_length=10000)
    source: str = "user"


class FactPatch(StrictModel):
    text: str = Field(min_length=1, max_length=10000)


class MemoryCreate(StrictModel):
    fact_id: str
    consent: bool


class MemoryPatch(StrictModel):
    text: str | None = Field(default=None, min_length=1, max_length=10000)
    active: bool | None = None


class InterpretInput(StrictModel):
    revision: int
    consent: bool


class ArtifactInput(StrictModel):
    revision: int
    consent: bool
    goal: str = Field(min_length=1, max_length=2000)


class ArtifactPatch(StrictModel):
    revision: int
    text: str = Field(min_length=1, max_length=100000)


class ExportInput(StrictModel):
    revision: int
