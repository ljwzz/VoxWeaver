import type {
  AdjustNovelImportChapterBoundaryCommandV1,
  ClassifyNovelImportRangeCommandV1,
  CoverageClassificationV1,
  DecideNovelImportNormalizationCommandV1,
  DesktopNovelImportEventV1,
  DesktopNovelImportTaskV1,
  NovelImportChangeSelectorV1,
  NovelImportReviewBaselineV1,
  NovelImportReviewCommandV1,
  NovelImportReviewSnapshotV1,
  NovelImportStalePreviewV1,
  ProjectSummaryDto,
  RerunNovelImportSelectionCommandV1,
  TextRangeV1,
  UserSelectedTxtSourceEncoding,
} from '@voxweaver/contracts';
import type { NovelImportDesktopApi } from '../../../preload/index';
import { decodeDesktopBridgeError } from '../../../shared/desktopBridgeError.js';

const CONTRACT_VERSION = '1' as const;
const REVIEW_SCHEMA_VERSION = 1 as const;
const REQUESTED_BY = 'desktop-user';
const TASK_STORAGE_KEY = 'voxweaver:novel-import:active-task-v1';

export type NovelImportPhase
  = | 'canceled'
    | 'completed'
    | 'encoding-required'
    | 'failed'
    | 'idle'
    | 'ready'
    | 'running';

export type NovelImportAction
  = | 'cancel-task'
    | 'confirm-review'
    | 'inspect'
    | 'prepare-review'
    | 'refresh-task'
    | 'retry-task'
    | 'select-source'
    | 'start-task';

export interface NovelImportProjectContext {
  readonly accessMode: ProjectSummaryDto['accessMode'];
  readonly projectId: string;
  readonly projectSessionId: string;
}

export interface NovelImportSelectedSource {
  readonly displayName: string;
  readonly expiresAt: string;
  readonly selectionToken: string;
}

export interface NovelImportUiError {
  readonly code: string;
  readonly currentArtifactRevisionId?: string;
  readonly message: string;
  readonly operationId?: string;
  readonly retryable: boolean;
  readonly taskId?: string;
}

interface NovelImportErrorFields {
  readonly code: string;
  readonly currentArtifactRevisionId?: string;
  readonly operationId?: string;
  readonly retryable: boolean;
  readonly taskId?: string;
}

export interface PendingNovelImportReview {
  readonly command: NovelImportReviewCommandV1;
  readonly preview: NovelImportStalePreviewV1;
  readonly scopeDescription: string;
}

export interface NovelImportRendererState {
  readonly action: NovelImportAction | null;
  readonly error: NovelImportUiError | null;
  readonly eventSubscription: 'subscribed' | 'unavailable' | 'waiting';
  readonly lastEventSequence: number;
  readonly pendingReview: PendingNovelImportReview | null;
  readonly phase: NovelImportPhase;
  readonly project: NovelImportProjectContext | null;
  readonly selectedChapterId: string | null;
  readonly selectedEncoding: UserSelectedTxtSourceEncoding | null;
  readonly selectedSource: NovelImportSelectedSource | null;
  readonly snapshot: NovelImportReviewSnapshotV1 | null;
  readonly statusMessage: string;
  readonly task: DesktopNovelImportTaskV1 | null;
}

export interface NovelImportTaskStorage {
  readonly getItem: (key: string) => string | null;
  readonly removeItem: (key: string) => void;
  readonly setItem: (key: string, value: string) => void;
}

interface StoredTaskReference {
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly taskId: string;
}

export interface NovelImportControllerOptions {
  readonly api: NovelImportDesktopApi;
  readonly createId?: () => string;
  readonly onStateChange?: (state: NovelImportRendererState) => void;
  readonly storage?: NovelImportTaskStorage;
}

export interface ChapterBoundaryDraft {
  readonly chapterId: string;
  readonly contentEndByte: number;
  readonly contentStartByte: number;
  readonly headingEndByte: number;
  readonly headingStartByte: number;
}

export type NovelImportKeyboardCommand
  = | 'cancel-dialog'
    | 'move-chapter-next'
    | 'move-chapter-previous'
    | 'refresh-task'
    | 'select-source'
    | 'start-task';

export interface NovelImportKeyboardInput {
  readonly altKey?: boolean;
  readonly ctrlKey?: boolean;
  readonly editable?: boolean;
  readonly key: string;
  readonly metaKey?: boolean;
  readonly shiftKey?: boolean;
}

export function resolveNovelImportKeyboardCommand(
  input: NovelImportKeyboardInput,
): NovelImportKeyboardCommand | null {
  const key = input.key.toLowerCase();
  const commandKey = input.ctrlKey === true || input.metaKey === true;

  if (key === 'escape')
    return 'cancel-dialog';
  if (input.editable === true)
    return null;
  if (commandKey && key === 'o')
    return 'select-source';
  if (commandKey && key === 'enter')
    return 'start-task';
  if (input.altKey === true && key === 'r')
    return 'refresh-task';
  if (input.altKey === true && key === 'arrowdown')
    return 'move-chapter-next';
  if (input.altKey === true && key === 'arrowup')
    return 'move-chapter-previous';
  return null;
}

