"""合成证据测试；不连接PG、不调用Embedding。"""
from dataclasses import replace

import pytest

from fileaction.retrieval.core import SourceSegment, Scope, build_chunks, retrieve, RetrievalError


def source(identifier, text, *, owner="alice", version="v1"):
    return SourceSegment(identifier, owner, version, "合成第1段", text)


def test_chunk_ranges_reproduce_original_without_inventing_locators():
    original = "合成条件：不得重复申请。" * 160
    chunks = build_chunks([source("s1", original)], index_id="i1", profile_key="p1")
    assert 1 < len(chunks) <= 1024
    covered = set()
    for chunk in chunks:
        assert len(chunk.text) <= 1200
        for span in chunk.spans:
            assert span.text == original[span.start:span.end]
            assert span.locator == "合成第1段"
            covered.update(range(span.start, span.end))
    assert covered == set(range(len(original)))


def test_filtering_excludes_other_owner_version_index_and_partial_authorization_before_ranking():
    good = build_chunks([source("s1", "合成申请条件")], index_id="i1", profile_key="p1")[0]
    outsiders = [replace(good, id="other-owner", owner_id="bob"), replace(good, id="old-version", document_version_id="v0"), replace(good, id="stale-index", index_id="i0"), replace(good, id="deleted", deleted=True), replace(good, id="other-session", session_id="session-2")]
    mixed = build_chunks([source("s1", "合成申请条件"), source("s2", "未授权的个人材料")], index_id="i1", profile_key="p1")[0]
    scope = Scope("alice", "session-1", frozenset({"v1"}), frozenset({"s1"}), frozenset({"i1"}), "p1")
    results = retrieve([*outsiders, mixed, good], "申请", scope, mode="keyword")
    assert [r.segment_id for r in results.evidence] == ["s1"]
    assert results.evidence[0].text == "合成申请条件"


def test_hybrid_refuses_incompatible_vectors_and_does_not_silently_fallback():
    chunk = build_chunks([source("s1", "合成申请")], index_id="i1", profile_key="p1")[0]
    scope = Scope("alice", "ss", frozenset({"v1"}), frozenset({"s1"}), frozenset({"i1"}), "p1")
    with pytest.raises(RetrievalError, match="INDEX_NOT_READY"):
        retrieve([chunk], "申请", scope, mode="hybrid", query_vector=(1., 0.))
    with pytest.raises(RetrievalError, match="EMBEDDING_OUTPUT_INVALID"):
        retrieve([replace(chunk, vector=(1., 0., 0.))], "申请", scope, mode="hybrid", query_vector=(1., 0.))


def test_no_keyword_match_means_no_fabricated_evidence_and_budget_never_truncates_claims():
    chunk = build_chunks([source("s1", "合成条件：不得重复申请。")], index_id="i1", profile_key="p1")[0]
    scope = Scope("alice", "ss", frozenset({"v1"}), frozenset({"s1"}), frozenset({"i1"}), "p1")
    assert retrieve([chunk], "完全无关词语", scope, mode="keyword").evidence == ()
    result = retrieve([chunk], "申请", scope, mode="keyword", max_chars=4)
    assert result.evidence == ()
    assert result.trimmed_for_budget


def test_chunk_cap_and_cross_document_inputs_are_rejected():
    with pytest.raises(RetrievalError, match="DOCUMENT_SCOPE_INVALID"):
        build_chunks([source("s1", "合成甲"), source("s2", "合成乙", version="v2")], index_id="i", profile_key="p")
    with pytest.raises(RetrievalError, match="CONTEXT_BUDGET_EXCEEDED"):
        build_chunks([source("s1", "甲" * 1000001)], index_id="i", profile_key="p")


def test_same_segment_partial_scope_excludes_whole_chunk_before_scoring():
    chunk = build_chunks([source("s1", "PUBLIC SECRET")], index_id="i1", profile_key="p1")[0]
    scope = Scope("alice", "ss", frozenset({"v1"}), frozenset({"s1"}), frozenset({"i1"}), "p1", authorized_ranges=(("s1", 0, 6),))
    assert retrieve([chunk], "SECRET", scope, mode="keyword").evidence == ()
