export const PROJECT_STATE_SCHEMA_VERSION = 2 as const;

export const PROJECT_STATE_METADATA_SCHEMA_SQL = `
CREATE TABLE project_metadata (
  singleton INTEGER PRIMARY KEY CHECK (singleton = 1),
  project_id TEXT NOT NULL UNIQUE,
  schema_version INTEGER NOT NULL CHECK (schema_version = 2),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
) STRICT;
`;

export const SOURCE_ASSET_COMMIT_SCHEMA_SQL = `
CREATE TABLE source_asset_commits (
  idempotency_key TEXT PRIMARY KEY,
  expected_content_hash TEXT NOT NULL,
  expected_byte_length INTEGER NOT NULL CHECK (
    expected_byte_length BETWEEN 0 AND 9007199254740991
  ),
  original_name TEXT NOT NULL,
  source_type TEXT NOT NULL,
  created_by TEXT NOT NULL,
  source_asset_id TEXT NOT NULL UNIQUE,
  target_relative_path TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL CHECK (
    status IN ('reserved', 'committed', 'recovery_required')
  ),
  recovery_reason TEXT,
  committed_source_asset_id TEXT UNIQUE REFERENCES source_assets(source_asset_id),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  UNIQUE (
    expected_content_hash,
    expected_byte_length,
    original_name,
    source_type
  ),
  CHECK (
    (status = 'recovery_required'
      AND recovery_reason IS NOT NULL
      AND length(recovery_reason) > 0)
    OR (status != 'recovery_required' AND recovery_reason IS NULL)
  ),
  CHECK (
    (status = 'committed'
      AND committed_source_asset_id IS NOT NULL
      AND committed_source_asset_id = source_asset_id)
    OR (status != 'committed' AND committed_source_asset_id IS NULL)
  )
) STRICT;

CREATE TRIGGER source_asset_commits_initially_reserved
BEFORE INSERT ON source_asset_commits
WHEN NEW.status != 'reserved'
BEGIN
  SELECT RAISE(ABORT, 'source asset commits must be reserved first');
END;

CREATE TRIGGER source_asset_commits_binding_no_update
BEFORE UPDATE OF
  idempotency_key,
  expected_content_hash,
  expected_byte_length,
  original_name,
  source_type,
  created_by,
  source_asset_id,
  target_relative_path,
  created_at
ON source_asset_commits
BEGIN
  SELECT RAISE(ABORT, 'source asset commit bindings are immutable');
END;

CREATE TRIGGER source_asset_commits_recovery_reason_stable
BEFORE UPDATE OF recovery_reason ON source_asset_commits
WHEN OLD.status = 'recovery_required'
  AND NEW.status = 'recovery_required'
  AND NEW.recovery_reason IS NOT OLD.recovery_reason
BEGIN
  SELECT RAISE(ABORT, 'source asset commit recovery reason is immutable');
END;

CREATE TRIGGER source_asset_commits_state_transition
BEFORE UPDATE OF status ON source_asset_commits
WHEN NOT (
  (OLD.status = 'reserved' AND NEW.status IN ('committed', 'recovery_required'))
  OR (OLD.status = 'committed' AND NEW.status = 'recovery_required')
  OR (OLD.status = 'recovery_required' AND NEW.status = 'committed')
  OR OLD.status = NEW.status
)
BEGIN
  SELECT RAISE(ABORT, 'invalid source asset commit state transition');
END;

CREATE TRIGGER source_asset_commits_committed_record_matches
BEFORE UPDATE OF status, committed_source_asset_id ON source_asset_commits
WHEN NEW.status = 'committed'
  AND NOT EXISTS (
    SELECT 1
    FROM source_assets AS source
    WHERE source.source_asset_id = NEW.source_asset_id
      AND source.source_type = NEW.source_type
      AND source.original_name = NEW.original_name
      AND source.content_hash = NEW.expected_content_hash
      AND source.relative_path = NEW.target_relative_path
      AND source.created_by = NEW.created_by
  )
BEGIN
  SELECT RAISE(ABORT, 'committed source asset does not match its reservation');
END;

CREATE TRIGGER source_asset_commits_no_delete
BEFORE DELETE ON source_asset_commits
BEGIN
  SELECT RAISE(ABORT, 'source asset commit mappings are immutable');
END;

CREATE TRIGGER committed_source_assets_no_update
BEFORE UPDATE ON source_assets
WHEN EXISTS (
  SELECT 1
  FROM source_asset_commits AS commit_mapping
  WHERE commit_mapping.committed_source_asset_id = OLD.source_asset_id
)
BEGIN
  SELECT RAISE(ABORT, 'committed source assets are immutable');
END;
`;

export const PROJECT_STATE_SCHEMA_SQL = `
${PROJECT_STATE_METADATA_SCHEMA_SQL}

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

${SOURCE_ASSET_COMMIT_SCHEMA_SQL}

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