export class NovelImportController {
  #api: NovelImportDesktopApi;
  #createId: () => string;
  #generation = 0;
  #idempotencyKey: string | null = null;
  #onStateChange: (state: NovelImportRendererState) => void;
  #storage: NovelImportTaskStorage | undefined;
  #unsubscribeEvent: (() => void) | undefined;

  state: NovelImportRendererState = initialState();

  constructor(options: NovelImportControllerOptions) {
    this.#api = options.api;
    this.#createId = options.createId ?? (() => globalThis.crypto.randomUUID());
    this.#onStateChange = options.onStateChange ?? (() => {});
    this.#storage = options.storage;
  }

  async activate(project: NovelImportProjectContext): Promise<void> {
    const generation = ++this.#generation;
    this.#unsubscribeEvent?.();
    this.#unsubscribeEvent = undefined;
    this.#idempotencyKey = null;
    this.#replace({
      ...initialState(),
      eventSubscription: 'waiting',
      project: { ...project },
      statusMessage: project.accessMode === 'read-only'
        ? '只读项目：可检查导入结果，所有写操作已禁用。'
        : '请选择一个 TXT 源文件。',
    });

    try {
      this.#unsubscribeEvent = this.#api.onEvent(event => this.#handleEvent(
        generation,
        project,
        event,
      ));
      if (this.#isCurrent(generation, project)) {
        this.#patch({ eventSubscription: 'subscribed' });
      }
    } catch {
      if (this.#isCurrent(generation, project)) {
        this.#patch({
          eventSubscription: 'unavailable',
          statusMessage: '桌面导入事件源当前不可用；请使用手动刷新查询任务。',
        });
      }
    }

    const stored = this.#readStoredTask(project);
    if (stored)
      await this.refreshTask(stored, generation);
  }

  dispose(): void {
    ++this.#generation;
    this.#unsubscribeEvent?.();
    this.#unsubscribeEvent = undefined;
    this.#idempotencyKey = null;
    this.#replace(initialState());
  }

  setEncoding(encoding: UserSelectedTxtSourceEncoding | null): void {
    this.#patch({ selectedEncoding: encoding });
  }

  clearError(): void {
    this.#patch({ error: null });
  }

  cancelPendingReview(): void {
    this.#patch({ pendingReview: null });
  }

  selectChapter(chapterId: string): void {
    const snapshot = this.state.snapshot;
    if (!snapshot?.chapters.some(chapter => chapter.chapterId === chapterId))
      return;
    this.#patch({ selectedChapterId: chapterId });
  }

  moveChapterSelection(direction: -1 | 1): void {
    const chapters = this.state.snapshot?.chapters ?? [];
    if (chapters.length === 0)
      return;
    const currentIndex = chapters.findIndex(
      chapter => chapter.chapterId === this.state.selectedChapterId,
    );
    const nextIndex = currentIndex < 0
      ? direction > 0 ? 0 : chapters.length - 1
      : Math.min(chapters.length - 1, Math.max(0, currentIndex + direction));
    this.#patch({ selectedChapterId: chapters[nextIndex]?.chapterId ?? null });
  }

  async selectSource(): Promise<void> {
    const operation = this.#beginWrite('select-source');
    if (!operation)
      return;
    if (hasActiveTask(this.state.task)) {
      this.#patch({
        action: null,
        error: localError('NOVEL_IMPORT_CONFLICT'),
        statusMessage: '当前导入任务仍在执行，不能选择第二个来源。',
      });
      return;
    }
    try {
      const result = await this.#api.selectSource(sessionPayload(operation.project));
      if (!this.#isCurrent(operation.generation, operation.project))
        return;
      if (result.canceled) {
        this.#patch({
          statusMessage: '未选择新的源文件；当前导入状态保持不变。',
        });
        return;
      }
      this.#idempotencyKey = null;
      this.#clearStoredTask(operation.project);
      this.#patch({
        error: null,
        lastEventSequence: 0,
        pendingReview: null,
        phase: 'ready',
        selectedChapterId: null,
        selectedEncoding: null,
        selectedSource: {
          displayName: result.displayName,
          expiresAt: result.expiresAt,
          selectionToken: result.selectionToken,
        },
        snapshot: null,
        statusMessage: '源文件已选择；可自动判断 UTF 编码，或显式选择受支持编码。',
        task: null,
      });
    } catch (error) {
      this.#captureError(operation, error, this.state.phase);
    } finally {
      this.#finish(operation);
    }
  }

  async start(): Promise<void> {
    const operation = this.#beginWrite('start-task');
    if (!operation)
      return;
    if (hasActiveTask(this.state.task)) {
      this.#patch({
        action: null,
        error: localError('NOVEL_IMPORT_CONFLICT'),
        statusMessage: '当前导入任务仍在执行，不能再次启动。',
      });
      return;
    }
    if (this.state.phase !== 'ready' && this.state.phase !== 'encoding-required') {
      this.#patch({
        action: null,
        error: localError('DESKTOP_SELECTION_INVALID'),
        statusMessage: '只有已选择来源或等待编码决定时才能启动导入。',
      });
      return;
    }
    const source = this.state.selectedSource;
    if (!source) {
      this.#patch({
        action: null,
        error: localError('DESKTOP_SELECTION_INVALID'),
        statusMessage: '请先选择源文件。',
      });
      return;
    }

    this.#idempotencyKey ??= this.#createId();
    const idempotencyKey = this.#idempotencyKey;
    try {
      const result = await this.#api.start({
        ...sessionPayload(operation.project),
        idempotencyKey,
        requestedBy: REQUESTED_BY,
        ...(this.state.selectedEncoding === null
          ? {}
          : { sourceEncoding: this.state.selectedEncoding }),
        selectionToken: source.selectionToken,
      });
      if (!this.#isCurrent(operation.generation, operation.project))
        return;
      const accepted = this.#acceptTask(result.task);
      if (accepted && result.baselineRevision) {
        try {
          await this.#inspectBaseline(
            operation,
            result.baselineRevision,
            result.task.taskId,
          );
        } catch (error) {
          this.#captureError(operation, error, phaseFromTask(result.task));
        }
      }
    } catch (error) {
      const captured = this.#captureError(operation, error, 'failed');
      if (captured?.code === 'NOVEL_IMPORT_ENCODING_REQUIRED') {
        this.#patch({
          phase: 'encoding-required',
          statusMessage: '无法自动确认编码。请选择编码后重新开始；将复用同一选择令牌和幂等键。',
        });
      }
    } finally {
      this.#finish(operation);
    }
  }

  async refreshTask(
    taskId = this.state.task?.taskId ?? this.state.error?.taskId,
    expectedGeneration?: number,
  ): Promise<void> {
    const operation = this.#begin('refresh-task', expectedGeneration);
    if (!operation)
      return;
    if (!taskId) {
      this.#patch({
        action: null,
        statusMessage: '当前项目会话没有可恢复的导入任务。',
      });
      return;
    }
    try {
      const result = await this.#api.getTask({
        ...sessionPayload(operation.project),
        taskId,
      });
      if (!this.#isCurrent(operation.generation, operation.project))
        return;
      if (!result.task) {
        if (this.state.task?.taskId === taskId)
          return;
        this.#removeStoredTask(operation.project, taskId);
        this.#patch({
          phase: 'idle',
          statusMessage: '该任务已不存在；请选择源文件重新开始。',
          task: null,
        });
        return;
      }
      if (result.task.taskId !== taskId)
        throw responseCorrelationError();
      const accepted = this.#acceptTask(result.task);
      if (accepted && result.baselineRevision) {
        await this.#inspectBaseline(
          operation,
          result.baselineRevision,
          result.task.taskId,
        );
      }
    } catch (error) {
      this.#captureError(operation, error, this.state.phase);
    } finally {
      this.#finish(operation);
    }
  }

  async inspect(): Promise<void> {
    const baseline = this.state.snapshot?.baselineRevision;
    const taskId = this.state.task?.taskId;
    const operation = this.#begin('inspect');
    if (!operation)
      return;
    if (!baseline) {
      this.#patch({
        action: null,
        error: localError('NOVEL_IMPORT_REVIEW_REQUIRED'),
        statusMessage: '任务尚未提供可检查的正式 revision。',
      });
      return;
    }
    try {
      await this.#inspectBaseline(operation, baseline, taskId);
    } catch (error) {
      this.#captureError(operation, error, this.state.phase);
    } finally {
      this.#finish(operation);
    }
  }

  async cancelTask(): Promise<void> {
    if (!hasActiveTask(this.state.task)) {
      this.#patch({
        error: localError('NOVEL_IMPORT_TASK_NOT_CANCELABLE'),
        statusMessage: stableErrorMessage('NOVEL_IMPORT_TASK_NOT_CANCELABLE'),
      });
      return;
    }
    await this.#runTaskCommand('cancel-task', taskId => this.#api.cancelTask({
      ...sessionPayload(this.#requireProject()),
      taskId,
    }));
  }

  async retryTask(): Promise<void> {
    const task = this.state.task;
    const error = this.state.error;
    const retryable = !hasActiveTask(task)
      && (
        task?.executionStatus === 'failed'
        || task?.recoveryStatus === 'retryable'
        || (task === null && error?.taskId !== undefined && error.retryable)
      );
    if (!retryable) {
      this.#patch({
        error: localError('NOVEL_IMPORT_TASK_NOT_RETRYABLE'),
        statusMessage: stableErrorMessage('NOVEL_IMPORT_TASK_NOT_RETRYABLE'),
      });
      return;
    }
    await this.#runTaskCommand('retry-task', taskId => this.#api.retryTask({
      ...sessionPayload(this.#requireProject()),
      taskId,
    }));
  }

  async prepareBoundaryAdjustment(draft: ChapterBoundaryDraft): Promise<void> {
    const snapshot = this.state.snapshot;
    const chapter = snapshot?.chapters.find(item => item.chapterId === draft.chapterId);
    if (!snapshot || !chapter) {
      this.#patch({ error: localError('NOVEL_IMPORT_REVIEW_REQUIRED') });
      return;
    }
    const headingRange = adjustedRange(
      chapter.headingRange,
      draft.headingStartByte,
      draft.headingEndByte,
    );
    const contentRange = adjustedRange(
      chapter.contentRange,
      draft.contentStartByte,
      draft.contentEndByte,
    );
    if (
      !validTextRange(headingRange, snapshot, false)
      || !validTextRange(contentRange, snapshot, true)
      || headingRange.endByte !== contentRange.startByte
    ) {
      this.#patch({
        error: localError('DESKTOP_PAYLOAD_INVALID'),
        statusMessage: '标题范围必须非空，正文范围可为空，且标题终点必须精确等于正文起点。',
      });
      return;
    }
    const command: AdjustNovelImportChapterBoundaryCommandV1 = {
      ...reviewCommandBase(snapshot.baselineRevision),
      chapterId: chapter.chapterId,
      commandType: 'adjust-chapter-boundary',
      contentRange,
      headingRange,
    };
    await this.#prepareReview(
      command,
      'boundary-adjustment',
      { chapterIds: [chapter.chapterId] },
      `章节“${chapter.title}”边界`,
    );
  }

  async prepareRangeClassification(
    rangeIndex: number,
    classification: Exclude<CoverageClassificationV1, 'chapter'>,
  ): Promise<void> {
    const snapshot = this.state.snapshot;
    const item = snapshot?.uncoveredRanges[rangeIndex];
    if (!snapshot || !item) {
      this.#patch({ error: localError('NOVEL_IMPORT_REVIEW_REQUIRED') });
      return;
    }
    const selector = conservativeSelector(snapshot, item.range);
    if (!selector) {
      this.#patch({
        error: localError('NOVEL_IMPORT_REVIEW_REQUIRED'),
        statusMessage: '当前快照缺少可用于 stale 预览的章节或块选择器，未执行分类写入。',
      });
      return;
    }
    const command: ClassifyNovelImportRangeCommandV1 = {
      ...reviewCommandBase(snapshot.baselineRevision),
      classification,
      commandType: 'classify-uncovered-range',
      targetRange: item.range,
    };
    await this.#prepareReview(
      command,
      'range-classification',
      selector,
      `未覆盖范围 ${item.range.startByte}–${item.range.endByte}（保守影响范围）`,
    );
  }

  async prepareNormalizationDecision(
    proposalId: string,
    decision: 'approved' | 'rejected',
  ): Promise<void> {
    const snapshot = this.state.snapshot;
    const proposal = snapshot?.normalizationProposals.find(
      item => item.proposalId === proposalId,
    );
    if (!snapshot || !proposal) {
      this.#patch({ error: localError('NOVEL_IMPORT_REVIEW_REQUIRED') });
      return;
    }
    const selector = conservativeSelector(snapshot, proposal.canonicalRange);
    if (!selector) {
      this.#patch({
        error: localError('NOVEL_IMPORT_REVIEW_REQUIRED'),
        statusMessage: '当前快照缺少可用于 stale 预览的章节或块选择器，未执行 normalization 决定。',
      });
      return;
    }
    const command: DecideNovelImportNormalizationCommandV1 = {
      ...reviewCommandBase(snapshot.baselineRevision),
      commandType: 'decide-normalization-proposal',
      decision,
      proposalId,
    };
    await this.#prepareReview(
      command,
      'normalization-decision',
      selector,
      `normalization proposal ${proposalId}（保守影响范围）`,
    );
  }

  async prepareChapterRerun(chapterId: string): Promise<void> {
    const snapshot = this.state.snapshot;
    if (!snapshot?.chapters.some(chapter => chapter.chapterId === chapterId)) {
      this.#patch({ error: localError('NOVEL_IMPORT_REVIEW_REQUIRED') });
      return;
    }
    const selector = { chapterIds: [chapterId] } as const;
    const command: RerunNovelImportSelectionCommandV1 = {
      ...reviewCommandBase(snapshot.baselineRevision),
      commandType: 'rerun-selection',
      selector,
    };
    await this.#prepareReview(
      command,
      'selection-rerun',
      selector,
      `章节 ${chapterId} 重跑`,
    );
  }

  async confirmPendingReview(): Promise<void> {
    const operation = this.#beginWrite('confirm-review');
    if (!operation)
      return;
    const pending = this.state.pendingReview;
    if (!pending || !pending.preview.canApply) {
      this.#patch({
        action: null,
        error: localError('NOVEL_IMPORT_CONFLICT'),
        statusMessage: 'stale 影响预览不允许应用；请刷新检查快照。',
      });
      return;
    }
    try {
      const result = await this.#api.executeReviewCommand({
        ...sessionPayload(operation.project),
        command: pending.command,
      });
      if (!this.#isCurrent(operation.generation, operation.project))
        return;
      if (result.artifact.artifactId !== pending.command.baselineRevision.artifactId)
        throw responseCorrelationError();
      this.#acceptSnapshot(result.snapshot);
      this.#patch({
        pendingReview: null,
        statusMessage: result.outcome === 'unchanged'
          ? '审核命令未改变正式内容。'
          : '审核命令已提交新的不可变 revision。',
      });
    } catch (error) {
      this.#captureError(operation, error, this.state.phase);
    } finally {
      this.#finish(operation);
    }
  }

  #begin(
    action: NovelImportAction,
    expectedGeneration?: number,
  ): ActiveOperation | null {
    const project = this.state.project;
    if (
      !project
      || this.state.action !== null
      || (expectedGeneration !== undefined && expectedGeneration !== this.#generation)
    ) {
      return null;
    }
    const operation = {
      action,
      generation: this.#generation,
      project,
    } as const;
    this.#patch({ action, error: null });
    return operation;
  }

  #beginWrite(action: NovelImportAction): ActiveOperation | null {
    const operation = this.#begin(action);
    if (!operation)
      return null;
    if (operation.project.accessMode !== 'read-only')
      return operation;
    this.#patch({
      action: null,
      error: localError('PROJECT_READ_ONLY'),
      statusMessage: '只读项目不允许执行导入或审核写操作。',
    });
    return null;
  }

  #finish(operation: ActiveOperation): void {
    if (
      this.#isCurrent(operation.generation, operation.project)
      && this.state.action === operation.action
    ) {
      this.#patch({ action: null });
    }
  }

  #captureError(
    operation: ActiveOperation,
    error: unknown,
    phase: NovelImportPhase,
  ): NovelImportUiError | null {
    if (!this.#isCurrent(operation.generation, operation.project))
      return null;
    const captured = toUiError(error);
    if (captured.taskId)
      this.#storeTask(operation.project, captured.taskId);
    this.#patch({
      error: captured,
      phase,
      statusMessage: captured.message,
    });
    return captured;
  }

  async #runTaskCommand(
    action: 'cancel-task' | 'retry-task',
    invoke: (taskId: string) => ReturnType<NovelImportDesktopApi['cancelTask']>,
  ): Promise<void> {
    const taskId = this.state.task?.taskId ?? this.state.error?.taskId;
    const operation = this.#beginWrite(action);
    if (!operation)
      return;
    if (!taskId) {
      this.#patch({
        action: null,
        error: localError('NOVEL_IMPORT_TASK_NOT_FOUND'),
      });
      return;
    }
    try {
      const result = await invoke(taskId);
      if (!this.#isCurrent(operation.generation, operation.project))
        return;
      if (result.task.taskId !== taskId)
        throw responseCorrelationError();
      const accepted = this.#acceptTask(result.task);
      if (accepted && result.baselineRevision) {
        try {
          await this.#inspectBaseline(
            operation,
            result.baselineRevision,
            result.task.taskId,
          );
        } catch (error) {
          this.#captureError(operation, error, phaseFromTask(result.task));
        }
      }
    } catch (error) {
      this.#captureError(operation, error, this.state.phase);
    } finally {
      this.#finish(operation);
    }
  }

  async #inspectBaseline(
    operation: ActiveOperation,
    baselineRevision: NovelImportReviewBaselineV1,
    expectedTaskId?: string,
  ): Promise<void> {
    if (expectedTaskId && this.state.task?.taskId !== expectedTaskId)
      return;
    const result = await this.#api.inspect({
      ...sessionPayload(operation.project),
      query: {
        baselineRevision,
        documentType: 'novel-import-review-query',
        readOnly: true,
        schemaVersion: REVIEW_SCHEMA_VERSION,
      },
    });
    if (!this.#isCurrent(operation.generation, operation.project))
      return;
    if (expectedTaskId && this.state.task?.taskId !== expectedTaskId)
      return;
    if (!sameBaseline(result.snapshot.baselineRevision, baselineRevision))
      throw responseCorrelationError();
    this.#acceptSnapshot(result.snapshot);
  }

  async #prepareReview(
    command: NovelImportReviewCommandV1,
    changeKind:
      | 'boundary-adjustment'
      | 'normalization-decision'
      | 'range-classification'
      | 'selection-rerun',
    changeSelector: NovelImportChangeSelectorV1,
    scopeDescription: string,
  ): Promise<void> {
    const operation = this.#beginWrite('prepare-review');
    if (!operation)
      return;
    this.#patch({ pendingReview: null });
    const query = {
      baselineRevision: command.baselineRevision,
      changeKind,
      changeSelector,
      documentType: 'novel-import-stale-preview-query',
      readOnly: true,
      schemaVersion: REVIEW_SCHEMA_VERSION,
    } as const;
    try {
      const result = await this.#api.previewStaleImpact({
        ...sessionPayload(operation.project),
        query,
      });
      if (!this.#isCurrent(operation.generation, operation.project))
        return;
      if (
        !sameBaseline(result.preview.baselineRevision, query.baselineRevision)
        || !sameSelector(result.preview.changeSelector, query.changeSelector)
      ) {
        throw responseCorrelationError();
      }
      this.#patch({
        pendingReview: {
          command,
          preview: result.preview,
          scopeDescription,
        },
        statusMessage: result.preview.canApply
          ? 'stale 影响预览已生成；确认后才会执行写命令。'
          : '当前 baseline 已变化，不能应用该命令。',
      });
    } catch (error) {
      this.#captureError(operation, error, this.state.phase);
    } finally {
      this.#finish(operation);
    }
  }

  #acceptTask(task: DesktopNovelImportTaskV1): boolean {
    const project = this.#requireProject();
    const previousTask = this.state.task;
    if (!shouldAcceptTask(previousTask, task))
      return false;
    const clearPreviousAttemptError = previousTask?.taskId === task.taskId
      && task.attempt > previousTask.attempt
      && task.executionStatus !== 'failed';
    this.#storeTask(project, task.taskId);
    const phase = phaseFromTask(task);
    this.#patch({
      ...(clearPreviousAttemptError ? { error: null } : {}),
      lastEventSequence: previousTask?.taskId === task.taskId
        ? this.state.lastEventSequence
        : 0,
      phase,
      statusMessage: taskStatusMessage(task),
      task,
    });
    return true;
  }

  #acceptSnapshot(snapshot: NovelImportReviewSnapshotV1): void {
    this.#patch({
      pendingReview: null,
      selectedChapterId: chooseChapterId(
        snapshot,
        this.state.selectedChapterId,
      ),
      snapshot,
    });
  }

  #handleEvent(
    generation: number,
    project: NovelImportProjectContext,
    event: DesktopNovelImportEventV1,
  ): void {
    if (!this.#isCurrent(generation, project))
      return;
    if (event.projectId !== project.projectId || event.projectSessionId !== project.projectSessionId)
      return;
    const activeTaskId = this.state.task?.taskId ?? this.#readStoredTask(project);
    if (activeTaskId !== event.task.taskId)
      return;
    if (event.sequence <= this.state.lastEventSequence)
      return;

    const accepted = this.#acceptTask(event.task);
    this.#patch({ lastEventSequence: event.sequence });
    if (!accepted)
      return;
    if (event.eventType === 'novelImport.taskFailed') {
      this.#patch({
        error: toUiError(event.error),
        statusMessage: stableErrorMessage(event.error.code),
      });
      return;
    }
    if (event.eventType === 'novelImport.taskCompleted') {
      const operation = {
        action: 'inspect',
        generation,
        project,
      } as const;
      void this.#inspectBaseline(
        operation,
        event.baselineRevision,
        event.task.taskId,
      ).catch((error) => {
        this.#captureError(operation, error, 'completed');
      });
    }
  }

  #isCurrent(
    generation: number,
    project: NovelImportProjectContext,
  ): boolean {
    const current = this.state.project;
    return generation === this.#generation
      && current?.projectId === project.projectId
      && current.projectSessionId === project.projectSessionId;
  }

  #requireProject(): NovelImportProjectContext {
    const project = this.state.project;
    if (!project)
      throw new Error('Novel import controller has no active project session.');
    return project;
  }

  #patch(patch: Partial<NovelImportRendererState>): void {
    this.#replace({ ...this.state, ...patch });
  }

  #replace(state: NovelImportRendererState): void {
    this.state = state;
    this.#onStateChange(state);
  }

  #readStoredTask(project: NovelImportProjectContext): string | null {
    const raw = this.#storage?.getItem(TASK_STORAGE_KEY);
    if (!raw)
      return null;
    try {
      const value = JSON.parse(raw) as Partial<StoredTaskReference>;
      return value.projectId === project.projectId
        && value.projectSessionId === project.projectSessionId
        && typeof value.taskId === 'string'
        ? value.taskId
        : null;
    } catch {
      return null;
    }
  }

  #storeTask(project: NovelImportProjectContext, taskId: string): void {
    this.#storage?.setItem(TASK_STORAGE_KEY, JSON.stringify({
      projectId: project.projectId,
      projectSessionId: project.projectSessionId,
      taskId,
    } satisfies StoredTaskReference));
  }

  #clearStoredTask(project: NovelImportProjectContext): void {
    if (this.#readStoredTask(project) !== null)
      this.#storage?.removeItem(TASK_STORAGE_KEY);
  }

  #removeStoredTask(project: NovelImportProjectContext, taskId: string): void {
    if (this.#readStoredTask(project) === taskId)
      this.#storage?.removeItem(TASK_STORAGE_KEY);
  }
}

