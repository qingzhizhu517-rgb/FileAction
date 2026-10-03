"""真实隔离 PostgreSQL 回归；所有测试数据均为合成且事务回滚。"""
import os
from uuid import uuid4

import psycopg
import pytest
from sqlalchemy import CheckConstraint

from fileaction.db.models import Base


@pytest.fixture
def pg():
    dsn = os.environ.get('FILEACTION_TEST_ADMIN_DATABASE_URL')
    if not dsn:
        pytest.skip('需要显式合成 PostgreSQL 测试库')
    with psycopg.connect(dsn.replace('postgresql+psycopg://', 'postgresql://')) as conn:
        try:
            yield conn
        finally:
            conn.rollback()


def test_metadata_binds_version_profile_and_session_owner():
    expected = {
        'document_versions': ('owner_id', 'id', 'active_index_id'),
        'chunk_embeddings': ('owner_id', 'index_id', 'embedding_profile_id'),
        'runs': ('owner_id', 'auth_session_id'),
    }
    for name, keys in expected.items():
        assert keys in {tuple(f.column_keys) for f in Base.metadata.tables[name].foreign_key_constraints}


@pytest.mark.parametrize('table,column', [('documents','parse_status'), ('documents','deletion_state'),
    ('document_indexes','status'), ('runs','status'), ('actions','status'), ('answers','validity'),
    ('index_jobs','status'), ('model_calls','state'), ('embedding_calls','state'),
    ('retention_batches','state'), ('blob_cleanup_jobs','status')])
def test_metadata_enforces_state_contract(table, column):
    assert any(column + ' IN' in str(c.sqltext) for c in Base.metadata.tables[table].constraints if isinstance(c, CheckConstraint))


def test_runtime_can_read_migration_version(pg):
    pg.execute('SET LOCAL ROLE fileaction_runtime')
    assert pg.execute('SELECT version_num FROM alembic_version').fetchone()


@pytest.mark.parametrize('role,table,column,privilege', [
    ('fileaction_dispatcher','runs','owner_id','UPDATE'),
    ('fileaction_dispatcher','runs','manifest_hash','UPDATE'),
    ('fileaction_dispatcher','index_jobs','temporary_ref','SELECT'),
    ('fileaction_dispatcher','blob_cleanup_jobs','exact_blob_key','UPDATE'),
    ('fileaction_dispatcher','blob_cleanup_jobs','exact_blob_key','SELECT'),
    ('fileaction_auth','users','password_hash','UPDATE'),
    ('fileaction_auth','auth_sessions','token_hash','UPDATE'),
])
def test_roles_cannot_access_arbitrary_sensitive_columns(pg, role, table, column, privilege):
    assert pg.execute('SELECT has_column_privilege(%s,%s,%s,%s)', (role,table,column,privilege)).fetchone() == (False,)


def synthetic_resources(pg):
    owner, other, doc, va, vb, profile, profile2, idx, chunk, session = [uuid4() for _ in range(10)]
    for uid in (owner, other):
        pg.execute("INSERT INTO users(id,username_normalized,display_name,password_hash) VALUES(%s,%s,'synthetic','synthetic')", (uid,str(uid)))
    pg.execute("INSERT INTO auth_sessions(id,user_id,token_hash,csrf_hash,expires_at) VALUES(%s,%s,%s,'synthetic',now()+interval '1 day')", (session,other,str(session)))
    pg.execute("INSERT INTO documents(id,owner_id,name) VALUES(%s,%s,'synthetic')", (doc,owner))
    for version_id, version in ((va,1),(vb,2)):
        pg.execute("INSERT INTO document_versions(id,owner_id,document_id,version,sha256,blob_key) VALUES(%s,%s,%s,%s,'synthetic','synthetic')", (version_id,owner,doc,version))
    for pid in (profile,profile2):
        pg.execute("INSERT INTO embedding_profiles(id,provider_alias,model,dimensions,distance_metric,config_revision) VALUES(%s,%s,'synthetic',768,'cosine',1)", (pid,str(pid)))
    pg.execute("INSERT INTO document_indexes(id,owner_id,document_version_id,index_version,parser_version,chunker_version,embedding_profile_id,status,content_hash) VALUES(%s,%s,%s,1,'synthetic','synthetic',%s,'ready','synthetic')", (idx,owner,va,profile))
    pg.execute("INSERT INTO document_chunks(id,owner_id,index_id,document_version_id,ordinal,text) VALUES(%s,%s,%s,%s,0,'synthetic')", (chunk,owner,idx,va))
    return owner, va, vb, profile2, idx, chunk, session


