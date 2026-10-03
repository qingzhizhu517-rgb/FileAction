"""正式个人版首版长期数据结构；临时正文只进Redis。"""
from __future__ import annotations

from datetime import datetime, timezone
from uuid import UUID, uuid4

from pgvector.sqlalchemy import Vector
from sqlalchemy import (
    BigInteger, Boolean, CheckConstraint, DateTime, ForeignKey, ForeignKeyConstraint,
    Index, Integer, String, Table, Text, UniqueConstraint, Column, text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID as PGUUID
from sqlalchemy.orm import DeclarativeBase, Mapped, mapped_column


def utcnow() -> datetime:
    return datetime.now(timezone.utc)


class Base(DeclarativeBase):
    pass


class User(Base):
    __tablename__ = "users"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    username_normalized: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    display_name: Mapped[str] = mapped_column(String(200), nullable=False)
    password_hash: Mapped[str] = mapped_column(Text, nullable=False)
    disabled_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=text("now()"))
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=text("now()"))
    revision: Mapped[int] = mapped_column(BigInteger, nullable=False, server_default=text("1"))
    __table_args__ = (CheckConstraint("revision >= 1"),)


class AuthSession(Base):
    __tablename__ = "auth_sessions"
    id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), primary_key=True, default=uuid4)
    user_id: Mapped[UUID] = mapped_column(PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    token_hash: Mapped[str] = mapped_column(String(128), unique=True, nullable=False)
    csrf_hash: Mapped[str] = mapped_column(String(128), nullable=False)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    last_seen_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utcnow, server_default=text("now()"))
    __table_args__ = (Index("ix_auth_sessions_user_expires", "user_id", "expires_at"), UniqueConstraint("user_id", "id", name="uq_auth_sessions_user_id"))


def u(name: str, *columns: Column, constraints: tuple = (), updated: bool = False, revision: bool = False) -> Table:
    """创建有归属业务表；跨资源外键始终含owner_id。"""
    basics = [
        Column("id", PGUUID(as_uuid=True), primary_key=True, default=uuid4),
        Column("owner_id", PGUUID(as_uuid=True), ForeignKey("users.id"), nullable=False),
        Column("created_at", DateTime(timezone=True), nullable=False, server_default=text("now()")),
    ]
    if updated:
        basics.append(Column("updated_at", DateTime(timezone=True), nullable=False, server_default=text("now()")))
    if revision:
        basics.append(Column("revision", BigInteger, nullable=False, server_default=text("1")))
    return Table(name, Base.metadata, *basics, *columns, UniqueConstraint("owner_id", "id"), *constraints)


embedding_profiles = Table(
    "embedding_profiles", Base.metadata,
    Column("id", PGUUID(as_uuid=True), primary_key=True, default=uuid4),
    Column("provider_alias", String(100), nullable=False),
    Column("model", String(200), nullable=False),
    Column("dimensions", Integer, nullable=False),
    Column("distance_metric", String(24), nullable=False),
    Column("config_revision", Integer, nullable=False),
    Column("active", Boolean, nullable=False, server_default=text("false")),
    Column("created_at", DateTime(timezone=True), nullable=False, server_default=text("now()")),
    CheckConstraint("dimensions > 0"),
    CheckConstraint("distance_metric IN ('cosine', 'l2', 'inner_product')"),
    UniqueConstraint("provider_alias", "model", "config_revision"),
)

documents = u("documents",
    Column("name", String(512)), Column("category", String(100)),
    Column("current_version", Integer, nullable=False, server_default=text("1")),
    Column("parse_status", String(24), nullable=False, server_default=text("'pending'")),
    Column("deletion_state", String(24), nullable=False, server_default=text("'active'")),
    Column("redacted_at", DateTime(timezone=True)),
    constraints=(CheckConstraint("current_version >= 1"), CheckConstraint("redacted_at IS NOT NULL OR name IS NOT NULL")), updated=True, revision=True)
Index("ix_documents_owner_updated", documents.c.owner_id, documents.c.updated_at, documents.c.id)

