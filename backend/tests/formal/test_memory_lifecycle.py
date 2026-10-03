"""独立背景服务合同；合成内存替身只隔离存储，真实持久化另做API验收。"""
from contextlib import asynccontextmanager
from copy import deepcopy
from types import SimpleNamespace

import pytest

from fileaction.retention.service import MemoryService, RetentionError
from fileaction.retention.dto import MemoryPatchRequest
from fileaction.workspaces.service import WorkspaceError


class SyntheticWorkspaces:
    def __init__(self):
        self.value = dict(id="synthetic-workspace", revision=2, facts=[
            dict(id="synthetic-fact", version=1, text="用户确认的合成背景", confirmed=True),
            dict(id="unselected-fact", version=1, text="未选择的合成内容", confirmed=True),
        ], documents=[dict(text="不应保存的文件正文")], messages=[dict(text="不应保存的消息")])
        self.temporary = SimpleNamespace(redis=self)

    @asynccontextmanager
    async def lock(self, *args, **kwargs):
        yield

    async def _resource(self, actor, identifier):
        if identifier != self.value["id"]:
            raise WorkspaceError("RESOURCE_NOT_FOUND")
        return SimpleNamespace(value=deepcopy(self.value))

    def check(self, resource, revision):
        if resource.value["revision"] != revision:
            raise WorkspaceError("REVISION_CONFLICT")

    async def fact(self, actor, workspace_id, expected_revision, **fields):
        self.check(await self._resource(actor, workspace_id), expected_revision)
        self.value["facts"].append(dict(id="used-fact", version=1, **fields))
        self.value["revision"] += 1
        return deepcopy(self.value)


class SyntheticRepository:
    def __init__(self):
        self.saved = None

    async def retain_fact(self, actor, snapshot, key, revision):
        self.saved = deepcopy(snapshot)
        return dict(id="synthetic-memory", text=snapshot["text"], revision=1)

    async def patch_memory(self, actor, memory_id, request):
        return dict(id=memory_id, **request.model_dump(exclude_unset=True))

    @asynccontextmanager
    async def available_snapshot(self, actor, memory_id, revision):
        if revision != 3:
            raise RetentionError("REVISION_CONFLICT")
        yield dict(id=memory_id, text="用户选中的合成背景", revision=3, version=2)


def setup_service():
    repository, workspaces = SyntheticRepository(), SyntheticWorkspaces()
    service = MemoryService(repository, workspaces=workspaces)
    actor = SimpleNamespace(user_id="synthetic-user", session_id="synthetic-session")
    return service, repository, workspaces, actor


@pytest.mark.asyncio
async def test_retain_freezes_only_the_confirmed_selected_fact():
    service, repository, _, actor = setup_service()
    request = SimpleNamespace(expected_revision=2, fact_version=1, consent_to_retain=True)
    memory = await service.retain_fact(actor, "synthetic-workspace", "synthetic-fact", request, "synthetic-key")
    assert memory["text"] == "用户确认的合成背景"
    assert repository.saved == dict(workspace_id="synthetic-workspace", fact_id="synthetic-fact",
                                    fact_version=1, text="用户确认的合成背景")


@pytest.mark.asyncio
@pytest.mark.parametrize("change,error", [
    (dict(consent_to_retain=False), "CONSENT_REQUIRED"),
    (dict(fact_version=2), "REVISION_CONFLICT"),
    (dict(expected_revision=1), "REVISION_CONFLICT"),
])
async def test_retain_rejects_unconfirmed_or_changed_selection(change, error):
    service, repository, _, actor = setup_service()
    request = SimpleNamespace(**(dict(expected_revision=2, fact_version=1, consent_to_retain=True) | change))
    with pytest.raises((RetentionError, WorkspaceError), match=error):
        await service.retain_fact(actor, "synthetic-workspace", "synthetic-fact", request, "synthetic-key")
    assert repository.saved is None


@pytest.mark.asyncio
async def test_retain_requires_key_and_user_confirmed_fact():
    service, repository, workspaces, actor = setup_service()
    request = SimpleNamespace(expected_revision=2, fact_version=1, consent_to_retain=True)
    with pytest.raises(RetentionError, match="IDEMPOTENCY_KEY_REQUIRED"):
        await service.retain_fact(actor, "synthetic-workspace", "synthetic-fact", request, "")
    workspaces.value["facts"][0]["confirmed"] = False
    with pytest.raises(RetentionError, match="FACT_NOT_ELIGIBLE"):
        await service.retain_fact(actor, "synthetic-workspace", "synthetic-fact", request, "key")
    assert repository.saved is None


@pytest.mark.asyncio
async def test_use_copies_selected_snapshot_into_this_workspace_only():
    service, _, _, actor = setup_service()
    result = await service.use(actor, "synthetic-memory", "synthetic-workspace", 2, 3)
    assert result["revision"] == 3
    assert result["facts"][-1] == dict(id="used-fact", version=1,
                                        text="用户选中的合成背景", confirmed=True)


@pytest.mark.asyncio
async def test_use_rejects_changed_memory_without_adding_fact():
    service, _, workspaces, actor = setup_service()
    with pytest.raises(RetentionError, match="REVISION_CONFLICT"):
        await service.use(actor, "synthetic-memory", "synthetic-workspace", 2, 2)
    assert workspaces.value["revision"] == 2


@pytest.mark.asyncio
async def test_memory_patch_can_clear_validity_but_not_save_blank_text():
    service, _, _, actor = setup_service()
    cleared = await service.patch(actor, "synthetic-memory", MemoryPatchRequest(expected_revision=1, valid_until=None))
    assert cleared["valid_until"] is None
    for body in (dict(expected_revision=1), dict(expected_revision=1, text="  ")):
        with pytest.raises(RetentionError, match="INVALID_REQUEST"):
            await service.patch(actor, "synthetic-memory", MemoryPatchRequest(**body))


def test_retention_identity_is_owner_scoped_and_binds_only_selected_content():
    from fileaction.retention import repository
    from uuid import uuid4
    owner = uuid4()
    snapshot = dict(workspace_id="synthetic-workspace", fact_id="synthetic-fact", fact_version=1, text="合成背景")
    identity, fingerprint = repository.retention_identity(owner, "synthetic-key", snapshot)
    assert repository.retention_identity(owner, "synthetic-key", snapshot) == (identity, fingerprint)
    changed_identity, changed_fingerprint = repository.retention_identity(owner, "synthetic-key", {**snapshot, "text": "改后的合成背景"})
    assert changed_identity == identity and changed_fingerprint != fingerprint
    assert repository.retention_identity(uuid4(), "synthetic-key", snapshot)[0] != identity


@pytest.mark.asyncio
async def test_readiness_accepts_current_schema_head(monkeypatch):
    from contextlib import asynccontextmanager
    from fileaction.api import readiness
    from fileaction.core.config import Settings

    class SyntheticConnection:
        async def execute(self, statement):
            # 合成探针仅模拟当前已迁移的schema，不代替真实PG验收。
            return SimpleNamespace(scalar_one=lambda: "0007_memory_revision" in str(statement))

    class SyntheticEngine:
        @asynccontextmanager
        async def connect(self):
            yield SyntheticConnection()

        async def dispose(self):
            pass

    monkeypatch.setattr(readiness, "create_async_engine", lambda *a, **kw: SyntheticEngine())
    assert await readiness.ReadinessProbes().database(Settings())