interface ActiveOperation {
  readonly action: NovelImportAction;
  readonly generation: number;
  readonly project: NovelImportProjectContext;
}

class NovelImportResponseCorrelationError extends Error {
  readonly code = 'DESKTOP_CORE_UNAVAILABLE';
  readonly retryable = true;

  constructor() {
    super('The novel import response did not match its request.');
    this.name = 'NovelImportResponseCorrelationError';
  }
}

function initialState(): NovelImportRendererState {
  return {
    action: null,
    error: null,
    eventSubscription: 'waiting',
    lastEventSequence: 0,
    pendingReview: null,
    phase: 'idle',
    project: null,
    selectedChapterId: null,
    selectedEncoding: null,
    selectedSource: null,
    snapshot: null,
    statusMessage: '尚未打开项目。',
    task: null,
  };
}

function sessionPayload(project: NovelImportProjectContext) {
  return {
    contractVersion: CONTRACT_VERSION,
    projectId: project.projectId,
    projectSessionId: project.projectSessionId,
  } as const;
}

function reviewCommandBase(baselineRevision: NovelImportReviewBaselineV1) {
  return {
    baselineRevision,
    documentType: 'novel-import-review-command',
    requestedBy: REQUESTED_BY,
    schemaVersion: REVIEW_SCHEMA_VERSION,
  } as const;
}

