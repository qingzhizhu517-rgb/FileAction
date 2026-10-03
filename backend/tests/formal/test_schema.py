from pathlib import Path
import subprocess
import sys
from uuid import uuid4
import importlib.util

import pytest

from fileaction.db.models import Base
from fileaction.db.session import ActorContext, tenant_transaction


EXPECTED_TABLES = {
    "users", "auth_sessions", "documents", "document_versions",
    "document_segments", "document_indexes", "document_chunks",
    "chunk_segments", "chunk_embeddings", "embedding_profiles",
    "index_jobs", "embedding_calls", "run_retrievals",
    "workspaces", "workspace_documents", "messages",
    "context_facts", "fact_versions", "fact_evidence",
    "memories", "memory_versions", "workspace_memories",
    "answers", "actions", "action_sources", "artifacts",
    "artifact_versions", "runs", "run_manifests", "run_documents",
    "run_facts", "run_events", "model_calls", "consents",
    "retention_batches", "blob_cleanup_jobs",
}


def test_schema_contains_formal_long_lived_tables_and_owner_keys():
    tables = Base.metadata.tables
    assert EXPECTED_TABLES <= set(tables)
    for name in EXPECTED_TABLES - {"users", "auth_sessions", "embedding_profiles"}:
        assert "owner_id" in tables[name].c, name
    assert "user_id" in tables["auth_sessions"].c


def test_artifact_workspace_foreign_key_binds_owner_and_id():
    artifact = Base.metadata.tables["artifacts"]
    keys = {(tuple(fk.column_keys), fk.referred_table.name) for fk in artifact.foreign_key_constraints}
    assert (("owner_id", "workspace_id"), "workspaces") in keys


def test_chunk_segment_binds_same_owner_and_document_version():
    link = Base.metadata.tables["chunk_segments"]
    keys = {(tuple(fk.column_keys), fk.referred_table.name) for fk in link.foreign_key_constraints}
    assert (("owner_id", "document_version_id", "segment_id"), "document_segments") in keys


def test_actor_context_requires_authenticated_ids():
    actor = ActorContext(user_id=uuid4(), session_id=uuid4())
    assert actor.user_id != actor.session_id
    with pytest.raises((TypeError, ValueError)):
        ActorContext(user_id=None, session_id=uuid4())


def test_tenant_transaction_requires_actor():
    with pytest.raises((TypeError, ValueError)):
        tenant_transaction(None, None)


def test_initial_migration_exists():
    migrations = Path(__file__).resolve().parents[2] / "migrations" / "versions"
    assert (migrations / "0001_initial_formal_schema.py").is_file()
    assert (migrations / "0002_foundation_hardening.py").is_file()


def test_frozen_schema_accepts_git_line_endings_but_rejects_content_changes():
    backend = Path(__file__).resolve().parents[2]
    path = backend / "migrations/versions/0001_initial_formal_schema.py"
    spec = importlib.util.spec_from_file_location("frozen_initial_migration", path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    unix = (backend / "migrations/initial_schema.sql").read_bytes().replace(b"\r\n", b"\n")
    windows = unix.replace(b"\n", b"\r\n")
    assert migration.verified_schema(unix) == migration.verified_schema(windows)
    with pytest.raises(RuntimeError, match="完整性校验失败"):
        migration.verified_schema(unix.replace(b"CREATE TABLE", b"CREATE TEMP TABLE", 1))


def test_offline_migration_contains_vector_rls_and_owner_constraints():
    backend = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "upgrade", "head", "--sql"],
        cwd=backend, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    sql = result.stdout
    assert "CREATE EXTENSION IF NOT EXISTS vector" in sql
    assert "CREATE TABLE chunk_embeddings" in sql
    assert "FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id)" in sql
    assert "FORCE ROW LEVEL SECURITY" in sql
    assert "fileaction_runtime" in sql
    assert "VECTOR(1024)" not in sql


def test_offline_migration_binds_only_explicit_embedding_dimension():
    backend = Path(__file__).resolve().parents[2]
    result = subprocess.run(
        [sys.executable, "-m", "alembic", "-c", "alembic.ini", "-x", "embedding_dimensions=768", "upgrade", "head", "--sql"],
        cwd=backend, capture_output=True, text=True, check=False,
    )
    assert result.returncode == 0, result.stderr
    assert "vector_dims(embedding) = 768" in result.stdout
    assert "dimensions = 768" in result.stdout


def test_real_postgresql_schema_when_explicit_test_database_is_available():
    import os
    import psycopg

    dsn = os.environ.get("FILEACTION_TEST_ADMIN_DATABASE_URL")
    if not dsn:
        pytest.skip("未配置隔离的 FILEACTION_TEST_ADMIN_DATABASE_URL；不使用用户数据库")
    with psycopg.connect(dsn.replace("postgresql+psycopg://", "postgresql://", 1)) as connection:
        with connection.cursor() as cursor:
            cursor.execute("SELECT extname FROM pg_extension WHERE extname = 'vector'")
            assert cursor.fetchone() == ("vector",)
            cursor.execute("SELECT version_num FROM alembic_version")
            assert cursor.fetchone() == ("0007_memory_revision",)
            cursor.execute(
                "SELECT relname FROM pg_class WHERE relname = 'documents' AND relrowsecurity AND relforcerowsecurity"
            )
            assert cursor.fetchone() == ("documents",)


def test_real_postgresql_runtime_rls_isolates_synthetic_owners():
    import os
    import psycopg

    admin_dsn = os.environ.get("FILEACTION_TEST_ADMIN_DATABASE_URL")
    runtime_dsn = os.environ.get("FILEACTION_TEST_DATABASE_URL")
    if not admin_dsn or not runtime_dsn:
        pytest.skip("未配置隔离的 PG 管理与受限运行测试连接")
    admin_dsn = admin_dsn.replace("postgresql+psycopg://", "postgresql://", 1)
    runtime_dsn = runtime_dsn.replace("postgresql+psycopg://", "postgresql://", 1)
    owner_a, owner_b, document_id = uuid4(), uuid4(), uuid4()
    with psycopg.connect(admin_dsn) as admin:
        with admin.cursor() as cursor:
            for user_id in (owner_a, owner_b):
                cursor.execute(
                    "INSERT INTO users (id, username_normalized, display_name, password_hash) "
                    "VALUES (%s, %s, '合成用户', 'synthetic-not-a-real-hash')",
                    (user_id, str(user_id)),
                )
            cursor.execute(
                "INSERT INTO documents (id, owner_id, name) VALUES (%s, %s, '合成通知')",
                (document_id, owner_a),
            )
        admin.commit()
        try:
            with psycopg.connect(runtime_dsn) as runtime:
                with runtime.cursor() as cursor:
                    cursor.execute("SELECT count(*) FROM documents")
                    assert cursor.fetchone() == (0,)
                    cursor.execute("SELECT set_config('app.user_id', %s, true)", (str(owner_b),))
                    cursor.execute("SELECT count(*) FROM documents")
                    assert cursor.fetchone() == (0,)
                    cursor.execute("SELECT set_config('app.user_id', %s, true)", (str(owner_a),))
                    cursor.execute("SELECT id FROM documents")
                    assert cursor.fetchone() == (document_id,)
        finally:
            with admin.cursor() as cursor:
                cursor.execute("DELETE FROM documents WHERE id = %s", (document_id,))
                cursor.execute("DELETE FROM users WHERE id IN (%s, %s)", (owner_a, owner_b))
