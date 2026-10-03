"""严格请求合同；未知字段拒绝，确认本次事实不等于保留。"""
from typing import Literal
from pydantic import BaseModel, ConfigDict, Field

class DTO(BaseModel):
    model_config = ConfigDict(extra='forbid', strict=True)

class CreateRequest(DTO):
    retention: Literal['temporary'] = 'temporary'
    title: str | None = Field(default=None, min_length=1, max_length=300)
    primary_document_id: str | None = None

class RevisionRequest(DTO):
    expected_revision: int = Field(ge=1)

class PatchRequest(RevisionRequest):
    title: str | None = Field(default=None, min_length=1, max_length=300)
    goal: str | None = Field(default=None, max_length=4000)
    status: Literal['active', 'paused'] | None = None

class DocumentsRequest(RevisionRequest):
    document_version_ids: list[str] = Field(max_length=20)

class FactRequest(RevisionRequest):
    text: str = Field(min_length=1, max_length=8000)
    confirmed: Literal[True]

class Selection(DTO):
    document_version_id: str
    segment_id: str
    char_start: int = Field(ge=0)
    char_end: int = Field(gt=0)

class PreviewRequest(RevisionRequest):
    kind: Literal['interpret', 'chat', 'propose_actions', 'generate_artifact'] = 'interpret'
    message: str = Field(default='', max_length=4000)
    retrieval_mode: Literal['full_text', 'keyword', 'hybrid'] = 'full_text'
    document_version_ids: list[str] | None = Field(default=None, max_length=20)
    fact_ids: list[str] = Field(default_factory=list, max_length=20)
    history_message_ids: list[str] = Field(default_factory=list, max_length=12)
    selections: list[Selection] | None = Field(default=None, max_length=1024)
    query: str = Field(default='', max_length=200)