function adjustedRange(
  source: TextRangeV1,
  startByte: number,
  endByte: number,
): TextRangeV1 & { readonly textLayer: 'canonical' } {
  return {
    ...source,
    endByte,
    startByte,
    textLayer: 'canonical',
  };
}

function validTextRange(
  range: TextRangeV1,
  snapshot: NovelImportReviewSnapshotV1,
  allowEmpty: boolean,
): boolean {
  const canonicalRevision = snapshot.baselineRevision.canonicalTextRevision;
  return Number.isSafeInteger(range.startByte)
    && Number.isSafeInteger(range.endByte)
    && range.textRevisionId === canonicalRevision.textRevisionId
    && range.startByte >= 0
    && (allowEmpty
      ? range.startByte <= range.endByte
      : range.startByte < range.endByte)
    && range.endByte <= canonicalRevision.byteLength;
}

function conservativeSelector(
  snapshot: NovelImportReviewSnapshotV1,
  range: TextRangeV1,
): NovelImportChangeSelectorV1 | null {
  const chapterIds = snapshot.coverage.segments.flatMap(segment => (
    segment.classification === 'chapter'
    && segment.range.startByte < range.endByte
    && range.startByte < segment.range.endByte
      ? [segment.chapterId]
      : []
  ));
  if (chapterIds.length > 0)
    return { chapterIds: [...new Set(chapterIds)] };
  if (snapshot.chapters.length > 0)
    return { chapterIds: snapshot.chapters.map(chapter => chapter.chapterId) };
  return null;
}

