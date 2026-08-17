import type {
  ChapterDto,
  ChapterStructureProjectionDto,
  CoreEventEnvelope,
  CoreTrustedContext,
  NovelImportEventDto,
  NovelImportReviewCommandInput,
  NovelImportReviewSnapshotDto,
  SourceTextPreviewDto,
  SourceTextPreviewRequest,
  StaleImpactItemDto,
  StalePreviewDto,
  StartNovelImportInput,
  TaskSummaryDto,
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
import {
  CORE_PROTOCOL_VERSION,
  isRecord,
  NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES,
  PROJECT_STATE_DATABASE_PATH,
  TXT_SOURCE_ENCODINGS,
  VoxWeaverError,
} from '@voxweaver/contracts';
import {
  createChapterCoverage,
  createNovelImportProcessorFingerprint,
  decodeUtf8TextSlice,
  importSourceAsset,
  NovelImportError,
  probeSourceAsset,
  readProjectSourceAsset,
  readProjectSourcePreview,
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

interface PreparedReviewText {
  readonly insertedCanonicalText?: Buffer;
  readonly textByteLength: number;
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
    if (probe.encoding.status === 'rejected')
      throw new VoxWeaverError('NOVEL_IMPORT_INVALID_SOURCE', probe.encoding.message, false);
    if (input.sourceEncoding !== undefined
      && !(TXT_SOURCE_ENCODINGS as readonly string[]).includes(input.sourceEncoding)) {
      throw invalidPayload('sourceEncoding');
    }
    if (input.sourceEncoding === undefined && probe.encoding.status === 'selection-required')
      throw new VoxWeaverError('NOVEL_IMPORT_ENCODING_REQUIRED', probe.encoding.message, false);

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

  async getSourcePreview(
    context: CoreTrustedContext,
    input: SourceTextPreviewRequest,
  ): Promise<SourceTextPreviewDto> {
    const session = this.#sessions.requireSession(context);
    return readProjectSourcePreview(
      session.rootPath,
      session.manifest.sourceAsset,
      input,
    );
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
    await prepareReviewText(session, initialRow, command);
    const commandHash = reviewCommandHash(command);

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
        commandHash,
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
    const preparedText = await prepareReviewText(session, initialRow, command);
    const commandHash = reviewCommandHash(command);

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
      `).get(command.baselineRevision, commandHash, now) as {
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
      const changed = applyReviewCommand(snapshot, command, preparedText.textByteLength);
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
      const temporaryTextPath = path.join(temporaryDirectory, 'text.utf8.txt');
      if (preparedText.insertedCanonicalText) {
        await writeFile(temporaryTextPath, preparedText.insertedCanonicalText, {
          flag: 'wx',
          mode: 0o600,
        });
        await syncFile(temporaryTextPath);
      }
      await writeFile(temporarySnapshotPath, snapshotArtifactJson, {
        flag: 'wx',
        mode: 0o600,
      });
      await syncFile(temporarySnapshotPath);
      await mkdir(path.dirname(artifactDirectory), { recursive: true, mode: 0o700 });
      await rename(temporaryDirectory, artifactDirectory);
      artifactPublished = true;
      const canonicalTextRelativePath = preparedText.insertedCanonicalText
        ? path.posix.join(TASK_ARTIFACT_DIRECTORY, nextRevisionId, 'text.utf8.txt')
        : row.canonical_text_path;

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
        canonicalTextRelativePath,
        snapshotJson,
        updated.reviewStatus,
        now,
      );
      database.prepare(`
        UPDATE artifact_revision SET validity_status = 'superseded'
        WHERE revision_id = ? AND validity_status = 'current'
      `).run(snapshot.revisionId);
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
        await removeDirectoryIgnoringErrors(artifactDirectory);
      throw error;
    } finally {
      closeDatabaseIgnoringErrors(database);
      await removeDirectoryIgnoringErrors(temporaryDirectory);
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
            progress_message = '已完成章节分析，准备发布产物', updated_at = ?
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
    chapters: artifact.chapters,
    coverage: artifact.coverage,
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
  textByteLength: number,
): NovelImportReviewSnapshotDto {
  switch (command.commandType) {
    case 'adjust-chapter-boundaries': {
      const chapters = projectChapterAdjustments(snapshot.chapters, command)
        .map(chapter => ({ ...chapter, reviewStatus: 'pending' as const }));
      return {
        ...snapshot,
        chapters,
        coverage: createChapterCoverage(
          snapshot.textByteLength,
          chapters,
          snapshot.coverage.uncoveredRanges,
        ),
        reviewStatus: 'pending',
      };
    }
    case 'update-chapter-structure': {
      const existingIds = new Set(snapshot.chapters.map(chapter => chapter.chapterId));
      const chapters = command.chapters.map((chapter, index): ChapterDto => {
        const chapterId = chapter.existingChapterId ?? createChapterId(existingIds);
        existingIds.add(chapterId);
        return {
          chapterId,
          order: index + 1,
          title: chapter.headingKind === 'missing' ? '未命名章节' : chapter.title,
          headingKind: chapter.headingKind,
          ...(chapter.headingRange ? { headingRange: chapter.headingRange } : {}),
          contentRange: chapter.contentRange,
          reviewStatus: 'pending',
          lengthAnomalyAccepted: chapter.lengthAnomalyAccepted,
        };
      });
      return {
        ...snapshot,
        textByteLength,
        chapters,
        coverage: createChapterCoverage(textByteLength, chapters, command.unassignedRanges),
        reviewStatus: 'pending',
      };
    }
    case 'confirm-review':
      if (snapshot.chapters.length === 0) {
        throw new VoxWeaverError(
          'NOVEL_IMPORT_REVIEW_REQUIRED',
          '必须至少存在一个有效章节。',
          false,
        );
      }
      assertValidChapterProjection(snapshot.chapters, snapshot.textByteLength);
      return {
        ...snapshot,
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

function validateReviewCommand(
  snapshot: NovelImportReviewSnapshotDto,
  command: NovelImportReviewCommandInput,
): void {
  assertReviewCommandWhitelist(command);
  switch (command.commandType) {
    case 'adjust-chapter-boundaries': {
      if (command.adjustments.length === 0)
        throw invalidPayload('chapter adjustments');
      const chapterIds = new Set(snapshot.chapters.map(chapter => chapter.chapterId));
      const adjustedIds = new Set<string>();
      for (const adjustment of command.adjustments) {
        if (!chapterIds.has(adjustment.chapterId) || adjustedIds.has(adjustment.chapterId))
          throw invalidPayload('chapter adjustments');
        adjustedIds.add(adjustment.chapterId);
      }
      const projectedChapters = projectChapterAdjustments(snapshot.chapters, command);
      assertValidChapterProjection(projectedChapters, snapshot.textByteLength);
      assertStructureRangesCoverText(
        projectedChapters,
        snapshot.coverage.uncoveredRanges,
        snapshot.textByteLength,
      );
      break;
    }
    case 'update-chapter-structure': {
      const maximum = snapshot.textByteLength + command.insertionPoints.length;
      const insertionPoints = new Set<number>();
      for (const insertionPoint of command.insertionPoints) {
        if (!Number.isSafeInteger(insertionPoint)
          || insertionPoint < 0
          || insertionPoint > snapshot.textByteLength
          || insertionPoints.has(insertionPoint)) {
          throw invalidPayload('chapter structure insertion point');
        }
        insertionPoints.add(insertionPoint);
      }

      const existingChapters = new Map(
        snapshot.chapters.map(chapter => [chapter.chapterId, chapter]),
      );
      const projectedExistingIds = new Set<string>();
      for (const chapter of command.chapters) {
        if (chapter.existingChapterId !== undefined) {
          const existing = existingChapters.get(chapter.existingChapterId);
          if (!existing || projectedExistingIds.has(chapter.existingChapterId))
            throw invalidPayload('chapter structure chapter ID');
          if (existing.lengthAnomalyAccepted && !chapter.lengthAnomalyAccepted)
            throw invalidPayload('chapter structure anomaly acceptance');
          projectedExistingIds.add(chapter.existingChapterId);
        }
        assertValidStructureProjection(chapter, maximum);
      }
      assertStructureRangesCoverText(command.chapters, command.unassignedRanges, maximum);
      break;
    }
    case 'confirm-review':
      break;
  }
}

function assertReviewCommandWhitelist(command: NovelImportReviewCommandInput): void {
  if (!isRecord(command)
    || !Number.isSafeInteger(command.baselineRevision)
    || command.baselineRevision < 1
    || typeof command.commandType !== 'string') {
    throw invalidPayload('review command');
  }
  switch (command.commandType) {
    case 'adjust-chapter-boundaries':
      assertOnlyKeys(command, ['baselineRevision', 'commandType', 'adjustments']);
      if (!Array.isArray(command.adjustments) || command.adjustments.length === 0)
        throw invalidPayload('chapter adjustments');
      for (const adjustment of command.adjustments) {
        if (!isRecord(adjustment))
          throw invalidPayload('chapter adjustment');
        assertOnlyKeys(adjustment, ['chapterId', 'headingRange', 'contentRange']);
        if (!isNonEmptyText(adjustment.chapterId))
          throw invalidPayload('chapter adjustment ID');
        assertRangeWhitelist(adjustment.headingRange);
        assertRangeWhitelist(adjustment.contentRange);
      }
      break;
    case 'update-chapter-structure':
      assertOnlyKeys(command, [
        'baselineRevision',
        'commandType',
        'insertionPoints',
        'chapters',
        'unassignedRanges',
      ]);
      if (!Array.isArray(command.insertionPoints)
        || !Array.isArray(command.chapters)
        || !Array.isArray(command.unassignedRanges)) {
        throw invalidPayload('chapter structure');
      }
      for (const insertionPoint of command.insertionPoints) {
        if (!Number.isSafeInteger(insertionPoint))
          throw invalidPayload('chapter structure insertion point');
      }
      for (const chapter of command.chapters) {
        if (!isRecord(chapter))
          throw invalidPayload('chapter projection');
        assertOnlyKeys(chapter, [
          'existingChapterId',
          'title',
          'headingKind',
          'headingRange',
          'contentRange',
          'lengthAnomalyAccepted',
        ]);
        const invalidExistingId = chapter.existingChapterId !== undefined
          && !isNonEmptyText(chapter.existingChapterId);
        if (invalidExistingId
          || !isNonEmptyText(chapter.title)
          || (chapter.headingKind !== 'source' && chapter.headingKind !== 'missing')
          || typeof chapter.lengthAnomalyAccepted !== 'boolean'
          || (chapter.headingKind === 'source' && chapter.headingRange === undefined)
          || (chapter.headingKind === 'missing' && chapter.headingRange !== undefined)) {
          throw invalidPayload('chapter projection');
        }
        if (chapter.headingRange !== undefined)
          assertRangeWhitelist(chapter.headingRange);
        assertRangeWhitelist(chapter.contentRange);
      }
      for (const range of command.unassignedRanges)
        assertRangeWhitelist(range);
      break;
    case 'confirm-review':
      assertOnlyKeys(command, ['baselineRevision', 'commandType']);
      break;
    default:
      throw invalidPayload('review command type');
  }
}

function assertOnlyKeys(value: Record<string, unknown>, allowedKeys: readonly string[]): void {
  if (Object.keys(value).some(key => !allowedKeys.includes(key)))
    throw invalidPayload('unexpected field');
}

function assertRangeWhitelist(value: unknown): void {
  if (!isRecord(value))
    throw invalidPayload('utf8 byte range');
  assertOnlyKeys(value, ['offsetUnit', 'startByte', 'endByte']);
  if (value.offsetUnit !== 'utf8-byte'
    || !Number.isSafeInteger(value.startByte)
    || !Number.isSafeInteger(value.endByte)) {
    throw invalidPayload('utf8 byte range');
  }
}

function projectChapterAdjustments(
  chapters: readonly ChapterDto[],
  command: Extract<NovelImportReviewCommandInput, { commandType: 'adjust-chapter-boundaries' }>,
): ChapterDto[] {
  const byChapterId = new Map(command.adjustments.map(adjustment => [adjustment.chapterId, adjustment]));
  return chapters.map((chapter) => {
    const adjustment = byChapterId.get(chapter.chapterId);
    return adjustment
      ? { ...chapter, headingRange: adjustment.headingRange, contentRange: adjustment.contentRange }
      : chapter;
  });
}

function assertValidChapterProjection(
  chapters: readonly ChapterDto[],
  maximum: number,
): void {
  const chapterIds = new Set<string>();
  let previousEndByte = 0;
  for (const [index, chapter] of chapters.entries()) {
    if (chapter.order !== index + 1
      || !isNonEmptyText(chapter.chapterId)
      || chapterIds.has(chapter.chapterId)
      || !isNonEmptyText(chapter.title)
      || typeof chapter.lengthAnomalyAccepted !== 'boolean'
      || (chapter.reviewStatus !== 'pending'
        && chapter.reviewStatus !== 'approved'
        && chapter.reviewStatus !== 'rejected')
      || !isValidRange(chapter.contentRange, maximum, true)
      || !isValidHeading(chapter.headingKind, chapter.headingRange, chapter.contentRange, maximum)) {
      throw invalidPayload('chapter boundary');
    }
    if (chapter.headingKind === 'missing' && chapter.title !== '未命名章节')
      throw invalidPayload('missing chapter title');
    const startByte = chapter.headingRange?.startByte ?? chapter.contentRange.startByte;
    if (startByte < previousEndByte)
      throw invalidPayload('overlapping chapter boundary');
    previousEndByte = chapter.contentRange.endByte;
    chapterIds.add(chapter.chapterId);
  }
}

function assertValidStructureProjection(
  chapter: ChapterStructureProjectionDto,
  maximum: number,
): void {
  if (!isNonEmptyText(chapter.title)
    || typeof chapter.lengthAnomalyAccepted !== 'boolean'
    || !isValidRange(chapter.contentRange, maximum, true)
    || !isValidHeading(chapter.headingKind, chapter.headingRange, chapter.contentRange, maximum)
    || (chapter.headingKind === 'missing' && chapter.title !== '未命名章节')) {
    throw invalidPayload('chapter structure projection');
  }
}

function assertStructureRangesCoverText(
  chapters: readonly ChapterStructureProjectionDto[],
  unassignedRanges: readonly Utf8TextRangeDto[],
  maximum: number,
): void {
  const protectedRanges: Utf8TextRangeDto[] = [];
  let previousChapterEnd = 0;
  for (const chapter of chapters) {
    const startByte = chapter.headingRange?.startByte ?? chapter.contentRange.startByte;
    if (startByte < previousChapterEnd)
      throw invalidPayload('chapter structure range order');
    previousChapterEnd = chapter.contentRange.endByte;
    if (chapter.headingRange)
      protectedRanges.push(chapter.headingRange);
    if (chapter.contentRange.startByte < chapter.contentRange.endByte)
      protectedRanges.push(chapter.contentRange);
  }

  let previousUnassignedEnd = 0;
  for (const range of unassignedRanges) {
    if (!isValidRange(range, maximum, false) || range.startByte < previousUnassignedEnd)
      throw invalidPayload('unassigned range');
    if (protectedRanges.some(protectedRange => rangesOverlap(range, protectedRange)))
      throw invalidPayload('unassigned chapter overlap');
    previousUnassignedEnd = range.endByte;
  }

  if (chapters.length === 0) {
    let cursor = 0;
    for (const range of unassignedRanges) {
      if (range.startByte !== cursor)
        throw invalidPayload('chapter structure coverage');
      cursor = range.endByte;
    }
    if (cursor !== maximum)
      throw invalidPayload('chapter structure coverage');
  }
}

function rangesOverlap(left: Utf8TextRangeDto, right: Utf8TextRangeDto): boolean {
  return left.startByte < right.endByte && right.startByte < left.endByte;
}

function isValidHeading(
  headingKind: unknown,
  headingRange: Utf8TextRangeDto | undefined,
  contentRange: Utf8TextRangeDto,
  maximum: number,
): boolean {
  if (headingKind === 'missing')
    return headingRange === undefined;
  return headingKind === 'source'
    && headingRange !== undefined
    && isValidRange(headingRange, maximum, false)
    && headingRange.endByte <= contentRange.startByte;
}

function createChapterId(reservedIds: ReadonlySet<string>): string {
  let chapterId: string;
  do {
    chapterId = `chapter-${randomUUID()}`;
  } while (reservedIds.has(chapterId));
  return chapterId;
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
  if (!(TXT_SOURCE_ENCODINGS as readonly string[]).includes(String(parsed.sourceEncoding))) {
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
    || !isRecord(parsed.source)
    || typeof parsed.encoding !== 'string'
    || typeof parsed.encodingMethod !== 'string'
    || !Number.isSafeInteger(parsed.textByteLength)
    || !Array.isArray(parsed.chapters)
    || !isRecord(parsed.coverage)
    || !Array.isArray(parsed.revisionHistory)
    || (parsed.reviewStatus !== 'pending' && parsed.reviewStatus !== 'approved')
    || typeof parsed.createdAt !== 'string') {
    throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '小说导入复核快照损坏。', false);
  }
  const textByteLength = parsed.textByteLength as number;
  const chapters = parsed.chapters.map((chapter): ChapterDto => {
    if (!isRecord(chapter)
      || !isNonEmptyText(chapter.chapterId)
      || !Number.isSafeInteger(chapter.order)
      || !isNonEmptyText(chapter.title)
      || (chapter.reviewStatus !== 'pending'
        && chapter.reviewStatus !== 'approved'
        && chapter.reviewStatus !== 'rejected')) {
      throw invalidStoredReviewSnapshot();
    }
    const headingKind = chapter.headingKind === undefined ? 'source' : chapter.headingKind;
    const lengthAnomalyAccepted = chapter.lengthAnomalyAccepted === undefined
      ? false
      : chapter.lengthAnomalyAccepted;
    if ((headingKind !== 'source' && headingKind !== 'missing')
      || typeof lengthAnomalyAccepted !== 'boolean') {
      throw invalidStoredReviewSnapshot();
    }
    const headingRange = chapter.headingRange === undefined
      ? undefined
      : parseStoredRange(chapter.headingRange, textByteLength, false);
    const contentRange = parseStoredRange(chapter.contentRange, textByteLength, true);
    return {
      chapterId: chapter.chapterId,
      order: chapter.order as number,
      title: chapter.title,
      headingKind,
      ...(headingRange ? { headingRange } : {}),
      contentRange,
      reviewStatus: chapter.reviewStatus,
      lengthAnomalyAccepted,
    };
  });
  try {
    assertValidChapterProjection(chapters, textByteLength);
  } catch {
    throw invalidStoredReviewSnapshot();
  }
  return {
    revisionId: parsed.revisionId,
    baselineRevision: parsed.baselineRevision as number,
    source: parsed.source as unknown as NovelImportReviewSnapshotDto['source'],
    encoding: parsed.encoding as NovelImportReviewSnapshotDto['encoding'],
    encodingMethod: parsed.encodingMethod as NovelImportReviewSnapshotDto['encodingMethod'],
    textByteLength,
    chapters,
    coverage: parsed.coverage as unknown as NovelImportReviewSnapshotDto['coverage'],
    revisionHistory: parsed.revisionHistory as unknown as NovelImportReviewSnapshotDto['revisionHistory'],
    reviewStatus: parsed.reviewStatus,
    createdAt: parsed.createdAt,
  };
}

function parseStoredRange(
  value: unknown,
  maximum: number,
  allowEmpty: boolean,
): Utf8TextRangeDto {
  if (!isRecord(value))
    throw invalidStoredReviewSnapshot();
  const range: Utf8TextRangeDto = {
    offsetUnit: value.offsetUnit as 'utf8-byte',
    startByte: value.startByte as number,
    endByte: value.endByte as number,
  };
  if (!isValidRange(range, maximum, allowEmpty))
    throw invalidStoredReviewSnapshot();
  return range;
}

function invalidStoredReviewSnapshot(): VoxWeaverError {
  return new VoxWeaverError('PROJECT_DATABASE_INVALID', '小说导入复核快照损坏。', false);
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
  assertReviewCommandWhitelist(command);
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

async function prepareReviewText(
  session: ProjectSession,
  row: RevisionRow,
  command: NovelImportReviewCommandInput,
): Promise<PreparedReviewText> {
  const snapshot = parseReviewSnapshot(row.review_snapshot_json);
  if (command.commandType === 'confirm-review')
    return { textByteLength: snapshot.textByteLength };

  const handle = await openProjectArtifactFile(session.rootPath, row.canonical_text_path);
  try {
    const before = await handle.stat();
    if (!before.isFile() || before.size !== snapshot.textByteLength) {
      throw new VoxWeaverError(
        'PROJECT_DATABASE_INVALID',
        '小说导入复核快照与规范化文本长度不一致。',
        false,
      );
    }

    if (command.commandType === 'adjust-chapter-boundaries') {
      const offsets = new Set(command.adjustments.flatMap(adjustment => [
        adjustment.headingRange.startByte,
        adjustment.headingRange.endByte,
        adjustment.contentRange.startByte,
        adjustment.contentRange.endByte,
      ]));
      for (const offset of offsets) {
        if (!await isArtifactUtf8Boundary(handle, offset, before.size))
          throw invalidPayload('chapter boundary UTF-8 offset');
      }
      return { textByteLength: snapshot.textByteLength };
    }

    for (const insertionPoint of command.insertionPoints) {
      if (!await isArtifactUtf8Boundary(handle, insertionPoint, before.size))
        throw invalidPayload('line insertion UTF-8 offset');
    }
    const baselineBytes = await readExactBytes(handle, before.size, 0);
    const after = await handle.stat();
    if (!sameFileStats(before, after)) {
      throw new VoxWeaverError(
        'PROJECT_DATABASE_INVALID',
        '读取期间小说文本 artifact 发生变化。',
        false,
      );
    }
    for (const insertionPoint of command.insertionPoints) {
      if (isLineBreakByte(baselineBytes[insertionPoint - 1])
        || isLineBreakByte(baselineBytes[insertionPoint])) {
        throw invalidPayload('line insertion newline boundary');
      }
    }
    const editedBytes = insertLineFeeds(baselineBytes, command.insertionPoints);
    const finalOffsets = new Set<number>();
    for (const chapter of command.chapters) {
      if (chapter.headingRange) {
        finalOffsets.add(chapter.headingRange.startByte);
        finalOffsets.add(chapter.headingRange.endByte);
      }
      finalOffsets.add(chapter.contentRange.startByte);
      finalOffsets.add(chapter.contentRange.endByte);
    }
    for (const range of command.unassignedRanges) {
      finalOffsets.add(range.startByte);
      finalOffsets.add(range.endByte);
    }
    for (const offset of finalOffsets) {
      if (!isUtf8Boundary(editedBytes, offset))
        throw invalidPayload('chapter structure UTF-8 offset');
    }
    return {
      textByteLength: editedBytes.byteLength,
      ...(command.insertionPoints.length > 0 ? { insertedCanonicalText: editedBytes } : {}),
    };
  } finally {
    await handle.close();
  }
}

function isLineBreakByte(value: number | undefined): boolean {
  return value === 0x0A || value === 0x0D;
}

function insertLineFeeds(baselineBytes: Buffer, insertionPoints: readonly number[]): Buffer {
  if (insertionPoints.length === 0)
    return baselineBytes;
  const ordered = [...insertionPoints].sort((left, right) => left - right);
  const edited = Buffer.allocUnsafe(baselineBytes.byteLength + ordered.length);
  let sourceOffset = 0;
  let targetOffset = 0;
  for (const insertionPoint of ordered) {
    targetOffset += baselineBytes.copy(edited, targetOffset, sourceOffset, insertionPoint);
    edited[targetOffset] = 0x0A;
    targetOffset += 1;
    sourceOffset = insertionPoint;
  }
  baselineBytes.copy(edited, targetOffset, sourceOffset);
  return edited;
}

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  return Number.isSafeInteger(offset)
    && offset >= 0
    && offset <= bytes.byteLength
    && (offset === 0 || offset === bytes.byteLength || (bytes[offset]! & 0xC0) !== 0x80);
}

async function readProjectArtifactSlice(
  session: ProjectSession,
  row: RevisionRow,
  input: TextSliceRequest,
): Promise<TextSliceDto> {
  if (!Number.isSafeInteger(input.startByte)
    || !Number.isSafeInteger(input.endByte)
    || input.startByte < 0
    || input.endByte < input.startByte) {
    throw invalidPayload('text slice range');
  }

  const handle = await openProjectArtifactFile(session.rootPath, row.canonical_text_path);
  try {
    const before = await handle.stat();
    if (!before.isFile() || input.endByte > before.size)
      throw invalidPayload('text slice range');
    if (!await isArtifactUtf8Boundary(handle, input.startByte, before.size)
      || !await isArtifactUtf8Boundary(handle, input.endByte, before.size)) {
      throw invalidPayload('text slice UTF-8 boundary');
    }
    let actualEndByte = Math.min(
      input.endByte,
      input.startByte + NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES,
    );
    while (actualEndByte > input.startByte
      && !await isArtifactUtf8Boundary(handle, actualEndByte, before.size)) {
      actualEndByte -= 1;
    }
    if (actualEndByte === input.startByte && input.endByte > input.startByte) {
      throw new VoxWeaverError(
        'PROJECT_DATABASE_INVALID',
        '小说文本 artifact 无法在分片上限内找到 UTF-8 边界。',
        false,
      );
    }
    const bytes = await readExactBytes(handle, actualEndByte - input.startByte, input.startByte);
    const after = await handle.stat();
    if (!sameFileStats(before, after)) {
      throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '读取期间小说文本 artifact 发生变化。', false);
    }
    return decodeUtf8TextSlice({
      revisionId: row.revision_id,
      sliceBytes: bytes,
      startByte: input.startByte,
      endByte: actualEndByte,
      done: actualEndByte === input.endByte,
    });
  } finally {
    await handle.close();
  }
}

async function isArtifactUtf8Boundary(
  handle: Awaited<ReturnType<typeof open>>,
  offset: number,
  totalByteLength: number,
): Promise<boolean> {
  if (!Number.isSafeInteger(offset) || offset < 0 || offset > totalByteLength)
    return false;
  if (offset === 0 || offset === totalByteLength)
    return true;
  const byte = Buffer.allocUnsafe(1);
  const { bytesRead } = await handle.read(byte, 0, 1, offset);
  return bytesRead === 1 && (byte[0]! & 0xC0) !== 0x80;
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

function reviewCommandHash(command: NovelImportReviewCommandInput): string {
  return sha256Text(stableJson(command));
}

function isValidRange(
  range: Utf8TextRangeDto,
  maximum: number,
  allowEmpty: boolean,
): boolean {
  return range.offsetUnit === 'utf8-byte'
    && Number.isSafeInteger(range.startByte)
    && Number.isSafeInteger(range.endByte)
    && range.startByte >= 0
    && (allowEmpty ? range.endByte >= range.startByte : range.endByte > range.startByte)
    && range.endByte <= maximum;
}

function isNonEmptyText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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

function closeDatabaseIgnoringErrors(database: DatabaseSync): void {
  try {
    database.close();
  } catch {
    // Cleanup must not replace the committed result or the original transaction error.
  }
}

async function removeDirectoryIgnoringErrors(directoryPath: string): Promise<void> {
  try {
    await rm(directoryPath, { recursive: true, force: true });
  } catch {
    // Cleanup must not replace the committed result or the original transaction error.
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
