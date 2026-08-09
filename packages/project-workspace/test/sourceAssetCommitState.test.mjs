import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, mkdtemp, readdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';
import { Worker } from 'node:worker_threads';

import {
  initializeProjectState,
  NodeProjectStateStore,
  PROJECT_STATE_RELATIVE_PATH,
  PROJECT_STATE_SCHEMA_VERSION,
} from '../dist/index.js';

const CREATED_AT = '2026-08-09T00:00:00.000Z';
const FINALIZED_AT = '2026-08-09T00:01:00.000Z';
const SOURCE_ASSET_ID_A = '10000000-0000-4000-8000-000000000001';
const SOURCE_ASSET_ID_B = '10000000-0000-4000-8000-000000000002';
const SOURCE_ASSET_ID_C = '10000000-0000-4000-8000-000000000003';
const SOURCE_ASSET_ID_D = '10000000-0000-4000-8000-000000000004';

const PROJECT_STATE_SCHEMA_V1_SQL = `
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

test('persists the four source asset commit APIs and enforces the state machine', async () => {
  const identifiers = [SOURCE_ASSET_ID_A, SOURCE_ASSET_ID_B];
  const harness = await createFreshState(() => identifiers.shift());
  const command = sourceAssetCommitCommand();

  try {
    assert.equal(PROJECT_STATE_SCHEMA_VERSION, 2);
    assert.equal(readUserVersion(harness.databasePath), 2);
    assert.deepEqual(
      readRows(
        harness.databasePath,
        'SELECT version FROM schema_migrations ORDER BY version',
      ),
      [{ version: 2 }],
    );
    assert.equal(harness.store.getSourceAssetCommit(command.idempotencyKey), undefined);

    const reserved = harness.store.reserveSourceAssetCommit(command);
    assert.equal(reserved.classification, 'new');
    assert.deepEqual(reserved.mapping, {
      idempotencyKey: command.idempotencyKey,
      expectedContentHash: command.expectedContentHash,
      expectedByteLength: command.expectedByteLength,
      originalName: command.originalName,
      sourceType: command.sourceType,
      createdBy: command.createdBy,
      sourceAssetId: SOURCE_ASSET_ID_A,
      targetRelativePath:
        `inputs/source-assets/${SOURCE_ASSET_ID_A}/novel.txt`,
      status: 'reserved',
      createdAt: CREATED_AT,
      updatedAt: CREATED_AT,
    });
    assert.equal(countRows(harness.databasePath, 'source_assets'), 0);

    const idempotent = harness.store.reserveSourceAssetCommit(sourceAssetCommitCommand({
      temporarySource: { relativePath: 'tmp/uploads/exact-retry.txt' },
    }));
    assert.equal(idempotent.classification, 'idempotent');
    assert.deepEqual(idempotent.mapping, reserved.mapping);

    const duplicate = harness.store.reserveSourceAssetCommit(sourceAssetCommitCommand({
      idempotencyKey: 'source-import-duplicate',
      temporarySource: { relativePath: 'tmp/uploads/retry.txt' },
      createdBy: 'another-user',
    }));
    assert.equal(duplicate.classification, 'duplicate');
    assert.deepEqual(duplicate.mapping, reserved.mapping);

    const conflict = harness.store.reserveSourceAssetCommit(sourceAssetCommitCommand({
      createdBy: 'another-user',
    }));
    assert.equal(conflict.classification, 'conflict');
    assert.deepEqual(conflict.mapping, reserved.mapping);

    const record = sourceAssetRecord(reserved.mapping);
    assert.throws(
      () => harness.store.finalizeSourceAssetCommit(
        command.idempotencyKey,
        command.expectedByteLength + 1,
        record,
      ),
      error => error?.code === 'PROJECT_STATE_CONFLICT',
    );
    assert.equal(countRows(harness.databasePath, 'source_assets'), 0);
    assert.equal(
      harness.store.getSourceAssetCommit(command.idempotencyKey).status,
      'reserved',
    );
    const preFinalizeDatabase = new DatabaseSync(harness.databasePath);
    try {
      assert.throws(
        () => preFinalizeDatabase.prepare(`
          UPDATE source_asset_commits
          SET status = 'committed'
          WHERE idempotency_key = ?
        `).run(command.idempotencyKey),
        /does not match|constraint/iu,
      );
    } finally {
      preFinalizeDatabase.close();
    }

    const finalized = harness.store.finalizeSourceAssetCommit(
      command.idempotencyKey,
      command.expectedByteLength,
      record,
    );
    assert.deepEqual(finalized, record);
    assert.deepEqual(
      harness.store.finalizeSourceAssetCommit(
        command.idempotencyKey,
        command.expectedByteLength,
        record,
      ),
      record,
    );
    assert.deepEqual(
      harness.store.getSourceAssetCommit(command.idempotencyKey).sourceAsset,
      record,
    );
    const committedRetry = harness.store.reserveSourceAssetCommit(
      sourceAssetCommitCommand({
        temporarySource: { relativePath: 'tmp/uploads/consumed.txt' },
      }),
    );
    assert.equal(committedRetry.classification, 'idempotent');
    assert.deepEqual(committedRetry.mapping.sourceAsset, record);

    const recovery = harness.store.markSourceAssetCommitRecoveryRequired(
      command.idempotencyKey,
      'TARGET_BYTES_UNPROVEN',
    );
    assert.equal(recovery.status, 'recovery_required');
    assert.equal(recovery.recoveryReason, 'TARGET_BYTES_UNPROVEN');
    assert.deepEqual(recovery.sourceAsset, record);
    assert.deepEqual(
      harness.store.markSourceAssetCommitRecoveryRequired(
        command.idempotencyKey,
        'TARGET_BYTES_UNPROVEN',
      ),
      recovery,
    );
    assert.throws(
      () => harness.store.markSourceAssetCommitRecoveryRequired(
        command.idempotencyKey,
        'A_DIFFERENT_REASON',
      ),
      error => error?.code === 'PROJECT_STATE_CONFLICT',
    );

    assert.deepEqual(
      harness.store.finalizeSourceAssetCommit(
        command.idempotencyKey,
        command.expectedByteLength,
        record,
      ),
      record,
    );
    const recommitted = harness.store.getSourceAssetCommit(
      command.idempotencyKey,
    );
    assert.equal(recommitted.status, 'committed');
    assert.equal(recommitted.recoveryReason, undefined);
    const secondRecovery = harness.store.markSourceAssetCommitRecoveryRequired(
      command.idempotencyKey,
      'TARGET_MISSING_AFTER_RECOMMIT',
    );
    assert.equal(secondRecovery.status, 'recovery_required');
    assert.equal(
      secondRecovery.recoveryReason,
      'TARGET_MISSING_AFTER_RECOMMIT',
    );
    harness.store.finalizeSourceAssetCommit(
      command.idempotencyKey,
      command.expectedByteLength,
      record,
    );

    const recoveryStateCommand = sourceAssetCommitCommand({
      expectedContentHash: 'b'.repeat(64),
      expectedByteLength: 12,
      idempotencyKey: 'recovery-terminal',
      originalName: 'recovery-terminal.txt',
    });
    harness.store.reserveSourceAssetCommit(recoveryStateCommand);
    const recoveryState = harness.store.markSourceAssetCommitRecoveryRequired(
      recoveryStateCommand.idempotencyKey,
      'RESERVED_COPY_INTERRUPTED',
    );
    assert.deepEqual(
      harness.store.markSourceAssetCommitRecoveryRequired(
        recoveryStateCommand.idempotencyKey,
        'RESERVED_COPY_INTERRUPTED',
      ),
      recoveryState,
    );
    assert.throws(
      () => harness.store.markSourceAssetCommitRecoveryRequired(
        recoveryStateCommand.idempotencyKey,
        'A_DIFFERENT_REASON',
      ),
      error => error?.code === 'PROJECT_STATE_CONFLICT',
    );
    const recoveryRetry = harness.store.reserveSourceAssetCommit({
      ...recoveryStateCommand,
      temporarySource: { relativePath: 'tmp/uploads/recovery-retry.txt' },
    });
    assert.equal(recoveryRetry.classification, 'idempotent');
    assert.equal(recoveryRetry.mapping.status, 'recovery_required');
    assert.equal(recoveryRetry.mapping.sourceAsset, undefined);
    assert.equal(countRows(harness.databasePath, 'source_assets'), 1);

    assert.throws(
      () => harness.store.finalizeSourceAssetCommit(
        'missing-key',
        command.expectedByteLength,
        record,
      ),
      error => error?.code === 'PROJECT_STATE_NOT_FOUND',
    );
    assert.throws(
      () => harness.store.markSourceAssetCommitRecoveryRequired(
        'missing-key',
        'TARGET_BYTES_UNPROVEN',
      ),
      error => error?.code === 'PROJECT_STATE_NOT_FOUND',
    );

    const database = new DatabaseSync(harness.databasePath);
    try {
      database.exec('PRAGMA foreign_keys = ON;');
      assert.throws(
        () => database.prepare(`
          UPDATE source_asset_commits
          SET status = 'reserved'
          WHERE idempotency_key = ?
        `).run(command.idempotencyKey),
        /state transition|constraint/iu,
      );
      assert.throws(
        () => database.prepare(`
          UPDATE source_asset_commits
          SET status = 'reserved'
          WHERE idempotency_key = ?
        `).run(recoveryStateCommand.idempotencyKey),
        /state transition|constraint/iu,
      );
      assert.throws(
        () => insertDirectSourceAssetCommit(database, {
          idempotencyKey: 'initial-committed',
          expectedContentHash: 'c'.repeat(64),
          expectedByteLength: 13,
          originalName: 'initial-committed.txt',
          sourceAssetId: SOURCE_ASSET_ID_C,
          targetRelativePath:
            `inputs/source-assets/${SOURCE_ASSET_ID_C}/initial-committed.txt`,
          status: 'committed',
        }),
        /must be reserved first/iu,
      );
      assert.throws(
        () => insertDirectSourceAssetCommit(database, {
          idempotencyKey: 'initial-recovery',
          expectedContentHash: 'd'.repeat(64),
          expectedByteLength: 14,
          originalName: 'initial-recovery.txt',
          recoveryReason: 'INVALID_INITIAL_STATE',
          sourceAssetId: SOURCE_ASSET_ID_D,
          targetRelativePath:
            `inputs/source-assets/${SOURCE_ASSET_ID_D}/initial-recovery.txt`,
          status: 'recovery_required',
        }),
        /must be reserved first/iu,
      );
      assert.throws(
        () => insertDirectSourceAssetCommit(database, {
          idempotencyKey: 'duplicate-source-asset-id',
          expectedContentHash: 'e'.repeat(64),
          expectedByteLength: 15,
          originalName: 'duplicate-source-asset-id.txt',
          sourceAssetId: SOURCE_ASSET_ID_A,
          targetRelativePath:
            `inputs/source-assets/${SOURCE_ASSET_ID_C}/duplicate-source-asset-id.txt`,
        }),
        /UNIQUE constraint failed: source_asset_commits.source_asset_id/iu,
      );
      assert.throws(
        () => insertDirectSourceAssetCommit(database, {
          idempotencyKey: 'duplicate-target-relative-path',
          expectedContentHash: 'f'.repeat(64),
          expectedByteLength: 16,
          originalName: 'duplicate-target-relative-path.txt',
          sourceAssetId: SOURCE_ASSET_ID_C,
          targetRelativePath: reserved.mapping.targetRelativePath,
        }),
        /UNIQUE constraint failed: source_asset_commits.target_relative_path/iu,
      );
      assert.throws(
        () => database.prepare(`
          UPDATE source_asset_commits
          SET target_relative_path = 'inputs/changed.txt'
          WHERE idempotency_key = ?
        `).run(command.idempotencyKey),
        /bindings are immutable/iu,
      );
      assert.throws(
        () => database.prepare(`
          DELETE FROM source_asset_commits WHERE idempotency_key = ?
        `).run(command.idempotencyKey),
        /mappings are immutable/iu,
      );
      assert.throws(
        () => database.prepare(`
          UPDATE source_assets
          SET created_by = 'mutated-user'
          WHERE source_asset_id = ?
        `).run(record.sourceAssetId),
        /committed source assets are immutable/iu,
      );
      assert.throws(
        () => database.prepare(`
          UPDATE source_asset_commits
          SET status = 'published'
          WHERE idempotency_key = ?
        `).run(command.idempotencyKey),
        /state transition|constraint/iu,
      );
    } finally {
      database.close();
    }
  } finally {
    await closeHarness(harness);
  }
});

test('reopens reserved, committed, and recovery-required mappings and rejects writes read-only', async () => {
  const identifiers = [SOURCE_ASSET_ID_A, SOURCE_ASSET_ID_B, SOURCE_ASSET_ID_C];
  const harness = await createFreshState(() => identifiers.shift());
  const reservedCommand = sourceAssetCommitCommand({ idempotencyKey: 'reserved' });
  const committedCommand = sourceAssetCommitCommand({
    expectedContentHash: 'b'.repeat(64),
    expectedByteLength: 22,
    idempotencyKey: 'committed',
    originalName: 'committed.txt',
  });
  const recoveryCommand = sourceAssetCommitCommand({
    expectedContentHash: 'c'.repeat(64),
    expectedByteLength: 33,
    idempotencyKey: 'recovery',
    originalName: 'recovery.txt',
  });

  try {
    harness.store.reserveSourceAssetCommit(reservedCommand);
    const committed = harness.store.reserveSourceAssetCommit(committedCommand);
    const recovery = harness.store.reserveSourceAssetCommit(recoveryCommand);
    const committedRecord = sourceAssetRecord(committed.mapping);
    harness.store.finalizeSourceAssetCommit(
      committedCommand.idempotencyKey,
      committedCommand.expectedByteLength,
      committedRecord,
    );
    harness.store.markSourceAssetCommitRecoveryRequired(
      recoveryCommand.idempotencyKey,
      'COPY_INTERRUPTED',
    );
    harness.store.close();

    harness.store = await openState(harness);
    assert.equal(
      harness.store.getSourceAssetCommit(reservedCommand.idempotencyKey).status,
      'reserved',
    );
    assert.deepEqual(
      harness.store.getSourceAssetCommit(committedCommand.idempotencyKey)
        .sourceAsset,
      committedRecord,
    );
    assert.deepEqual(
      harness.store.getSourceAssetCommit(recoveryCommand.idempotencyKey),
      {
        ...recovery.mapping,
        status: 'recovery_required',
        recoveryReason: 'COPY_INTERRUPTED',
      },
    );

    const reader = await NodeProjectStateStore.open({
      accessMode: 'read-only',
      projectDirectory: harness.projectDirectory,
      projectId: harness.projectId,
    });
    try {
      assert.equal(
        reader.getSourceAssetCommit(reservedCommand.idempotencyKey).status,
        'reserved',
      );
      assert.throws(
        () => reader.reserveSourceAssetCommit(sourceAssetCommitCommand({
          idempotencyKey: 'read-only',
        })),
        error => error?.code === 'PROJECT_STATE_READ_ONLY',
      );
      assert.throws(
        () => reader.finalizeSourceAssetCommit(
          committedCommand.idempotencyKey,
          committedCommand.expectedByteLength,
          committedRecord,
        ),
        error => error?.code === 'PROJECT_STATE_READ_ONLY',
      );
      assert.throws(
        () => reader.markSourceAssetCommitRecoveryRequired(
          reservedCommand.idempotencyKey,
          'READ_ONLY',
        ),
        error => error?.code === 'PROJECT_STATE_READ_ONLY',
      );
    } finally {
      reader.close();
    }
  } finally {
    await closeHarness(harness);
  }
});

test('rejects missing, future, and destroyed v2 migration history', async () => {
  const harness = await createFreshState();
  harness.store.close();

  try {
    let database = new DatabaseSync(harness.databasePath);
    try {
      database.exec('DELETE FROM schema_migrations WHERE version = 2;');
    } finally {
      database.close();
    }
    await assert.rejects(
      openState(harness),
      error => error?.code === 'PROJECT_STATE_INVALID',
    );

    database = new DatabaseSync(harness.databasePath);
    try {
      database.prepare(`
        INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)
      `).run(CREATED_AT);
    } finally {
      database.close();
    }
    await assert.rejects(
      openState(harness),
      error => error?.code === 'PROJECT_STATE_INVALID',
    );

    database = new DatabaseSync(harness.databasePath);
    try {
      database.exec('DELETE FROM schema_migrations WHERE version = 1;');
      database.prepare(`
        INSERT INTO schema_migrations(version, applied_at) VALUES (2, ?)
      `).run(CREATED_AT);
      database.prepare(`
        INSERT INTO schema_migrations(version, applied_at) VALUES (3, ?)
      `).run(CREATED_AT);
    } finally {
      database.close();
    }
    await assert.rejects(
      openState(harness),
      error => error?.code === 'PROJECT_STATE_INVALID',
    );

    database = new DatabaseSync(harness.databasePath);
    try {
      database.exec(`
        DELETE FROM schema_migrations WHERE version = 3;
        DROP TABLE schema_migrations;
      `);
    } finally {
      database.close();
    }
    await assert.rejects(
      openState(harness),
      error => error?.code === 'PROJECT_STATE_INVALID',
    );
  } finally {
    await closeHarness(harness);
  }
});

test('migrates a real v1 database once without inventing mappings for legacy source assets', async () => {
  const harness = await createV1State();

  try {
    await assert.rejects(
      NodeProjectStateStore.open({
        accessMode: 'read-only',
        projectDirectory: harness.projectDirectory,
        projectId: harness.projectId,
      }),
      error => error?.code === 'PROJECT_STATE_MIGRATION_REQUIRED',
    );
    assert.deepEqual(await migrationBackups(harness.projectDirectory), []);

    let store = await openState(harness);
    store.close();
    assert.equal(readUserVersion(harness.databasePath), 2);
    assert.deepEqual(
      readRows(
        harness.databasePath,
        'SELECT version FROM schema_migrations ORDER BY version',
      ),
      [{ version: 1 }, { version: 2 }],
    );
    assert.deepEqual(
      readRows(
        harness.databasePath,
        'SELECT source_asset_id, original_name FROM source_assets',
      ),
      [{ source_asset_id: SOURCE_ASSET_ID_D, original_name: 'legacy.txt' }],
    );
    assert.equal(countRows(harness.databasePath, 'source_asset_commits'), 0);
    const backups = await migrationBackups(harness.projectDirectory);
    assert.equal(backups.length, 1);
    const backupPath = join(
      harness.projectDirectory,
      'state/backups',
      backups[0],
    );
    assert.equal(readUserVersion(backupPath), 1);
    assert.deepEqual(
      readRows(
        backupPath,
        `SELECT project_id, schema_version, created_at, updated_at
         FROM project_metadata`,
      ),
      [{
        project_id: harness.projectId,
        schema_version: 1,
        created_at: CREATED_AT,
        updated_at: CREATED_AT,
      }],
    );
    assert.deepEqual(
      readRows(
        backupPath,
        `SELECT source_asset_id, source_type, original_name, content_hash,
                relative_path, created_at, created_by
         FROM source_assets`,
      ),
      [{
        source_asset_id: SOURCE_ASSET_ID_D,
        source_type: 'text/plain',
        original_name: 'legacy.txt',
        content_hash: 'd'.repeat(64),
        relative_path: 'inputs/legacy.txt',
        created_at: CREATED_AT,
        created_by: 'legacy-user',
      }],
    );
    assert.deepEqual(
      readRows(
        backupPath,
        'SELECT version FROM schema_migrations ORDER BY version',
      ),
      [{ version: 1 }],
    );
    assert.deepEqual(
      readRows(
        backupPath,
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name = 'source_asset_commits'`,
      ),
      [],
    );

    store = await openState(harness);
    assert.equal(store.getSourceAssetCommit('invented-legacy-key'), undefined);
    store.close();
    assert.equal((await migrationBackups(harness.projectDirectory)).length, 1);
  } finally {
    await rm(harness.projectDirectory, { force: true, recursive: true });
  }
});