function chooseChapterId(
  snapshot: NovelImportReviewSnapshotV1,
  current: string | null,
): string | null {
  if (current && snapshot.chapters.some(chapter => chapter.chapterId === current))
    return current;
  return snapshot.chapters[0]?.chapterId ?? null;
}

function hasActiveTask(task: DesktopNovelImportTaskV1 | null): boolean {
  return task?.executionStatus === 'pending' || task?.executionStatus === 'running';
}

function shouldAcceptTask(
  current: DesktopNovelImportTaskV1 | null,
  candidate: DesktopNovelImportTaskV1,
): boolean {
  if (!current || current.taskId !== candidate.taskId)
    return true;
  if (candidate.attempt < current.attempt)
    return false;
  if (candidate.attempt > current.attempt)
    return true;

  const currentTerminal = isTerminalTask(current);
  const candidateTerminal = isTerminalTask(candidate);
  if (currentTerminal && !candidateTerminal)
    return false;
  if (
    currentTerminal
    && candidateTerminal
    && current.executionStatus !== candidate.executionStatus
  ) {
    return false;
  }
  return Date.parse(candidate.updatedAt) >= Date.parse(current.updatedAt);
}

function isTerminalTask(task: DesktopNovelImportTaskV1): boolean {
  return task.executionStatus === 'canceled'
    || task.executionStatus === 'failed'
    || task.executionStatus === 'succeeded';
}

