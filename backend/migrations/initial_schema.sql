CREATE TABLE users (
	id UUID NOT NULL, 
	username_normalized VARCHAR(128) NOT NULL, 
	display_name VARCHAR(200) NOT NULL, 
	password_hash TEXT NOT NULL, 
	disabled_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	revision BIGINT DEFAULT 1 NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (revision >= 1), 
	UNIQUE (username_normalized)
)
-- FILEACTION STATEMENT --
CREATE TABLE embedding_profiles (
	id UUID NOT NULL, 
	provider_alias VARCHAR(100) NOT NULL, 
	model VARCHAR(200) NOT NULL, 
	dimensions INTEGER NOT NULL, 
	distance_metric VARCHAR(24) NOT NULL, 
	config_revision INTEGER NOT NULL, 
	active BOOLEAN DEFAULT false NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (dimensions > 0), 
	CHECK (distance_metric IN ('cosine', 'l2', 'inner_product')), 
	UNIQUE (provider_alias, model, config_revision)
)
-- FILEACTION STATEMENT --
CREATE TABLE auth_sessions (
	id UUID NOT NULL, 
	user_id UUID NOT NULL, 
	token_hash VARCHAR(128) NOT NULL, 
	csrf_hash VARCHAR(128) NOT NULL, 
	expires_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	last_seen_at TIMESTAMP WITH TIME ZONE, 
	revoked_at TIMESTAMP WITH TIME ZONE, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(user_id) REFERENCES users (id), 
	UNIQUE (token_hash)
)
-- FILEACTION STATEMENT --
CREATE INDEX ix_auth_sessions_user_expires ON auth_sessions (user_id, expires_at)
-- FILEACTION STATEMENT --
CREATE TABLE documents (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	revision BIGINT DEFAULT 1 NOT NULL, 
	name VARCHAR(512), 
	category VARCHAR(100), 
	current_version INTEGER DEFAULT 1 NOT NULL, 
	parse_status VARCHAR(24) DEFAULT 'pending' NOT NULL, 
	deletion_state VARCHAR(24) DEFAULT 'active' NOT NULL, 
	redacted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CHECK (current_version >= 1), 
	CHECK (redacted_at IS NOT NULL OR name IS NOT NULL), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE INDEX ix_documents_owner_updated ON documents (owner_id, updated_at, id)
-- FILEACTION STATEMENT --
CREATE TABLE workspaces (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	revision BIGINT DEFAULT 1 NOT NULL, 
	title VARCHAR(300) NOT NULL, 
	goal TEXT, 
	status VARCHAR(24) DEFAULT 'active' NOT NULL, 
	retained_at TIMESTAMP WITH TIME ZONE, 
	last_activity_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CHECK (status IN ('active', 'paused', 'ended')), 
	CHECK (revision >= 1), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE INDEX ix_workspaces_owner_updated ON workspaces (owner_id, updated_at, id)
-- FILEACTION STATEMENT --
CREATE TABLE memories (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	current_version INTEGER DEFAULT 1 NOT NULL, 
	active BOOLEAN DEFAULT true NOT NULL, 
	valid_from TIMESTAMP WITH TIME ZONE, 
	valid_until TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	CHECK (current_version >= 1), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE INDEX ix_memories_owner_active ON memories (owner_id, active)
-- FILEACTION STATEMENT --
CREATE TABLE consents (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	operation VARCHAR(40) NOT NULL, 
	manifest_hash VARCHAR(64) NOT NULL, 
	resource_revision BIGINT, 
	retention_mode VARCHAR(24) NOT NULL, 
	confirmed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE retention_batches (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	workspace_ref VARCHAR(160) NOT NULL, 
	expected_revision BIGINT NOT NULL, 
	state VARCHAR(24) NOT NULL, 
	idempotency_key VARCHAR(160) NOT NULL, 
	PRIMARY KEY (id), 
	UNIQUE (owner_id, idempotency_key), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE blob_cleanup_jobs (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	exact_blob_key TEXT NOT NULL, 
	cos_version_id VARCHAR(256), 
	reason VARCHAR(100) NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	attempts INTEGER DEFAULT 0 NOT NULL, 
	PRIMARY KEY (id), 
	CHECK (attempts >= 0), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE document_versions (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	document_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	sha256 VARCHAR(64), 
	size_bytes BIGINT, 
	mime_type VARCHAR(128), 
	blob_key TEXT, 
	cos_version_id VARCHAR(256), 
	extracted_chars INTEGER, 
	parse_warnings JSONB, 
	active_index_id UUID, 
	redacted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, document_id) REFERENCES documents (owner_id, id), 
	UNIQUE (owner_id, document_id, version), 
	CHECK (version >= 1), 
	CHECK (size_bytes >= 0), 
	CHECK (redacted_at IS NOT NULL OR (sha256 IS NOT NULL AND blob_key IS NOT NULL)), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE messages (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	workspace_id UUID NOT NULL, 
	sequence BIGINT NOT NULL, 
	role VARCHAR(16) NOT NULL, 
	text TEXT, 
	answer_id UUID, 
	supersedes_id UUID, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id), 
	UNIQUE (owner_id, workspace_id, sequence), 
	CHECK (role IN ('user', 'assistant', 'system')), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE context_facts (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	workspace_id UUID NOT NULL, 
	current_version INTEGER DEFAULT 1 NOT NULL, 
	active BOOLEAN DEFAULT true NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id), 
	CHECK (current_version >= 1), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE runs (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	workspace_id UUID, 
	temporary_ref VARCHAR(160), 
	auth_session_id UUID NOT NULL, 
	kind VARCHAR(30) NOT NULL, 
	status VARCHAR(30) NOT NULL, 
	manifest_hash VARCHAR(64) NOT NULL, 
	expected_revision BIGINT NOT NULL, 
	idempotency_key VARCHAR(160) NOT NULL, 
	lease_owner VARCHAR(160), 
	lease_until TIMESTAMP WITH TIME ZONE, 
	error_code VARCHAR(64), 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id), 
	UNIQUE (owner_id, idempotency_key), 
	CHECK ((workspace_id IS NULL) <> (temporary_ref IS NULL)), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE INDEX ix_runs_owner_status_created ON runs (owner_id, status, created_at)
-- FILEACTION STATEMENT --
CREATE TABLE actions (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	revision BIGINT DEFAULT 1 NOT NULL, 
	workspace_id UUID NOT NULL, 
	title VARCHAR(300) NOT NULL, 
	description TEXT, 
	status VARCHAR(24) NOT NULL, 
	priority VARCHAR(16), 
	due_at TIMESTAMP WITH TIME ZONE, 
	proposal_key VARCHAR(160), 
	confirmed_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id), 
	UNIQUE (owner_id, workspace_id, proposal_key), 
	CHECK (revision >= 1), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE artifacts (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	revision BIGINT DEFAULT 1 NOT NULL, 
	workspace_id UUID NOT NULL, 
	kind VARCHAR(40) NOT NULL, 
	title VARCHAR(300) NOT NULL, 
	current_version INTEGER DEFAULT 1 NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id), 
	CHECK (current_version >= 1 AND revision >= 1), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE INDEX ix_artifacts_owner_workspace_updated ON artifacts (owner_id, workspace_id, updated_at)
-- FILEACTION STATEMENT --
CREATE TABLE document_segments (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	document_version_id UUID NOT NULL, 
	ordinal INTEGER NOT NULL, 
	locator_json JSONB, 
	text TEXT, 
	text_hash VARCHAR(64), 
	char_count INTEGER, 
	redacted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, document_version_id) REFERENCES document_versions (owner_id, id), 
	UNIQUE (owner_id, document_version_id, ordinal), 
	UNIQUE (owner_id, document_version_id, id), 
	CHECK (char_count >= 0), 
	CHECK (redacted_at IS NOT NULL OR text IS NOT NULL), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE document_indexes (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	document_version_id UUID NOT NULL, 
	index_version INTEGER NOT NULL, 
	parser_version VARCHAR(80) NOT NULL, 
	chunker_version VARCHAR(80) NOT NULL, 
	embedding_profile_id UUID NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	consent_id UUID, 
	content_hash VARCHAR(64) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, document_version_id) REFERENCES document_versions (owner_id, id), 
	UNIQUE (owner_id, document_version_id, index_version), 
	UNIQUE (owner_id, document_version_id, id), 
	CHECK (index_version >= 1), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id), 
	FOREIGN KEY(embedding_profile_id) REFERENCES embedding_profiles (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE workspace_documents (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	workspace_id UUID NOT NULL, 
	document_version_id UUID NOT NULL, 
	position INTEGER NOT NULL, 
	selected BOOLEAN DEFAULT true NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id), 
	FOREIGN KEY(owner_id, document_version_id) REFERENCES document_versions (owner_id, id), 
	UNIQUE (owner_id, workspace_id, document_version_id), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE fact_versions (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	fact_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	text TEXT, 
	origin_kind VARCHAR(30) NOT NULL, 
	confirmed_at TIMESTAMP WITH TIME ZONE, 
	provenance_state VARCHAR(30) NOT NULL, 
	redacted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, fact_id) REFERENCES context_facts (owner_id, id), 
	UNIQUE (owner_id, fact_id, version), 
	CHECK (version >= 1), 
	CHECK (redacted_at IS NOT NULL OR text IS NOT NULL), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE run_manifests (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	run_id UUID NOT NULL, 
	header_json JSONB NOT NULL, 
	content_ref VARCHAR(160) NOT NULL, 
	prompt_version VARCHAR(80) NOT NULL, 
	retention_mode VARCHAR(16) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	UNIQUE (owner_id, run_id), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE run_documents (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	run_id UUID NOT NULL, 
	document_version_id UUID NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	FOREIGN KEY(owner_id, document_version_id) REFERENCES document_versions (owner_id, id), 
	UNIQUE (owner_id, run_id, document_version_id), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE run_events (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	run_id UUID NOT NULL, 
	seq BIGINT NOT NULL, 
	type VARCHAR(40) NOT NULL, 
	phase VARCHAR(40), 
	occurred_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	safe_payload JSONB NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	UNIQUE (owner_id, run_id, seq), 
	CHECK (seq >= 0), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE model_calls (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	run_id UUID NOT NULL, 
	call_no INTEGER NOT NULL, 
	state VARCHAR(24) NOT NULL, 
	request_fingerprint VARCHAR(64) NOT NULL, 
	response_ref VARCHAR(160), 
	usage_json JSONB, 
	started_at TIMESTAMP WITH TIME ZONE, 
	finished_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	UNIQUE (owner_id, run_id, call_no), 
	CHECK (call_no >= 1), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE answers (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	workspace_id UUID NOT NULL, 
	run_id UUID NOT NULL, 
	envelope_json JSONB, 
	validity VARCHAR(24) NOT NULL, 
	generated_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	redacted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	UNIQUE (owner_id, run_id), 
	CHECK (redacted_at IS NOT NULL OR envelope_json IS NOT NULL), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE artifact_versions (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	artifact_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	body TEXT, 
	body_hash VARCHAR(64), 
	author_kind VARCHAR(16) NOT NULL, 
	run_id UUID, 
	validity VARCHAR(24) NOT NULL, 
	edited_at TIMESTAMP WITH TIME ZONE, 
	redacted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, artifact_id) REFERENCES artifacts (owner_id, id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	UNIQUE (owner_id, artifact_id, version), 
	CHECK (version >= 1), 
	CHECK (redacted_at IS NOT NULL OR body IS NOT NULL), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE index_jobs (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	document_version_id UUID, 
	temporary_ref VARCHAR(160), 
	index_ref VARCHAR(160) NOT NULL, 
	consent_id UUID NOT NULL, 
	status VARCHAR(24) NOT NULL, 
	idempotency_key VARCHAR(160) NOT NULL, 
	request_hash VARCHAR(64) NOT NULL, 
	lease_owner VARCHAR(160), 
	lease_epoch BIGINT DEFAULT 0 NOT NULL, 
	lease_until TIMESTAMP WITH TIME ZONE, 
	error_code VARCHAR(64), 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, document_version_id) REFERENCES document_versions (owner_id, id), 
	FOREIGN KEY(owner_id, consent_id) REFERENCES consents (owner_id, id), 
	UNIQUE (owner_id, idempotency_key), 
	CHECK ((document_version_id IS NULL) <> (temporary_ref IS NULL)), 
	CHECK (lease_epoch >= 0), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE run_retrievals (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	run_id UUID NOT NULL, 
	step_no INTEGER NOT NULL, 
	mode VARCHAR(24) NOT NULL, 
	index_refs JSONB NOT NULL, 
	scope_hash VARCHAR(64) NOT NULL, 
	query_ref VARCHAR(160) NOT NULL, 
	result_ref VARCHAR(160) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	UNIQUE (owner_id, run_id, step_no), 
	CHECK (step_no >= 0), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE document_chunks (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	index_id UUID NOT NULL, 
	document_version_id UUID NOT NULL, 
	ordinal INTEGER NOT NULL, 
	text TEXT, 
	text_hash VARCHAR(64), 
	char_count INTEGER, 
	redacted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, document_version_id, index_id) REFERENCES document_indexes (owner_id, document_version_id, id), 
	UNIQUE (owner_id, index_id, ordinal), 
	UNIQUE (owner_id, index_id, id), 
	UNIQUE (owner_id, index_id, document_version_id, id), 
	CHECK (ordinal >= 0), 
	CHECK (char_count >= 0), 
	CHECK (redacted_at IS NOT NULL OR text IS NOT NULL), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE fact_evidence (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	fact_version_id UUID NOT NULL, 
	document_version_id UUID NOT NULL, 
	segment_id UUID NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, fact_version_id) REFERENCES fact_versions (owner_id, id), 
	FOREIGN KEY(owner_id, document_version_id, segment_id) REFERENCES document_segments (owner_id, document_version_id, id), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE memory_versions (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	memory_id UUID NOT NULL, 
	version INTEGER NOT NULL, 
	text TEXT, 
	source_fact_version_id UUID, 
	provenance_state VARCHAR(30) NOT NULL, 
	redacted_at TIMESTAMP WITH TIME ZONE, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, memory_id) REFERENCES memories (owner_id, id), 
	FOREIGN KEY(owner_id, source_fact_version_id) REFERENCES fact_versions (owner_id, id), 
	UNIQUE (owner_id, memory_id, version), 
	CHECK (version >= 1), 
	CHECK (redacted_at IS NOT NULL OR text IS NOT NULL), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE action_sources (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	action_id UUID NOT NULL, 
	answer_id UUID NOT NULL, 
	claim_id VARCHAR(100) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, action_id) REFERENCES actions (owner_id, id), 
	FOREIGN KEY(owner_id, answer_id) REFERENCES answers (owner_id, id), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE embedding_calls (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	updated_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	index_job_id UUID, 
	run_id UUID, 
	batch_no INTEGER NOT NULL, 
	request_hash VARCHAR(64) NOT NULL, 
	content_ref VARCHAR(160) NOT NULL, 
	response_ref VARCHAR(160), 
	state VARCHAR(24) NOT NULL, 
	usage_json JSONB, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, index_job_id) REFERENCES index_jobs (owner_id, id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	CHECK ((index_job_id IS NULL) <> (run_id IS NULL)), 
	CHECK (batch_no >= 0), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE chunk_segments (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	chunk_id UUID NOT NULL, 
	index_id UUID NOT NULL, 
	document_version_id UUID NOT NULL, 
	segment_id UUID NOT NULL, 
	char_start INTEGER NOT NULL, 
	char_end INTEGER NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, index_id, document_version_id, chunk_id) REFERENCES document_chunks (owner_id, index_id, document_version_id, id), 
	FOREIGN KEY(owner_id, document_version_id, segment_id) REFERENCES document_segments (owner_id, document_version_id, id), 
	UNIQUE (owner_id, chunk_id, segment_id), 
	CHECK (char_start >= 0 AND char_end > char_start), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE chunk_embeddings (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	chunk_id UUID NOT NULL, 
	index_id UUID NOT NULL, 
	embedding_profile_id UUID NOT NULL, 
	embedding VECTOR NOT NULL, 
	text_hash VARCHAR(64) NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, index_id, chunk_id) REFERENCES document_chunks (owner_id, index_id, id), 
	UNIQUE (owner_id, chunk_id), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id), 
	FOREIGN KEY(embedding_profile_id) REFERENCES embedding_profiles (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE workspace_memories (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	workspace_id UUID NOT NULL, 
	memory_version_id UUID NOT NULL, 
	confirmed_at TIMESTAMP WITH TIME ZONE NOT NULL, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, workspace_id) REFERENCES workspaces (owner_id, id), 
	FOREIGN KEY(owner_id, memory_version_id) REFERENCES memory_versions (owner_id, id), 
	UNIQUE (owner_id, workspace_id, memory_version_id), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
CREATE TABLE run_facts (
	id UUID NOT NULL, 
	owner_id UUID NOT NULL, 
	created_at TIMESTAMP WITH TIME ZONE DEFAULT now() NOT NULL, 
	run_id UUID NOT NULL, 
	fact_version_id UUID, 
	memory_version_id UUID, 
	PRIMARY KEY (id), 
	FOREIGN KEY(owner_id, run_id) REFERENCES runs (owner_id, id), 
	FOREIGN KEY(owner_id, fact_version_id) REFERENCES fact_versions (owner_id, id), 
	FOREIGN KEY(owner_id, memory_version_id) REFERENCES memory_versions (owner_id, id), 
	CHECK ((fact_version_id IS NULL) <> (memory_version_id IS NULL)), 
	UNIQUE (owner_id, id), 
	FOREIGN KEY(owner_id) REFERENCES users (id)
)
-- FILEACTION STATEMENT --
ALTER TABLE document_versions ADD CONSTRAINT fk_document_version_active_index FOREIGN KEY(owner_id, active_index_id) REFERENCES document_indexes (owner_id, id)
-- FILEACTION STATEMENT --
ALTER TABLE messages ADD CONSTRAINT fk_message_supersedes FOREIGN KEY(owner_id, supersedes_id) REFERENCES messages (owner_id, id)
-- FILEACTION STATEMENT --
ALTER TABLE messages ADD CONSTRAINT fk_message_answer FOREIGN KEY(owner_id, answer_id) REFERENCES answers (owner_id, id)