test('makes two concurrent v1 opens idempotently converge on one healthy v2 state', async () => {
  const harness = await createV1State();

  try {
    const opened = await Promise.allSettled([
      openState(harness),
      openState(harness),
    ]);
    assert.deepEqual(opened.map(result => result.status), [
      'fulfilled',
      'fulfilled',
    ]);
    const stores = opened.map(result => result.value);
    assert.notEqual(stores[0], stores[1]);
    for (const store of stores)
      store.close();

    assert.equal(readUserVersion(harness.databasePath), 2);
    assert.deepEqual(
      readRows(
        harness.databasePath,
        'SELECT version FROM schema_migrations ORDER BY version',
      ),
      [{ version: 1 }, { version: 2 }],
    );
    const backups = await migrationBackups(harness.projectDirectory);
    assert.equal(backups.length >= 1, true);
    assert.equal(backups.length <= 2, true);
    for (const name of backups) {
      assertValidMigrationBackup(
        join(harness.projectDirectory, 'state/backups', name),
        harness.projectId,
      );
    }
  } finally {
    await rm(harness.projectDirectory, { force: true, recursive: true });
  }
});

test('rolls a failed v1 migration back and permits a later retry', async () => {
  const harness = await createV1State();
  const database = new DatabaseSync(harness.databasePath);
  try {
    database.exec(`
      CREATE TABLE source_asset_commits (invalid_column TEXT) STRICT;
    `);
  } finally {
    database.close();
  }

  try {
    await assert.rejects(
      openState(harness),
      error => error?.code === 'PROJECT_STATE_MIGRATION_FAILED',
    );
    assert.equal(readUserVersion(harness.databasePath), 1);
    assert.deepEqual(
      readRows(
        harness.databasePath,
        'SELECT project_id, schema_version FROM project_metadata',
      ),
      [{ project_id: harness.projectId, schema_version: 1 }],
    );
    assert.equal(
      countRows(harness.databasePath, 'source_assets'),
      1,
    );
    assert.deepEqual(
      readRows(
        harness.databasePath,
        'SELECT version FROM schema_migrations ORDER BY version',
      ),
      [{ version: 1 }],
    );
    assert.deepEqual(
      readRows(
        harness.databasePath,
        `SELECT name FROM sqlite_schema
         WHERE type = 'table' AND name = 'project_metadata_v1'`,
      ),
      [],
    );
    assert.equal((await migrationBackups(harness.projectDirectory)).length, 1);

    const repair = new DatabaseSync(harness.databasePath);
    try {
      repair.exec('DROP TABLE source_asset_commits;');
    } finally {
      repair.close();
    }
    const store = await openState(harness);
    store.close();
    assert.equal(readUserVersion(harness.databasePath), 2);
    assert.equal(countRows(harness.databasePath, 'source_assets'), 1);
    assert.equal(countRows(harness.databasePath, 'source_asset_commits'), 0);
  } finally {
    await rm(harness.projectDirectory, { force: true, recursive: true });
  }
});

