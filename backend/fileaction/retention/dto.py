"""严格的 Task 5d 请求合同。"""
from datetime import datetime
from typing import Literal

from pydantic import Field, field_validator

from fileaction.workspaces.dto import DTO, RevisionRequest


class ArtifactVersionSelection(DTO):
    artifact_id: str
    version: int = Field(ge=1)


class RetentionPreviewRequest(RevisionRequest):
    document_version_ids: list[str] = Field(default_factory=list, max_length=20)
    message_ids: list[str] = Field(default_factory=list, max_length=100)
    answer_ids: list[str] = Field(default_factory=list, max_length=100)
    artifact_versions: list[ArtifactVersionSelection] = Field(default_factory=list, max_length=100)
    fact_version_ids: list[str] = Field(default_factory=list, max_length=100)
    index_ids: list[str] = Field(default_factory=list, max_length=20)
    retain_indexes: bool = False


class RetainRequest(DTO):
    preview_id: str
    scope_hash: str = Field(min_length=64, max_length=64)
    expected_revision: int = Field(ge=1)
    confirmed: Literal[True]


class MemoryDates(DTO):
    @field_validator("valid_from", "valid_until", mode="before", check_fields=False)
    @classmethod
    def aware_dates(cls, value):
        if value is None:
            return value
        if isinstance(value, str):
            value = datetime.fromisoformat(value.replace("Z", "+00:00"))
        if not isinstance(value, datetime) or value.tzinfo is None or value.utcoffset() is None:
            raise ValueError("日期必须包含时区")
        return value


class RetainFactRequest(RevisionRequest):
    fact_version: int = Field(ge=1)
    consent_to_retain: Literal[True]


class MemoryCreateRequest(MemoryDates):
    fact_version_id: str
    consent_to_retain: Literal[True]
    text: str | None = Field(default=None, min_length=1, max_length=8000)
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class MemoryPatchRequest(MemoryDates, RevisionRequest):
    text: str | None = Field(default=None, min_length=1, max_length=8000)
    active: bool | None = None
    valid_from: datetime | None = None
    valid_until: datetime | None = None


class MemoryUseRequest(RevisionRequest):
    workspace_id: str
    expected_memory_revision: int = Field(ge=1)