function sameBaseline(
  left: NovelImportReviewBaselineV1,
  right: NovelImportReviewBaselineV1,
): boolean {
  return left.artifactId === right.artifactId
    && left.artifactRevisionId === right.artifactRevisionId
    && left.canonicalTextRevision.textRevisionId
    === right.canonicalTextRevision.textRevisionId
    && left.canonicalTextRevision.textLayer
    === right.canonicalTextRevision.textLayer
    && left.canonicalTextRevision.contentHash
    === right.canonicalTextRevision.contentHash
    && left.canonicalTextRevision.byteLength
    === right.canonicalTextRevision.byteLength;
}

function sameSelector(
  left: NovelImportChangeSelectorV1,
  right: NovelImportChangeSelectorV1,
): boolean {
  return sameOptionalStringArray(left.blockIds, right.blockIds)
    && sameOptionalStringArray(left.chapterIds, right.chapterIds);
}

function sameOptionalStringArray(
  left: readonly string[] | undefined,
  right: readonly string[] | undefined,
): boolean {
  if (left === undefined || right === undefined)
    return left === right;
  return left.length === right.length
    && left.every((value, index) => value === right[index]);
}

function responseCorrelationError(): NovelImportResponseCorrelationError {
  return new NovelImportResponseCorrelationError();
}