test('serializes competing reservations across independent database connections', async () => {
  const sameKeyHarness = await createFreshState();
  sameKeyHarness.store.close();
  const sameKeyCommand = sourceAssetCommitCommand();

  try {
    const sameKeyResults = await Promise.all([
      reserveInWorker(sameKeyHarness, sameKeyCommand, SOURCE_ASSET_ID_A),
      reserveInWorker(sameKeyHarness, sameKeyCommand, SOURCE_ASSET_ID_B),
    ]);
    assert.deepEqual(
      sameKeyResults.map(result => result.classification).sort(),
      ['idempotent', 'new'],
    );
    assert.equal(
      new Set(sameKeyResults.map(result => result.mapping.sourceAssetId)).size,
      1,
    );
    assert.equal(countRows(sameKeyHarness.databasePath, 'source_asset_commits'), 1);
  } finally {
    await closeHarness(sameKeyHarness);
  }

  const duplicateHarness = await createFreshState();
  duplicateHarness.store.close();
  try {
    const duplicateResults = await Promise.all([
      reserveInWorker(
        duplicateHarness,
        sourceAssetCommitCommand({ idempotencyKey: 'parallel-a' }),
        SOURCE_ASSET_ID_A,
      ),
      reserveInWorker(
        duplicateHarness,
        sourceAssetCommitCommand({ idempotencyKey: 'parallel-b' }),
        SOURCE_ASSET_ID_B,
      ),
    ]);
    assert.deepEqual(
      duplicateResults.map(result => result.classification).sort(),
      ['duplicate', 'new'],
    );
    assert.equal(
      new Set(duplicateResults.map(result => result.mapping.sourceAssetId)).size,
      1,
    );
    assert.equal(countRows(duplicateHarness.databasePath, 'source_asset_commits'), 1);
  } finally {
    await closeHarness(duplicateHarness);
  }
});

