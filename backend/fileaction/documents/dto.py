from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field


class DocumentMetadataPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")

    name: str | None = Field(default=None, min_length=1, max_length=512)
    category: Literal["uncategorized", "notice", "material"] | None = None
    expected_revision: int = Field(ge=1)


class DocumentVersionRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)


class DocumentDeleteRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    expected_revision: int = Field(ge=1)
    impact_hash: str = Field(min_length=64, max_length=64, pattern=r"^[0-9a-f]{64}$")
    confirmed: Literal[True]


class SegmentPageRequest(BaseModel):
    model_config = ConfigDict(extra="forbid")

    limit: int = Field(default=20, ge=1, le=100)
    cursor: str | None = Field(default=None, max_length=4096)
