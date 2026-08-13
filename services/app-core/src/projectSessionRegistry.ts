import type { ProjectCatalogPort, ProjectCatalogRecord } from '@voxweaver/application';
import type {
  CoreTrustedContext,
  ProjectOpenConfirmationOperation,
  ProjectOpenOutcomeDto,
  ProjectSummaryDto,
  RecentProjectSummaryDto,
  StageStateDto,
  TaskSummaryDto,
  WorkflowStageId,
  WorkspaceBootstrapDto,
  WorkspaceCapabilityDto,
  WorkspacePageKey,
} from '@voxweaver/contracts';
import type {
  FileIdentity,
  OpenedProject,
  ProjectOpenInspection,
  ProjectWriteLock,
} from '@voxweaver/project-workspace';

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import {
  isWorkspacePageKey,
  PROJECT_LAYOUT_VERSION,
  PROJECT_STATE_DATABASE_PATH,
  toProjectSummary,
  VoxWeaverError,
  WORKSPACE_PAGE_KEYS,
} from '@voxweaver/contracts';
import { NodeProjectWorkspace } from '@voxweaver/project-workspace';

export const PROJECT_OPEN_CONFIRMATION_TTL_MS = 5 * 60 * 1_000;

export interface ProjectSession {
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly appInstanceId: string;
  readonly rootPath: string;
  readonly canonicalRootPath: string;
  readonly project: ProjectSummaryDto;
  readonly manifest: OpenedProject['manifest'];
  readonly writeLock: ProjectWriteLock;
}

interface PendingOpenConfirmation {
  readonly confirmationToken: string;
  readonly appInstanceId: string;
  readonly webContentsId: number;
  readonly rootPath: string;
  readonly canonicalRootPath: string;
  readonly projectId: string;
  readonly expiresAtMs: number;
  readonly operations: readonly ProjectOpenConfirmationOperation[];
  readonly manifestIdentity: FileIdentity;
  readonly databaseIdentity: FileIdentity;
  readonly staleLockIdentity?: FileIdentity;
}

interface TaskRow {
  readonly task_id: string;
  readonly execution_status: TaskSummaryDto['status'];
  readonly recovery_status: TaskSummaryDto['recoveryStatus'];
  readonly attempt: number;
  readonly progress_completed: number;
  readonly progress_total: number;
  readonly progress_message: string;
  readonly error_code: string | null;
  readonly error_message: string | null;
  readonly created_at: string;
  readonly updated_at: string;
  readonly started_at: string | null;
  readonly finished_at: string | null;
}

interface NovelRevisionRow {
  readonly review_status: 'approved' | 'pending';
}

export interface ProjectSessionRegistryOptions {
  readonly appInstanceId: string;
  readonly catalog: ProjectCatalogPort;
  readonly now?: () => Date;
  readonly workspace?: NodeProjectWorkspace;
}

export class ProjectSessionRegistry {
  readonly #appInstanceId: string;
  readonly #catalog: ProjectCatalogPort;
  readonly #confirmations = new Map<string, PendingOpenConfirmation>();
  readonly #now: () => Date;
  readonly #sessionsByCanonicalRoot = new Map<string, ProjectSession>();
  readonly #sessionsByProjectId = new Map<string, ProjectSession>();
  readonly #workspace: NodeProjectWorkspace;

  #lifecycleTail: Promise<void> = Promise.resolve();

  constructor(options: ProjectSessionRegistryOptions) {
    if (!options.appInstanceId)
      throw new TypeError('appInstanceId is required.');
    this.#appInstanceId = options.appInstanceId;
    this.#catalog = options.catalog;
    this.#now = options.now ?? (() => new Date());
    this.#workspace = options.workspace ?? new NodeProjectWorkspace();
  }