function phaseFromTask(task: DesktopNovelImportTaskV1): NovelImportPhase {
  switch (task.executionStatus) {
    case 'canceled':
      return 'canceled';
    case 'failed':
      return 'failed';
    case 'succeeded':
      return 'completed';
    default:
      return 'running';
  }
}

function taskStatusMessage(task: DesktopNovelImportTaskV1): string {
  switch (task.executionStatus) {
    case 'canceled':
      return '导入任务已取消；未把中间结果标记为完成。';
    case 'failed':
      return '导入任务失败；可在允许时重试同一任务。';
    case 'succeeded':
      return '导入任务已完成，可检查正式 revision。';
    case 'pending':
      return '导入任务等待执行。';
    case 'running':
      return '导入任务正在执行；若事件源不可用可手动刷新。';
  }
}

function toUiError(error: unknown): NovelImportUiError {
  const decoded = decodeDesktopBridgeError(error);
  if (decoded)
    return toUiErrorFields(decoded);
  if (!isErrorFields(error))
    return localError('DESKTOP_CORE_UNAVAILABLE');
  return toUiErrorFields(error);
}

function toUiErrorFields(error: NovelImportErrorFields): NovelImportUiError {
  return {
    code: error.code,
    ...(typeof error.currentArtifactRevisionId === 'string'
      ? { currentArtifactRevisionId: error.currentArtifactRevisionId }
      : {}),
    message: stableErrorMessage(error.code),
    ...(typeof error.operationId === 'string'
      ? { operationId: error.operationId }
      : {}),
    retryable: error.retryable,
    ...(typeof error.taskId === 'string' ? { taskId: error.taskId } : {}),
  };
}