document_versions = u("document_versions",
    Column("document_id", PGUUID(as_uuid=True), nullable=False), Column("version", Integer, nullable=False),
    Column("sha256", String(64)), Column("size_bytes", BigInteger), Column("mime_type", String(128)),
    Column("blob_key", Text), Column("cos_version_id", String(256)),
    Column("extracted_chars", Integer), Column("parse_warnings", JSONB),
    Column("active_index_id", PGUUID(as_uuid=True)), Column("redacted_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "document_id"], ["documents.owner_id", "documents.id"]),
                 UniqueConstraint("owner_id", "document_id", "version"),
                 CheckConstraint("version >= 1"), CheckConstraint("size_bytes >= 0"),
                 CheckConstraint("redacted_at IS NOT NULL OR (sha256 IS NOT NULL AND blob_key IS NOT NULL)")))

document_segments = u("document_segments",
    Column("document_version_id", PGUUID(as_uuid=True), nullable=False), Column("ordinal", Integer, nullable=False),
    Column("locator_json", JSONB), Column("text", Text), Column("text_hash", String(64)),
    Column("char_count", Integer), Column("redacted_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "document_version_id"], ["document_versions.owner_id", "document_versions.id"]),
                 UniqueConstraint("owner_id", "document_version_id", "ordinal"),
                 UniqueConstraint("owner_id", "document_version_id", "id"),
                 CheckConstraint("char_count >= 0"), CheckConstraint("redacted_at IS NOT NULL OR text IS NOT NULL")))

document_indexes = u("document_indexes",
    Column("document_version_id", PGUUID(as_uuid=True), nullable=False),
    Column("index_version", Integer, nullable=False), Column("parser_version", String(80), nullable=False),
    Column("chunker_version", String(80), nullable=False),
    Column("embedding_profile_id", PGUUID(as_uuid=True), ForeignKey("embedding_profiles.id"), nullable=False),
    Column("status", String(24), nullable=False), Column("consent_id", PGUUID(as_uuid=True)),
    Column("content_hash", String(64), nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "document_version_id"], ["document_versions.owner_id", "document_versions.id"]),
                 UniqueConstraint("owner_id", "document_version_id", "index_version"),
                 UniqueConstraint("owner_id", "document_version_id", "id"),
                 CheckConstraint("index_version >= 1")), updated=True)

document_chunks = u("document_chunks",
    Column("index_id", PGUUID(as_uuid=True), nullable=False),
    Column("document_version_id", PGUUID(as_uuid=True), nullable=False),
    Column("ordinal", Integer, nullable=False), Column("text", Text),
    Column("text_hash", String(64)), Column("char_count", Integer), Column("redacted_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "document_version_id", "index_id"], ["document_indexes.owner_id", "document_indexes.document_version_id", "document_indexes.id"]),
                 UniqueConstraint("owner_id", "index_id", "ordinal"),
                 UniqueConstraint("owner_id", "index_id", "id"),
                 UniqueConstraint("owner_id", "index_id", "document_version_id", "id"),
                 CheckConstraint("ordinal >= 0"), CheckConstraint("char_count >= 0"),
                 CheckConstraint("redacted_at IS NOT NULL OR text IS NOT NULL")))

chunk_segments = u("chunk_segments",
    Column("chunk_id", PGUUID(as_uuid=True), nullable=False), Column("index_id", PGUUID(as_uuid=True), nullable=False),
    Column("document_version_id", PGUUID(as_uuid=True), nullable=False),
    Column("segment_id", PGUUID(as_uuid=True), nullable=False),
    Column("char_start", Integer, nullable=False), Column("char_end", Integer, nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "index_id", "document_version_id", "chunk_id"], ["document_chunks.owner_id", "document_chunks.index_id", "document_chunks.document_version_id", "document_chunks.id"]),
                 ForeignKeyConstraint(["owner_id", "document_version_id", "segment_id"], ["document_segments.owner_id", "document_segments.document_version_id", "document_segments.id"]),
                 UniqueConstraint("owner_id", "chunk_id", "segment_id"),
                 CheckConstraint("char_start >= 0 AND char_end > char_start")))

