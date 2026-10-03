"""Freeze ownership, state and least-privilege authentication/claim contracts."""
from alembic import op

revision = "0002_foundation_hardening"
down_revision = "0001_initial_formal_schema"
branch_labels = None
depends_on = None

# Revision-local snapshot: never import mutable application metadata here.
STATES = {
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


def function(name, arguments, returns, body, role="fileaction_auth", language="sql"):
    op.execute(f"CREATE FUNCTION public.{name}({arguments}) RETURNS {returns} "
               f"LANGUAGE {language} SECURITY DEFINER SET search_path = pg_catalog, public "
               f"AS $function$ {body} $function$")
    # Names are unique in this revision; revoke by exact routine name, all overloads.
    types = ", ".join(argument.strip().split(" ", 1)[1] for argument in arguments.split(",")) if arguments else ""
    op.execute(f"REVOKE ALL ON FUNCTION public.{name}({types}) FROM PUBLIC")
    op.execute(f"GRANT EXECUTE ON FUNCTION public.{name}({types}) TO {role}")


def upgrade():
    op.execute("GRANT SELECT ON alembic_version TO fileaction_runtime")
    op.execute("ALTER TABLE auth_sessions ADD CONSTRAINT uq_auth_sessions_user_id UNIQUE(user_id,id)")
    op.execute("ALTER TABLE runs ADD CONSTRAINT fk_run_owner_session FOREIGN KEY(owner_id,auth_session_id) REFERENCES auth_sessions(user_id,id)")
    op.execute("ALTER TABLE document_versions DROP CONSTRAINT fk_document_version_active_index")
    op.execute("ALTER TABLE document_versions ADD CONSTRAINT fk_document_version_active_index FOREIGN KEY(owner_id,id,active_index_id) REFERENCES document_indexes(owner_id,document_version_id,id)")
    op.execute("ALTER TABLE document_indexes ADD CONSTRAINT uq_index_embedding_profile UNIQUE(owner_id,id,embedding_profile_id)")
    op.execute("ALTER TABLE chunk_embeddings ADD CONSTRAINT fk_embedding_index_profile FOREIGN KEY(owner_id,index_id,embedding_profile_id) REFERENCES document_indexes(owner_id,id,embedding_profile_id)")
    for (table, column), values in STATES.items():
        expression = column + " IN (" + ", ".join(repr(value) for value in values) + ")"
        op.execute(f"ALTER TABLE {table} ADD CONSTRAINT ck_{table}_{column} CHECK ({expression})")

    # No arbitrary metadata mutation or content/cleanup-target reads by dispatcher.
    for table in ("runs", "index_jobs", "retention_batches", "blob_cleanup_jobs"):
        op.execute(f"REVOKE ALL ON {table} FROM fileaction_dispatcher")
        op.execute(f"DROP POLICY {table}_dispatch ON {table}")
        state = "state" if table == "retention_batches" else "status"
        op.execute(f"GRANT SELECT(id, owner_id, {state}, created_at) ON {table} TO fileaction_dispatcher")
        op.execute(f"CREATE POLICY {table}_dispatch_read ON {table} FOR SELECT TO fileaction_dispatcher USING(true)")
        running = "retaining" if table == "retention_batches" else "running"
        extra = ", lease_owner = p_worker, lease_until = now() + interval '30 seconds'" if table in ("runs", "index_jobs") else ""
        if table == "index_jobs":
            extra += ", lease_epoch = lease_epoch + 1"
        function(f"fa_claim_{table}", "p_worker text", "TABLE(id uuid, owner_id uuid)", f"""
            WITH candidate AS (
                SELECT t.id FROM public.{table} t WHERE t.{state}='queued'
                  AND length(p_worker) BETWEEN 1 AND 160
                ORDER BY t.created_at,t.id FOR UPDATE SKIP LOCKED LIMIT 1
            ) UPDATE public.{table} t SET {state}='{running}', updated_at=now(){extra}
              FROM candidate c WHERE t.id=c.id RETURNING t.id,t.owner_id
        """, "fileaction_dispatcher")

    for table in ("users", "auth_sessions"):
        op.execute(f"REVOKE ALL ON {table} FROM fileaction_auth")
        op.execute(f"DROP POLICY {table}_authentication ON {table}")
    # Runtime must not offer a second path to password/token mutation.
    op.execute("REVOKE UPDATE ON users, auth_sessions FROM fileaction_runtime")

    function("fa_auth_register", "p_id uuid, p_username text, p_display text, p_password_hash text", "SETOF public.users", """
        INSERT INTO public.users(id,username_normalized,display_name,password_hash)
        VALUES(p_id,p_username,p_display,p_password_hash) RETURNING *
    """)
    function("fa_auth_find_user", "p_username text", "SETOF public.users", """
        SELECT * FROM public.users WHERE username_normalized=p_username
    """)
    function("fa_auth_create_session", "p_id uuid, p_user_id uuid, p_expected_password_hash text, p_token_hash text, p_csrf_hash text, p_expires timestamptz", "SETOF public.auth_sessions", """
        INSERT INTO public.auth_sessions(id,user_id,token_hash,csrf_hash,expires_at,last_seen_at)
        SELECT p_id,u.id,p_token_hash,p_csrf_hash,LEAST(p_expires,now()+interval '7 days'),now()
        FROM public.users u WHERE u.id=p_user_id AND u.password_hash=p_expected_password_hash
          AND u.disabled_at IS NULL AND p_expires>now() FOR UPDATE OF u
        RETURNING *
    """)
    # The token hash is an unguessable capability, supplied only by trusted auth code.
    function("fa_auth_authenticate", "p_token_hash text", "TABLE(session_id uuid,user_id uuid,username_normalized varchar,display_name varchar,revision bigint)", """
        WITH valid AS MATERIALIZED (
          SELECT s.id AS session_id,u.id AS user_id,u.username_normalized,u.display_name,u.revision
          FROM public.auth_sessions s JOIN public.users u ON u.id=s.user_id
          WHERE s.token_hash=p_token_hash AND u.disabled_at IS NULL
            AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '24 hours'
        ), touched AS (
          UPDATE public.auth_sessions s SET last_seen_at=now() FROM valid v
          WHERE s.id=v.session_id AND s.last_seen_at<=now()-interval '5 minutes'
          RETURNING s.id
        ) SELECT * FROM valid
    """)
    function("fa_auth_profile", "p_token_hash text, p_revision bigint, p_display text", "SETOF public.users", """
        UPDATE public.users u SET display_name=p_display,revision=u.revision+1,updated_at=now()
        WHERE u.revision=p_revision AND u.disabled_at IS NULL AND EXISTS(
          SELECT 1 FROM public.auth_sessions s WHERE s.user_id=u.id AND s.token_hash=p_token_hash
          AND s.revoked_at IS NULL AND s.expires_at>now() AND s.last_seen_at>now()-interval '24 hours') RETURNING u.*
    """)
    function("fa_auth_change_password", "p_token_hash text, p_expected_password_hash text, p_new_password_hash text", "TABLE(session_id uuid)", """
        DECLARE target_id uuid;
        BEGIN
          SELECT u.id INTO target_id FROM public.users u JOIN public.auth_sessions s ON s.user_id=u.id
            WHERE s.token_hash=p_token_hash AND s.revoked_at IS NULL AND s.expires_at>now()
            AND s.last_seen_at>now()-interval '24 hours' AND u.disabled_at IS NULL
            AND u.password_hash=p_expected_password_hash FOR UPDATE OF u;
          IF target_id IS NULL THEN RETURN; END IF;
          UPDATE public.users SET password_hash=p_new_password_hash,updated_at=now() WHERE id=target_id;
          RETURN QUERY UPDATE public.auth_sessions SET revoked_at=now()
            WHERE user_id=target_id AND revoked_at IS NULL RETURNING id;
        END
    """, language="plpgsql")
    function("fa_auth_logout", "p_token_hash text", "TABLE(session_id uuid)", """
        UPDATE public.auth_sessions SET revoked_at=now() WHERE token_hash=p_token_hash AND revoked_at IS NULL RETURNING id
    """)


def downgrade():
    raise RuntimeError("权限及约束加固不可自动降级；使用经验证的备份恢复")