test('rolls back a newly inserted source asset when finalization cannot transition the mapping', async () => {
  const harness = await createFreshState(() => SOURCE_ASSET_ID_A);
  const command = sourceAssetCommitCommand();

  try {
    const reserved = harness.store.reserveSourceAssetCommit(command);
    const record = sourceAssetRecord(reserved.mapping);
    const database = new DatabaseSync(harness.databasePath);
    try {
      database.exec(`
        CREATE TRIGGER test_fail_source_asset_finalize
        BEFORE UPDATE OF status ON source_asset_commits
        WHEN NEW.status = 'committed'
        BEGIN
          SELECT RAISE(ABORT, 'injected finalize failure');
        END;
      `);
    } finally {
      database.close();
    }

    assert.throws(
      () => harness.store.finalizeSourceAssetCommit(
        command.idempotencyKey,
        command.expectedByteLength,
        record,
      ),
      error => error?.code === 'PROJECT_STATE_TRANSACTION_FAILED',
    );
    assert.equal(countRows(harness.databasePath, 'source_assets'), 0);
    assert.equal(
      harness.store.getSourceAssetCommit(command.idempotencyKey).status,
      'reserved',
    );

    const cleanup = new DatabaseSync(harness.databasePath);
    try {
      cleanup.exec('DROP TRIGGER test_fail_source_asset_finalize;');
    } finally {
      cleanup.close();
    }
    assert.deepEqual(
      harness.store.finalizeSourceAssetCommit(
        command.idempotencyKey,
        command.expectedByteLength,
        record,
      ),
      record,
    );
  } finally {
    await closeHarness(harness);
  }
});

