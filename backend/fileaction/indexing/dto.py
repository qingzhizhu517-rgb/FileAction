"""索引外发授权请求；客户端不能提供正文或授权凭证。"""
from pydantic import BaseModel, ConfigDict, Field

class DTO(BaseModel):
    model_config=ConfigDict(extra='forbid',strict=True)

class Selection(DTO):
    segment_id: str
    char_start: int=Field(ge=0)
    char_end: int=Field(gt=0)

class IndexPreviewRequest(DTO):
    expected_revision: int=Field(ge=1)
    document_version_id: str
    selections: list[Selection] | None=Field(default=None,min_length=1,max_length=256)

class IndexCreateRequest(DTO):
    preview_id: str
    manifest_hash: str=Field(min_length=64,max_length=64)
    expected_revision: int=Field(ge=1)
    consent_to_embed: bool
    retry_job_id: str | None=None
    accept_possible_duplicate_cost: bool=False

class ConfirmRequest(DTO):
    confirmed: bool

class DeleteIndexesRequest(ConfirmRequest):
    expected_revision: int=Field(ge=1)
