"""Freeze retention scopes and require an explicit background-retention consent."""
from alembic import op


revision = "0006_retention_and_memories"
down_revision = "0005_file_lifecycle"
branch_labels = None
depends_on = None


def upgrade():
    # 0001-0005 are frozen.  These columns make a retaining batch auditable and
    # let recovery compensate exact COS versions without touching Redis input.
    op.execute("ALTER TABLE retention_batches ADD COLUMN scope_hash varchar(64)")
    op.execute("ALTER TABLE retention_batches ADD COLUMN manifest_json jsonb")
    op.execute("ALTER TABLE retention_batches ADD COLUMN failure_code varchar(64)")
    op.execute("ALTER TABLE retention_batches ADD COLUMN compensation_json jsonb")
    op.execute("ALTER TABLE retention_batches ADD COLUMN completed_at timestamptz")
    op.execute("ALTER TABLE fact_versions ADD COLUMN consent_to_retain boolean NOT NULL DEFAULT false")
    op.execute("CREATE UNIQUE INDEX uq_retention_batches_owner_scope ON retention_batches(owner_id, scope_hash) WHERE scope_hash IS NOT NULL")
    op.execute("CREATE INDEX ix_retention_batches_owner_state ON retention_batches(owner_id, state, updated_at, id)")


def downgrade():
    raise RuntimeError("保留与独立背景迁移不可自动降级；使用经验证的备份恢复")