function sourceAssetCommitCommand(overrides = {}) {
  return {
    temporarySource: { relativePath: 'tmp/uploads/novel.txt' },
    expectedContentHash: 'a'.repeat(64),
    expectedByteLength: 11,
    originalName: 'novel.txt',
    sourceType: 'text/plain',
    createdBy: 'test-user',
    idempotencyKey: 'source-import-1',
    ...overrides,
  };
}

function sourceAssetRecord(mapping) {
  return {
    sourceAssetId: mapping.sourceAssetId,
    sourceType: mapping.sourceType,
    originalName: mapping.originalName,
    contentHash: mapping.expectedContentHash,
    relativePath: mapping.targetRelativePath,
    createdAt: FINALIZED_AT,
    createdBy: mapping.createdBy,
  };
}

function insertDirectSourceAssetCommit(database, input) {
  database.prepare(`
    INSERT INTO source_asset_commits(
      idempotency_key, expected_content_hash, expected_byte_length,
      original_name, source_type, created_by, source_asset_id,
      target_relative_path, status, recovery_reason,
      committed_source_asset_id, created_at, updated_at
    ) VALUES (?, ?, ?, ?, 'text/plain', 'direct-test', ?, ?, ?, ?, NULL, ?, ?)
  `).run(
    input.idempotencyKey,
    input.expectedContentHash,
    input.expectedByteLength,
    input.originalName,
    input.sourceAssetId,
    input.targetRelativePath,
    input.status ?? 'reserved',
    input.recoveryReason ?? null,
    CREATED_AT,
    CREATED_AT,
  );
}