  get sessions(): readonly ProjectSession[] {
    return [...this.#sessionsByProjectId.values()];
  }

  getSessionByProjectId(projectId: string): ProjectSession | undefined {
    return this.#sessionsByProjectId.get(projectId);
  }

  async createProject(input: {
    readonly displayName: string;
    readonly rootPath: string;
    readonly sourcePath: string;
  }): Promise<ProjectSession> {
    return this.#exclusive(async () => {
      const opened = await this.#workspace.createProject(input);
      return this.#activate(opened);
    });
  }

  async recoverProjectSession(
    input: {
      readonly rootPath: string;
      readonly projectId: string;
      readonly projectSessionId: string;
    },
    trustedContext: CoreTrustedContext,
  ): Promise<ProjectSession> {
    this.assertStartupContext(trustedContext);
    return this.#exclusive(async () => {
      const inspection = await this.#workspace.inspectOpenProject(input.rootPath);
      if (inspection.status !== 'current'
        || inspection.manifest.projectId !== input.projectId
        || inspection.writeLock.status !== 'stale'
        || !inspection.writeLock.lock
        || inspection.writeLock.lock.projectId !== input.projectId
        || inspection.writeLock.lock.appInstanceId !== this.#appInstanceId
        || inspection.writeLock.lock.projectSessionId !== input.projectSessionId) {
        throw new VoxWeaverError(
          'PROJECT_SESSION_STALE',
          '崩溃前项目写锁与 Main 保存的会话身份不一致。',
          false,
        );
      }

      const opened = await this.#workspace.openProject(inspection.rootPath);
      const writeLock = await this.#workspace.acquireWriteLock({
        rootPath: inspection.rootPath,
        projectId: input.projectId,
        appInstanceId: this.#appInstanceId,
        projectSessionId: input.projectSessionId,
        recoverStale: true,
        expectedStaleIdentity: inspection.writeLock.identity,
      });
      try {
        const session = await this.#register(opened, input.projectSessionId, writeLock);
        this.#markInterruptedTasksRetryable(session);
        return session;
      } catch (error) {
        await this.#workspace.releaseWriteLock(inspection.rootPath, writeLock).catch(() => {});
        throw error;
      }
    });
  }

  async openProject(
    rootPath: string,
    trustedContext: CoreTrustedContext,
  ): Promise<ProjectOpenOutcomeDto> {
    this.assertStartupContext(trustedContext);
    return this.#exclusive(async () => {
      const inspection = await this.#workspace.inspectOpenProject(rootPath);
      const existing = this.#findExisting(inspection);
      if (existing)
        return { kind: 'focused', project: existing.project };

      if (inspection.writeLock.status === 'active')
        throw new VoxWeaverError('PROJECT_WRITE_LOCK_ACTIVE', '项目正在由其他会话写入。', false);
      if (inspection.writeLock.status === 'invalid')
        throw new VoxWeaverError('PROJECT_DATABASE_INVALID', '项目写锁无效，无法安全打开。', false);

      const operations: ProjectOpenConfirmationOperation[] = [];
      if (inspection.status === 'migration-required')
        operations.push('migrate-v1');
      if (inspection.writeLock.status === 'stale')
        operations.push('recover-stale-lock');

      if (operations.length > 0)
        return this.#createConfirmation(inspection, trustedContext, operations);

      return {
        kind: 'opened',
        project: (await this.#activateCurrentInspection(inspection)).project,
      };
    });
  }

  async openRecentProject(
    projectId: string,
    trustedContext: CoreTrustedContext,
  ): Promise<ProjectOpenOutcomeDto> {
    this.assertStartupContext(trustedContext);
    const record = await this.#catalog.get(projectId);
    if (!record)
      throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '最近项目记录不存在。', false);
    return this.openProject(record.directoryPath, trustedContext);
  }

  async confirmProjectOpen(
    confirmationToken: string,
    trustedContext: CoreTrustedContext,
  ): Promise<ProjectOpenOutcomeDto> {
    this.assertStartupContext(trustedContext);
    return this.#exclusive(async () => {
      const confirmation = this.#confirmations.get(confirmationToken);
      this.#confirmations.delete(confirmationToken);
      if (!confirmation
        || confirmation.appInstanceId !== trustedContext.appInstanceId
        || confirmation.webContentsId !== trustedContext.webContentsId) {
        throw new VoxWeaverError('CONFIRMATION_INVALID', '项目打开确认令牌无效。', false);
      }
      if (confirmation.expiresAtMs <= this.#now().getTime())
        throw new VoxWeaverError('CONFIRMATION_EXPIRED', '项目打开确认已过期，请重新打开项目。', false);

      const inspection = await this.#workspace.inspectOpenProject(confirmation.rootPath);
      if (inspection.canonicalRootPath !== confirmation.canonicalRootPath
        || inspection.manifest.projectId !== confirmation.projectId
        || !sameIdentity(inspection.manifestIdentity, confirmation.manifestIdentity)
        || !sameIdentity(inspection.databaseIdentity, confirmation.databaseIdentity)) {
        throw new VoxWeaverError(
          'CONFIRMATION_STATE_CHANGED',
          '项目文件在确认期间发生变化，请重新检查后再试。',
          false,
        );
      }

      const existing = this.#findExisting(inspection);
      if (existing)
        return { kind: 'focused', project: existing.project };

      const recoverStale = confirmation.operations.includes('recover-stale-lock');
      if (recoverStale) {
        if (inspection.writeLock.status !== 'stale'
          || !confirmation.staleLockIdentity
          || !sameIdentity(inspection.writeLock.identity, confirmation.staleLockIdentity)) {
          throw new VoxWeaverError(
            'CONFIRMATION_STATE_CHANGED',
            '项目写锁在确认期间发生变化，请重新检查后再试。',
            false,
          );
        }
      } else if (inspection.writeLock.status !== 'available') {
        throw new VoxWeaverError(
          'CONFIRMATION_STATE_CHANGED',
          '项目写锁状态在确认期间发生变化，请重新检查后再试。',
          false,
        );
      }

      const projectSessionId = randomUUID();
      const writeLock = await this.#workspace.acquireWriteLock({
        rootPath: inspection.rootPath,
        projectId: inspection.manifest.projectId,
        appInstanceId: this.#appInstanceId,
        projectSessionId,
        ...(recoverStale
          ? {
              recoverStale: true,
              expectedStaleIdentity: confirmation.staleLockIdentity,
            }
          : {}),
      });

      try {
        const opened = confirmation.operations.includes('migrate-v1')
          ? await this.#workspace.migrateProject(
              inspection.rootPath,
              confirmation,
              writeLock,
            )
          : await this.#workspace.openProject(inspection.rootPath);
        const session = await this.#register(opened, projectSessionId, writeLock);
        return { kind: 'opened', project: session.project };
      } catch (error) {
        await this.#workspace.releaseWriteLock(inspection.rootPath, writeLock).catch(() => {});
        throw error;
      }
    });
  }

  async listRecentProjects(): Promise<RecentProjectSummaryDto[]> {
    const records = await this.#catalog.list();
    return Promise.all(records.map(async (record) => {
      const inspection = await this.#workspace.inspectProject(record.directoryPath, record.projectId);
      return {
        projectId: record.projectId,
        displayName: record.displayName,
        sourceFileName: record.sourceFileName,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        layoutVersion: PROJECT_LAYOUT_VERSION,
        directoryPath: record.directoryPath,
        lastOpenedAt: record.lastOpenedAt,
        availability: inspection.availability,
      };
    }));
  }

  async removeRecentProject(projectId: string): Promise<void> {
    await this.#catalog.remove(projectId);
  }

  requireSession(trustedContext: CoreTrustedContext): ProjectSession {
    if (trustedContext.windowKind !== 'project'
      || trustedContext.appInstanceId !== this.#appInstanceId
      || !trustedContext.projectId
      || !trustedContext.projectSessionId) {
      throw new VoxWeaverError('FORBIDDEN', '当前窗口没有项目会话权限。', false);
    }
    const session = this.#sessionsByProjectId.get(trustedContext.projectId);
    if (!session
      || session.projectSessionId !== trustedContext.projectSessionId
      || session.appInstanceId !== trustedContext.appInstanceId) {
      throw new VoxWeaverError('PROJECT_SESSION_STALE', '项目会话已失效。', false);
    }
    return session;
  }

  async getBootstrap(trustedContext: CoreTrustedContext): Promise<WorkspaceBootstrapDto> {
    const session = this.requireSession(trustedContext);
    const database = new DatabaseSync(path.join(session.rootPath, PROJECT_STATE_DATABASE_PATH), {
      readOnly: true,
      timeout: 5_000,
    });
    try {
      const taskRows = database.prepare(`
        SELECT task_id, execution_status, recovery_status, attempt,
          progress_completed, progress_total, progress_message,
          error_code, error_message, created_at, updated_at, started_at, finished_at
        FROM task
        ORDER BY updated_at DESC, task_id ASC
      `).all() as unknown as TaskRow[];
      const tasks = taskRows.map(toTaskSummary);
      const currentTask = tasks.find(task => task.status === 'pending' || task.status === 'running');
      const recoverableTasks = tasks.filter(task => task.recoveryStatus === 'resumable' || task.recoveryStatus === 'retryable');
      const revision = database.prepare(`
        SELECT review_status FROM novel_import_revision WHERE active = 1 LIMIT 1
      `).get() as NovelRevisionRow | undefined;
      const state = database.prepare(`
        SELECT last_page_key FROM workspace_state WHERE singleton = 1
      `).get() as { last_page_key?: unknown } | undefined;
      const lastPage = isWorkspacePageKey(state?.last_page_key) ? state.last_page_key : undefined;
      const importCompleted = revision?.review_status === 'approved';
      const importReadyForReview = revision?.review_status === 'pending';
      const recommendedPage: WorkspacePageKey = currentTask || recoverableTasks.length > 0
        ? 'text-extraction'
        : lastPage
          ?? (importReadyForReview ? 'chapter-splitting' : importCompleted ? 'proofreading' : 'text-extraction');
      return {
        project: session.project,
        sourceAsset: session.manifest.sourceAsset,
        stages: createStageStates({
          ...(currentTask ? { currentTask } : {}),
          importCompleted,
          importReadyForReview,
        }),
        capabilities: createCapabilities({ importCompleted, importReadyForReview }),
        ...(currentTask ? { currentTask } : {}),
        recoverableTasks,
        ...(lastPage ? { lastPage } : {}),
        recommendedPage,
        coreHealth: {
          status: 'healthy',
          canRestart: false,
          protocolVersion: 1,
        },
      };
    } finally {
      database.close();
    }
  }

  async recordLastPage(
    trustedContext: CoreTrustedContext,
    pageKey: WorkspacePageKey,
  ): Promise<void> {
    const session = this.requireSession(trustedContext);
    await this.#workspace.recordLastPage(session.rootPath, pageKey);
  }

  async closeProject(trustedContext: CoreTrustedContext): Promise<void> {
    await this.#exclusive(async () => {
      const session = this.requireSession(trustedContext);
      this.#sessionsByProjectId.delete(session.projectId);
      this.#sessionsByCanonicalRoot.delete(session.canonicalRootPath);
      await this.#workspace.releaseWriteLock(session.rootPath, session.writeLock);
    });
  }

  async closeAll(): Promise<void> {
    await this.#exclusive(async () => {
      const sessions = [...this.#sessionsByProjectId.values()];
      this.#sessionsByProjectId.clear();
      this.#sessionsByCanonicalRoot.clear();
      await Promise.all(sessions.map(session =>
        this.#workspace.releaseWriteLock(session.rootPath, session.writeLock).catch(() => {})));
    });
  }

  async #activate(opened: OpenedProject): Promise<ProjectSession> {
    const projectSessionId = randomUUID();
    const writeLock = await this.#workspace.acquireWriteLock({
      rootPath: opened.rootPath,
      projectId: opened.manifest.projectId,
      appInstanceId: this.#appInstanceId,
      projectSessionId,
    });
    try {
      return await this.#register(opened, projectSessionId, writeLock);
    } catch (error) {
      await this.#workspace.releaseWriteLock(opened.rootPath, writeLock).catch(() => {});
      throw error;
    }
  }

  async #activateCurrentInspection(inspection: ProjectOpenInspection): Promise<ProjectSession> {
    if (inspection.status !== 'current')
      throw new VoxWeaverError('PROJECT_MIGRATION_REQUIRED', '项目必须先迁移。', false);
    const opened = await this.#workspace.openProject(inspection.rootPath);
    return this.#activate(opened);
  }

  async #register(
    opened: OpenedProject,
    projectSessionId: string,
    writeLock: ProjectWriteLock,
  ): Promise<ProjectSession> {
    const duplicateById = this.#sessionsByProjectId.get(opened.manifest.projectId);
    const duplicateByRoot = this.#sessionsByCanonicalRoot.get(opened.canonicalRootPath);
    if (duplicateById || duplicateByRoot)
      throw new VoxWeaverError('PROJECT_OPERATION_IN_PROGRESS', '项目已在其他窗口打开。', false);
    const session: ProjectSession = {
      projectId: opened.manifest.projectId,
      projectSessionId,
      appInstanceId: this.#appInstanceId,
      rootPath: opened.rootPath,
      canonicalRootPath: opened.canonicalRootPath,
      project: toProjectSummary(opened.manifest),
      manifest: opened.manifest,
      writeLock,
    };
    this.#sessionsByProjectId.set(session.projectId, session);
    this.#sessionsByCanonicalRoot.set(session.canonicalRootPath, session);
    await this.#recordRecent(session);
    return session;
  }

  #findExisting(inspection: ProjectOpenInspection): ProjectSession | undefined {
    const byRoot = this.#sessionsByCanonicalRoot.get(inspection.canonicalRootPath);
    const byId = this.#sessionsByProjectId.get(inspection.manifest.projectId);
    if (byRoot && byRoot.projectId !== inspection.manifest.projectId) {
      throw new VoxWeaverError(
        'PROJECT_DIRECTORY_INVALID',
        '同一目录不能登记为不同项目。',
        false,
      );
    }
    if (byId && byId.canonicalRootPath !== inspection.canonicalRootPath) {
      throw new VoxWeaverError(
        'PROJECT_DIRECTORY_INVALID',
        '同一项目 ID 已从其他目录打开。',
        false,
      );
    }
    return byRoot ?? byId;
  }

  #createConfirmation(
    inspection: ProjectOpenInspection,
    trustedContext: CoreTrustedContext,
    operations: readonly ProjectOpenConfirmationOperation[],
  ): ProjectOpenOutcomeDto {
    const confirmationToken = randomUUID();
    const expiresAtMs = this.#now().getTime() + PROJECT_OPEN_CONFIRMATION_TTL_MS;
    const confirmation: PendingOpenConfirmation = {
      confirmationToken,
      appInstanceId: trustedContext.appInstanceId,
      webContentsId: trustedContext.webContentsId,
      rootPath: inspection.rootPath,
      canonicalRootPath: inspection.canonicalRootPath,
      projectId: inspection.manifest.projectId,
      expiresAtMs,
      operations,
      manifestIdentity: inspection.manifestIdentity,
      databaseIdentity: inspection.databaseIdentity,
      ...(inspection.writeLock.status === 'stale'
        ? { staleLockIdentity: inspection.writeLock.identity }
        : {}),
    };
    this.#confirmations.set(confirmationToken, confirmation);
    this.#discardExpiredConfirmations();
    const project: ProjectSummaryDto = inspection.status === 'current'
      ? toProjectSummary(inspection.manifest as OpenedProject['manifest'])
      : {
          projectId: inspection.manifest.projectId,
          displayName: inspection.manifest.displayName,
          sourceFileName: inspection.manifest.sourceAsset.originalName,
          createdAt: inspection.manifest.createdAt,
          updatedAt: inspection.manifest.createdAt,
          layoutVersion: PROJECT_LAYOUT_VERSION,
        };
    return {
      kind: 'confirmation-required',
      confirmationToken,
      expiresAt: new Date(expiresAtMs).toISOString(),
      operations,
      project,
      riskSummary: operations.map(operation => operation === 'migrate-v1'
        ? '将备份旧 manifest 和 SQLite，并把项目布局迁移到 v2。'
        : '将保留失效写锁副本，并为当前项目会话获取新写锁。'),
    };
  }

  async #recordRecent(session: ProjectSession): Promise<void> {
    const record: ProjectCatalogRecord = {
      projectId: session.projectId,
      displayName: session.project.displayName,
      directoryPath: session.rootPath,
      sourceFileName: session.project.sourceFileName,
      createdAt: session.project.createdAt,
      updatedAt: session.project.updatedAt,
      layoutVersion: session.project.layoutVersion,
      lastOpenedAt: this.#now().toISOString(),
    };
    try {
      await this.#catalog.upsert(record);
    } catch {
      // The catalog is a convenience index and cannot invalidate an acquired session.
    }
  }

  #markInterruptedTasksRetryable(session: ProjectSession): void {
    const database = new DatabaseSync(path.join(session.rootPath, PROJECT_STATE_DATABASE_PATH), { timeout: 5_000 });
    try {
      const now = this.#now().toISOString();
      database.prepare(`
        UPDATE task SET execution_status = 'failed', recovery_status = 'retryable',
          progress_message = 'Core 中断，可重试', error_code = 'CORE_UNAVAILABLE',
          error_message = '上次导入在 Core 退出时中断。', updated_at = ?, finished_at = ?
        WHERE execution_status IN ('pending', 'running')
      `).run(now, now);
    } finally {
      database.close();
    }
  }

  assertStartupContext(context: CoreTrustedContext): void {
    if (context.windowKind !== 'startup' || context.appInstanceId !== this.#appInstanceId)
      throw new VoxWeaverError('FORBIDDEN', '只有启动窗口可以打开项目。', false);
  }

  #discardExpiredConfirmations(): void {
    const now = this.#now().getTime();
    for (const [token, confirmation] of this.#confirmations) {
      if (confirmation.expiresAtMs <= now)
        this.#confirmations.delete(token);
    }
  }

  async #exclusive<T>(operation: () => Promise<T>): Promise<T> {
    const previous = this.#lifecycleTail;
    let release!: () => void;
    this.#lifecycleTail = new Promise<void>((resolve) => {
      release = resolve;
    });
    await previous;
    try {
      return await operation();
    } finally {
      release();
    }
  }
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.device === right.device
    && left.inode === right.inode
    && left.size === right.size
    && left.modifiedAtMs === right.modifiedAtMs
    && left.sha256 === right.sha256;
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
      percent: Math.round((completed / total) * 100),
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

