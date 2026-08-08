export const PROJECT_STATE_SCHEMA_VERSION = 1 as const;

export const PROJECT_STATE_SCHEMA_SQL = `
CREATE TABLE project_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 1),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE schema_migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
) STRICT;

CREATE TABLE source_assets (
  source_asset_id TEXT PRIMARY KEY,
  source_type TEXT NOT NULL,
  original_name TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  relative_path TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
) STRICT;

CREATE TABLE artifacts (
  artifact_id TEXT PRIMARY KEY,
  artifact_type TEXT NOT NULL,
  lineage_id TEXT NOT NULL,
  scope_json TEXT NOT NULL,
  storage_kind TEXT NOT NULL,
  active_revision_id TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE artifact_revisions (
  revision_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  content_path TEXT NOT NULL UNIQUE,
  content_hash TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  processor_id TEXT NOT NULL,
  processor_version TEXT NOT NULL,
  parameters_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
) STRICT;

CREATE TABLE artifact_revision_state (
  revision_id TEXT PRIMARY KEY REFERENCES artifact_revisions(revision_id),
  execution_status TEXT NOT NULL CHECK (
    execution_status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')
  ),
  validity_status TEXT NOT NULL CHECK (
    validity_status IN ('current', 'stale', 'superseded', 'missing')
  ),
  review_status TEXT NOT NULL CHECK (
    review_status IN ('not_required', 'pending', 'approved', 'rejected')
  ),
  updated_at TEXT NOT NULL
) STRICT;

CREATE TABLE artifact_dependencies (
  dependency_id TEXT PRIMARY KEY,
  consumer_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  consumer_revision_id TEXT NOT NULL REFERENCES artifact_revisions(revision_id),
  producer_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  producer_revision_id TEXT NOT NULL REFERENCES artifact_revisions(revision_id),
  dependency_type TEXT NOT NULL CHECK (
    dependency_type IN ('content', 'structure', 'voice', 'pronunciation', 'config')
  ),
  selector_json TEXT NOT NULL,
  UNIQUE (
    consumer_revision_id,
    producer_artifact_id,
    producer_revision_id,
    dependency_type,
    selector_json
  )
) STRICT;

CREATE TABLE stale_causes (
  stale_cause_id TEXT PRIMARY KEY,
  root_cause_key TEXT NOT NULL,
  consumer_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  consumer_revision_id TEXT NOT NULL REFERENCES artifact_revisions(revision_id),
  producer_artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  previous_producer_revision_id TEXT NOT NULL REFERENCES artifact_revisions(revision_id),
  current_producer_revision_id TEXT NOT NULL REFERENCES artifact_revisions(revision_id),
  dependency_type TEXT NOT NULL CHECK (
    dependency_type IN ('content', 'structure', 'voice', 'pronunciation', 'config')
  ),
  selector_json TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('active', 'resolved')),
  created_at TEXT NOT NULL,
  resolved_at TEXT,
  UNIQUE (
    consumer_revision_id,
    root_cause_key,
    producer_artifact_id,
    dependency_type,
    selector_json
  )
) STRICT;

CREATE TABLE tasks (
  task_id TEXT PRIMARY KEY,
  project_id TEXT NOT NULL,
  processor_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  output_scope_json TEXT NOT NULL,
  dedupe_key TEXT NOT NULL,
  execution_status TEXT NOT NULL CHECK (
    execution_status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')
  ),
  recovery_status TEXT NOT NULL CHECK (
    recovery_status IN ('none', 'resumable', 'retryable', 'manual', 'orphaned')
  ),
  attempt INTEGER NOT NULL CHECK (attempt >= 1),
  temporary_path TEXT NOT NULL,
  result_revision_id TEXT REFERENCES artifact_revisions(revision_id),
  error_code TEXT,
  error_message TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  started_at TEXT,
  finished_at TEXT
) STRICT;

CREATE INDEX tasks_dedupe_idx
  ON tasks(project_id, processor_id, input_fingerprint, output_scope_json, attempt DESC);

CREATE TABLE stage_runs (
  stage_run_id TEXT PRIMARY KEY,
  stage_id TEXT NOT NULL,
  input_fingerprint TEXT NOT NULL,
  execution_status TEXT NOT NULL CHECK (
    execution_status IN ('pending', 'running', 'succeeded', 'failed', 'canceled')
  ),
  started_at TEXT,
  finished_at TEXT,
  created_at TEXT NOT NULL
) STRICT;

CREATE TABLE review_decisions (
  review_decision_id TEXT PRIMARY KEY,
  artifact_id TEXT NOT NULL REFERENCES artifacts(artifact_id),
  revision_id TEXT NOT NULL REFERENCES artifact_revisions(revision_id),
  decision TEXT NOT NULL CHECK (decision IN ('approved', 'rejected')),
  note TEXT,
  decided_at TEXT NOT NULL,
  decided_by TEXT NOT NULL
) STRICT;

CREATE TABLE export_snapshots (
  export_snapshot_id TEXT PRIMARY KEY,
  revision_ids_json TEXT NOT NULL,
  stale_waiver_reason TEXT,
  created_at TEXT NOT NULL,
  created_by TEXT NOT NULL
) STRICT;

CREATE TRIGGER artifact_revisions_no_update
BEFORE UPDATE ON artifact_revisions
BEGIN
  SELECT RAISE(ABORT, 'artifact revisions are immutable');
END;

CREATE TRIGGER artifact_revisions_no_delete
BEFORE DELETE ON artifact_revisions
BEGIN
  SELECT RAISE(ABORT, 'artifact revisions are immutable');
END;

CREATE TRIGGER artifact_dependencies_no_update
BEFORE UPDATE ON artifact_dependencies
BEGIN
  SELECT RAISE(ABORT, 'artifact dependencies are immutable');
END;

CREATE TRIGGER artifact_dependencies_no_delete
BEFORE DELETE ON artifact_dependencies
BEGIN
  SELECT RAISE(ABORT, 'artifact dependencies are immutable');
END;

CREATE TRIGGER review_decisions_no_update
BEFORE UPDATE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review decisions are immutable');
END;

CREATE TRIGGER review_decisions_no_delete
BEFORE DELETE ON review_decisions
BEGIN
  SELECT RAISE(ABORT, 'review decisions are immutable');
END;
`;