async function createFreshState(generateId = randomUUID) {
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'voxweaver-source-commit-state-'),
  );
  const projectId = randomUUID();
  await mkdir(join(projectDirectory, 'state'));
  await initializeProjectState(projectDirectory, {
    projectId,
    createdAt: CREATED_AT,
  }, {
    now: () => new Date(CREATED_AT),
  });
  const harness = {
    databasePath: join(projectDirectory, PROJECT_STATE_RELATIVE_PATH),
    generateId,
    projectDirectory,
    projectId,
  };
  return {
    ...harness,
    store: await openState(harness),
  };
}

async function createV1State() {
  const projectDirectory = await mkdtemp(
    join(tmpdir(), 'voxweaver-source-commit-v1-'),
  );
  const projectId = randomUUID();
  await mkdir(join(projectDirectory, 'state'));
  const databasePath = join(projectDirectory, PROJECT_STATE_RELATIVE_PATH);
  const database = new DatabaseSync(databasePath);
  try {
    database.exec(PROJECT_STATE_SCHEMA_V1_SQL);
    database.prepare(`
      INSERT INTO project_metadata(
        singleton, project_id, schema_version, created_at, updated_at
      ) VALUES (1, ?, 1, ?, ?)
    `).run(projectId, CREATED_AT, CREATED_AT);
    database.prepare(`
      INSERT INTO schema_migrations(version, applied_at) VALUES (1, ?)
    `).run(CREATED_AT);
    database.prepare(`
      INSERT INTO source_assets(
        source_asset_id, source_type, original_name, content_hash,
        relative_path, created_at, created_by
      ) VALUES (?, 'text/plain', 'legacy.txt', ?,
                'inputs/legacy.txt', ?, 'legacy-user')
    `).run(SOURCE_ASSET_ID_D, 'd'.repeat(64), CREATED_AT);
    database.exec('PRAGMA user_version = 1;');
  } finally {
    database.close();
  }
  return {
    databasePath,
    generateId: randomUUID,
    projectDirectory,
    projectId,
  };
}

