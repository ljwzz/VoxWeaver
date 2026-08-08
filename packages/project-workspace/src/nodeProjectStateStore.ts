import type {
  ArtifactDependency,
  ArtifactRecord,
  ArtifactScope,
  ArtifactSelector,
  ExportSnapshotRecord,
  JsonValue,
  ProjectAccessMode,
  ProjectManifest,
  ReviewDecisionRecord,
  SourceAssetRecord,
  StageRunRecord,
  StaleCause,
  TaskRecord,
} from '@voxweaver/contracts';
import type {
  ArtifactDependencyInput,
  ArtifactImpactItem,
  ArtifactImpactPreview,
  CreateExportSnapshotCommand,
  CreateStageRunCommand,
  EnqueueTaskCommand,
  EnqueueTaskResult,
  FailTaskCommand,
  PreviewArtifactImpactCommand,
  RecordReviewDecisionCommand,
} from '@voxweaver/workflow-core';
import type { DatabaseSync } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { lstat, mkdir, open as openFile, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import { backup, DatabaseSync as NodeDatabaseSync } from 'node:sqlite';
import {
  parseArtifactDependency,
  parseArtifactRecord,
  parseExportSnapshotRecord,
  parseProjectRecord,
  parseReviewDecisionRecord,
  parseSourceAssetRecord,
  parseStageRunRecord,
  parseStaleCause,
  parseTaskRecord,
} from '@voxweaver/contracts';
import {
  canonicalizeJson,
  selectorsIntersect,
  sha256CanonicalJson,
} from '@voxweaver/workflow-core';

import { ProjectStateError } from './projectStateError.js';
import {
  PROJECT_STATE_SCHEMA_SQL,
  PROJECT_STATE_SCHEMA_VERSION,
} from './projectStateSchema.js';

export const PROJECT_STATE_RELATIVE_PATH = 'state/project.sqlite';

export interface ProjectStateLifecycleOptions {
  generateId?: () => string;
  now?: () => Date;
}

export interface OpenProjectStateOptions extends ProjectStateLifecycleOptions {
  accessMode: ProjectAccessMode;
  projectDirectory: string;
  projectId: string;
}

export interface CommitStoredArtifactCommand {
  activate: boolean;
  changeSelector?: ArtifactSelector;
  dependencies: readonly ArtifactDependencyInput[];
  record: ArtifactRecord;
  taskId?: string;
}

export interface StoredRevisionPath {
  readonly contentPath: string;
  readonly contentHash: string;
  readonly dependencies: readonly ArtifactDependency[];
  readonly record: ArtifactRecord;
  readonly revisionId: string;
}

interface SqlRow {
  readonly [key: string]: unknown;
}

interface PropagationItem {
  readonly changeSelector?: ArtifactSelector;
  readonly currentRevisionId: string;
  readonly includeCurrentDependency: boolean;
  readonly producerArtifactId: string;
  readonly rootCauseKey: string;
}

const DATABASE_TIMEOUT_MS = 5_000;

const ARTIFACT_RECORD_QUERY_BASE = `
  SELECT
    a.artifact_id, a.artifact_type, a.lineage_id, a.scope_json,
    a.storage_kind, r.revision_id, r.content_path, r.content_hash,
    r.input_fingerprint, r.processor_id, r.processor_version,
    r.parameters_hash, r.created_at, r.created_by,
    s.execution_status, s.validity_status, s.review_status
  FROM artifact_revisions r
  INNER JOIN artifacts a ON a.artifact_id = r.artifact_id
  INNER JOIN artifact_revision_state s ON s.revision_id = r.revision_id
`;
const ARTIFACT_RECORD_QUERY = `${ARTIFACT_RECORD_QUERY_BASE}
  WHERE r.revision_id = ?
`;

export async function initializeProjectState(
  projectDirectory: string,
  manifest: ProjectManifest,
  options: ProjectStateLifecycleOptions = {},
): Promise<void> {
  const databasePath = join(projectDirectory, PROJECT_STATE_RELATIVE_PATH);
  await assertPhysicalStateDirectory(databasePath);
  try {
    await createPrivateFile(databasePath);
  } catch (error) {
    throw normalizeStateError(
      error,
      'PROJECT_STATE_INVALID',
      'Unable to reserve the project state database.',
    );
  }
  let database: DatabaseSync | undefined;
  const now = options.now ?? (() => new Date());

  try {
    database = openDatabase(databasePath, false);
    configureWritableDatabase(database);
    createCurrentSchema(database, manifest.projectId, manifest.createdAt, now());
    assertDatabaseHealthy(database, manifest.projectId);
  } catch (error) {
    closeDatabaseBestEffort(database);
    await removeDatabaseFilesBestEffort(databasePath);
    throw normalizeStateError(
      error,
      'PROJECT_STATE_INVALID',
      'Unable to initialize the project state database.',
    );
  } finally {
    closeDatabaseBestEffort(database);
  }
}

export async function ensureProjectState(
  options: OpenProjectStateOptions,
): Promise<void> {
  const databasePath = join(
    options.projectDirectory,
    PROJECT_STATE_RELATIVE_PATH,
  );
  await assertPhysicalStateDatabase(databasePath);
  const database = openDatabase(databasePath, options.accessMode === 'read-only');

  try {
    configureDatabase(database, options.accessMode);
    const version = readUserVersion(database);
    if (version > PROJECT_STATE_SCHEMA_VERSION) {
      throw new ProjectStateError(
        'PROJECT_STATE_SCHEMA_TOO_NEW',
        `Project state schema ${version} is newer than supported schema ${PROJECT_STATE_SCHEMA_VERSION}.`,
      );
    }

    if (version < PROJECT_STATE_SCHEMA_VERSION) {
      if (options.accessMode === 'read-only') {
        throw new ProjectStateError(
          'PROJECT_STATE_MIGRATION_REQUIRED',
          'The project state database must be migrated before read-only use.',
        );
      }

      await migrateLegacyState(database, options);
    }

    assertDatabaseHealthy(database, options.projectId);
  } finally {
    closeDatabaseBestEffort(database);
  }
}

export class NodeProjectStateStore {
  readonly #accessMode: ProjectAccessMode;
  readonly #database: DatabaseSync;
  readonly #generateId: () => string;
  readonly #now: () => Date;
  readonly #projectDirectory: string;
  readonly #projectId: string;
  #closed = false;

  private constructor(options: OpenProjectStateOptions) {
    this.#accessMode = options.accessMode;
    this.#generateId = options.generateId ?? randomUUID;
    this.#now = options.now ?? (() => new Date());
    this.#projectDirectory = options.projectDirectory;
    this.#projectId = options.projectId;
    this.#database = openDatabase(
      join(options.projectDirectory, PROJECT_STATE_RELATIVE_PATH),
      options.accessMode === 'read-only',
    );
    configureDatabase(this.#database, options.accessMode);
    assertDatabaseHealthy(this.#database, options.projectId);
  }

  static async open(
    options: OpenProjectStateOptions,
  ): Promise<NodeProjectStateStore> {
    await ensureProjectState(options);
    return new NodeProjectStateStore(options);
  }

  close(): void {
    if (this.#closed)
      return;
    this.#database.close();
    this.#closed = true;
  }

  activateArtifactRevision(
    revisionId: string,
    changeSelector?: ArtifactSelector,
  ): ArtifactRecord {
    this.#assertWritable();
    return this.#transaction(() => {
      const record = this.getArtifactRevision(revisionId);
      if (!record) {
        throw new ProjectStateError(
          'PROJECT_STATE_NOT_FOUND',
          'The reusable artifact revision does not exist.',
        );
      }
      const activeCause = this.#database.prepare(`
        SELECT 1 AS found FROM stale_causes
        WHERE consumer_revision_id = ? AND status = 'active'
        LIMIT 1
      `).get(revisionId) as SqlRow | undefined;
      if (
        record.executionStatus !== 'succeeded'
        || record.validityStatus === 'missing'
        || activeCause
      ) {
        throw new ProjectStateError(
          'PROJECT_STATE_CONFLICT',
          'Only a complete revision without active stale causes can be activated.',
        );
      }

      this.#activateAndPropagate(
        record,
        changeSelector,
        this.#now().toISOString(),
      );
      return this.getArtifactRevision(revisionId) as ArtifactRecord;
    });
  }

  async createBackup(): Promise<string> {
    this.#assertOpen();
    const backupDirectory = join(this.#projectDirectory, 'state/backups');
    await mkdir(backupDirectory, { recursive: true });
    const timestamp = this.#now().toISOString().replaceAll(/[:.]/g, '-');
    const backupPath = join(
      backupDirectory,
      `project-v${PROJECT_STATE_SCHEMA_VERSION}-${timestamp}-${this.#generateId()}.sqlite`,
    );
    await createPrivateFile(backupPath);
    try {
      await backup(this.#database, backupPath);
    } catch (error) {
      await unlink(backupPath).catch(() => {});
      throw error;
    }
    return backupPath;
  }

  createStageRun(
    command: CreateStageRunCommand,
    stageRunId: string,
  ): StageRunRecord {
    this.#assertWritable();
    return this.#transaction(() => {
      const record: StageRunRecord = {
        stageRunId,
        stageId: command.stageId,
        inputFingerprint: command.inputFingerprint,
        executionStatus: 'pending',
        createdAt: this.#now().toISOString(),
      };
      parseStageRunRecord(record);
      this.#database.prepare(`
        INSERT INTO stage_runs(
          stage_run_id, stage_id, input_fingerprint, execution_status,
          started_at, finished_at, created_at
        ) VALUES (?, ?, ?, 'pending', NULL, NULL, ?)
      `).run(
        record.stageRunId,
        record.stageId,
        record.inputFingerprint,
        record.createdAt,
      );
      return record;
    });
  }

  registerSourceAsset(record: SourceAssetRecord): SourceAssetRecord {
    this.#assertWritable();
    parseSourceAssetRecord(record);
    return this.#transaction(() => {
      this.#database.prepare(`
        INSERT INTO source_assets(
          source_asset_id, source_type, original_name, content_hash,
          relative_path, created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.sourceAssetId,
        record.sourceType,
        record.originalName,
        record.contentHash,
        record.relativePath,
        record.createdAt,
        record.createdBy,
      );
      return record;
    });
  }

  enqueueTask(
    command: EnqueueTaskCommand,
    taskId: string,
    temporaryPath: string,
  ): EnqueueTaskResult {
    this.#assertWritable();
    return this.#transaction(() => {
      const outputScopeJson = serializeJson(command.outputScope);
      const existing = this.#database.prepare(`
        SELECT * FROM tasks
        WHERE project_id = ?
          AND processor_id = ?
          AND input_fingerprint = ?
          AND output_scope_json = ?
          AND (
            execution_status IN ('pending', 'running')
            OR (
              execution_status = 'succeeded'
              AND result_revision_id IS NOT NULL
              AND EXISTS (
                SELECT 1
                FROM artifact_revision_state s
                WHERE s.revision_id = tasks.result_revision_id
                  AND s.validity_status != 'missing'
              )
            )
          )
        ORDER BY attempt DESC
        LIMIT 1
      `).get(
        this.#projectId,
        command.processorId,
        command.inputFingerprint,
        outputScopeJson,
      ) as SqlRow | undefined;

      if (existing) {
        return { reused: true, task: mapTaskRow(existing) };
      }

      const previousAttempt = this.#database.prepare(`
        SELECT COALESCE(MAX(attempt), 0) AS attempt
        FROM tasks
        WHERE project_id = ?
          AND processor_id = ?
          AND input_fingerprint = ?
          AND output_scope_json = ?
      `).get(
        this.#projectId,
        command.processorId,
        command.inputFingerprint,
        outputScopeJson,
      ) as SqlRow;
      const attempt = readInteger(previousAttempt, 'attempt') + 1;
      const timestamp = this.#now().toISOString();
      const task: TaskRecord = {
        taskId,
        projectId: this.#projectId,
        processorId: command.processorId,
        inputFingerprint: command.inputFingerprint,
        outputScope: command.outputScope,
        dedupeKey: sha256CanonicalJson({
          inputFingerprint: command.inputFingerprint,
          outputScope: command.outputScope,
          processorId: command.processorId,
          projectId: this.#projectId,
        } as unknown as JsonValue),
        executionStatus: 'pending',
        recoveryStatus: 'resumable',
        attempt,
        temporaryPath,
        createdAt: timestamp,
        updatedAt: timestamp,
      };
      parseTaskRecord(task);
      insertTask(this.#database, task);
      return { reused: false, task };
    });
  }

  getTask(taskId: string): TaskRecord | undefined {
    this.#assertOpen();
    const row = this.#database.prepare(
      'SELECT * FROM tasks WHERE task_id = ?',
    ).get(taskId) as SqlRow | undefined;
    return row ? mapTaskRow(row) : undefined;
  }

  getStageRun(stageRunId: string): StageRunRecord | undefined {
    this.#assertOpen();
    const row = this.#database.prepare(
      'SELECT * FROM stage_runs WHERE stage_run_id = ?',
    ).get(stageRunId) as SqlRow | undefined;
    return row ? mapStageRunRow(row) : undefined;
  }

  startTask(taskId: string): TaskRecord {
    this.#assertWritable();
    return this.#transitionTask(taskId, ['pending'], 'running', {
      recoveryStatus: 'retryable',
      startedAt: this.#now().toISOString(),
    });
  }

  startStageRun(stageRunId: string): StageRunRecord {
    this.#assertWritable();
    return this.#transitionStageRun(stageRunId, ['pending'], 'running');
  }

  finishStageRun(
    stageRunId: string,
    status: 'canceled' | 'failed' | 'succeeded',
  ): StageRunRecord {
    this.#assertWritable();
    return this.#transitionStageRun(stageRunId, ['running'], status);
  }

  failTask(command: FailTaskCommand): TaskRecord {
    this.#assertWritable();
    return this.#transitionTask(
      command.taskId,
      ['pending', 'running'],
      'failed',
      {
        errorCode: command.errorCode,
        errorMessage: command.errorMessage,
        finishedAt: this.#now().toISOString(),
        recoveryStatus: 'retryable',
      },
    );
  }

  cancelTask(taskId: string): TaskRecord {
    this.#assertWritable();
    return this.#transitionTask(
      taskId,
      ['pending', 'running'],
      'canceled',
      {
        finishedAt: this.#now().toISOString(),
        recoveryStatus: 'none',
      },
    );
  }

  commitArtifact(command: CommitStoredArtifactCommand): ArtifactRecord {
    this.#assertWritable();
    parseArtifactRecord(command.record);

    return this.#transaction(() => {
      const existingArtifact = this.#database.prepare(
        'SELECT * FROM artifacts WHERE artifact_id = ?',
      ).get(command.record.artifactId) as SqlRow | undefined;
      if (!existingArtifact) {
        this.#database.prepare(`
          INSERT INTO artifacts(
            artifact_id, artifact_type, lineage_id, scope_json, storage_kind,
            active_revision_id, created_at
          ) VALUES (?, ?, ?, ?, ?, NULL, ?)
        `).run(
          command.record.artifactId,
          command.record.artifactType,
          command.record.lineageId,
          serializeJson(command.record.scope),
          command.record.storageKind,
          command.record.createdAt,
        );
      } else {
        assertArtifactIdentity(existingArtifact, command.record);
      }

      this.#database.prepare(`
        INSERT INTO artifact_revisions(
          revision_id, artifact_id, content_path, content_hash,
          input_fingerprint, processor_id, processor_version, parameters_hash,
          created_at, created_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        command.record.revisionId,
        command.record.artifactId,
        command.record.contentPath,
        command.record.contentHash,
        command.record.inputFingerprint,
        command.record.processorId,
        command.record.processorVersion,
        command.record.parametersHash,
        command.record.createdAt,
        command.record.createdBy,
      );
      this.#database.prepare(`
        INSERT INTO artifact_revision_state(
          revision_id, execution_status, validity_status, review_status, updated_at
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        command.record.revisionId,
        command.record.executionStatus,
        command.record.validityStatus,
        command.record.reviewStatus,
        command.record.createdAt,
      );

      for (const dependency of command.dependencies) {
        this.#insertDependency(command.record, dependency);
      }

      if (command.activate) {
        this.#activateAndPropagate(
          command.record,
          command.changeSelector,
          command.record.createdAt,
        );
      }

      if (command.taskId) {
        const task = this.getTask(command.taskId);
        if (!task || !['pending', 'running'].includes(task.executionStatus)) {
          throw new ProjectStateError(
            'PROJECT_STATE_CONFLICT',
            'The result task is missing or is not committable.',
          );
        }
        const timestamp = this.#now().toISOString();
        this.#database.prepare(`
          UPDATE tasks
          SET execution_status = 'succeeded', recovery_status = 'none',
              result_revision_id = ?, updated_at = ?, finished_at = ?,
              error_code = NULL, error_message = NULL
          WHERE task_id = ?
        `).run(
          command.record.revisionId,
          timestamp,
          timestamp,
          command.taskId,
        );
      }

      return this.getArtifactRevision(command.record.revisionId) as ArtifactRecord;
    });
  }

  getArtifactRevision(revisionId: string): ArtifactRecord | undefined {
    this.#assertOpen();
    const row = this.#database.prepare(ARTIFACT_RECORD_QUERY).get(
      revisionId,
    ) as SqlRow | undefined;
    return row ? mapArtifactRow(row) : undefined;
  }

  findReusableRevision(
    inputFingerprint: string,
    processorId: string,
    scope: ArtifactScope,
  ): ArtifactRecord | undefined {
    this.#assertOpen();
    const row = this.#database.prepare(`
      ${ARTIFACT_RECORD_QUERY_BASE}
      WHERE r.input_fingerprint = ?
        AND r.processor_id = ?
        AND a.scope_json = ?
        AND s.execution_status = 'succeeded'
        AND s.validity_status != 'missing'
        AND s.review_status != 'rejected'
        AND NOT EXISTS (
          SELECT 1 FROM stale_causes c
          WHERE c.consumer_revision_id = r.revision_id
            AND c.status = 'active'
        )
      ORDER BY r.created_at DESC
      LIMIT 1
    `).get(
      inputFingerprint,
      processorId,
      serializeJson(scope),
    ) as SqlRow | undefined;
    return row ? mapArtifactRow(row) : undefined;
  }

  listArtifactDependencies(revisionId: string): readonly ArtifactDependency[] {
    this.#assertOpen();
    return (this.#database.prepare(`
      SELECT * FROM artifact_dependencies
      WHERE consumer_revision_id = ?
      ORDER BY dependency_id
    `).all(revisionId) as SqlRow[]).map(mapDependencyRow);
  }

  listStaleCauses(revisionId: string): readonly StaleCause[] {
    this.#assertOpen();
    return (this.#database.prepare(`
      SELECT * FROM stale_causes
      WHERE consumer_revision_id = ?
      ORDER BY created_at, stale_cause_id
    `).all(revisionId) as SqlRow[]).map(mapStaleCauseRow);
  }

  previewArtifactImpact(
    command: PreviewArtifactImpactCommand,
  ): ArtifactImpactPreview {
    this.#assertOpen();
    const artifact = this.#database.prepare(`
      SELECT active_revision_id FROM artifacts WHERE artifact_id = ?
    `).get(command.producerArtifactId) as SqlRow | undefined;
    const producerRevisionId = artifact
      ? readOptionalString(artifact, 'active_revision_id')
      : undefined;
    if (!producerRevisionId) {
      throw new ProjectStateError(
        'PROJECT_STATE_NOT_FOUND',
        'The impact producer has no active artifact revision.',
      );
    }

    const impacts: ArtifactImpactItem[] = [];
    const queue = [{
      changeSelector: command.changeSelector,
      currentRevisionId: producerRevisionId,
      depth: 1,
      producerArtifactId: command.producerArtifactId,
      root: true,
    }];
    const visited = new Set<string>();
    while (queue.length > 0) {
      const current = queue.shift();
      if (!current)
        break;
      const visitKey = `${current.producerArtifactId}:${current.currentRevisionId}`;
      if (visited.has(visitKey))
        continue;
      visited.add(visitKey);

      const revisionClause = current.root
        ? ''
        : 'AND d.producer_revision_id = ?';
      const values = current.root
        ? [current.producerArtifactId]
        : [current.producerArtifactId, current.currentRevisionId];
      const rows = this.#database.prepare(`
        SELECT d.*
        FROM artifact_dependencies d
        INNER JOIN artifacts a
          ON a.artifact_id = d.consumer_artifact_id
         AND a.active_revision_id = d.consumer_revision_id
        WHERE d.producer_artifact_id = ?
          ${revisionClause}
        ORDER BY d.dependency_id
      `).all(...values) as SqlRow[];

      for (const row of rows) {
        const dependency = mapDependencyRow(row);
        if (!selectorsIntersect(dependency.selector, current.changeSelector))
          continue;
        impacts.push({
          consumerArtifactId: dependency.consumerArtifactId,
          consumerRevisionId: dependency.consumerRevisionId,
          dependencyType: dependency.dependencyType,
          depth: current.depth,
          producerArtifactId: dependency.producerArtifactId,
          producerRevisionId: dependency.producerRevisionId,
          ...(dependency.selector ? { selector: dependency.selector } : {}),
        });
        queue.push({
          changeSelector: undefined,
          currentRevisionId: dependency.consumerRevisionId,
          depth: current.depth + 1,
          producerArtifactId: dependency.consumerArtifactId,
          root: false,
        });
      }
    }

    return {
      ...(command.changeSelector
        ? { changeSelector: command.changeSelector }
        : {}),
      impacts,
      producerArtifactId: command.producerArtifactId,
      producerRevisionId,
    };
  }

  resolveStaleCause(staleCauseId: string): StaleCause {
    this.#assertWritable();
    return this.#transaction(() => {
      const row = this.#database.prepare(
        'SELECT * FROM stale_causes WHERE stale_cause_id = ?',
      ).get(staleCauseId) as SqlRow | undefined;
      if (!row) {
        throw new ProjectStateError(
          'PROJECT_STATE_NOT_FOUND',
          'The stale cause does not exist.',
        );
      }

      const cause = mapStaleCauseRow(row);
      if (cause.status === 'resolved')
        return cause;

      const timestamp = this.#now().toISOString();
      this.#database.prepare(`
        UPDATE stale_causes
        SET status = 'resolved', resolved_at = ?
        WHERE stale_cause_id = ?
      `).run(timestamp, staleCauseId);
      this.#recomputeRevisionValidity(cause.consumerRevisionId, timestamp);
      return mapStaleCauseRow({
        ...row,
        status: 'resolved',
        resolved_at: timestamp,
      });
    });
  }

  recordReviewDecision(
    command: RecordReviewDecisionCommand,
  ): ReviewDecisionRecord {
    this.#assertWritable();
    return this.#transaction(() => {
      const artifact = this.getArtifactRevision(command.revisionId);
      if (!artifact || artifact.artifactId !== command.artifactId) {
        throw new ProjectStateError(
          'PROJECT_STATE_NOT_FOUND',
          'The reviewed artifact revision does not exist.',
        );
      }

      const record: ReviewDecisionRecord = {
        reviewDecisionId: this.#generateId(),
        artifactId: command.artifactId,
        revisionId: command.revisionId,
        decision: command.decision,
        ...(command.note ? { note: command.note } : {}),
        decidedAt: this.#now().toISOString(),
        decidedBy: command.decidedBy,
      };
      parseReviewDecisionRecord(record);
      this.#database.prepare(`
        INSERT INTO review_decisions(
          review_decision_id, artifact_id, revision_id, decision, note,
          decided_at, decided_by
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
        record.reviewDecisionId,
        record.artifactId,
        record.revisionId,
        record.decision,
        record.note ?? null,
        record.decidedAt,
        record.decidedBy,
      );
      this.#database.prepare(`
        UPDATE artifact_revision_state
        SET review_status = ?, updated_at = ?
        WHERE revision_id = ?
      `).run(record.decision, record.decidedAt, record.revisionId);
      return record;
    });
  }

  createExportSnapshot(
    command: CreateExportSnapshotCommand,
  ): ExportSnapshotRecord {
    this.#assertWritable();
    return this.#transaction(() => {
      if (command.revisionIds.length === 0) {
        throw new ProjectStateError(
          'PROJECT_STATE_INVALID',
          'An export snapshot must contain at least one revision.',
        );
      }

      for (const revisionId of command.revisionIds) {
        const artifact = this.getArtifactRevision(revisionId);
        if (!artifact) {
          throw new ProjectStateError(
            'PROJECT_STATE_NOT_FOUND',
            `Export revision ${revisionId} does not exist.`,
          );
        }
        if (
          ['stale', 'missing'].includes(artifact.validityStatus)
          && !command.staleWaiverReason
        ) {
          throw new ProjectStateError(
            'PROJECT_STATE_CONFLICT',
            'Stale or missing revisions require an explicit export waiver.',
          );
        }
      }

      const record: ExportSnapshotRecord = {
        exportSnapshotId: this.#generateId(),
        revisionIds: [...new Set(command.revisionIds)],
        ...(command.staleWaiverReason
          ? { staleWaiverReason: command.staleWaiverReason }
          : {}),
        createdAt: this.#now().toISOString(),
        createdBy: command.createdBy,
      };
      parseExportSnapshotRecord(record);
      this.#database.prepare(`
        INSERT INTO export_snapshots(
          export_snapshot_id, revision_ids_json, stale_waiver_reason,
          created_at, created_by
        ) VALUES (?, ?, ?, ?, ?)
      `).run(
        record.exportSnapshotId,
        serializeJson(record.revisionIds),
        record.staleWaiverReason ?? null,
        record.createdAt,
        record.createdBy,
      );
      return record;
    });
  }

  recoverInterruptedTasks(): readonly string[] {
    this.#assertWritable();
    return this.#transaction(() => {
      const rows = this.#database.prepare(`
        SELECT task_id FROM tasks WHERE execution_status = 'running'
        ORDER BY task_id
      `).all() as SqlRow[];
      const timestamp = this.#now().toISOString();
      this.#database.prepare(`
        UPDATE tasks
        SET execution_status = 'pending', recovery_status = 'retryable',
            updated_at = ?, error_code = 'TASK_INTERRUPTED',
            error_message = 'The application stopped while the task was running.'
        WHERE execution_status = 'running'
      `).run(timestamp);
      return rows.map(row => readString(row, 'task_id'));
    });
  }

  recoverInterruptedStageRuns(): readonly string[] {
    this.#assertWritable();
    return this.#transaction(() => {
      const rows = this.#database.prepare(`
        SELECT stage_run_id FROM stage_runs
        WHERE execution_status = 'running'
        ORDER BY stage_run_id
      `).all() as SqlRow[];
      this.#database.prepare(`
        UPDATE stage_runs
        SET execution_status = 'failed', finished_at = ?
        WHERE execution_status = 'running'
      `).run(this.#now().toISOString());
      return rows.map(row => readString(row, 'stage_run_id'));
    });
  }

  markRevisionMissing(revisionId: string): void {
    this.#assertWritable();
    this.#transaction(() => {
      const result = this.#database.prepare(`
        UPDATE artifact_revision_state
        SET validity_status = 'missing', updated_at = ?
        WHERE revision_id = ?
      `).run(this.#now().toISOString(), revisionId);
      if (Number(result.changes) !== 1) {
        throw new ProjectStateError(
          'PROJECT_STATE_NOT_FOUND',
          'The missing artifact revision does not exist.',
        );
      }
    });
  }

  restoreRevision(revisionId: string): void {
    this.#assertWritable();
    this.#transaction(() => {
      const record = this.getArtifactRevision(revisionId);
      if (!record) {
        throw new ProjectStateError(
          'PROJECT_STATE_NOT_FOUND',
          'The restored artifact revision does not exist.',
        );
      }
      this.#recomputeRevisionValidity(
        revisionId,
        this.#now().toISOString(),
        true,
      );
    });
  }

  markTaskRetryable(taskId: string): void {
    this.#assertWritable();
    this.#transaction(() => {
      const result = this.#database.prepare(`
        UPDATE tasks
        SET recovery_status = 'retryable', updated_at = ?
        WHERE task_id = ?
      `).run(this.#now().toISOString(), taskId);
      if (Number(result.changes) !== 1) {
        throw new ProjectStateError(
          'PROJECT_STATE_NOT_FOUND',
          'The recoverable task does not exist.',
        );
      }
    });
  }

  listRevisionPaths(): readonly StoredRevisionPath[] {
    this.#assertOpen();
    return (this.#database.prepare(`
      ${ARTIFACT_RECORD_QUERY_BASE}
      ORDER BY r.revision_id
    `).all() as SqlRow[]).map((row) => {
      const record = mapArtifactRow(row);
      return {
        revisionId: record.revisionId,
        contentPath: record.contentPath,
        contentHash: record.contentHash,
        dependencies: this.listArtifactDependencies(record.revisionId),
        record,
      };
    });
  }

  listTaskPaths(): ReadonlyMap<string, string> {
    this.#assertOpen();
    return new Map(
      (this.#database.prepare(`
        SELECT task_id, temporary_path FROM tasks ORDER BY task_id
      `).all() as SqlRow[]).map(row => [
        readString(row, 'task_id'),
        readString(row, 'temporary_path'),
      ]),
    );
  }

  #activateAndPropagate(
    record: ArtifactRecord,
    changeSelector: ArtifactSelector | undefined,
    timestamp: string,
  ): void {
    const artifact = this.#database.prepare(
      'SELECT active_revision_id FROM artifacts WHERE artifact_id = ?',
    ).get(record.artifactId) as SqlRow;
    const previousRevisionId = readOptionalString(
      artifact,
      'active_revision_id',
    );

    if (previousRevisionId && previousRevisionId !== record.revisionId) {
      this.#resolveReversedCauses(
        record.artifactId,
        record.revisionId,
        previousRevisionId,
        timestamp,
      );
      this.#database.prepare(`
        UPDATE artifact_revision_state
        SET validity_status = CASE
          WHEN validity_status = 'missing' THEN 'missing'
          ELSE 'superseded'
        END,
        updated_at = ?
        WHERE revision_id = ?
      `).run(timestamp, previousRevisionId);
    }
    this.#database.prepare(`
      UPDATE artifact_revision_state
      SET validity_status = 'current', updated_at = ?
      WHERE revision_id = ? AND validity_status != 'missing'
    `).run(timestamp, record.revisionId);
    this.#database.prepare(`
      UPDATE artifacts SET active_revision_id = ? WHERE artifact_id = ?
    `).run(record.revisionId, record.artifactId);

    if (!previousRevisionId || previousRevisionId === record.revisionId)
      return;

    const rootCauseKey = sha256CanonicalJson({
      artifactId: record.artifactId,
      changeSelector: changeSelector ?? null,
      currentRevisionId: record.revisionId,
      previousRevisionId,
    } as unknown as JsonValue);
    const queue: PropagationItem[] = [{
      changeSelector,
      currentRevisionId: record.revisionId,
      includeCurrentDependency: false,
      producerArtifactId: record.artifactId,
      rootCauseKey,
    }];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const current = queue.shift();
      if (!current)
        break;
      const visitKey = `${current.rootCauseKey}:${current.producerArtifactId}`;
      if (visited.has(visitKey))
        continue;
      visited.add(visitKey);

      const revisionPredicate = current.includeCurrentDependency ? '=' : '!=';
      const rows = this.#database.prepare(`
        SELECT d.*
        FROM artifact_dependencies d
        INNER JOIN artifacts a
          ON a.artifact_id = d.consumer_artifact_id
         AND a.active_revision_id = d.consumer_revision_id
        WHERE d.producer_artifact_id = ?
          AND d.producer_revision_id ${revisionPredicate} ?
        ORDER BY d.dependency_id
      `).all(
        current.producerArtifactId,
        current.currentRevisionId,
      ) as SqlRow[];

      for (const row of rows) {
        const dependency = mapDependencyRow(row);
        if (!selectorsIntersect(dependency.selector, current.changeSelector))
          continue;

        const cause: StaleCause = {
          staleCauseId: this.#generateId(),
          rootCauseKey: current.rootCauseKey,
          consumerArtifactId: dependency.consumerArtifactId,
          consumerRevisionId: dependency.consumerRevisionId,
          producerArtifactId: dependency.producerArtifactId,
          previousProducerRevisionId: dependency.producerRevisionId,
          currentProducerRevisionId: current.currentRevisionId,
          dependencyType: dependency.dependencyType,
          ...(dependency.selector ? { selector: dependency.selector } : {}),
          status: 'active',
          createdAt: timestamp,
        };
        parseStaleCause(cause);
        const inserted = this.#database.prepare(`
          INSERT OR IGNORE INTO stale_causes(
            stale_cause_id, root_cause_key, consumer_artifact_id,
            consumer_revision_id, producer_artifact_id,
            previous_producer_revision_id, current_producer_revision_id,
            dependency_type, selector_json, status, created_at, resolved_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'active', ?, NULL)
        `).run(
          cause.staleCauseId,
          cause.rootCauseKey,
          cause.consumerArtifactId,
          cause.consumerRevisionId,
          cause.producerArtifactId,
          cause.previousProducerRevisionId,
          cause.currentProducerRevisionId,
          cause.dependencyType,
          cause.selector ? serializeJson(cause.selector) : '',
          cause.createdAt,
        );
        if (Number(inserted.changes) === 0)
          continue;

        this.#database.prepare(`
          UPDATE artifact_revision_state
          SET validity_status = CASE
            WHEN validity_status = 'missing' THEN 'missing'
            ELSE 'stale'
          END,
          updated_at = ?
          WHERE revision_id = ?
        `).run(timestamp, cause.consumerRevisionId);
        queue.push({
          currentRevisionId: cause.consumerRevisionId,
          includeCurrentDependency: true,
          producerArtifactId: cause.consumerArtifactId,
          rootCauseKey: cause.rootCauseKey,
        });
      }
    }
  }

  #resolveReversedCauses(
    producerArtifactId: string,
    targetRevisionId: string,
    previousActiveRevisionId: string,
    timestamp: string,
  ): void {
    const roots = this.#database.prepare(`
      SELECT DISTINCT root_cause_key
      FROM stale_causes
      WHERE producer_artifact_id = ?
        AND previous_producer_revision_id = ?
        AND current_producer_revision_id = ?
        AND status = 'active'
    `).all(
      producerArtifactId,
      targetRevisionId,
      previousActiveRevisionId,
    ) as SqlRow[];

    for (const root of roots) {
      const rootCauseKey = readString(root, 'root_cause_key');
      const consumers = this.#database.prepare(`
        SELECT DISTINCT consumer_revision_id
        FROM stale_causes
        WHERE root_cause_key = ? AND status = 'active'
      `).all(rootCauseKey) as SqlRow[];
      this.#database.prepare(`
        UPDATE stale_causes
        SET status = 'resolved', resolved_at = ?
        WHERE root_cause_key = ? AND status = 'active'
      `).run(timestamp, rootCauseKey);
      for (const consumer of consumers) {
        this.#recomputeRevisionValidity(
          readString(consumer, 'consumer_revision_id'),
          timestamp,
        );
      }
    }
  }

  #insertDependency(
    consumer: ArtifactRecord,
    input: ArtifactDependencyInput,
  ): void {
    const producer = this.getArtifactRevision(input.producerRevisionId);
    if (!producer || producer.artifactId !== input.producerArtifactId) {
      throw new ProjectStateError(
        'PROJECT_STATE_NOT_FOUND',
        'An artifact dependency references a missing producer revision.',
      );
    }
    const dependency: ArtifactDependency = {
      dependencyId: this.#generateId(),
      consumerArtifactId: consumer.artifactId,
      consumerRevisionId: consumer.revisionId,
      producerArtifactId: input.producerArtifactId,
      producerRevisionId: input.producerRevisionId,
      dependencyType: input.dependencyType,
      ...(input.selector ? { selector: input.selector } : {}),
    };
    parseArtifactDependency(dependency);
    this.#database.prepare(`
      INSERT INTO artifact_dependencies(
        dependency_id, consumer_artifact_id, consumer_revision_id,
        producer_artifact_id, producer_revision_id, dependency_type,
        selector_json
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(
      dependency.dependencyId,
      dependency.consumerArtifactId,
      dependency.consumerRevisionId,
      dependency.producerArtifactId,
      dependency.producerRevisionId,
      dependency.dependencyType,
      dependency.selector ? serializeJson(dependency.selector) : '',
    );
  }

  #recomputeRevisionValidity(
    revisionId: string,
    timestamp: string,
    restoreMissing = false,
  ): void {
    const activeCause = this.#database.prepare(`
      SELECT 1 AS found FROM stale_causes
      WHERE consumer_revision_id = ? AND status = 'active'
      LIMIT 1
    `).get(revisionId) as SqlRow | undefined;
    if (activeCause) {
      if (restoreMissing) {
        this.#database.prepare(`
          UPDATE artifact_revision_state
          SET validity_status = 'stale', updated_at = ?
          WHERE revision_id = ?
        `).run(timestamp, revisionId);
      }
      return;
    }

    const artifact = this.#database.prepare(`
      SELECT a.active_revision_id
      FROM artifacts a
      INNER JOIN artifact_revisions r ON r.artifact_id = a.artifact_id
      WHERE r.revision_id = ?
    `).get(revisionId) as SqlRow | undefined;
    if (!artifact)
      return;
    const validity = readOptionalString(artifact, 'active_revision_id') === revisionId
      ? 'current'
      : 'superseded';
    this.#database.prepare(`
      UPDATE artifact_revision_state
      SET validity_status = ?, updated_at = ?
      WHERE revision_id = ?
        AND (? = 1 OR validity_status != 'missing')
    `).run(validity, timestamp, revisionId, restoreMissing ? 1 : 0);
  }

  #transitionTask(
    taskId: string,
    allowed: readonly TaskRecord['executionStatus'][],
    next: TaskRecord['executionStatus'],
    updates: {
      errorCode?: string;
      errorMessage?: string;
      finishedAt?: string;
      recoveryStatus: TaskRecord['recoveryStatus'];
      startedAt?: string;
    },
  ): TaskRecord {
    return this.#transaction(() => {
      const current = this.getTask(taskId);
      if (!current) {
        throw new ProjectStateError(
          'PROJECT_STATE_NOT_FOUND',
          'The task does not exist.',
        );
      }
      if (!allowed.includes(current.executionStatus)) {
        throw new ProjectStateError(
          'PROJECT_STATE_CONFLICT',
          `Task ${taskId} cannot transition from ${current.executionStatus} to ${next}.`,
        );
      }

      const timestamp = this.#now().toISOString();
      this.#database.prepare(`
        UPDATE tasks
        SET execution_status = ?, recovery_status = ?, updated_at = ?,
            started_at = COALESCE(?, started_at),
            finished_at = COALESCE(?, finished_at),
            error_code = ?, error_message = ?
        WHERE task_id = ?
      `).run(
        next,
        updates.recoveryStatus,
        timestamp,
        updates.startedAt ?? null,
        updates.finishedAt ?? null,
        updates.errorCode ?? null,
        updates.errorMessage ?? null,
        taskId,
      );
      return this.getTask(taskId) as TaskRecord;
    });
  }

  #transitionStageRun(
    stageRunId: string,
    allowed: readonly StageRunRecord['executionStatus'][],
    next: StageRunRecord['executionStatus'],
  ): StageRunRecord {
    return this.#transaction(() => {
      const current = this.getStageRun(stageRunId);
      if (!current) {
        throw new ProjectStateError(
          'PROJECT_STATE_NOT_FOUND',
          'The stage run does not exist.',
        );
      }
      if (!allowed.includes(current.executionStatus)) {
        throw new ProjectStateError(
          'PROJECT_STATE_CONFLICT',
          `Stage run ${stageRunId} cannot transition from ${current.executionStatus} to ${next}.`,
        );
      }
      const timestamp = this.#now().toISOString();
      this.#database.prepare(`
        UPDATE stage_runs
        SET execution_status = ?,
            started_at = CASE WHEN ? = 'running' THEN ? ELSE started_at END,
            finished_at = CASE WHEN ? != 'running' THEN ? ELSE finished_at END
        WHERE stage_run_id = ?
      `).run(next, next, timestamp, next, timestamp, stageRunId);
      return this.getStageRun(stageRunId) as StageRunRecord;
    });
  }

  #transaction<T>(operation: () => T): T {
    this.#assertWritable();
    if (this.#database.isTransaction) {
      throw new ProjectStateError(
        'PROJECT_STATE_TRANSACTION_FAILED',
        'Nested project state transactions are not supported.',
      );
    }

    this.#database.exec('BEGIN IMMEDIATE');
    try {
      const result = operation();
      this.#database.exec('COMMIT');
      return result;
    } catch (error) {
      try {
        if (this.#database.isTransaction)
          this.#database.exec('ROLLBACK');
      } catch {
        // Preserve the domain or SQLite error that caused the rollback.
      }
      if (error instanceof ProjectStateError)
        throw error;
      throw new ProjectStateError(
        'PROJECT_STATE_TRANSACTION_FAILED',
        'The project state transaction failed.',
        error,
      );
    }
  }

  #assertOpen(): void {
    if (this.#closed) {
      throw new ProjectStateError(
        'PROJECT_STATE_CLOSED',
        'The project state database is closed.',
      );
    }
  }

  #assertWritable(): void {
    this.#assertOpen();
    if (this.#accessMode !== 'read-write') {
      throw new ProjectStateError(
        'PROJECT_STATE_READ_ONLY',
        'The project state database is open read-only.',
      );
    }
  }
}

function openDatabase(path: string, readOnly: boolean): DatabaseSync {
  try {
    return new NodeDatabaseSync(path, {
      allowExtension: false,
      defensive: true,
      enableDoubleQuotedStringLiterals: false,
      enableForeignKeyConstraints: true,
      readOnly,
      timeout: DATABASE_TIMEOUT_MS,
    });
  } catch (error) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'Unable to open the project state database.',
      error,
    );
  }
}

function configureDatabase(
  database: DatabaseSync,
  accessMode: ProjectAccessMode,
): void {
  database.exec(`
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA trusted_schema = OFF;
  `);
  if (accessMode === 'read-write') {
    configureWritableDatabase(database);
  } else {
    database.exec('PRAGMA query_only = ON;');
  }
}

function configureWritableDatabase(database: DatabaseSync): void {
  database.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = FULL;
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 5000;
    PRAGMA trusted_schema = OFF;
  `);
}

function createCurrentSchema(
  database: DatabaseSync,
  projectId: string,
  createdAt: string,
  now: Date,
): void {
  const timestamp = now.toISOString();
  const record = parseProjectRecord({
    projectId,
    schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
    createdAt,
    updatedAt: timestamp,
  });
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(PROJECT_STATE_SCHEMA_SQL);
    database.prepare(`
      INSERT INTO project_metadata(
        singleton, project_id, schema_version, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?)
    `).run(
      record.projectId,
      record.schemaVersion,
      record.createdAt,
      record.updatedAt,
    );
    database.prepare(
      'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    ).run(PROJECT_STATE_SCHEMA_VERSION, timestamp);
    database.exec(`PRAGMA user_version = ${PROJECT_STATE_SCHEMA_VERSION}; COMMIT`);
  } catch (error) {
    if (database.isTransaction)
      database.exec('ROLLBACK');
    throw error;
  }
}

async function migrateLegacyState(
  database: DatabaseSync,
  options: OpenProjectStateOptions,
): Promise<void> {
  const legacyTable = database.prepare(`
    SELECT 1 AS found FROM sqlite_schema
    WHERE type = 'table' AND name = 'legacy_project_metadata'
  `).get() as SqlRow | undefined;
  if (!legacyTable) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The legacy project state schema is not recognized.',
    );
  }
  const legacy = database.prepare(
    'SELECT project_id, created_at FROM legacy_project_metadata LIMIT 1',
  ).get() as SqlRow | undefined;
  if (!legacy || readString(legacy, 'project_id') !== options.projectId) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The legacy project state belongs to a different project.',
    );
  }

  const backupDirectory = join(options.projectDirectory, 'state/backups');
  await mkdir(backupDirectory, { recursive: true });
  const id = (options.generateId ?? randomUUID)();
  const backupPath = join(backupDirectory, `project-v0-${id}.sqlite`);
  await createPrivateFile(backupPath);
  try {
    await backup(database, backupPath);
  } catch (error) {
    await unlink(backupPath).catch(() => {});
    throw error;
  }

  const now = options.now ?? (() => new Date());
  database.exec('BEGIN IMMEDIATE');
  try {
    database.exec(PROJECT_STATE_SCHEMA_SQL);
    const timestamp = now().toISOString();
    const record = parseProjectRecord({
      projectId: options.projectId,
      schemaVersion: PROJECT_STATE_SCHEMA_VERSION,
      createdAt: readString(legacy, 'created_at'),
      updatedAt: timestamp,
    });
    database.prepare(`
      INSERT INTO project_metadata(
        singleton, project_id, schema_version, created_at, updated_at
      ) VALUES (1, ?, ?, ?, ?)
    `).run(
      record.projectId,
      record.schemaVersion,
      record.createdAt,
      record.updatedAt,
    );
    database.prepare(
      'INSERT INTO schema_migrations(version, applied_at) VALUES (?, ?)',
    ).run(PROJECT_STATE_SCHEMA_VERSION, timestamp);
    database.exec(`
      DROP TABLE legacy_project_metadata;
      PRAGMA user_version = ${PROJECT_STATE_SCHEMA_VERSION};
      COMMIT;
    `);
  } catch (error) {
    try {
      if (database.isTransaction)
        database.exec('ROLLBACK');
    } catch {
      // The pre-migration backup remains available for explicit recovery.
    }
    throw new ProjectStateError(
      'PROJECT_STATE_MIGRATION_FAILED',
      'Unable to migrate the legacy project state database.',
      error,
    );
  }
}