chunk_embeddings = u("chunk_embeddings",
    Column("chunk_id", PGUUID(as_uuid=True), nullable=False), Column("index_id", PGUUID(as_uuid=True), nullable=False),
    Column("embedding_profile_id", PGUUID(as_uuid=True), ForeignKey("embedding_profiles.id"), nullable=False),
    Column("embedding", Vector(), nullable=False), Column("text_hash", String(64), nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "index_id", "chunk_id"], ["document_chunks.owner_id", "document_chunks.index_id", "document_chunks.id"]),
                 UniqueConstraint("owner_id", "chunk_id")))

workspaces = u("workspaces",
    Column("title", String(300), nullable=False), Column("goal", Text),
    Column("status", String(24), nullable=False, server_default=text("'active'")),
    Column("retained_at", DateTime(timezone=True)), Column("last_activity_at", DateTime(timezone=True)),
    constraints=(CheckConstraint("status IN ('active', 'paused', 'ended')"), CheckConstraint("revision >= 1")),
    updated=True, revision=True)
Index("ix_workspaces_owner_updated", workspaces.c.owner_id, workspaces.c.updated_at, workspaces.c.id)

workspace_documents = u("workspace_documents",
    Column("workspace_id", PGUUID(as_uuid=True), nullable=False),
    Column("document_version_id", PGUUID(as_uuid=True), nullable=False),
    Column("position", Integer, nullable=False), Column("selected", Boolean, nullable=False, server_default=text("true")),
    constraints=(ForeignKeyConstraint(["owner_id", "workspace_id"], ["workspaces.owner_id", "workspaces.id"]),
                 ForeignKeyConstraint(["owner_id", "document_version_id"], ["document_versions.owner_id", "document_versions.id"]),
                 UniqueConstraint("owner_id", "workspace_id", "document_version_id")))

messages = u("messages",
    Column("workspace_id", PGUUID(as_uuid=True), nullable=False), Column("sequence", BigInteger, nullable=False),
    Column("role", String(16), nullable=False), Column("text", Text),
    Column("answer_id", PGUUID(as_uuid=True)), Column("supersedes_id", PGUUID(as_uuid=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "workspace_id"], ["workspaces.owner_id", "workspaces.id"]),
                 UniqueConstraint("owner_id", "workspace_id", "sequence"),
                 CheckConstraint("role IN ('user', 'assistant', 'system')")))

context_facts = u("context_facts",
    Column("workspace_id", PGUUID(as_uuid=True), nullable=False),
    Column("current_version", Integer, nullable=False, server_default=text("1")),
    Column("active", Boolean, nullable=False, server_default=text("true")),
    constraints=(ForeignKeyConstraint(["owner_id", "workspace_id"], ["workspaces.owner_id", "workspaces.id"]),
                 CheckConstraint("current_version >= 1")), updated=True)

fact_versions = u("fact_versions",
    Column("fact_id", PGUUID(as_uuid=True), nullable=False), Column("version", Integer, nullable=False),
    Column("text", Text), Column("origin_kind", String(30), nullable=False),
    Column("confirmed_at", DateTime(timezone=True)), Column("consent_to_retain", Boolean, nullable=False, server_default=text("false")),
    Column("provenance_state", String(30), nullable=False),
    Column("redacted_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "fact_id"], ["context_facts.owner_id", "context_facts.id"]),
                 UniqueConstraint("owner_id", "fact_id", "version"),
                 CheckConstraint("version >= 1"), CheckConstraint("redacted_at IS NOT NULL OR text IS NOT NULL")))

fact_evidence = u("fact_evidence",
    Column("fact_version_id", PGUUID(as_uuid=True), nullable=False),
    Column("document_version_id", PGUUID(as_uuid=True), nullable=False),
    Column("segment_id", PGUUID(as_uuid=True), nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "fact_version_id"], ["fact_versions.owner_id", "fact_versions.id"]),
                 ForeignKeyConstraint(["owner_id", "document_version_id", "segment_id"], ["document_segments.owner_id", "document_segments.document_version_id", "document_segments.id"])))