async function openState(harness) {
  return NodeProjectStateStore.open({
    accessMode: 'read-write',
    projectDirectory: harness.projectDirectory,
    projectId: harness.projectId,
    generateId: harness.generateId,
    now: () => new Date(CREATED_AT),
  });
}

async function closeHarness(harness) {
  if (harness.store?.isOpen !== false) {
    try {
      harness.store?.close();
    } catch {
      // A test may already have closed the store before a worker race.
    }
  }
  await rm(harness.projectDirectory, { force: true, recursive: true });
}

async function migrationBackups(projectDirectory) {
  try {
    return (await readdir(join(projectDirectory, 'state/backups')))
      .filter(name => name.startsWith('project-v1-') && name.endsWith('.sqlite'))
      .sort();
  } catch (error) {
    if (error?.code === 'ENOENT')
      return [];
    throw error;
  }
}

function readUserVersion(databasePath) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare('PRAGMA user_version').get().user_version;
  } finally {
    database.close();
  }
}

function countRows(databasePath, table) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(`SELECT COUNT(*) AS count FROM ${table}`).get().count;
  } finally {
    database.close();
  }
}

function readRows(databasePath, sql) {
  const database = new DatabaseSync(databasePath, { readOnly: true });
  try {
    return database.prepare(sql).all().map(row => ({ ...row }));
  } finally {
    database.close();
  }
}

