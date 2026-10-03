"""Initial PostgreSQL/pgvector schema with role and RLS isolation."""
from __future__ import annotations

from pathlib import Path
from hashlib import sha256

from alembic import context, op

revision = "0001_initial_formal_schema"
down_revision = None
branch_labels = None
depends_on = None

_SEPARATOR = "-- FILEACTION STATEMENT --"
_TENANT_TABLES = (
    "documents", "document_versions", "document_segments", "document_indexes",
    "document_chunks", "chunk_segments", "chunk_embeddings", "index_jobs",
    "embedding_calls", "run_retrievals", "workspaces", "workspace_documents",
    "messages", "context_facts", "fact_versions", "fact_evidence",
    "memories", "memory_versions", "workspace_memories", "answers",
    "actions", "action_sources", "artifacts", "artifact_versions",
    "runs", "run_manifests", "run_documents", "run_facts",
    "run_events", "model_calls", "consents", "retention_batches",
    "blob_cleanup_jobs",
)
_DISPATCH_TABLES = ("runs", "index_jobs", "retention_batches", "blob_cleanup_jobs")


def _dimension() -> int | None:
    raw = context.get_x_argument(as_dictionary=True).get("embedding_dimensions")
    if raw is None:
        if not context.is_offline_mode():
            raise ValueError("在线迁移需要 -x embedding_dimensions=<已验证维度>")
        return None
    if not raw.isdecimal() or not 1 <= int(raw) <= 16000:
        raise ValueError("embedding_dimensions 必须为明确验证的 1..16000 整数")
    return int(raw)


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS vector")
    asset = (Path(__file__).resolve().parents[1] / "initial_schema.sql").read_bytes()
    if sha256(asset).hexdigest() != "2010bda3fda0cee6a9cfe9bfc443ec418e355513a95901c52779026618154072":
        raise RuntimeError("0001 initial_schema.sql 完整性校验失败；使用新修订变更 Schema")
    sql = asset.decode("utf-8")
    for statement in sql.split(_SEPARATOR):
        if statement.strip():
            op.execute(statement.strip())

    dimension = _dimension()
    if dimension is not None:
        op.execute(
            f"ALTER TABLE chunk_embeddings ADD CONSTRAINT ck_chunk_embeddings_dimension "
            f"CHECK (vector_dims(embedding) = {dimension})"
        )
        op.execute(
            "ALTER TABLE embedding_profiles ADD CONSTRAINT ck_embedding_profile_migration_dimension "
            f"CHECK (dimensions = {dimension})"
        )

    for role in ("fileaction_runtime", "fileaction_auth", "fileaction_dispatcher"):
        op.execute(
            "DO $$ BEGIN IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = '" + role + "') THEN "
            "CREATE ROLE " + role + " NOLOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS; "
            "END IF; END $$"
        )
        op.execute(f"GRANT USAGE ON SCHEMA public TO {role}")
    # Login roles receive only explicitly assigned group memberships during deployment.
    for table in _TENANT_TABLES:
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_owner ON {table} TO fileaction_runtime "
            "USING (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid) "
            "WITH CHECK (owner_id = NULLIF(current_setting('app.user_id', true), '')::uuid)"
        )
        op.execute(f"GRANT SELECT, INSERT, UPDATE, DELETE ON {table} TO fileaction_runtime")
    for table in _DISPATCH_TABLES:
        op.execute(f"CREATE POLICY {table}_dispatch ON {table} TO fileaction_dispatcher USING (true) WITH CHECK (true)")
        op.execute(f"GRANT SELECT, UPDATE ON {table} TO fileaction_dispatcher")

    for table, expression in (("users", "id"), ("auth_sessions", "user_id")):
        op.execute(f"ALTER TABLE {table} ENABLE ROW LEVEL SECURITY")
        op.execute(f"ALTER TABLE {table} FORCE ROW LEVEL SECURITY")
        op.execute(
            f"CREATE POLICY {table}_self ON {table} TO fileaction_runtime "
            f"USING ({expression} = NULLIF(current_setting('app.user_id', true), '')::uuid) "
            f"WITH CHECK ({expression} = NULLIF(current_setting('app.user_id', true), '')::uuid)"
        )
        op.execute(f"CREATE POLICY {table}_authentication ON {table} TO fileaction_auth USING (true) WITH CHECK (true)")
        op.execute(f"GRANT SELECT, UPDATE ON {table} TO fileaction_runtime")
        op.execute(f"GRANT SELECT, INSERT, UPDATE ON {table} TO fileaction_auth")
    op.execute("GRANT SELECT ON embedding_profiles TO fileaction_runtime, fileaction_auth, fileaction_dispatcher")


def downgrade() -> None:
    raise RuntimeError("初始正式库迁移不可自动降级；使用经验证的备份恢复")
