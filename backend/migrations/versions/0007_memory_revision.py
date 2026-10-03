"""Give independent backgrounds the revision required by their public contract."""
from alembic import op

revision = "0007_memory_revision"
down_revision = "0006_retention_and_memories"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE memories ADD COLUMN revision bigint NOT NULL DEFAULT 1")
    op.execute("ALTER TABLE memories ADD CONSTRAINT ck_memories_revision CHECK (revision >= 1)")


def downgrade():
    raise RuntimeError("背景版本迁移不可自动降级；使用经验证的备份恢复")