function assertValidMigrationBackup(databasePath, projectId) {
  assert.deepEqual(
    readRows(databasePath, 'PRAGMA quick_check'),
    [{ quick_check: 'ok' }],
  );
  const version = readUserVersion(databasePath);
  assert.equal([1, 2].includes(version), true);
  assert.deepEqual(
    readRows(
      databasePath,
      'SELECT project_id, schema_version FROM project_metadata',
    ),
    [{ project_id: projectId, schema_version: version }],
  );
  const migrationVersions = readRows(
    databasePath,
    'SELECT version FROM schema_migrations ORDER BY version',
  ).map(row => row.version);
  if (version === 1) {
    assert.deepEqual(migrationVersions, [1]);
  } else {
    assert.equal(
      ['2', '1,2'].includes(migrationVersions.join(',')),
      true,
    );
  }
  assert.deepEqual(
    readRows(
      databasePath,
      'SELECT source_asset_id, original_name FROM source_assets',
    ),
    [{ source_asset_id: SOURCE_ASSET_ID_D, original_name: 'legacy.txt' }],
  );
}

async function reserveInWorker(harness, command, sourceAssetId) {
  const moduleUrl = new URL('../dist/index.js', import.meta.url).href;
  const workerSource = `
    import { parentPort, workerData } from 'node:worker_threads';
    import { NodeProjectStateStore } from ${JSON.stringify(moduleUrl)};

    const store = await NodeProjectStateStore.open({
      accessMode: 'read-write',
      projectDirectory: workerData.projectDirectory,
      projectId: workerData.projectId,
      generateId: () => workerData.sourceAssetId,
      now: () => new Date(workerData.now),
    });
    try {
      parentPort.postMessage(store.reserveSourceAssetCommit(workerData.command));
    } finally {
      store.close();
    }
  `;
  const worker = new Worker(
    new URL(`data:text/javascript,${encodeURIComponent(workerSource)}`),
    {
      workerData: {
        command,
        now: CREATED_AT,
        projectDirectory: harness.projectDirectory,
        projectId: harness.projectId,
        sourceAssetId,
      },
    },
  );
  return new Promise((resolve, reject) => {
    let result;
    worker.once('message', (message) => {
      result = message;
    });
    worker.once('error', reject);
    worker.once('exit', (code) => {
      if (code !== 0) {
        reject(new Error(`Reservation worker exited with code ${code}.`));
        return;
      }
      if (result === undefined) {
        reject(new Error('Reservation worker exited without a result.'));
        return;
      }
      resolve(result);
    });
  });
}