function createStageStates(input: {
  readonly currentTask?: TaskSummaryDto;
  readonly importCompleted: boolean;
  readonly importReadyForReview: boolean;
}): StageStateDto[] {
  const stage01Status: StageStateDto['status'] = input.currentTask
    ? 'running'
    : input.importCompleted
      ? 'completed'
      : input.importReadyForReview
        ? 'review-required'
        : 'ready';
  const stages: StageStateDto[] = [{
    stageId: '01',
    status: stage01Status,
    title: '小说导入与文件预处理',
    detail: input.currentTask
      ? input.currentTask.progress.message
      : input.importCompleted
        ? '阶段 01 已确认，可进入阶段 02。'
        : input.importReadyForReview
          ? '导入结果等待章节结构复核。'
          : '源资产已就绪，等待文本提取。',
  }];
  for (let stage = 2; stage <= 11; stage += 1) {
    stages.push({
      stageId: stage.toString().padStart(2, '0') as WorkflowStageId,
      status: input.importCompleted && stage === 2 ? 'ready' : 'blocked',
      title: `阶段 ${stage.toString().padStart(2, '0')}`,
      detail: input.importCompleted && stage === 2
        ? '阶段 01 已确认；该能力尚未在本批实现。'
        : '需要先完成前置阶段。',
    });
  }
  return stages;
}

