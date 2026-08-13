import type {
  ChapterCandidateDto,
  ChapterDto,
  CoreEventEnvelope,
  CoreTrustedContext,
  CoverageClassification,
  CoverageReportDto,
  CoverageSegmentDto,
  NovelImportEventDto,
  NovelImportReviewCommandInput,
  NovelImportReviewSnapshotDto,
  StaleImpactItemDto,
  StalePreviewDto,
  StartNovelImportInput,
  TaskSummaryDto,
  TextDiffHunkDto,
  TextSliceDto,
  TextSliceRequest,
  Utf8TextRangeDto,
} from '@voxweaver/contracts';
import type { ImportedNovelArtifact } from '@voxweaver/novel-import';
import type { Stats } from 'node:fs';

import type { ProjectSession, ProjectSessionRegistry } from './projectSessionRegistry.ts';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { constants } from 'node:fs';
import {
  lstat,
  mkdir,
  open,
  realpath,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { TextDecoder } from 'node:util';
import {
  CORE_PROTOCOL_VERSION,
  isRecord,
  NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES,
  PROJECT_STATE_DATABASE_PATH,
  VoxWeaverError,
} from '@voxweaver/contracts';
import {
  analyzeNovelStructure,
  createNovelImportProcessorFingerprint,
  decodeUtf8TextSlice,
  importSourceAsset,
  NovelImportError,
  probeSourceAsset,
  readProjectSourceAsset,
} from '@voxweaver/novel-import';

const TASK_STAGE = 'importing';
const TASK_PROGRESS_TOTAL = 100;
const TASK_ARTIFACT_DIRECTORY = 'artifacts/imported';
const TASK_TEMPORARY_DIRECTORY = 'tmp/novel-import';
const REVIEW_TEMPORARY_DIRECTORY = 'tmp/novel-review';

interface TaskRow {
  readonly task_id: string;
  readonly input_fingerprint: string;
  readonly command_json: string;
  readonly execution_status: TaskSummaryDto['status'];
  readonly recovery_status: TaskSummaryDto['recoveryStatus'];
  readonly attempt: number;
  readonly progress_completed: number;
  readonly progress_total: number;
  readonly progress_message: string;
  readonly result_revision_id: string | null;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
}

interface RevisionRow {
  readonly revision_id: string;
  readonly baseline_revision: number;
  readonly source_hash: string;
  readonly source_encoding: NovelImportReviewSnapshotDto['encoding'];
  readonly encoding_method: NovelImportReviewSnapshotDto['encodingMethod'];
  readonly processor_version: string;
  readonly raw_text_path: string;
  readonly canonical_text_path: string;
  readonly review_snapshot_json: string;
  readonly review_status: NovelImportReviewSnapshotDto['reviewStatus'];
  readonly active: number;
  readonly created_at: string;
}

interface PendingTaskExecution {
  readonly projectSessionId: string;
  cancelRequested: boolean;
}

interface AffectedArtifactRow {
  readonly artifactType: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly dependencyType: string;
  readonly selectorJson: string | null;
}

interface RerunSelectionResult {
  readonly candidates: readonly ChapterCandidateDto[];
  readonly chapters: readonly ChapterDto[];
  readonly coverageSegments: readonly CoverageSegmentDto[];
}

export interface NovelImportServiceOptions {
  readonly emitEvent?: (event: CoreEventEnvelope) => void;
  readonly now?: () => Date;
}

export class NovelImportService {
  readonly #emitEvent: (event: CoreEventEnvelope) => void;
  readonly #now: () => Date;
  readonly #pendingTasks = new Map<string, PendingTaskExecution>();
  readonly #sessions: ProjectSessionRegistry;
  readonly #taskExecutionPromises = new Set<Promise<void>>();
  #eventSequence = 0;

  constructor(sessions: ProjectSessionRegistry, options: NovelImportServiceOptions = {}) {
    this.#sessions = sessions;
    this.#emitEvent = options.emitEvent ?? (() => {});
    this.#now = options.now ?? (() => new Date());
    this.#recoverInterruptedTasks();
  }

  async probe(context: CoreTrustedContext) {
    const session = this.#sessions.requireSession(context);
    const source = await readProjectSourceAsset(session.rootPath, session.manifest.sourceAsset);
    const base = probeSourceAsset(source);
    const database = openProjectDatabase(session);
    try {
      const activeTask = readLatestTask(database, [
        'pending',
        'running',
        'failed',
        'canceled',
      ]);
      const latestRevision = database.prepare(`
        SELECT revision_id FROM novel_import_revision
        WHERE active = 1 LIMIT 1
      `).get() as { revision_id?: unknown } | undefined;
      return {
        ...base,
        ...(activeTask ? { activeTask: toTaskSummary(activeTask) } : {}),
        ...(typeof latestRevision?.revision_id === 'string'
          ? { latestReviewRevisionId: latestRevision.revision_id }
          : {}),
      };
    } finally {
      database.close();
    }
  }

  async start(context: CoreTrustedContext, input: StartNovelImportInput): Promise<TaskSummaryDto> {
    const session = this.#sessions.requireSession(context);
    const source = await readProjectSourceAsset(session.rootPath, session.manifest.sourceAsset);
    const probe = probeSourceAsset(source);
    if (input.sourceEncoding !== undefined) {
      if (probe.encoding.status !== 'selection-required')
        throw new VoxWeaverError('NOVEL_IMPORT_INVALID_SOURCE', '当前源资产不允许手动覆盖编码。', false);
      if (!probe.encoding.allowedEncodings.includes(input.sourceEncoding))
        throw invalidPayload('sourceEncoding');
    } else if (probe.encoding.status === 'selection-required') {
      throw new VoxWeaverError('NOVEL_IMPORT_ENCODING_REQUIRED', probe.encoding.message, false);
    }
    if (probe.encoding.status === 'rejected')
      throw new VoxWeaverError('NOVEL_IMPORT_INVALID_SOURCE', probe.encoding.message, false);

    const encoding = input.sourceEncoding
      ?? (probe.encoding.status === 'confirmed' ? probe.encoding.encoding : undefined);
    if (!encoding)
      throw new VoxWeaverError('NOVEL_IMPORT_ENCODING_REQUIRED', '需要选择源文本编码。', false);
    const inputFingerprint = createNovelImportProcessorFingerprint(source.source.sha256, encoding);
    const database = openProjectDatabase(session);
    let task: TaskSummaryDto;
    try {
      const reusable = database.prepare(`
        SELECT * FROM task
        WHERE project_id = ? AND task_type = 'novel-import' AND input_fingerprint = ?
          AND execution_status IN ('pending', 'running', 'succeeded')
        ORDER BY created_at DESC LIMIT 1
      `).get(session.projectId, inputFingerprint) as unknown as TaskRow | undefined;
      if (reusable)
        return toTaskSummary(reusable);

      const now = this.#now().toISOString();
      const taskId = randomUUID();
      database.prepare(`
        INSERT INTO task (
          task_id, project_id, task_type, input_fingerprint, command_json,
          execution_status, recovery_status, attempt, stage,
          progress_completed, progress_total, progress_message,
          temporary_path, created_at, updated_at
        ) VALUES (?, ?, 'novel-import', ?, ?, 'pending', 'resumable', 1, ?, 0, ?, ?, ?, ?, ?)
      `).run(
        taskId,
        session.projectId,
        inputFingerprint,
        JSON.stringify({ sourceHash: source.source.sha256, sourceEncoding: input.sourceEncoding ?? null }),
        TASK_STAGE,
        TASK_PROGRESS_TOTAL,
        '等待导入',
        `${TASK_TEMPORARY_DIRECTORY}/${taskId}`,
        now,
        now,
      );
      task = this.#readTask(database, taskId);
    } finally {
      database.close();
    }

    this.#scheduleTask(session, task.taskId, input);
    return task;
  }

  getTask(context: CoreTrustedContext, taskId: string): TaskSummaryDto {
    const session = this.#sessions.requireSession(context);
    const database = openProjectDatabase(session);
    try {
      return this.#readTask(database, taskId);
    } finally {
      database.close();
    }
  }

  cancelTask(context: CoreTrustedContext, taskId: string): TaskSummaryDto {
    const session = this.#sessions.requireSession(context);
    const database = openProjectDatabase(session);
    try {
      const row = this.#readTaskRow(database, taskId);
      if (row.execution_status !== 'pending' && row.execution_status !== 'running') {
        throw new VoxWeaverError(
          'NOVEL_IMPORT_TASK_NOT_CANCELABLE',
          '该小说导入任务当前不能取消。',
          false,
        );
      }
      const execution = this.#pendingTasks.get(taskId);
      if (!execution || execution.projectSessionId !== session.projectSessionId) {
        throw new VoxWeaverError(
          'NOVEL_IMPORT_TASK_NOT_CANCELABLE',
          '任务不属于当前 Core 执行上下文，需按崩溃恢复结果重试。',
          false,
        );
      }
      execution.cancelRequested = true;
      const now = this.#now().toISOString();
      database.prepare(`
        UPDATE task SET cancel_requested_at = ?, updated_at = ? WHERE task_id = ?
      `).run(now, now, taskId);
      return this.#readTask(database, taskId);
    } finally {
      database.close();
    }
  }

  retryTask(context: CoreTrustedContext, taskId: string): TaskSummaryDto {
    const session = this.#sessions.requireSession(context);
    const database = openProjectDatabase(session);
    let task: TaskSummaryDto;
    let input: StartNovelImportInput;
    try {
      const row = this.#readTaskRow(database, taskId);
      if (row.execution_status !== 'failed' && row.execution_status !== 'canceled') {
        throw new VoxWeaverError(
          'NOVEL_IMPORT_TASK_NOT_RETRYABLE',
          '该小说导入任务当前不能重试。',
          false,
        );
      }
      input = parseStoredTaskInput(row.command_json);
      const now = this.#now().toISOString();
      database.prepare(`
        UPDATE task SET execution_status = 'pending', recovery_status = 'resumable',
          attempt = attempt + 1, progress_completed = 0, progress_message = '等待重试',
          cancel_requested_at = NULL, error_code = NULL, error_message = NULL,
          started_at = NULL, finished_at = NULL, updated_at = ?
        WHERE task_id = ?
      `).run(now, taskId);
      task = this.#readTask(database, taskId);
    } finally {
      database.close();
    }
    this.#emitTaskEvent(session, 'task-retry-scheduled', task);
    this.#scheduleTask(session, taskId, input);
    return task;
  }

  getReviewSnapshot(context: CoreTrustedContext): NovelImportReviewSnapshotDto {
    const session = this.#sessions.requireSession(context);
    const database = openProjectDatabase(session);
    try {
      const row = readActiveRevision(database);
      if (!row)
        throw new VoxWeaverError('NOVEL_IMPORT_REVIEW_REQUIRED', '当前项目没有可复核的小说导入 revision。', false);
      return parseReviewSnapshot(row.review_snapshot_json);
    } finally {
      database.close();
    }
  }

  async getTextSlice(
    context: CoreTrustedContext,
    input: TextSliceRequest,
  ): Promise<TextSliceDto> {
    const session = this.#sessions.requireSession(context);
    const database = openProjectDatabase(session);
    let row: RevisionRow | undefined;
    try {
      row = database.prepare(`
        SELECT * FROM novel_import_revision WHERE revision_id = ? LIMIT 1
      `).get(input.revisionId) as unknown as RevisionRow | undefined;
    } finally {
      database.close();
    }
    if (!row)
      throw new VoxWeaverError('NOVEL_IMPORT_REVIEW_REQUIRED', '小说导入 revision 不存在。', false);

    return readProjectArtifactSlice(session, row, input);
  }

  async previewReview(
    context: CoreTrustedContext,
    command: NovelImportReviewCommandInput,
  ): Promise<StalePreviewDto> {
    const session = this.#sessions.requireSession(context);
    const initialRow = readCurrentRevisionForCommand(session, command);
    await validateReviewByteBoundaries(session, initialRow, command);

    const database = openProjectDatabase(session);
    try {
      database.exec('BEGIN IMMEDIATE;');
      const currentRow = readActiveRevision(database);
      if (!currentRow || currentRow.revision_id !== initialRow.revision_id)
        throw reviewConflict();
      const snapshot = parseReviewSnapshot(currentRow.review_snapshot_json);
      assertCurrentBaseline(snapshot, command.baselineRevision);
      validateReviewCommand(snapshot, command);
      const affected = this.#findAffectedArtifacts(database, snapshot.revisionId, command);
      const preview: StalePreviewDto = {
        baselineRevision: command.baselineRevision,
        commandType: command.commandType,
        affected,
        requiresConfirmation: affected.length > 0,
      };
      const now = this.#now();
      database.prepare(`
        DELETE FROM novel_import_review_preview
        WHERE consumed_at IS NOT NULL OR expires_at <= ?
      `).run(now.toISOString());
      database.prepare(`
        INSERT INTO novel_import_review_preview (
          preview_id, baseline_revision, command_hash, preview_json, created_at, expires_at
        ) VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        randomUUID(),
        command.baselineRevision,
        stableJson(command),
        JSON.stringify(preview),
        now.toISOString(),
        new Date(now.getTime() + 5 * 60 * 1_000).toISOString(),
      );
      database.exec('COMMIT;');
      return preview;
    } catch (error) {
      rollbackIgnoringErrors(database);
      throw error;
    } finally {
      database.close();
    }
  }

  async applyReview(
    context: CoreTrustedContext,
    command: NovelImportReviewCommandInput,
  ): Promise<NovelImportReviewSnapshotDto> {
    const session = this.#sessions.requireSession(context);
    const initialRow = readCurrentRevisionForCommand(session, command);
    await validateReviewByteBoundaries(session, initialRow, command);
    const initialSnapshot = parseReviewSnapshot(initialRow.review_snapshot_json);
    const rerunSelection = command.commandType === 'rerun-selection'
      ? await prepareRerunSelection(session, initialRow, initialSnapshot, command)
      : undefined;

    const database = openProjectDatabase(session);
    const nextRevisionId = randomUUID();
    const temporaryDirectory = path.join(
      session.rootPath,
      REVIEW_TEMPORARY_DIRECTORY,
      nextRevisionId,
    );
    const artifactDirectory = path.join(
      session.rootPath,
      TASK_ARTIFACT_DIRECTORY,
      nextRevisionId,
    );
    let artifactPublished = false;
    try {
      database.exec('BEGIN IMMEDIATE;');
      const row = readActiveRevision(database);
      if (!row || row.revision_id !== initialRow.revision_id)
        throw reviewConflict();
      const snapshot = parseReviewSnapshot(row.review_snapshot_json);
      assertCurrentBaseline(snapshot, command.baselineRevision);
      validateReviewCommand(snapshot, command);
      const affectedRows = this.#findAffectedArtifactRows(database, snapshot.revisionId, command);
      const expectedAffected = toStaleImpactItems(affectedRows, command);
      const expectedPreview: StalePreviewDto = {
        baselineRevision: command.baselineRevision,
        commandType: command.commandType,
        affected: expectedAffected,
        requiresConfirmation: expectedAffected.length > 0,
      };
      const now = this.#now().toISOString();
      const previewRecord = database.prepare(`
        SELECT preview_id, preview_json FROM novel_import_review_preview
        WHERE baseline_revision = ? AND command_hash = ?
          AND consumed_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC LIMIT 1
      `).get(command.baselineRevision, stableJson(command), now) as {
        preview_id: string;
        preview_json: string;
      } | undefined;
      if (!previewRecord
        || stableJson(parseStoredPreview(previewRecord.preview_json)) !== stableJson(expectedPreview)) {
        throw new VoxWeaverError(
          'NOVEL_IMPORT_REVIEW_REQUIRED',
          '复核操作必须先完成最新的下游失效影响预览。',
          false,
        );
      }
      database.prepare(`
        UPDATE novel_import_review_preview SET consumed_at = ? WHERE preview_id = ?
      `).run(now, previewRecord.preview_id);

      const nextBaselineRevision = readNextBaseline(database);
      const changed = applyReviewCommand(snapshot, command, rerunSelection);
      const updated = createReviewRevision(
        snapshot,
        changed,
        nextRevisionId,
        nextBaselineRevision,
        now,
      );
      const snapshotJson = JSON.stringify(updated);
      const snapshotArtifactJson = JSON.stringify(updated, null, 2);
      const snapshotRelativePath = path.posix.join(
        TASK_ARTIFACT_DIRECTORY,
        nextRevisionId,
        'review.json',
      );
      await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
      const temporarySnapshotPath = path.join(temporaryDirectory, 'review.json');
      await writeFile(temporarySnapshotPath, snapshotArtifactJson, {
        flag: 'wx',
        mode: 0o600,
      });
      await syncFile(temporarySnapshotPath);
      await mkdir(path.dirname(artifactDirectory), { recursive: true, mode: 0o700 });
      await rename(temporaryDirectory, artifactDirectory);
      artifactPublished = true;

      database.prepare(`
        UPDATE novel_import_revision SET active = 0
        WHERE revision_id = ? AND active = 1
      `).run(snapshot.revisionId);
      database.prepare(`
        INSERT INTO novel_import_revision (
          revision_id, baseline_revision, source_asset_id, source_hash,
          source_encoding, encoding_method, processor_version,
          raw_text_path, canonical_text_path, review_snapshot_json,
          review_status, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?)
      `).run(
        nextRevisionId,
        nextBaselineRevision,
        session.manifest.sourceAsset.id,
        row.source_hash,
        row.source_encoding,
        row.encoding_method,
        row.processor_version,
        row.raw_text_path,
        row.canonical_text_path,
        snapshotJson,
        updated.reviewStatus,
        now,
      );
      database.prepare(`
        UPDATE artifact_revision SET validity_status = 'superseded'
        WHERE revision_id = ? AND validity_status = 'current'
      `).run(snapshot.revisionId);
      const commandHash = sha256Text(stableJson(command));
      database.prepare(`
        INSERT INTO artifact_revision (
          revision_id, artifact_id, artifact_type, lineage_id, storage_kind,
          content_path, content_hash, input_fingerprint, processor_id,
          processor_version, parameters_hash, execution_status, validity_status,
          review_status, created_at, created_by, metadata_json
        ) VALUES (?, ?, 'novel-import', ?, 'reviewed', ?, ?, ?,
          'voxweaver.novel-import-review', '1', ?, 'succeeded', 'current', ?, ?,
          'operator', ?)
      `).run(
        nextRevisionId,
        `novel-import:${session.projectId}`,
        `novel-import:${session.projectId}`,
        snapshotRelativePath,
        sha256Text(snapshotArtifactJson),
        sha256Text(`${snapshot.revisionId}:${commandHash}`),
        commandHash,
        updated.reviewStatus,
        now,
        JSON.stringify({
          commandType: command.commandType,
          previousRevisionId: snapshot.revisionId,
        }),
      );
      const reviewDecisionId = randomUUID();
      database.prepare(`
        INSERT INTO review_decision (
          review_decision_id, artifact_id, revision_id, decision, note, decided_at, decided_by
        ) VALUES (?, ?, ?, ?, ?, ?, 'operator')
      `).run(
        reviewDecisionId,
        `novel-import:${session.projectId}`,
        nextRevisionId,
        command.commandType,
        JSON.stringify(command),
        now,
      );
      for (const item of affectedRows) {
        database.prepare(`
          UPDATE artifact_revision SET validity_status = 'stale'
          WHERE revision_id = ? AND validity_status = 'current'
        `).run(item.revisionId);
        database.prepare(`
          INSERT INTO stale_cause (
            stale_cause_id, consumer_revision_id, previous_producer_revision_id,
            current_producer_revision_id, dependency_type, selector_json,
            status, created_at
          ) VALUES (?, ?, ?, ?, ?, ?, 'active', ?)
        `).run(
          randomUUID(),
          item.revisionId,
          snapshot.revisionId,
          nextRevisionId,
          item.dependencyType,
          item.selectorJson,
          now,
        );
      }
      database.exec('COMMIT;');
      return updated;
    } catch (error) {
      rollbackIgnoringErrors(database);
      if (artifactPublished)
        await rm(artifactDirectory, { recursive: true, force: true });
      throw error;
    } finally {
      database.close();
      await rm(temporaryDirectory, { recursive: true, force: true });
    }
  }

  async waitForIdle(): Promise<void> {
    await Promise.all([...this.#taskExecutionPromises]);
  }

  #scheduleTask(session: ProjectSession, taskId: string, input: StartNovelImportInput): void {
    if (this.#pendingTasks.has(taskId))
      return;
    this.#pendingTasks.set(taskId, {
      projectSessionId: session.projectSessionId,
      cancelRequested: false,
    });
    const execution = new Promise<void>(resolve => setImmediate(resolve))
      .then(() => this.#executeTask(session, taskId, input))
      .finally(() => {
        this.#pendingTasks.delete(taskId);
        this.#taskExecutionPromises.delete(execution);
      });
    this.#taskExecutionPromises.add(execution);
  }

  async #executeTask(
    session: ProjectSession,
    taskId: string,
    input: StartNovelImportInput,
  ): Promise<void> {
    const database = openProjectDatabase(session);
    try {
      const now = this.#now().toISOString();
      database.prepare(`
        UPDATE task SET execution_status = 'running', recovery_status = 'resumable',
          progress_completed = 5, progress_message = '校验项目源资产', started_at = ?, updated_at = ?
        WHERE task_id = ? AND execution_status = 'pending'
      `).run(now, now, taskId);
      this.#emitTaskEvent(session, 'task-progress', this.#readTask(database, taskId));
    } finally {
      database.close();
    }

    try {
      await this.#throwIfCanceled(session, taskId);
      const source = await readProjectSourceAsset(session.rootPath, session.manifest.sourceAsset);
      const artifact = importSourceAsset(source, input.sourceEncoding
        ? { sourceEncoding: input.sourceEncoding, sourceHash: source.source.sha256 }
        : undefined);
      const progressDatabase = openProjectDatabase(session);
      try {
        const now = this.#now().toISOString();
        progressDatabase.prepare(`
          UPDATE task SET progress_completed = 70,
            progress_message = '已生成章节候选，准备发布产物', updated_at = ?
          WHERE task_id = ? AND execution_status = 'running'
        `).run(now, taskId);
        this.#emitTaskEvent(session, 'task-progress', this.#readTask(progressDatabase, taskId));
      } finally {
        progressDatabase.close();
      }
      await new Promise<void>(resolve => setImmediate(resolve));
      await this.#throwIfCanceled(session, taskId);
      await this.#persistSuccessfulImport(session, taskId, artifact);
    } catch (error) {
      await this.#persistTaskFailure(session, taskId, error);
    }
  }

  async #throwIfCanceled(session: ProjectSession, taskId: string): Promise<void> {
    if (!this.#pendingTasks.get(taskId)?.cancelRequested)
      return;
    const database = openProjectDatabase(session);
    try {
      const now = this.#now().toISOString();
      database.prepare(`
        UPDATE task SET execution_status = 'canceled', recovery_status = 'retryable',
          progress_message = '导入已取消', updated_at = ?, finished_at = ? WHERE task_id = ?
      `).run(now, now, taskId);
      this.#emitTaskEvent(session, 'task-canceled', this.#readTask(database, taskId));
    } finally {
      database.close();
    }
    throw new TaskCanceledError();
  }

  async #persistSuccessfulImport(
    session: ProjectSession,
    taskId: string,
    artifact: ImportedNovelArtifact,
  ): Promise<void> {
    await this.#throwIfCanceled(session, taskId);
    const revisionId = randomUUID();
    const artifactDirectory = path.join(session.rootPath, TASK_ARTIFACT_DIRECTORY, revisionId);
    const temporaryDirectory = path.join(session.rootPath, TASK_TEMPORARY_DIRECTORY, taskId);
    await rm(temporaryDirectory, { recursive: true, force: true });
    await mkdir(temporaryDirectory, { recursive: true, mode: 0o700 });
    const textTemporaryPath = path.join(temporaryDirectory, 'text.utf8.txt');
    const snapshotTemporaryPath = path.join(temporaryDirectory, 'review.json');
    const now = this.#now().toISOString();
    const database = openProjectDatabase(session);
    let baseline: number;
    let previousHistory: NovelImportReviewSnapshotDto['revisionHistory'];
    try {
      baseline = readNextBaseline(database);
      previousHistory = readRevisionHistory(database);
    } finally {
      database.close();
    }
    const snapshot = createReviewSnapshot(
      artifact,
      revisionId,
      baseline,
      now,
      previousHistory,
    );
    await writeFile(textTemporaryPath, artifact.utf8Text.bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(snapshotTemporaryPath, JSON.stringify(snapshot, null, 2), { flag: 'wx', mode: 0o600 });
    await syncFile(textTemporaryPath);
    await syncFile(snapshotTemporaryPath);
    await mkdir(path.dirname(artifactDirectory), { recursive: true, mode: 0o700 });
    await rename(temporaryDirectory, artifactDirectory);

    const textRelativePath = path.posix.join(TASK_ARTIFACT_DIRECTORY, revisionId, 'text.utf8.txt');
    const snapshotRelativePath = path.posix.join(TASK_ARTIFACT_DIRECTORY, revisionId, 'review.json');
    const writable = openProjectDatabase(session);
    try {
      writable.exec('BEGIN IMMEDIATE;');
      writable.prepare('UPDATE novel_import_revision SET active = 0 WHERE active = 1').run();
      writable.prepare(`
        INSERT INTO novel_import_revision (
          revision_id, baseline_revision, source_asset_id, source_hash,
          source_encoding, encoding_method, processor_version,
          raw_text_path, canonical_text_path, review_snapshot_json,
          review_status, active, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', 1, ?)
      `).run(
        revisionId,
        baseline,
        session.manifest.sourceAsset.id,
        artifact.sourceHash,
        artifact.sourceEncoding,
        artifact.encodingMethod,
        artifact.processorVersion,
        textRelativePath,
        textRelativePath,
        JSON.stringify(snapshot),
        now,
      );
      writable.prepare(`
        INSERT INTO artifact_revision (
          revision_id, artifact_id, artifact_type, lineage_id, storage_kind,
          content_path, content_hash, input_fingerprint, processor_id,
          processor_version, parameters_hash, execution_status, validity_status,
          review_status, created_at, created_by, metadata_json
        ) VALUES (?, ?, 'novel-import', ?, 'imported', ?, ?, ?, ?, ?, ?,
          'succeeded', 'current', 'pending', ?, 'core', ?)
      `).run(
        revisionId,
        `novel-import:${session.projectId}`,
        `novel-import:${session.projectId}`,
        snapshotRelativePath,
        artifact.utf8Text.sha256,
        artifact.processorFingerprint,
        artifact.processorId,
        artifact.processorVersion,
        artifact.processorFingerprint,
        now,
        JSON.stringify({ sourceHash: artifact.sourceHash }),
      );
      writable.prepare(`
        UPDATE task SET execution_status = 'succeeded', recovery_status = 'none',
          progress_completed = ?, progress_message = '导入完成，等待复核',
          result_revision_id = ?, updated_at = ?, finished_at = ? WHERE task_id = ?
      `).run(TASK_PROGRESS_TOTAL, revisionId, now, now, taskId);
      writable.exec('COMMIT;');
      this.#emitTaskEvent(session, 'task-completed', this.#readTask(writable, taskId));
    } catch (error) {
      rollbackIgnoringErrors(writable);
      await rm(artifactDirectory, { recursive: true, force: true });
      throw error;
    } finally {
      writable.close();
    }
  }

  async #persistTaskFailure(session: ProjectSession, taskId: string, error: unknown): Promise<void> {
    if (error instanceof TaskCanceledError)
      return;
    const database = openProjectDatabase(session);
    try {
      const now = this.#now().toISOString();
      const normalized = normalizeNovelImportError(error);
      database.prepare(`
        UPDATE task SET execution_status = 'failed', recovery_status = 'retryable',
          progress_message = '导入失败', error_code = ?, error_message = ?,
          updated_at = ?, finished_at = ? WHERE task_id = ?
      `).run(normalized.code, normalized.message, now, now, taskId);
      this.#emitTaskEvent(session, 'task-failed', this.#readTask(database, taskId));
    } finally {
      database.close();
    }
  }

  #readTask(database: DatabaseSync, taskId: string): TaskSummaryDto {
    return toTaskSummary(this.#readTaskRow(database, taskId));
  }

  #readTaskRow(database: DatabaseSync, taskId: string): TaskRow {
    const row = database.prepare(`
      SELECT * FROM task WHERE task_id = ? LIMIT 1
    `).get(taskId) as unknown as TaskRow | undefined;
    if (!row)
      throw new VoxWeaverError('NOVEL_IMPORT_TASK_NOT_FOUND', '小说导入任务不存在。', false);
    return row;
  }

  #emitTaskEvent(
    session: ProjectSession,
    eventType: NovelImportEventDto['eventType'],
    task: TaskSummaryDto,
  ): void {
    const payload: NovelImportEventDto = {
      eventType,
      sequence: ++this.#eventSequence,
      occurredAt: this.#now().toISOString(),
      task,
    };
    try {
      this.#emitEvent({
        protocolVersion: CORE_PROTOCOL_VERSION,
        eventId: randomUUID(),
        eventType,
        occurredAt: payload.occurredAt,
        projectId: session.projectId,
        projectSessionId: session.projectSessionId,
        payload: payload as unknown as CoreEventEnvelope['payload'],
      });
    } catch {
      // Event delivery cannot roll back a persisted task transition.
    }
  }

  #findAffectedArtifacts(
    database: DatabaseSync,
    producerRevisionId: string,
    command: NovelImportReviewCommandInput,
  ): StaleImpactItemDto[] {
    return toStaleImpactItems(
      this.#findAffectedArtifactRows(database, producerRevisionId, command),
      command,
    );
  }

  #findAffectedArtifactRows(
    database: DatabaseSync,
    producerRevisionId: string,
    command: NovelImportReviewCommandInput,
  ): AffectedArtifactRow[] {
    if (command.commandType === 'confirm-review')
      return [];
    const rows = database.prepare(`
      SELECT consumer.artifact_type, consumer.artifact_id, consumer.revision_id,
        dependency.dependency_type, dependency.selector_json
      FROM artifact_dependency dependency
      JOIN artifact_revision consumer ON consumer.revision_id = dependency.consumer_revision_id
      WHERE dependency.producer_revision_id = ? AND consumer.validity_status = 'current'
      ORDER BY consumer.artifact_type, consumer.artifact_id, consumer.revision_id
    `).all(producerRevisionId) as unknown as Array<{
      artifact_type: string;
      artifact_id: string;
      revision_id: string;
      dependency_type: string;
      selector_json: string | null;
    }>;
    return rows.map(row => ({
      artifactType: row.artifact_type,
      artifactId: row.artifact_id,
      revisionId: row.revision_id,
      dependencyType: row.dependency_type,
      selectorJson: row.selector_json,
    }));
  }

  #recoverInterruptedTasks(): void {
    for (const session of this.#sessions.sessions) {
      const database = openProjectDatabase(session);
      try {
        database.prepare(`
          UPDATE task SET execution_status = 'failed', recovery_status = 'retryable',
            progress_message = 'Core 中断，可重试', error_code = 'CORE_UNAVAILABLE',
            error_message = '上次导入在 Core 退出时中断。', updated_at = ?
          WHERE execution_status IN ('pending', 'running')
        `).run(this.#now().toISOString());
      } finally {
        database.close();
      }
    }
  }
}

function createReviewSnapshot(
  artifact: ImportedNovelArtifact,
  revisionId: string,
  baselineRevision: number,
  createdAt: string,
  previousHistory: NovelImportReviewSnapshotDto['revisionHistory'],
): NovelImportReviewSnapshotDto {
  return {
    revisionId,
    baselineRevision,
    source: artifact.source,
    encoding: artifact.sourceEncoding,
    encodingMethod: artifact.encodingMethod,
    textByteLength: artifact.utf8Text.byteLength,
    candidates: artifact.candidates,
    chapters: artifact.chapters,
    coverage: artifact.coverage,
    normalizationProposals: artifact.normalizationProposals,
    diff: [],
    revisionHistory: [
      ...previousHistory.map(revision => ({ ...revision, active: false })),
      {
        revisionId,
        baselineRevision,
        sourceHash: artifact.sourceHash,
        encoding: artifact.sourceEncoding,
        processorVersion: artifact.processorVersion,
        reviewStatus: 'pending',
        active: true,
        createdAt,
      },
    ],
    reviewStatus: 'pending',
    createdAt,
  };
}

function applyReviewCommand(
  snapshot: NovelImportReviewSnapshotDto,
  command: NovelImportReviewCommandInput,
  rerunSelection?: RerunSelectionResult,
): NovelImportReviewSnapshotDto {
  switch (command.commandType) {
    case 'adjust-chapter-boundary':
      return {
        ...snapshot,
        chapters: snapshot.chapters.map(chapter => chapter.chapterId === command.chapterId
          ? { ...chapter, headingRange: command.headingRange, contentRange: command.contentRange }
          : chapter),
      };
    case 'classify-uncovered-range':
      return {
        ...snapshot,
        coverage: classifyCoverage(snapshot.coverage, command.range, command.classification),
      };
    case 'decide-normalization-proposal': {
      const proposal = snapshot.normalizationProposals.find(item => item.proposalId === command.proposalId)!;
      const proposals = snapshot.normalizationProposals.map(item => item.proposalId === command.proposalId
        ? { ...item, decision: command.decision }
        : item);
      const diff: TextDiffHunkDto[] = command.decision === 'approved'
        ? mergeDiff(snapshot.diff, {
            operation: 'replace',
            range: proposal.range,
            beforeText: proposal.beforeText,
            afterText: proposal.afterText,
          })
        : snapshot.diff.filter(hunk => hunk.range.startByte !== proposal.range.startByte
          || hunk.range.endByte !== proposal.range.endByte);
      return { ...snapshot, normalizationProposals: proposals, diff };
    }
    case 'rerun-selection': {
      if (!rerunSelection)
        throw new VoxWeaverError('NOVEL_IMPORT_REVIEW_REQUIRED', '局部重跑结果缺失。', false);
      const selectedChapterIds = new Set(command.chapterIds);
      const selectedHeadingRanges = snapshot.chapters
        .filter(chapter => selectedChapterIds.has(chapter.chapterId))
        .map(chapter => chapter.headingRange);
      const chapters = [
        ...snapshot.chapters.filter(chapter => !selectedChapterIds.has(chapter.chapterId)),
        ...rerunSelection.chapters,
      ]
        .sort((left, right) => left.headingRange.startByte - right.headingRange.startByte)
        .map((chapter, index) => ({ ...chapter, order: index + 1 }));
      const candidates = [
        ...snapshot.candidates.filter(candidate => !selectedHeadingRanges.some(range => (
          rangesOverlap(range, candidate.headingRange)
        ))),
        ...rerunSelection.candidates,
      ].sort((left, right) => left.headingRange.startByte - right.headingRange.startByte);
      return {
        ...snapshot,
        candidates,
        chapters,
        coverage: replaceChapterCoverage(
          snapshot.coverage,
          selectedChapterIds,
          rerunSelection.coverageSegments,
        ),
        reviewStatus: 'pending',
      };
    }
    case 'confirm-review':
      if (!snapshot.coverage.complete
        || snapshot.coverage.uncoveredRanges.length > 0
        || snapshot.normalizationProposals.some(proposal => proposal.decision === 'pending')) {
        throw new VoxWeaverError(
          'NOVEL_IMPORT_REVIEW_REQUIRED',
          '必须先完成覆盖范围分类和规范化提案决策。',
          false,
        );
      }
      return {
        ...snapshot,
        candidates: snapshot.candidates.map(candidate => ({ ...candidate, reviewStatus: 'approved' })),
        chapters: snapshot.chapters.map(chapter => ({ ...chapter, reviewStatus: 'approved' })),
        reviewStatus: 'approved',
      };
  }
}

function createReviewRevision(
  previous: NovelImportReviewSnapshotDto,
  changed: NovelImportReviewSnapshotDto,
  revisionId: string,
  baselineRevision: number,
  createdAt: string,
): NovelImportReviewSnapshotDto {
  return {
    ...changed,
    revisionId,
    baselineRevision,
    createdAt,
    revisionHistory: [
      ...previous.revisionHistory.map(revision => ({ ...revision, active: false })),
      {
        revisionId,
        baselineRevision,
        sourceHash: previous.source.sha256,
        encoding: previous.encoding,
        processorVersion: previous.revisionHistory.at(-1)?.processorVersion ?? '1',
        reviewStatus: changed.reviewStatus,
        active: true,
        createdAt,
      },
    ],
  };
}

function toStaleImpactItems(
  rows: readonly AffectedArtifactRow[],
  command: NovelImportReviewCommandInput,
): StaleImpactItemDto[] {
  const byRevision = new Map<string, StaleImpactItemDto>();
  for (const row of rows) {
    byRevision.set(row.revisionId, {
      artifactType: row.artifactType,
      artifactId: row.artifactId,
      reason: `${command.commandType} 会使下游 revision ${row.revisionId} 失效。`,
    });
  }
  return [...byRevision.values()];
}

function replaceChapterCoverage(
  coverage: CoverageReportDto,
  replacedChapterIds: ReadonlySet<string>,
  replacementSegments: readonly CoverageSegmentDto[],
): CoverageReportDto {
  return {
    ...coverage,
    segments: [
      ...coverage.segments.filter(segment => (
        segment.classification !== 'chapter'
        || !segment.chapterId
        || !replacedChapterIds.has(segment.chapterId)
      )),
      ...replacementSegments,
    ].sort((left, right) => left.range.startByte - right.range.startByte),
  };
}

function rangesOverlap(left: Utf8TextRangeDto, right: Utf8TextRangeDto): boolean {
  return left.startByte < right.endByte && right.startByte < left.endByte;
}

function classifyCoverage(
  coverage: CoverageReportDto,
  range: Utf8TextRangeDto,
  classification: Exclude<CoverageClassification, 'chapter'>,
): CoverageReportDto {
  const remaining = coverage.uncoveredRanges.filter(item => !sameRange(item, range));
  const classifiedByteLength = coverage.totalByteLength
    - remaining.reduce((total, item) => total + item.endByte - item.startByte, 0);
  return {
    ...coverage,
    segments: [...coverage.segments.filter(segment => !sameRange(segment.range, range)), { classification, range }],
    uncoveredRanges: remaining,
    classifiedByteLength,
    unclassifiedByteLength: coverage.totalByteLength - classifiedByteLength,
    complete: remaining.length === 0,
  };
}

function validateReviewCommand(
  snapshot: NovelImportReviewSnapshotDto,
  command: NovelImportReviewCommandInput,
): void {
  switch (command.commandType) {
    case 'adjust-chapter-boundary':
      if (!snapshot.chapters.some(chapter => chapter.chapterId === command.chapterId)
        || !isValidRange(command.headingRange, snapshot.textByteLength)
        || !isValidRange(command.contentRange, snapshot.textByteLength)
        || command.headingRange.endByte > command.contentRange.startByte) {
        throw invalidPayload('chapter boundary');
      }
      assertNonOverlappingChapters(snapshot, command);
      return;
    case 'classify-uncovered-range':
      if (!snapshot.coverage.uncoveredRanges.some(range => sameRange(range, command.range)))
        throw invalidPayload('uncovered range');
      return;
    case 'decide-normalization-proposal':
      if (!snapshot.normalizationProposals.some(proposal => proposal.proposalId === command.proposalId))
        throw invalidPayload('proposalId');
      return;
    case 'rerun-selection':
      if (command.chapterIds.length === 0
        || command.chapterIds.some(id => !snapshot.chapters.some(chapter => chapter.chapterId === id))) {
        throw invalidPayload('chapterIds');
      }
      break;

    case 'confirm-review':
      break;
  }
}

function assertNonOverlappingChapters(
  snapshot: NovelImportReviewSnapshotDto,
  command: Extract<NovelImportReviewCommandInput, { commandType: 'adjust-chapter-boundary' }>,
): void {
  const chapters = [...snapshot.chapters
    .map(chapter => chapter.chapterId === command.chapterId
      ? { ...chapter, headingRange: command.headingRange, contentRange: command.contentRange }
      : chapter)]
    .sort((left, right) => left.order - right.order);
  for (const [index, chapter] of chapters.entries()) {
    const previous = chapters[index - 1];
    if (previous && previous.contentRange.endByte > chapter.headingRange.startByte)
      throw invalidPayload('overlapping chapter boundary');
  }
}

function openProjectDatabase(session: ProjectSession): DatabaseSync {
  return new DatabaseSync(path.join(session.rootPath, PROJECT_STATE_DATABASE_PATH), { timeout: 5_000 });
}

function readLatestTask(database: DatabaseSync, statuses: readonly string[]): TaskRow | undefined {
  const placeholders = statuses.map(() => '?').join(', ');
  return database.prepare(`
    SELECT * FROM task WHERE execution_status IN (${placeholders})
    ORDER BY updated_at DESC, task_id ASC LIMIT 1
  `).get(...statuses) as unknown as TaskRow | undefined;
}

function readActiveRevision(database: DatabaseSync): RevisionRow | undefined {
  return database.prepare(`
    SELECT * FROM novel_import_revision WHERE active = 1 LIMIT 1
  `).get() as unknown as RevisionRow | undefined;
}

function readNextBaseline(database: DatabaseSync): number {
  const row = database.prepare(`
    SELECT COALESCE(MAX(baseline_revision), 0) + 1 AS value FROM novel_import_revision
  `).get() as { value: number };
  return row.value;
}

function readRevisionHistory(
  database: DatabaseSync,
): NovelImportReviewSnapshotDto['revisionHistory'] {
  const rows = database.prepare(`
    SELECT revision_id, baseline_revision, source_hash, source_encoding,
      processor_version, review_status, active, created_at
    FROM novel_import_revision
    ORDER BY baseline_revision ASC
  `).all() as unknown as RevisionRow[];
  return rows.map(row => ({
    revisionId: row.revision_id,
    baselineRevision: row.baseline_revision,
    sourceHash: row.source_hash,
    encoding: row.source_encoding,
    processorVersion: row.processor_version,
    reviewStatus: row.review_status,
    active: row.active === 1,
    createdAt: row.created_at,
  }));
}

function toTaskSummary(row: TaskRow): TaskSummaryDto {
  const total = Math.max(1, row.progress_total);
  const completed = Math.min(total, Math.max(0, row.progress_completed));
  return {
    taskId: row.task_id,
    taskType: 'novel-import',
    status: row.execution_status,
    recoveryStatus: row.recovery_status,
    attempt: row.attempt,
    progress: {
      completed,
      total,
      percent: Math.round(completed / total * 100),
      message: row.progress_message,
    },
    canCancel: row.execution_status === 'pending' || row.execution_status === 'running',
    canRetry: row.execution_status === 'failed' || row.execution_status === 'canceled',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ...(row.started_at ? { startedAt: row.started_at } : {}),
    ...(row.finished_at ? { finishedAt: row.finished_at } : {}),
    ...(row.error_code ? { errorCode: row.error_code } : {}),
    ...(row.error_message ? { errorMessage: row.error_message } : {}),
  };
}

function parseStoredTaskInput(value: string): StartNovelImportInput {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new VoxWeaverError('NOVEL_IMPORT_TASK_NOT_RETRYABLE', '任务参数损坏，无法重试。', false);
  }
  if (!isRecord(parsed))
    throw new VoxWeaverError('NOVEL_IMPORT_TASK_NOT_RETRYABLE', '任务参数损坏，无法重试。', false);
  if (parsed.sourceEncoding === null || parsed.sourceEncoding === undefined)
    return {};
  if (!['gbk', 'gb18030', 'big5', 'utf-16le', 'utf-16be'].includes(String(parsed.sourceEncoding))) {
    throw new VoxWeaverError('NOVEL_IMPORT_TASK_NOT_RETRYABLE', '任务编码参数损坏，无法重试。', false);
  }
  return {
    sourceEncoding: parsed.sourceEncoding as NonNullable<StartNovelImportInput['sourceEncoding']>,
  };
}

function parseReviewSnapshot(value: string): NovelImportReviewSnapshotDto {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '小说导入复核快照损坏。', false);
  }
  if (!isRecord(parsed)
    || typeof parsed.revisionId !== 'string'
    || !Number.isSafeInteger(parsed.baselineRevision)
    || !Array.isArray(parsed.candidates)
    || !Array.isArray(parsed.chapters)
    || !isRecord(parsed.coverage)
    || !Array.isArray(parsed.normalizationProposals)) {
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '小说导入复核快照损坏。', false);
  }
  return parsed as unknown as NovelImportReviewSnapshotDto;
}

function assertCurrentBaseline(snapshot: NovelImportReviewSnapshotDto, baseline: number): void {
  if (!Number.isSafeInteger(baseline) || snapshot.baselineRevision !== baseline) {
    throw new VoxWeaverError(
      'NOVEL_IMPORT_CONFLICT',
      '复核基线已变化，请刷新后重试。',
      false,
      { currentBaselineRevision: snapshot.baselineRevision },
    );
  }
}

function reviewConflict(): VoxWeaverError {
  return new VoxWeaverError(
    'NOVEL_IMPORT_CONFLICT',
    '复核基线已变化，请刷新后重试。',
    false,
  );
}

function readCurrentRevisionForCommand(
  session: ProjectSession,
  command: NovelImportReviewCommandInput,
): RevisionRow {
  const database = openProjectDatabase(session);
  try {
    const row = readActiveRevision(database);
    if (!row)
      throw new VoxWeaverError('NOVEL_IMPORT_REVIEW_REQUIRED', '当前项目没有可复核的 revision。', false);
    const snapshot = parseReviewSnapshot(row.review_snapshot_json);
    assertCurrentBaseline(snapshot, command.baselineRevision);
    validateReviewCommand(snapshot, command);
    return row;
  } finally {
    database.close();
  }
}

async function validateReviewByteBoundaries(
  session: ProjectSession,
  row: RevisionRow,
  command: NovelImportReviewCommandInput,
): Promise<void> {
  if (command.commandType !== 'adjust-chapter-boundary')
    return;
  const handle = await openProjectArtifactFile(session.rootPath, row.canonical_text_path);
  try {
    const stat = await handle.stat();
    const offsets = [
      command.headingRange.startByte,
      command.headingRange.endByte,
      command.contentRange.startByte,
      command.contentRange.endByte,
    ];
    for (const offset of offsets) {
      if (offset === 0 || offset === stat.size)
        continue;
      const byte = Buffer.allocUnsafe(1);
      const { bytesRead } = await handle.read(byte, 0, 1, offset);
      if (bytesRead !== 1 || (byte[0]! & 0xC0) === 0x80)
        throw invalidPayload('chapter boundary UTF-8 offset');
    }
  } finally {
    await handle.close();
  }
}

async function prepareRerunSelection(
  session: ProjectSession,
  row: RevisionRow,
  snapshot: NovelImportReviewSnapshotDto,
  command: Extract<NovelImportReviewCommandInput, { commandType: 'rerun-selection' }>,
): Promise<RerunSelectionResult> {
  const selected = snapshot.chapters
    .filter(chapter => command.chapterIds.includes(chapter.chapterId))
    .sort((left, right) => left.order - right.order);
  const candidates: ChapterCandidateDto[] = [];
  const chapters: ChapterDto[] = [];
  const coverageSegments: CoverageSegmentDto[] = [];

  for (const selectedChapter of selected) {
    const startByte = selectedChapter.headingRange.startByte;
    const endByte = selectedChapter.contentRange.endByte;
    const text = await readProjectArtifactUtf8Range(session, row, startByte, endByte);
    const analysis = analyzeNovelStructure(
      text,
      `${snapshot.source.sha256}:${startByte}:${endByte}`,
    );
    if (analysis.chapters.length === 0) {
      throw new VoxWeaverError(
        'NOVEL_IMPORT_REVIEW_REQUIRED',
        `局部重跑未在“${selectedChapter.title}”范围内检测到章节标题，请保留并人工调整边界。`,
        false,
      );
    }

    const offsetCandidates = analysis.candidates.map(candidate => ({
      ...candidate,
      headingRange: offsetRange(candidate.headingRange, startByte),
      reviewStatus: 'pending' as const,
    }));
    const offsetChapters = analysis.chapters.map(chapter => ({
      ...chapter,
      headingRange: offsetRange(chapter.headingRange, startByte),
      contentRange: offsetRange(chapter.contentRange, startByte),
      reviewStatus: 'pending' as const,
    }));
    candidates.push(...offsetCandidates);
    chapters.push(...offsetChapters);

    const existingSegment = snapshot.coverage.segments.find(segment => (
      segment.classification === 'chapter'
      && segment.chapterId === selectedChapter.chapterId
    ));
    let segmentStart = existingSegment?.range.startByte ?? startByte;
    for (const [index, chapter] of offsetChapters.entries()) {
      const segmentEnd = index === offsetChapters.length - 1
        ? existingSegment?.range.endByte ?? endByte
        : chapter.contentRange.endByte;
      coverageSegments.push({
        classification: 'chapter',
        chapterId: chapter.chapterId,
        range: {
          offsetUnit: 'utf8-byte',
          startByte: segmentStart,
          endByte: segmentEnd,
        },
      });
      segmentStart = segmentEnd;
    }
  }

  return { candidates, chapters, coverageSegments };
}

async function readProjectArtifactUtf8Range(
  session: ProjectSession,
  row: RevisionRow,
  startByte: number,
  endByte: number,
): Promise<string> {
  if (!Number.isSafeInteger(startByte)
    || !Number.isSafeInteger(endByte)
    || startByte < 0
    || endByte <= startByte) {
    throw invalidPayload('local rerun range');
  }
  const handle = await openProjectArtifactFile(session.rootPath, row.canonical_text_path);
  try {
    const before = await handle.stat();
    if (!before.isFile() || endByte > before.size)
      throw invalidPayload('local rerun range');
    const bytes = await readExactBytes(handle, endByte - startByte, startByte);
    const after = await handle.stat();
    if (!sameFileStats(before, after))
      throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '局部重跑期间小说文本 artifact 发生变化。', false);
    try {
      return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes);
    } catch {
      throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '小说文本 artifact 不是有效 UTF-8。', false);
    }
  } finally {
    await handle.close();
  }
}

async function readProjectArtifactSlice(
  session: ProjectSession,
  row: RevisionRow,
  input: TextSliceRequest,
): Promise<TextSliceDto> {
  const length = input.endByte - input.startByte;
  if (!Number.isSafeInteger(input.startByte)
    || !Number.isSafeInteger(input.endByte)
    || input.startByte < 0
    || input.endByte < input.startByte
    || length > NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES) {
    throw invalidPayload('text slice range');
  }

  const handle = await openProjectArtifactFile(session.rootPath, row.canonical_text_path);
  try {
    const before = await handle.stat();
    if (!before.isFile() || input.endByte > before.size)
      throw invalidPayload('text slice range');
    const bytes = await readExactBytes(handle, length, input.startByte);
    const after = await handle.stat();
    if (!sameFileStats(before, after)) {
      throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '读取期间小说文本 artifact 发生变化。', false);
    }
    return decodeUtf8TextSlice({
      revisionId: row.revision_id,
      sliceBytes: bytes,
      startByte: input.startByte,
      endByte: input.endByte,
      totalByteLength: before.size,
    });
  } finally {
    await handle.close();
  }
}

async function readExactBytes(
  handle: Awaited<ReturnType<typeof open>>,
  length: number,
  position: number,
): Promise<Buffer> {
  const bytes = Buffer.allocUnsafe(length);
  let totalRead = 0;
  while (totalRead < length) {
    const { bytesRead } = await handle.read(
      bytes,
      totalRead,
      length - totalRead,
      position + totalRead,
    );
    if (bytesRead === 0)
      throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '小说文本 artifact 提前结束。', false);
    totalRead += bytesRead;
  }
  return bytes;
}

function sameFileStats(left: Stats, right: Stats): boolean {
  return left.dev === right.dev
    && left.ino === right.ino
    && left.size === right.size
    && left.mtimeMs === right.mtimeMs;
}

function offsetRange(range: Utf8TextRangeDto, offset: number): Utf8TextRangeDto {
  return {
    offsetUnit: 'utf8-byte',
    startByte: range.startByte + offset,
    endByte: range.endByte + offset,
  };
}

async function openProjectArtifactFile(rootPath: string, relativePath: string) {
  const resolved = resolveProjectRelativePath(rootPath, relativePath);
  let currentPath = path.resolve(rootPath);
  for (const [index, segment] of relativePath.split('/').entries()) {
    currentPath = path.join(currentPath, segment);
    const stat = await lstat(currentPath);
    if (stat.isSymbolicLink()
      || (index < relativePath.split('/').length - 1 ? !stat.isDirectory() : !stat.isFile())) {
      throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '项目 artifact 路径包含符号链接或非预期节点。', false);
    }
  }
  const [canonicalRoot, canonicalFile] = await Promise.all([
    realpath(rootPath),
    realpath(resolved),
  ]);
  const relativeCanonicalPath = path.relative(canonicalRoot, canonicalFile);
  if (!relativeCanonicalPath
    || relativeCanonicalPath === '..'
    || relativeCanonicalPath.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeCanonicalPath)) {
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '项目 artifact 真实路径越出项目根目录。', false);
  }
  const noFollow = typeof constants.O_NOFOLLOW === 'number' ? constants.O_NOFOLLOW : 0;
  return open(resolved, constants.O_RDONLY | noFollow);
}

function resolveProjectRelativePath(rootPath: string, relativePath: string): string {
  const resolved = path.resolve(rootPath, ...relativePath.split('/'));
  const relative = path.relative(rootPath, resolved);
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative))
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '项目 artifact 路径无效。', false);
  return resolved;
}

function parseStoredPreview(value: string): StalePreviewDto {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '复核影响预览记录损坏。', false);
  }
  if (!isRecord(parsed)
    || !Number.isSafeInteger(parsed.baselineRevision)
    || typeof parsed.commandType !== 'string'
    || !Array.isArray(parsed.affected)
    || typeof parsed.requiresConfirmation !== 'boolean') {
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '复核影响预览记录损坏。', false);
  }
  return parsed as unknown as StalePreviewDto;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value))
    return `[${value.map(stableJson).join(',')}]`;
  if (isRecord(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${stableJson(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function sha256Text(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

function sameRange(left: Utf8TextRangeDto, right: Utf8TextRangeDto): boolean {
  return left.offsetUnit === 'utf8-byte'
    && right.offsetUnit === 'utf8-byte'
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function isValidRange(range: Utf8TextRangeDto, maximum: number): boolean {
  return range.offsetUnit === 'utf8-byte'
    && Number.isSafeInteger(range.startByte)
    && Number.isSafeInteger(range.endByte)
    && range.startByte >= 0
    && range.endByte > range.startByte
    && range.endByte <= maximum;
}

function mergeDiff(
  existing: readonly TextDiffHunkDto[],
  next: TextDiffHunkDto,
): TextDiffHunkDto[] {
  return [...existing.filter(item => !sameRange(item.range, next.range)), next]
    .sort((left, right) => left.range.startByte - right.range.startByte);
}

function normalizeNovelImportError(error: unknown): { code: string; message: string } {
  if (error instanceof NovelImportError || error instanceof VoxWeaverError)
    return { code: error.code, message: error.message };
  return { code: 'NOVEL_IMPORT_INVALID_SOURCE', message: '小说导入失败。' };
}

function invalidPayload(field: string): VoxWeaverError {
  return new VoxWeaverError('IPC_PAYLOAD_INVALID', `小说导入请求字段无效：${field}。`, false);
}

function rollbackIgnoringErrors(database: DatabaseSync): void {
  try {
    database.exec('ROLLBACK;');
  } catch {
    // No active transaction remains.
  }
}

async function syncFile(filePath: string): Promise<void> {
  const handle = await open(filePath, 'r');
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

class TaskCanceledError extends Error {}
