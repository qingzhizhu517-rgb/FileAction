"""Preserve existing COS upload journal states without claiming uncertain uploads."""
from alembic import op

revision = "0003_upload_journal_states"
down_revision = "0002_foundation_hardening"
branch_labels = None
depends_on = None


def upgrade():
    op.execute("ALTER TABLE blob_cleanup_jobs DROP CONSTRAINT ck_blob_cleanup_jobs_status")
    op.execute("ALTER TABLE blob_cleanup_jobs ADD CONSTRAINT ck_blob_cleanup_jobs_status CHECK "
               "(status IN ('queued','running','succeeded','failed','uploading','attached','pending','complete'))")
    op.execute("""
        CREATE OR REPLACE FUNCTION public.fa_claim_blob_cleanup_jobs(p_worker text)
        RETURNS TABLE(id uuid, owner_id uuid) LANGUAGE sql SECURITY DEFINER
        SET search_path = pg_catalog, public AS $function$
          WITH candidate AS (
            SELECT t.id FROM public.blob_cleanup_jobs t
            WHERE t.status IN ('queued','pending') AND length(p_worker) BETWEEN 1 AND 160
            ORDER BY t.created_at,t.id FOR UPDATE SKIP LOCKED LIMIT 1
          ) UPDATE public.blob_cleanup_jobs t SET status='running',updated_at=now()
            FROM candidate c WHERE t.id=c.id RETURNING t.id,t.owner_id
        $function$
    """)
    op.execute("REVOKE ALL ON FUNCTION public.fa_claim_blob_cleanup_jobs(text) FROM PUBLIC")
    op.execute("GRANT EXECUTE ON FUNCTION public.fa_claim_blob_cleanup_jobs(text) TO fileaction_dispatcher")


def downgrade():
    raise RuntimeError("上传日志状态不可自动降级；使用经验证的备份恢复")
