from typing import Literal
from pydantic import Field
from fileaction.workspaces.dto import DTO,RevisionRequest

class CreateAction(DTO):
    workspace_id: str
    confirmed: bool
    title: str | None = Field(default=None,min_length=1,max_length=300)
    description: str | None = Field(default=None,max_length=4000)
    proposal_id: str | None = Field(default=None,min_length=1,max_length=400)
    priority: Literal['low','normal','high'] | None = None
    due_at: str | None = None

class PatchAction(RevisionRequest):
    title: str | None = Field(default=None,min_length=1,max_length=300)
    description: str | None = Field(default=None,max_length=4000)
    status: Literal['confirmed','in_progress','draft_ready','paused','completed'] | None = None
    priority: Literal['low','normal','high'] | None = None
    due_at: str | None = None

class DeleteAction(RevisionRequest):
    confirmed: bool
