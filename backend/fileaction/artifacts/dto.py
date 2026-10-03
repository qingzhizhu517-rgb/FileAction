from pydantic import Field
from fileaction.workspaces.dto import DTO,RevisionRequest

class EditArtifact(RevisionRequest):
    body: str=Field(min_length=1,max_length=30000)

class DeleteArtifact(RevisionRequest):
    confirmed: bool

class ExportArtifact(RevisionRequest):
    version: int=Field(ge=1)
    confirm_historical: bool=False
    confirm_stale: bool=False

class ArtifactSelection(DTO):
    artifact_id: str
    version: int=Field(ge=1)

class ExportWorkspace(RevisionRequest):
    selections: list[ArtifactSelection]=Field(min_length=1,max_length=50)
    confirm_historical: bool=False
    confirm_stale: bool=False