const PAGE_STAGE: Readonly<Record<WorkspacePageKey, WorkflowStageId | undefined>> = {
  'text-extraction': '01',
  'chapter-splitting': '01',
  'proofreading': '02',
  'script-management': '03',
  'character-extraction': '04',
  'primary-character-marking': '04',
  'crowd-voice-pool': '05',
  'character-voice-refinement': '05',
  'chapter-parameters': '07',
  'selection-requirements': '07',
  'chapter-generation': '07',
  'stale-propagation': '07',
  'asr-review': '08',
  'loudness-consistency': '09',
  'timeline-alignment': '10',
  'chapter-summary': '11',
  'chapter-cover': '11',
  'tar-export': '11',
  'offline-player-export': '11',
  'project-settings': undefined,
  'project-backup': '11',
  'software-settings': undefined,
};

function createCapabilities(input: {
  readonly importCompleted: boolean;
  readonly importReadyForReview: boolean;
}): Record<WorkspacePageKey, WorkspaceCapabilityDto> {
  return Object.fromEntries(WORKSPACE_PAGE_KEYS.map((pageKey): [WorkspacePageKey, WorkspaceCapabilityDto] => {
    if (pageKey === 'text-extraction' || pageKey === 'project-settings') {
      return [pageKey, {
        available: true,
        reason: 'available',
        message: '该页面已接通当前项目的真实数据。',
      }];
    }
    if (pageKey === 'chapter-splitting') {
      return [pageKey, input.importReadyForReview || input.importCompleted
        ? {
            available: true,
            reason: 'available',
            requiredStage: '01',
            message: '小说导入结果可复核。',
          }
        : {
            available: false,
            reason: 'prerequisite',
            requiredStage: '01',
            prerequisitePageKey: 'text-extraction',
            message: '请先完成文本提取。',
          }];
    }
    const stage = PAGE_STAGE[pageKey];
    if (!input.importCompleted && pageKey !== 'software-settings') {
      return [pageKey, {
        available: false,
        reason: 'prerequisite',
        ...(stage ? { requiredStage: stage } : {}),
        prerequisitePageKey: 'chapter-splitting',
        message: '请先确认阶段 01 的章节结构。',
      }];
    }
    return [pageKey, {
      available: false,
      reason: 'not-implemented',
      ...(stage ? { requiredStage: stage } : {}),
      message: '该阶段的正式数据契约和写入能力尚未实现。',
    }];
  })) as Record<WorkspacePageKey, WorkspaceCapabilityDto>;
}