def test_pg_rejects_active_index_from_other_version(pg):
    owner, va, vb, _, idx, _, _ = synthetic_resources(pg)
    pg.execute('UPDATE document_versions SET active_index_id=%s WHERE id=%s', (idx,va))
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        pg.execute('UPDATE document_versions SET active_index_id=%s WHERE id=%s', (idx,vb))


def test_pg_rejects_embedding_profile_mismatch(pg):
    owner, _, _, profile, idx, chunk, _ = synthetic_resources(pg)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        pg.execute("INSERT INTO chunk_embeddings(id,owner_id,index_id,chunk_id,embedding_profile_id,embedding,text_hash) VALUES(%s,%s,%s,%s,%s,%s,'synthetic')", (uuid4(),owner,idx,chunk,profile,'['+','.join(['0']*768)+']'))


@pytest.mark.parametrize('missing', [True,False])
def test_pg_rejects_missing_or_other_owner_session(pg, missing):
    owner, _, _, _, _, _, session = synthetic_resources(pg)
    with pytest.raises(psycopg.errors.ForeignKeyViolation):
        pg.execute("INSERT INTO runs(id,owner_id,temporary_ref,auth_session_id,kind,status,manifest_hash,expected_revision,idempotency_key) VALUES(%s,%s,'synthetic',%s,'interpret','queued','synthetic',1,%s)", (uuid4(),owner,uuid4() if missing else session,str(uuid4())))


@pytest.mark.parametrize('column', ['parse_status','deletion_state'])
def test_pg_rejects_unknown_document_state(pg, column):
    owner, *_ = synthetic_resources(pg)
    with pytest.raises(psycopg.errors.CheckViolation):
        pg.execute(psycopg.sql.SQL('UPDATE documents SET {} = %s WHERE owner_id=%s').format(psycopg.sql.Identifier(column)), ('invalid-synthetic',owner))


def test_auth_functions_require_valid_target_capability(pg):
    owner, *_ = synthetic_resources(pg)
    pg.execute('SET LOCAL ROLE fileaction_auth')
    assert pg.execute('SELECT * FROM fa_auth_profile(%s,1,%s)', ('unknown-token','forbidden')).fetchall() == []
    assert pg.execute('SELECT * FROM fa_auth_change_password(%s,%s,%s)', ('unknown-token','synthetic','forbidden')).fetchall() == []
    assert pg.execute('SELECT * FROM fa_auth_create_session(%s,%s,%s,%s,%s,now()+interval \'1 day\')', (uuid4(),owner,'wrong-password-hash',str(uuid4()),'synthetic')).fetchall() == []


def test_auth_functions_only_modify_capability_owner(pg):
    owner, *_ = synthetic_resources(pg)
    session, token = uuid4(), str(uuid4())
    pg.execute('SET LOCAL ROLE fileaction_auth')
    assert pg.execute('SELECT id FROM fa_auth_create_session(%s,%s,%s,%s,%s,now()+interval \'1 day\')', (session,owner,'synthetic',token,'synthetic')).fetchone() == (session,)
    assert pg.execute('SELECT user_id FROM fa_auth_authenticate(%s)', (token,)).fetchone() == (owner,)
    assert pg.execute('SELECT id FROM fa_auth_profile(%s,1,%s)', (token,'synthetic-new')).fetchone() == (owner,)
    assert pg.execute('SELECT * FROM fa_auth_profile(%s,1,%s)', (token,'stale')).fetchall() == []
    assert pg.execute('SELECT session_id FROM fa_auth_change_password(%s,%s,%s)', (token,'synthetic','synthetic-new-hash')).fetchall() == [(session,)]
    assert pg.execute('SELECT * FROM fa_auth_authenticate(%s)', (token,)).fetchall() == []
    pg.execute('RESET ROLE')
    assert pg.execute('SELECT password_hash FROM users WHERE id=%s',(owner,)).fetchone() == ('synthetic-new-hash',)
    assert pg.execute('SELECT count(*) FROM users WHERE password_hash=%s',('forbidden',)).fetchone() == (0,)


def test_dispatcher_claim_is_atomic_and_does_not_expose_target(pg):
    owner, *_ = synthetic_resources(pg)
    job = uuid4()
    pg.execute("INSERT INTO blob_cleanup_jobs(id,owner_id,exact_blob_key,reason,status) VALUES(%s,%s,'synthetic-secret-key','synthetic','queued')",(job,owner))
    pg.execute('SET LOCAL ROLE fileaction_dispatcher')
    assert pg.execute('SELECT * FROM fa_claim_blob_cleanup_jobs(%s)', ('synthetic-worker',)).fetchone() == (job,owner)
    assert pg.execute('SELECT * FROM fa_claim_blob_cleanup_jobs(%s)', ('synthetic-worker',)).fetchall() == []
    with pytest.raises(psycopg.errors.InsufficientPrivilege):
        pg.execute('UPDATE blob_cleanup_jobs SET exact_blob_key=%s WHERE id=%s', ('forbidden',job))