function assertDatabaseHealthy(database: DatabaseSync, projectId: string): void {
  const integrity = database.prepare('PRAGMA quick_check').get() as SqlRow;
  if (readString(integrity, 'quick_check') !== 'ok') {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The project state database failed its integrity check.',
    );
  }
  if (readUserVersion(database) !== PROJECT_STATE_SCHEMA_VERSION) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The project state schema version is inconsistent.',
    );
  }
  const metadata = database.prepare(
    'SELECT project_id, schema_version FROM project_metadata WHERE singleton = 1',
  ).get() as SqlRow | undefined;
  if (
    !metadata
    || readString(metadata, 'project_id') !== projectId
    || readInteger(metadata, 'schema_version') !== PROJECT_STATE_SCHEMA_VERSION
  ) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The project state metadata does not match the project manifest.',
    );
  }
}

async function assertPhysicalStateDirectory(databasePath: string): Promise<void> {
  const directory = join(databasePath, '..');
  const entry = await lstat(directory);
  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The project state directory must be a physical directory.',
    );
  }
}

async function assertPhysicalStateDatabase(databasePath: string): Promise<void> {
  await assertPhysicalStateDirectory(databasePath);
  try {
    const entry = await lstat(databasePath);
    if (!entry.isFile() || entry.isSymbolicLink())
      throw new Error('State database is not a physical file.');
  } catch (error) {
    throw new ProjectStateError(
      'PROJECT_STATE_INVALID',
      'The project state database is missing or invalid.',
      error,
    );
  }
}