memories = u("memories",
    Column("current_version", Integer, nullable=False, server_default=text("1")),
    Column("active", Boolean, nullable=False, server_default=text("true")),
    Column("valid_from", DateTime(timezone=True)), Column("valid_until", DateTime(timezone=True)),
    constraints=(CheckConstraint("current_version >= 1"),), updated=True)
Index("ix_memories_owner_active", memories.c.owner_id, memories.c.active)

memory_versions = u("memory_versions",
    Column("memory_id", PGUUID(as_uuid=True), nullable=False), Column("version", Integer, nullable=False),
    Column("text", Text), Column("source_fact_version_id", PGUUID(as_uuid=True)),
    Column("provenance_state", String(30), nullable=False), Column("redacted_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "memory_id"], ["memories.owner_id", "memories.id"]),
                 ForeignKeyConstraint(["owner_id", "source_fact_version_id"], ["fact_versions.owner_id", "fact_versions.id"]),
                 UniqueConstraint("owner_id", "memory_id", "version"),
                 CheckConstraint("version >= 1"), CheckConstraint("redacted_at IS NOT NULL OR text IS NOT NULL")))

workspace_memories = u("workspace_memories",
    Column("workspace_id", PGUUID(as_uuid=True), nullable=False),
    Column("memory_version_id", PGUUID(as_uuid=True), nullable=False),
    Column("confirmed_at", DateTime(timezone=True), nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "workspace_id"], ["workspaces.owner_id", "workspaces.id"]),
                 ForeignKeyConstraint(["owner_id", "memory_version_id"], ["memory_versions.owner_id", "memory_versions.id"]),
                 UniqueConstraint("owner_id", "workspace_id", "memory_version_id")))

runs = u("runs",
    Column("workspace_id", PGUUID(as_uuid=True)), Column("temporary_ref", String(160)),
    Column("auth_session_id", PGUUID(as_uuid=True), nullable=False),
    Column("kind", String(30), nullable=False), Column("status", String(30), nullable=False),
    Column("manifest_hash", String(64), nullable=False), Column("expected_revision", BigInteger, nullable=False),
    Column("idempotency_key", String(160), nullable=False), Column("lease_owner", String(160)),
    Column("lease_until", DateTime(timezone=True)), Column("error_code", String(64)),
    constraints=(ForeignKeyConstraint(["owner_id", "workspace_id"], ["workspaces.owner_id", "workspaces.id"]),
                 UniqueConstraint("owner_id", "idempotency_key"),
                 CheckConstraint("(workspace_id IS NULL) <> (temporary_ref IS NULL)")), updated=True)
Index("ix_runs_owner_status_created", runs.c.owner_id, runs.c.status, runs.c.created_at)

run_manifests = u("run_manifests",
    Column("run_id", PGUUID(as_uuid=True), nullable=False), Column("header_json", JSONB, nullable=False),
    Column("content_ref", String(160), nullable=False), Column("prompt_version", String(80), nullable=False),
    Column("retention_mode", String(16), nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 UniqueConstraint("owner_id", "run_id")))

run_documents = u("run_documents",
    Column("run_id", PGUUID(as_uuid=True), nullable=False),
    Column("document_version_id", PGUUID(as_uuid=True), nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 ForeignKeyConstraint(["owner_id", "document_version_id"], ["document_versions.owner_id", "document_versions.id"]),
                 UniqueConstraint("owner_id", "run_id", "document_version_id")))

