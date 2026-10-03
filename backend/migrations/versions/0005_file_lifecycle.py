"""File lifecycle metadata CAS, upload reservations and exact cleanup accounting."""
from alembic import op

revision = "0005_file_lifecycle"
down_revision = "0004_indexing_pipeline"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE blob_cleanup_jobs ADD COLUMN reserved_bytes bigint NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE blob_cleanup_jobs ADD COLUMN reserved_files integer NOT NULL DEFAULT 0")
    op.execute("ALTER TABLE blob_cleanup_jobs ADD CONSTRAINT ck_blob_cleanup_jobs_reservation CHECK(reserved_bytes >= 0 AND reserved_files >= 0)")
    op.execute("CREATE INDEX ix_blob_cleanup_jobs_owner_status ON blob_cleanup_jobs(owner_id,status,created_at)")


def downgrade():
    raise RuntimeError("文件生命周期迁移不可自动降级；使用经验证的备份恢复")
