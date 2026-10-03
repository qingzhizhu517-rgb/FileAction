"""独立索引授权快照、配额与受限领取；不修改冻结迁移。"""
from alembic import op

revision='0004_indexing_pipeline'
down_revision='0003_upload_journal_states'
branch_labels=None
depends_on=None

def upgrade():
    op.execute('ALTER TABLE index_jobs ADD COLUMN auth_session_id uuid, ADD COLUMN manifest_json jsonb, ADD COLUMN reserved_chunks integer NOT NULL DEFAULT 0, ADD COLUMN reserved_bytes bigint NOT NULL DEFAULT 0, ADD COLUMN completed_chunks integer NOT NULL DEFAULT 0, ADD COLUMN started_at timestamptz')
    op.execute('ALTER TABLE index_jobs ADD CONSTRAINT fk_index_job_session FOREIGN KEY(owner_id,auth_session_id) REFERENCES auth_sessions(user_id,id)')
    op.execute('ALTER TABLE index_jobs ADD CONSTRAINT ck_index_job_capacity CHECK(reserved_chunks BETWEEN 0 AND 256 AND reserved_bytes>=0 AND completed_chunks BETWEEN 0 AND reserved_chunks)')
    op.execute('CREATE UNIQUE INDEX uq_index_batch ON embedding_calls(owner_id,index_job_id,batch_no) WHERE index_job_id IS NOT NULL')
    op.execute('CREATE INDEX ix_index_jobs_owner_status ON index_jobs(owner_id,status)')
    op.execute('DROP FUNCTION public.fa_claim_index_jobs(text)')
    op.execute("""CREATE FUNCTION public.fa_claim_index_jobs(p_worker text)
      RETURNS TABLE(id uuid, owner_id uuid, auth_session_id uuid, lease_epoch bigint)
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=pg_catalog,public AS $f$
      BEGIN
        PERFORM pg_advisory_xact_lock(728934004);
        IF length(p_worker) NOT BETWEEN 1 AND 160 OR (SELECT count(*) FROM public.index_jobs j WHERE j.status='running')>=2 THEN RETURN; END IF;
        RETURN QUERY WITH candidate AS (SELECT j.id FROM public.index_jobs j
          WHERE j.status='queued' AND j.created_at>now()-interval '300 seconds'
            AND NOT EXISTS(SELECT 1 FROM public.index_jobs r WHERE r.owner_id=j.owner_id AND r.status='running')
          ORDER BY j.created_at,j.id FOR UPDATE SKIP LOCKED LIMIT 1)
          UPDATE public.index_jobs j SET status='running',lease_owner=p_worker,lease_epoch=j.lease_epoch+1,
            lease_until=now()+interval '30 seconds',started_at=coalesce(j.started_at,now()),updated_at=now()
          FROM candidate c WHERE j.id=c.id RETURNING j.id,j.owner_id,j.auth_session_id,j.lease_epoch;
      END $f$""")
    op.execute('REVOKE ALL ON FUNCTION public.fa_claim_index_jobs(text) FROM PUBLIC')
    op.execute('GRANT EXECUTE ON FUNCTION public.fa_claim_index_jobs(text) TO fileaction_dispatcher')

def downgrade():
    raise RuntimeError('索引账本不可自动降级；使用经验证的备份恢复')