run_facts = u("run_facts",
    Column("run_id", PGUUID(as_uuid=True), nullable=False),
    Column("fact_version_id", PGUUID(as_uuid=True)), Column("memory_version_id", PGUUID(as_uuid=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 ForeignKeyConstraint(["owner_id", "fact_version_id"], ["fact_versions.owner_id", "fact_versions.id"]),
                 ForeignKeyConstraint(["owner_id", "memory_version_id"], ["memory_versions.owner_id", "memory_versions.id"]),
                 CheckConstraint("(fact_version_id IS NULL) <> (memory_version_id IS NULL)")))

run_events = u("run_events",
    Column("run_id", PGUUID(as_uuid=True), nullable=False), Column("seq", BigInteger, nullable=False),
    Column("type", String(40), nullable=False), Column("phase", String(40)),
    Column("occurred_at", DateTime(timezone=True), nullable=False, server_default=text("now()")),
    Column("safe_payload", JSONB, nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 UniqueConstraint("owner_id", "run_id", "seq"), CheckConstraint("seq >= 0")))

model_calls = u("model_calls",
    Column("run_id", PGUUID(as_uuid=True), nullable=False), Column("call_no", Integer, nullable=False),
    Column("state", String(24), nullable=False), Column("request_fingerprint", String(64), nullable=False),
    Column("response_ref", String(160)), Column("usage_json", JSONB),
    Column("started_at", DateTime(timezone=True)), Column("finished_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 UniqueConstraint("owner_id", "run_id", "call_no"), CheckConstraint("call_no >= 1")))

answers = u("answers",
    Column("workspace_id", PGUUID(as_uuid=True), nullable=False),
    Column("run_id", PGUUID(as_uuid=True), nullable=False), Column("envelope_json", JSONB),
    Column("validity", String(24), nullable=False),
    Column("generated_at", DateTime(timezone=True), nullable=False), Column("redacted_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "workspace_id"], ["workspaces.owner_id", "workspaces.id"]),
                 ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 UniqueConstraint("owner_id", "run_id"),
                 CheckConstraint("redacted_at IS NOT NULL OR envelope_json IS NOT NULL")))

actions = u("actions",
    Column("workspace_id", PGUUID(as_uuid=True), nullable=False), Column("title", String(300), nullable=False),
    Column("description", Text), Column("status", String(24), nullable=False),
    Column("priority", String(16)), Column("due_at", DateTime(timezone=True)),
    Column("proposal_key", String(160)), Column("confirmed_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "workspace_id"], ["workspaces.owner_id", "workspaces.id"]),
                 UniqueConstraint("owner_id", "workspace_id", "proposal_key"),
                 CheckConstraint("revision >= 1")), updated=True, revision=True)

action_sources = u("action_sources",
    Column("action_id", PGUUID(as_uuid=True), nullable=False),
    Column("answer_id", PGUUID(as_uuid=True), nullable=False), Column("claim_id", String(100), nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "action_id"], ["actions.owner_id", "actions.id"]),
                 ForeignKeyConstraint(["owner_id", "answer_id"], ["answers.owner_id", "answers.id"])))

artifacts = u("artifacts",
    Column("workspace_id", PGUUID(as_uuid=True), nullable=False),
    Column("kind", String(40), nullable=False), Column("title", String(300), nullable=False),
    Column("current_version", Integer, nullable=False, server_default=text("1")),
    constraints=(ForeignKeyConstraint(["owner_id", "workspace_id"], ["workspaces.owner_id", "workspaces.id"]),
                 CheckConstraint("current_version >= 1 AND revision >= 1")), updated=True, revision=True)
Index("ix_artifacts_owner_workspace_updated", artifacts.c.owner_id, artifacts.c.workspace_id, artifacts.c.updated_at)

artifact_versions = u("artifact_versions",
    Column("artifact_id", PGUUID(as_uuid=True), nullable=False), Column("version", Integer, nullable=False),
    Column("body", Text), Column("body_hash", String(64)),
    Column("author_kind", String(16), nullable=False), Column("run_id", PGUUID(as_uuid=True)),
    Column("validity", String(24), nullable=False), Column("edited_at", DateTime(timezone=True)),
    Column("redacted_at", DateTime(timezone=True)),
    constraints=(ForeignKeyConstraint(["owner_id", "artifact_id"], ["artifacts.owner_id", "artifacts.id"]),
                 ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 UniqueConstraint("owner_id", "artifact_id", "version"), CheckConstraint("version >= 1"),
                 CheckConstraint("redacted_at IS NOT NULL OR body IS NOT NULL")))

consents = u("consents",
    Column("operation", String(40), nullable=False), Column("manifest_hash", String(64), nullable=False),
    Column("resource_revision", BigInteger), Column("retention_mode", String(24), nullable=False),
    Column("confirmed_at", DateTime(timezone=True), nullable=False))

index_jobs = u("index_jobs",
    Column("auth_session_id", PGUUID(as_uuid=True)), Column("manifest_json", JSONB),
    Column("reserved_chunks", Integer, nullable=False, server_default=text("0")),
    Column("reserved_bytes", BigInteger, nullable=False, server_default=text("0")),
    Column("completed_chunks", Integer, nullable=False, server_default=text("0")),
    Column("started_at", DateTime(timezone=True)),
    Column("document_version_id", PGUUID(as_uuid=True)), Column("temporary_ref", String(160)),
    Column("index_ref", String(160), nullable=False), Column("consent_id", PGUUID(as_uuid=True), nullable=False),
    Column("status", String(24), nullable=False), Column("idempotency_key", String(160), nullable=False),
    Column("request_hash", String(64), nullable=False), Column("lease_owner", String(160)),
    Column("lease_epoch", BigInteger, nullable=False, server_default=text("0")),
    Column("lease_until", DateTime(timezone=True)), Column("error_code", String(64)),
    constraints=(ForeignKeyConstraint(["owner_id", "document_version_id"], ["document_versions.owner_id", "document_versions.id"]),
                 ForeignKeyConstraint(["owner_id", "consent_id"], ["consents.owner_id", "consents.id"]),
                 UniqueConstraint("owner_id", "idempotency_key"),
                 CheckConstraint("(document_version_id IS NULL) <> (temporary_ref IS NULL)"),
                 CheckConstraint("lease_epoch >= 0")), updated=True)
index_jobs.append_constraint(ForeignKeyConstraint(["owner_id","auth_session_id"],["auth_sessions.user_id","auth_sessions.id"],name="fk_index_job_session"))
index_jobs.append_constraint(CheckConstraint("reserved_chunks BETWEEN 0 AND 256 AND reserved_bytes>=0 AND completed_chunks BETWEEN 0 AND reserved_chunks",name="ck_index_job_capacity"))

embedding_calls = u("embedding_calls",
    Column("index_job_id", PGUUID(as_uuid=True)), Column("run_id", PGUUID(as_uuid=True)),
    Column("batch_no", Integer, nullable=False), Column("request_hash", String(64), nullable=False),
    Column("content_ref", String(160), nullable=False), Column("response_ref", String(160)),
    Column("state", String(24), nullable=False), Column("usage_json", JSONB),
    constraints=(ForeignKeyConstraint(["owner_id", "index_job_id"], ["index_jobs.owner_id", "index_jobs.id"]),
                 ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 CheckConstraint("(index_job_id IS NULL) <> (run_id IS NULL)"),
                 CheckConstraint("batch_no >= 0")), updated=True)

run_retrievals = u("run_retrievals",
    Column("run_id", PGUUID(as_uuid=True), nullable=False), Column("step_no", Integer, nullable=False),
    Column("mode", String(24), nullable=False), Column("index_refs", JSONB, nullable=False),
    Column("scope_hash", String(64), nullable=False), Column("query_ref", String(160), nullable=False),
    Column("result_ref", String(160), nullable=False),
    constraints=(ForeignKeyConstraint(["owner_id", "run_id"], ["runs.owner_id", "runs.id"]),
                 UniqueConstraint("owner_id", "run_id", "step_no"), CheckConstraint("step_no >= 0")))

retention_batches = u("retention_batches",
    Column("workspace_ref", String(160), nullable=False), Column("expected_revision", BigInteger, nullable=False),
    Column("state", String(24), nullable=False), Column("idempotency_key", String(160), nullable=False),
    Column("scope_hash", String(64)), Column("manifest_json", JSONB), Column("failure_code", String(64)),
    Column("compensation_json", JSONB), Column("completed_at", DateTime(timezone=True)),
    constraints=(UniqueConstraint("owner_id", "idempotency_key"),), updated=True)

blob_cleanup_jobs = u("blob_cleanup_jobs",
    Column("exact_blob_key", Text, nullable=False), Column("cos_version_id", String(256)),
    Column("reason", String(100), nullable=False), Column("status", String(24), nullable=False),
    Column("attempts", Integer, nullable=False, server_default=text("0")),
    Column("reserved_bytes", BigInteger, nullable=False, server_default=text("0")),
    Column("reserved_files", Integer, nullable=False, server_default=text("0")),
    constraints=(CheckConstraint("attempts >= 0"), CheckConstraint("reserved_bytes >= 0"), CheckConstraint("reserved_files >= 0")), updated=True)

# 活动指针与回答/消息交叉引用在所有表声明后补齐。
document_versions.append_constraint(ForeignKeyConstraint(
    ["owner_id", "id", "active_index_id"], ["document_indexes.owner_id", "document_indexes.document_version_id", "document_indexes.id"],
    use_alter=True, name="fk_document_version_active_index"))
messages.append_constraint(ForeignKeyConstraint(
    ["owner_id", "answer_id"], ["answers.owner_id", "answers.id"],
    use_alter=True, name="fk_message_answer"))
messages.append_constraint(ForeignKeyConstraint(
    ["owner_id", "supersedes_id"], ["messages.owner_id", "messages.id"],
    use_alter=True, name="fk_message_supersedes"))

# 数据库状态合同；增改时使用新迁移，既有迁移不导入此可变映射。
STATE_CONTRACTS = {
    ("documents", "parse_status"): ("pending", "uploading", "parsing", "ready", "failed", "deleting", "deleted"),
    ("documents", "deletion_state"): ("active", "deleting", "deleted"),
    ("document_indexes", "status"): ("not_requested", "queued", "embedding", "ready", "failed", "cancelled", "stale", "deleted"),
    ("runs", "status"): ("queued", "running", "succeeded", "failed", "cancelled", "stale", "interrupted"),
    ("index_jobs", "status"): ("queued", "running", "succeeded", "failed", "cancelled", "stale", "interrupted"),
    ("answers", "validity"): ("current", "stale", "source_deleted"),
    ("artifact_versions", "validity"): ("current", "stale", "source_deleted"),
    ("actions", "status"): ("proposed", "confirmed", "in_progress", "draft_ready", "paused", "completed", "deleted"),
    ("model_calls", "state"): ("prepared", "sent", "received", "committed", "interrupted"),
    ("embedding_calls", "state"): ("prepared", "sent", "received", "committed", "interrupted"),
    ("retention_batches", "state"): ("queued", "retaining", "ready", "failed", "cancelled"),
    ("blob_cleanup_jobs", "status"): ("queued", "running", "succeeded", "failed", "uploading", "attached", "pending", "complete"),
}
for (table_name, column_name), values in STATE_CONTRACTS.items():
    expression = column_name + " IN (" + ", ".join(repr(value) for value in values) + ")"
    Base.metadata.tables[table_name].append_constraint(CheckConstraint(expression, name=f"ck_{table_name}_{column_name}"))

document_indexes.append_constraint(UniqueConstraint("owner_id", "id", "embedding_profile_id", name="uq_index_embedding_profile"))
chunk_embeddings.append_constraint(ForeignKeyConstraint(
    ["owner_id", "index_id", "embedding_profile_id"],
    ["document_indexes.owner_id", "document_indexes.id", "document_indexes.embedding_profile_id"], name="fk_embedding_index_profile"))
runs.append_constraint(ForeignKeyConstraint(
    ["owner_id", "auth_session_id"], ["auth_sessions.user_id", "auth_sessions.id"], name="fk_run_owner_session"))