function localError(code: string): NovelImportUiError {
  return {
    code,
    message: stableErrorMessage(code),
    retryable: code === 'DESKTOP_CORE_UNAVAILABLE'
      || code === 'NOVEL_IMPORT_CONFLICT'
      || code === 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  };
}

function isErrorFields(error: unknown): error is NovelImportErrorFields {
  return typeof error === 'object'
    && error !== null
    && typeof Reflect.get(error, 'code') === 'string'
    && typeof Reflect.get(error, 'retryable') === 'boolean';
}

function stableErrorMessage(code: string): string {
  switch (code) {
    case 'DESKTOP_CORE_UNAVAILABLE':
      return '桌面 Core 导入路由或运行时当前不可用；请求未被视为成功。';
    case 'DESKTOP_METHOD_NOT_FOUND':
      return '当前 Core 尚未装配该导入方法；请求未被视为成功。';
    case 'DESKTOP_PAYLOAD_INVALID':
      return '导入请求参数无效。';
    case 'DESKTOP_SELECTION_INVALID':
      return '源文件选择已取消、失效或不属于当前项目会话。';
    case 'NOVEL_IMPORT_CONFLICT':
      return '当前 revision 已变化，请刷新后重新确认。';
    case 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE':
      return '所需导入适配器或处理能力当前不可用。';
    case 'NOVEL_IMPORT_ENCODING_REQUIRED':
      return '需要显式选择源文件编码。';
    case 'NOVEL_IMPORT_TASK_NOT_CANCELABLE':
      return '当前任务状态不允许取消。';
    case 'NOVEL_IMPORT_TASK_NOT_FOUND':
      return '当前项目会话中找不到该导入任务。';
    case 'NOVEL_IMPORT_TASK_NOT_RETRYABLE':
      return '当前任务状态不允许重试。';
    case 'NOVEL_IMPORT_UNSUPPORTED_FORMAT':
      return '没有可处理该来源的 TXT 适配器；未创建部分导入结果。';
    case 'PROJECT_READ_ONLY':
      return '只读项目不允许执行写操作。';
    case 'PROJECT_SESSION_STALE':
    case 'NOVEL_IMPORT_STALE_SESSION':
      return '项目会话已切换；旧请求结果已丢弃。';
    default:
      return '小说导入请求失败；没有把未知结果标记为完成。';
  }
}