def test_definer_functions_fixed_path_and_no_public_execute(pg):
    rows = pg.execute("SELECT proname,proconfig,has_function_privilege('public',oid,'EXECUTE') FROM pg_proc WHERE pronamespace='public'::regnamespace AND proname LIKE 'fa_%'").fetchall()
    assert len(rows) == 11
    assert all('search_path=pg_catalog, public' in config and not public for _,config,public in rows)


def test_real_runtime_database_readiness():
    import asyncio
    from fileaction.api.readiness import ReadinessProbes
    from fileaction.core.config import Settings
    dsn = os.environ.get('FILEACTION_TEST_DATABASE_URL')
    if not dsn:
        pytest.skip('需要显式 runtime 合成连接')
    # psycopg requires SelectorEventLoop on Windows, as does the API launcher.
    with asyncio.Runner(loop_factory=asyncio.SelectorEventLoop) as runner:
        assert runner.run(ReadinessProbes().database(Settings(database_url=dsn.replace('postgresql://','postgresql+psycopg://'))))


def test_run_claim_uses_thirty_second_lease(pg):
    owner, _, _, _, _, _, session = synthetic_resources(pg)
    pg.execute('UPDATE auth_sessions SET user_id=%s WHERE id=%s', (owner,session))
    run = uuid4()
    pg.execute("INSERT INTO runs(id,owner_id,temporary_ref,auth_session_id,kind,status,manifest_hash,expected_revision,idempotency_key) VALUES(%s,%s,'synthetic',%s,'interpret','queued','synthetic',1,%s)", (run,owner,session,str(run)))
    pg.execute('SET LOCAL ROLE fileaction_dispatcher')
    assert pg.execute('SELECT * FROM fa_claim_runs(%s)', ('synthetic-worker',)).fetchone() == (run,owner)
    pg.execute('RESET ROLE')
    assert pg.execute('SELECT extract(epoch FROM lease_until-now()) FROM runs WHERE id=%s',(run,)).fetchone()[0] == 30


def test_initial_revision_rejects_tampered_sql(tmp_path):
    import shutil
    import subprocess
    import sys
    from pathlib import Path
    backend = Path(__file__).resolve().parents[2]
    shutil.copytree(backend / 'migrations', tmp_path / 'migrations')
    shutil.copy(backend / 'alembic.ini', tmp_path / 'alembic.ini')
    with (tmp_path / 'migrations' / 'initial_schema.sql').open('ab') as stream:
        stream.write(b'\n-- synthetic tampering regression\n')
    result = subprocess.run([sys.executable,'-m','alembic','-c',str(tmp_path / 'alembic.ini'),'upgrade','head','--sql'], env=dict(os.environ,PYTHONPATH=str(backend)), capture_output=True, text=True, encoding='utf-8', errors='replace')
    assert result.returncode != 0
    assert 'RuntimeError' in result.stderr


def test_authenticate_throttles_session_activity_writes(pg):
    owner, _, _, _, _, _, session = synthetic_resources(pg)
    pg.execute("UPDATE auth_sessions SET user_id=%s,last_seen_at=now()-interval '2 minutes' WHERE id=%s",(owner,session))
    before = pg.execute('SELECT last_seen_at FROM auth_sessions WHERE id=%s',(session,)).fetchone()
    pg.execute('SET LOCAL ROLE fileaction_auth')
    assert pg.execute('SELECT user_id FROM fa_auth_authenticate(%s)',(str(session),)).fetchone() == (owner,)
    pg.execute('RESET ROLE')
    assert pg.execute('SELECT last_seen_at FROM auth_sessions WHERE id=%s',(session,)).fetchone() == before


@pytest.mark.parametrize('state', ['uploading','attached','pending','complete'])
def test_existing_upload_journal_states_are_preserved(pg, state):
    owner, *_ = synthetic_resources(pg)
    job = uuid4()
    pg.execute("INSERT INTO blob_cleanup_jobs(id,owner_id,exact_blob_key,reason,status) VALUES(%s,%s,'synthetic-key','upload_intent',%s)", (job,owner,state))
    pg.execute('SET LOCAL ROLE fileaction_dispatcher')
    claimed = pg.execute('SELECT * FROM fa_claim_blob_cleanup_jobs(%s)', ('synthetic-worker',)).fetchall()
    assert claimed == ([(job,owner)] if state == 'pending' else [])
