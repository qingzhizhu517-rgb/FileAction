"""Task 5d: retention and independent background contracts (synthetic unit cases)."""
from datetime import datetime, timezone
from uuid import uuid4

import pytest

from fileaction.retention.dto import (
    MemoryCreateRequest,
    MemoryPatchRequest,
    RetainRequest,
    RetentionPreviewRequest,
)
from fileaction.retention.service import RetentionError, build_scope_hash, freeze_preview


def test_preview_freezes_selected_ids_and_hashes_content():
    workspace = {
        "id": "ws-1",
        "revision": 3,
        "documents": [{"document_version_id": "dv-1", "sha256": "a" * 64}],
        "messages": [{"id": "m-1", "text": "首条"}, {"id": "m-2", "text": "后来追加"}],
        "answers": [{"id": "ans-1", "envelope": {"summary": "合成"}}],
        "artifacts": [{"id": "art-1", "version": 2, "body_hash": "b" * 64}],
        "facts": [{"id": "fv-1", "version": 1, "text": "合成事实", "confirmed": True}],
    }
    request = RetentionPreviewRequest(
        expected_revision=3,
        document_version_ids=["dv-1"],
        message_ids=["m-1"],
        answer_ids=["ans-1"],
        artifact_versions=[{"artifact_id": "art-1", "version": 2}],
        fact_version_ids=["fv-1"],
        retain_indexes=False,
    )
    preview = freeze_preview(workspace, request)
    assert preview["expected_revision"] == 3
    assert preview["messages"] == ["m-1"]
    assert preview["scope_hash"] == build_scope_hash(preview["scope"])
    assert "m-2" not in preview["scope"]["message_ids"]


def test_preview_rejects_revision_or_unknown_selection():
    workspace = {"id": "ws-1", "revision": 4, "documents": [], "messages": [], "answers": [], "artifacts": [], "facts": []}
    with pytest.raises(RetentionError, match="REVISION_CONFLICT"):
        freeze_preview(workspace, RetentionPreviewRequest(expected_revision=3))
    with pytest.raises(RetentionError, match="INVALID_SELECTION"):
        freeze_preview(workspace, RetentionPreviewRequest(expected_revision=4, message_ids=["missing"]))


def test_retain_requires_explicit_confirmation_and_memory_consent():
    with pytest.raises(ValueError):
        RetainRequest(preview_id="p", scope_hash="h", expected_revision=1, confirmed=False)
    with pytest.raises(ValueError):
        MemoryCreateRequest(fact_version_id="f", consent_to_retain=False)
    assert MemoryCreateRequest(fact_version_id="f", consent_to_retain=True).consent_to_retain is True


def test_memory_patch_accepts_validity_window_and_explicit_active_state():
    patch = MemoryPatchRequest(
        expected_revision=2,
        text="修订后的合成背景",
        active=False,
        valid_until=datetime(2026, 12, 1, tzinfo=timezone.utc),
    )
    assert patch.expected_revision == 2
    assert patch.active is False