function readUserVersion(database: DatabaseSync): number {
  return readInteger(
    database.prepare('PRAGMA user_version').get() as SqlRow,
    'user_version',
  );
}

function insertTask(database: DatabaseSync, task: TaskRecord): void {
  database.prepare(`
    INSERT INTO tasks(
      task_id, project_id, processor_id, input_fingerprint,
      output_scope_json, dedupe_key, execution_status, recovery_status,
      attempt, temporary_path, result_revision_id, error_code, error_message,
      created_at, updated_at, started_at, finished_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    task.taskId,
    task.projectId,
    task.processorId,
    task.inputFingerprint,
    serializeJson(task.outputScope),
    task.dedupeKey,
    task.executionStatus,
    task.recoveryStatus,
    task.attempt,
    task.temporaryPath,
    task.resultRevisionId ?? null,
    task.errorCode ?? null,
    task.errorMessage ?? null,
    task.createdAt,
    task.updatedAt,
    task.startedAt ?? null,
    task.finishedAt ?? null,
  );
}

function assertArtifactIdentity(row: SqlRow, record: ArtifactRecord): void {
  if (
    readString(row, 'artifact_type') !== record.artifactType
    || readString(row, 'lineage_id') !== record.lineageId
    || readString(row, 'scope_json') !== serializeJson(record.scope)
    || readString(row, 'storage_kind') !== record.storageKind
  ) {
    throw new ProjectStateError(
      'PROJECT_STATE_CONFLICT',
      'Artifact identity fields cannot change between revisions.',
    );
  }
}

function mapArtifactRow(row: SqlRow): ArtifactRecord {
  return parseArtifactRecord({
    artifactId: readString(row, 'artifact_id'),
    artifactType: readString(row, 'artifact_type'),
    lineageId: readString(row, 'lineage_id'),
    revisionId: readString(row, 'revision_id'),
    scope: parseJson(row, 'scope_json'),
    storageKind: readString(row, 'storage_kind'),
    contentPath: readString(row, 'content_path'),
    contentHash: readString(row, 'content_hash'),
    inputFingerprint: readString(row, 'input_fingerprint'),
    processorId: readString(row, 'processor_id'),
    processorVersion: readString(row, 'processor_version'),
    parametersHash: readString(row, 'parameters_hash'),
    executionStatus: readString(row, 'execution_status'),
    validityStatus: readString(row, 'validity_status'),
    reviewStatus: readString(row, 'review_status'),
    createdAt: readString(row, 'created_at'),
    createdBy: readString(row, 'created_by'),
  });
}

function mapDependencyRow(row: SqlRow): ArtifactDependency {
  const selector = parseOptionalJson(row, 'selector_json');
  return parseArtifactDependency({
    dependencyId: readString(row, 'dependency_id'),
    consumerArtifactId: readString(row, 'consumer_artifact_id'),
    consumerRevisionId: readString(row, 'consumer_revision_id'),
    producerArtifactId: readString(row, 'producer_artifact_id'),
    producerRevisionId: readString(row, 'producer_revision_id'),
    dependencyType: readString(row, 'dependency_type'),
    ...(selector ? { selector } : {}),
  });
}

function mapStaleCauseRow(row: SqlRow): StaleCause {
  const selector = parseOptionalJson(row, 'selector_json');
  const resolvedAt = readOptionalString(row, 'resolved_at');
  return parseStaleCause({
    staleCauseId: readString(row, 'stale_cause_id'),
    rootCauseKey: readString(row, 'root_cause_key'),
    consumerArtifactId: readString(row, 'consumer_artifact_id'),
    consumerRevisionId: readString(row, 'consumer_revision_id'),
    producerArtifactId: readString(row, 'producer_artifact_id'),
    previousProducerRevisionId: readString(
      row,
      'previous_producer_revision_id',
    ),
    currentProducerRevisionId: readString(
      row,
      'current_producer_revision_id',
    ),
    dependencyType: readString(row, 'dependency_type'),
    ...(selector ? { selector } : {}),
    status: readString(row, 'status'),
    createdAt: readString(row, 'created_at'),
    ...(resolvedAt ? { resolvedAt } : {}),
  });
}

function mapStageRunRow(row: SqlRow): StageRunRecord {
  const startedAt = readOptionalString(row, 'started_at');
  const finishedAt = readOptionalString(row, 'finished_at');
  return parseStageRunRecord({
    stageRunId: readString(row, 'stage_run_id'),
    stageId: readString(row, 'stage_id'),
    inputFingerprint: readString(row, 'input_fingerprint'),
    executionStatus: readString(row, 'execution_status'),
    ...(startedAt ? { startedAt } : {}),
    ...(finishedAt ? { finishedAt } : {}),
    createdAt: readString(row, 'created_at'),
  });
}

function mapTaskRow(row: SqlRow): TaskRecord {
  const optional = {
    resultRevisionId: readOptionalString(row, 'result_revision_id'),
    errorCode: readOptionalString(row, 'error_code'),
    errorMessage: readOptionalString(row, 'error_message'),
    startedAt: readOptionalString(row, 'started_at'),
    finishedAt: readOptionalString(row, 'finished_at'),
  };
  return parseTaskRecord({
    taskId: readString(row, 'task_id'),
    projectId: readString(row, 'project_id'),
    processorId: readString(row, 'processor_id'),
    inputFingerprint: readString(row, 'input_fingerprint'),
    outputScope: parseJson(row, 'output_scope_json'),
    dedupeKey: readString(row, 'dedupe_key'),
    executionStatus: readString(row, 'execution_status'),
    recoveryStatus: readString(row, 'recovery_status'),
    attempt: readInteger(row, 'attempt'),
    temporaryPath: readString(row, 'temporary_path'),
    createdAt: readString(row, 'created_at'),
    updatedAt: readString(row, 'updated_at'),
    ...Object.fromEntries(
      Object.entries(optional).filter(([, value]) => value !== undefined),
    ),
  });
}

function serializeJson(value: unknown): string {
  return canonicalizeJson(value as JsonValue);
}

function parseJson(row: SqlRow, key: string): unknown {
  return JSON.parse(readString(row, key));
}

function parseOptionalJson(row: SqlRow, key: string): unknown | undefined {
  const value = readOptionalString(row, key);
  return value === undefined || value === '' ? undefined : JSON.parse(value);
}

function readString(row: SqlRow, key: string): string {
  const value = row[key];
  if (typeof value !== 'string')
    throw new ProjectStateError('PROJECT_STATE_INVALID', `Invalid ${key}.`);
  return value;
}

function readOptionalString(row: SqlRow, key: string): string | undefined {
  const value = row[key];
  if (value === null || value === undefined)
    return undefined;
  if (typeof value !== 'string')
    throw new ProjectStateError('PROJECT_STATE_INVALID', `Invalid ${key}.`);
  return value;
}

function readInteger(row: SqlRow, key: string): number {
  const value = row[key];
  if (typeof value !== 'number' || !Number.isSafeInteger(value))
    throw new ProjectStateError('PROJECT_STATE_INVALID', `Invalid ${key}.`);
  return value;
}

async function createPrivateFile(path: string): Promise<void> {
  const handle = await openFile(path, 'wx', 0o600);
  await handle.close();
}

async function removeDatabaseFilesBestEffort(path: string): Promise<void> {
  await Promise.all([
    unlink(path).catch(() => {}),
    unlink(`${path}-shm`).catch(() => {}),
    unlink(`${path}-wal`).catch(() => {}),
  ]);
}

function closeDatabaseBestEffort(database: DatabaseSync | undefined): void {
  try {
    if (database?.isOpen)
      database.close();
  } catch {
    // The caller reports the original state error.
  }
}

function normalizeStateError(
  error: unknown,
  code: ConstructorParameters<typeof ProjectStateError>[0],
  message: string,
): ProjectStateError {
  if (error instanceof ProjectStateError)
    return error;
  return new ProjectStateError(code, message, error);
}
