import type {
  AppError,
  AppErrorCode,
  AppResult,
  CoreHealthDto,
  CoreMethodName,
  CoreTrustedContext,
  CreateProjectRequest,
  JsonValue,
  NovelImportReviewCommandInput,
  ProjectOpenOutcomeDto,
  ProjectSummaryDto,
  StartNovelImportInput,
  TextSliceRequest,
  WorkspacePageKey,
} from '@voxweaver/contracts';
import type { IpcMainInvokeEvent } from 'electron';
import type { CoreProcessHandle, CoreProcessRequest } from '../shared/coreTransport.ts';

import { randomUUID } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import {
  CORE_METHODS,
  failure,
  IPC_CHANNELS,
  isRecord,
  isSupportedProjectSourceFileName,
  isWorkspacePageKey,
  success,
  VoxWeaverError,
} from '@voxweaver/contracts';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  Menu,
  session,
  utilityProcess,
} from 'electron';
import { createApplicationMenuTemplate } from './applicationMenu.ts';
import { CoreProcessManager, CoreProcessManagerError } from './coreProcessManager.ts';
import {
  validateCoreMethodResult,
  validateNovelImportEvent,
} from './coreResultValidation.ts';
import { createProjectSourceFileDialogOptions } from './dialogConfig.ts';
import { isTrustedIpcSender, matchesProjectEventTarget } from './ipcTrust.ts';
import { SelectionStore } from './selectionStore.ts';
import { findWindowForAppActivation } from './windowActivation.ts';
import { PROJECT_WINDOW_CONFIG, STARTUP_WINDOW_CONFIG } from './windowConfig.ts';

interface CoreProjectSessionResult {
  readonly project: ProjectSummaryDto;
  readonly projectSessionId: string;
  readonly canonicalRootPath: string;
}

interface CoreProjectOpenResult {
  readonly outcome: ProjectOpenOutcomeDto;
  readonly projectSessionId?: string;
  readonly canonicalRootPath?: string;
}

interface StartupWindowContext {
  readonly kind: 'startup';
}

interface ProjectWindowContext extends CoreProjectSessionResult {
  readonly kind: 'project';
}

type MainWindowContext = ProjectWindowContext | StartupWindowContext;

interface ProjectWindowSession extends CoreProjectSessionResult {
  readonly window: BrowserWindow;
  allowClose: boolean;
  closing: boolean;
}

const appInstanceId = randomUUID();
const userDataPath = path.join(app.getPath('appData'), '@voxweaver', 'desktop');
mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock)
  app.quit();

let startupWindow: BrowserWindow | undefined;
let coreManager: CoreProcessManager | undefined;
let coreShutdownComplete = false;
let coreShutdownStarted = false;

const projectWindows = new Map<string, ProjectWindowSession>();
const projectWindowsByRoot = new Map<string, ProjectWindowSession>();
const windowContexts = new Map<number, MainWindowContext>();
const runningStartupOperations = new Set<number>();
const selections = new SelectionStore();

function isAllowedMainFrameNavigation(currentUrl: string, nextUrl: string): boolean {
  try {
    const current = new URL(currentUrl);
    const next = new URL(nextUrl);
    if (current.protocol === 'file:')
      return next.protocol === 'file:' && next.pathname === current.pathname;
    return next.origin === current.origin;
  } catch {
    return false;
  }
}

function platformTitleBarOptions(): Electron.BrowserWindowConstructorOptions {
  if (process.platform === 'darwin')
    return { titleBarStyle: 'hiddenInset' };
  return { titleBarOverlay: true, titleBarStyle: 'hidden' };
}

function configureWindowSecurity(window: BrowserWindow): void {
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', event => event.preventDefault());
  window.webContents.on('will-navigate', (event, url) => {
    const currentUrl = window.webContents.getURL();
    if (!currentUrl || !isAllowedMainFrameNavigation(currentUrl, url))
      event.preventDefault();
  });
}

function isNavigationAbortedError(error: unknown): boolean {
  return error instanceof Error && 'code' in error && error.code === 'ERR_ABORTED';
}

async function loadRendererRoute(window: BrowserWindow, route: string): Promise<void> {
  if (MAIN_WINDOW_VITE_DEV_SERVER_URL) {
    const rendererUrl = new URL(MAIN_WINDOW_VITE_DEV_SERVER_URL);
    rendererUrl.hash = route;
    try {
      await window.loadURL(rendererUrl.toString());
    } catch (error) {
      if (!isNavigationAbortedError(error))
        throw error;
    }
    return;
  }
  await window.loadFile(
    path.join(__dirname, `../renderer/${MAIN_WINDOW_VITE_NAME}/index.html`),
    { hash: route },
  );
}

function commonWindowOptions(): Electron.BrowserWindowConstructorOptions {
  return {
    backgroundColor: '#f7f8f6',
    show: false,
    ...platformTitleBarOptions(),
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: path.join(__dirname, 'preload.js'),
      sandbox: true,
      webviewTag: false,
    },
  };
}

function focusWindow(window: BrowserWindow): void {
  if (window.isMinimized())
    window.restore();
  window.show();
  window.focus();
}

function showOpenDialogForSender(
  event: IpcMainInvokeEvent,
  options: Electron.OpenDialogOptions,
): ReturnType<typeof dialog.showOpenDialog> {
  const ownerWindow = BrowserWindow.fromWebContents(event.sender);
  return ownerWindow
    ? dialog.showOpenDialog(ownerWindow, options)
    : dialog.showOpenDialog(options);
}

async function createStartupWindow(): Promise<BrowserWindow> {
  if (startupWindow && !startupWindow.isDestroyed()) {
    focusWindow(startupWindow);
    return startupWindow;
  }
  const window = new BrowserWindow({
    ...commonWindowOptions(),
    ...STARTUP_WINDOW_CONFIG,
    title: 'VoxWeaver',
  });
  startupWindow = window;
  window.center();
  const webContentsId = window.webContents.id;
  windowContexts.set(webContentsId, { kind: 'startup' });
  configureWindowSecurity(window);
  window.once('ready-to-show', () => window.show());
  window.on('closed', () => {
    selections.clearOwner(webContentsId);
    windowContexts.delete(webContentsId);
    if (startupWindow === window)
      startupWindow = undefined;
  });
  await loadRendererRoute(window, '/startup');
  return window;
}

function trustedProjectContext(
  session: Pick<ProjectWindowSession, 'project' | 'projectSessionId'>,
  webContentsId: number,
): CoreTrustedContext {
  return {
    appInstanceId,
    webContentsId,
    windowKind: 'project',
    projectId: session.project.projectId,
    projectSessionId: session.projectSessionId,
  };
}

function internalStartupContext(): CoreTrustedContext {
  return {
    appInstanceId,
    webContentsId: 0,
    windowKind: 'startup',
  };
}

async function recoverKnownProjectSessions(): Promise<void> {
  let firstError: unknown;
  let startupRequired = false;
  for (const record of [...projectWindows.values()]) {
    try {
      const recovered = parseCoreSessionResult(await requestCore(
        CORE_METHODS.recoverProjectSession,
        {
          rootPath: record.canonicalRootPath,
          projectId: record.project.projectId,
          projectSessionId: record.projectSessionId,
        },
        internalStartupContext(),
      ));
      if (recovered.project.projectId !== record.project.projectId
        || recovered.projectSessionId !== record.projectSessionId
        || recovered.canonicalRootPath !== record.canonicalRootPath) {
        await requestCore(
          CORE_METHODS.closeProject,
          {},
          {
            appInstanceId,
            webContentsId: record.window.webContents.id,
            windowKind: 'project',
            projectId: recovered.project.projectId,
            projectSessionId: recovered.projectSessionId,
          },
        ).catch(() => undefined);
        throw new VoxWeaverError(
          'PROJECT_SESSION_STALE',
          'Core 恢复的项目会话与 Main 保存的身份不一致。',
          false,
        );
      }
    } catch (error) {
      firstError ??= error;
      startupRequired = true;
      record.allowClose = true;
      if (!record.window.isDestroyed())
        record.window.close();
    }
  }
  if (startupRequired)
    await createStartupWindow();
  if (firstError)
    throw firstError;
}

async function closeCoreProjectSession(session: ProjectWindowSession): Promise<void> {
  if (getCoreManager().status !== 'ready')
    return;
  await requestCore(
    CORE_METHODS.closeProject,
    {},
    trustedProjectContext(session, session.window.webContents.id),
  );
}

async function createOrFocusProjectWindow(input: CoreProjectSessionResult): Promise<BrowserWindow> {
  const existing = projectWindows.get(input.project.projectId)
    ?? projectWindowsByRoot.get(input.canonicalRootPath);
  if (existing && !existing.window.isDestroyed()) {
    focusWindow(existing.window);
    return existing.window;
  }

  let window: BrowserWindow | undefined;
  let sessionRecord: ProjectWindowSession | undefined;
  try {
    window = new BrowserWindow({
      ...commonWindowOptions(),
      ...PROJECT_WINDOW_CONFIG,
      title: `VoxWeaver · ${input.project.displayName}`,
    });
    sessionRecord = {
      ...input,
      window,
      allowClose: false,
      closing: false,
    };
    const record = sessionRecord;
    const webContentsId = window.webContents.id;
    projectWindows.set(input.project.projectId, record);
    projectWindowsByRoot.set(input.canonicalRootPath, record);
    windowContexts.set(webContentsId, {
      kind: 'project',
      project: input.project,
      projectSessionId: input.projectSessionId,
      canonicalRootPath: input.canonicalRootPath,
    });
    configureWindowSecurity(window);
    window.once('ready-to-show', () => window?.show());
    window.on('close', (event) => {
      if (record.allowClose || getCoreManager().status !== 'ready')
        return;
      event.preventDefault();
      if (record.closing)
        return;
      record.closing = true;
      void closeCoreProjectSession(record).finally(() => {
        record.allowClose = true;
        if (!record.window.isDestroyed())
          record.window.close();
      });
    });
    window.on('closed', () => {
      windowContexts.delete(webContentsId);
      if (projectWindows.get(input.project.projectId) === record)
        projectWindows.delete(input.project.projectId);
      if (projectWindowsByRoot.get(input.canonicalRootPath) === record)
        projectWindowsByRoot.delete(input.canonicalRootPath);
      if (projectWindows.size === 0
        && !coreShutdownStarted
        && startupWindow
        && !startupWindow.isDestroyed()) {
        focusWindow(startupWindow);
      }
    });
    await loadRendererRoute(window, '/project');
    return window;
  } catch {
    if (sessionRecord)
      await closeCoreProjectSession(sessionRecord).catch(() => {});
    if (window && !window.isDestroyed())
      window.destroy();
    projectWindows.delete(input.project.projectId);
    projectWindowsByRoot.delete(input.canonicalRootPath);
    throw new VoxWeaverError(
      'PROJECT_WINDOW_OPEN_FAILED',
      '项目已保存，但工作台窗口打开失败。请从最近项目重试。',
    );
  }
}

function getCoreManager(): CoreProcessManager {
  if (!coreManager)
    throw new VoxWeaverError('CORE_UNAVAILABLE', '应用核心尚未就绪。');
  return coreManager;
}

function publicError(error: unknown, fallbackCode: AppErrorCode, fallbackMessage: string): AppError {
  if (error instanceof VoxWeaverError || error instanceof CoreProcessManagerError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
      ...(error instanceof VoxWeaverError && error.details ? { details: error.details } : {}),
    };
  }
  return { code: fallbackCode, message: fallbackMessage, retryable: true };
}

function requireKnownContext(event: IpcMainInvokeEvent): MainWindowContext {
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  const context = windowContexts.get(event.sender.id);
  if (!isTrustedIpcSender({
    browserWindowExists: Boolean(browserWindow),
    ...(browserWindow ? { browserWindowWebContentsId: browserWindow.webContents.id } : {}),
    contextExists: Boolean(context),
    senderFrameIsMainFrame: event.senderFrame !== null
      && browserWindow?.webContents.mainFrame === event.senderFrame,
    senderFrameUrl: event.senderFrame?.url ?? '',
    senderId: event.sender.id,
    senderUrl: event.sender.getURL(),
  }) || !context) {
    throw new VoxWeaverError('FORBIDDEN', '当前窗口无权执行此操作。', false);
  }
  return context;
}

function requireStartupContext(event: IpcMainInvokeEvent): CoreTrustedContext {
  if (requireKnownContext(event).kind !== 'startup')
    throw new VoxWeaverError('FORBIDDEN', '只有启动窗口可以执行此操作。', false);
  return {
    appInstanceId,
    webContentsId: event.sender.id,
    windowKind: 'startup',
  };
}

function requireProjectContext(event: IpcMainInvokeEvent): ProjectWindowContext {
  const context = requireKnownContext(event);
  if (context.kind !== 'project')
    throw new VoxWeaverError('FORBIDDEN', '只有项目工作台可以执行此操作。', false);
  return context;
}

function trustedContextForEvent(event: IpcMainInvokeEvent): CoreTrustedContext {
  const context = requireProjectContext(event);
  return {
    appInstanceId,
    webContentsId: event.sender.id,
    windowKind: 'project',
    projectId: context.project.projectId,
    projectSessionId: context.projectSessionId,
  };
}

function hideStartupWindowForSender(event: IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== startupWindow || window.isDestroyed())
    return;
  setImmediate(() => {
    if (!window.isDestroyed())
      window.hide();
  });
}

async function withStartupOperation<T>(
  event: IpcMainInvokeEvent,
  operation: (context: CoreTrustedContext) => Promise<AppResult<T>>,
): Promise<AppResult<T>> {
  const context = requireStartupContext(event);
  if (runningStartupOperations.has(event.sender.id)) {
    return failure({
      code: 'PROJECT_OPERATION_IN_PROGRESS',
      message: '已有项目操作正在进行，请等待完成。',
      retryable: true,
    });
  }
  runningStartupOperations.add(event.sender.id);
  try {
    return await operation(context);
  } finally {
    runningStartupOperations.delete(event.sender.id);
  }
}

async function requestCore<TResult>(
  method: CoreMethodName,
  payload: unknown,
  trustedContext: CoreTrustedContext,
): Promise<TResult> {
  const response = await getCoreManager().request({
    method,
    payload: payload as JsonValue,
    trustedContext,
  } as CoreProcessRequest);
  if (!response.ok) {
    throw new VoxWeaverError(
      response.error.code,
      response.error.message,
      response.error.retryable,
      response.error.details,
    );
  }
  return validateCoreMethodResult(method, response.result) as TResult;
}

function parseCoreSessionResult(value: unknown): CoreProjectSessionResult {
  if (!isRecord(value)
    || !isRecord(value.project)
    || typeof value.projectSessionId !== 'string'
    || typeof value.canonicalRootPath !== 'string') {
    throw new VoxWeaverError('CORE_PROTOCOL_MISMATCH', 'Core 返回了无效项目会话。', false);
  }
  return value as unknown as CoreProjectSessionResult;
}

function parseCoreOpenResult(value: unknown): CoreProjectOpenResult {
  if (!isRecord(value) || !isRecord(value.outcome) || typeof value.outcome.kind !== 'string')
    throw new VoxWeaverError('CORE_PROTOCOL_MISMATCH', 'Core 返回了无效打开结果。', false);
  return value as unknown as CoreProjectOpenResult;
}

async function finalizeOpenOutcome(
  event: IpcMainInvokeEvent,
  result: CoreProjectOpenResult,
): Promise<ProjectOpenOutcomeDto> {
  const { outcome } = result;
  if (outcome.kind === 'cancelled' || outcome.kind === 'confirmation-required')
    return outcome;
  if (!result.projectSessionId || !result.canonicalRootPath)
    throw new VoxWeaverError('CORE_PROTOCOL_MISMATCH', 'Core 未返回可信项目会话。', false);
  await createOrFocusProjectWindow({
    project: outcome.project,
    projectSessionId: result.projectSessionId,
    canonicalRootPath: result.canonicalRootPath,
  });
  hideStartupWindowForSender(event);
  return outcome;
}

function requireString(value: unknown, message: string): string {
  if (typeof value !== 'string' || !value)
    throw new VoxWeaverError('IPC_PAYLOAD_INVALID', message, false);
  return value;
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.startupSelectProjectDirectory, async (event) => {
    try {
      requireStartupContext(event);
      const result = await showOpenDialogForSender(event, {
        title: '选择空的项目目录',
        buttonLabel: '选择项目目录',
        properties: ['openDirectory', 'createDirectory'],
      });
      const directoryPath = result.filePaths[0];
      return success(result.canceled || !directoryPath
        ? null
        : selections.create(event.sender.id, 'directory', directoryPath));
    } catch (error) {
      return failure(publicError(error, 'PROJECT_DIRECTORY_INVALID', '无法选择项目目录。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.startupSelectSourceFile, async (event) => {
    try {
      requireStartupContext(event);
      const result = await showOpenDialogForSender(event, createProjectSourceFileDialogOptions());
      const sourcePath = result.filePaths[0];
      if (result.canceled || !sourcePath)
        return success(null);
      if (!isSupportedProjectSourceFileName(path.basename(sourcePath)))
        throw new VoxWeaverError('SOURCE_FILE_INVALID', '当前仅支持 TXT（.txt）源文件。', false);
      return success(selections.create(event.sender.id, 'source', sourcePath));
    } catch (error) {
      return failure(publicError(error, 'SOURCE_FILE_INVALID', '无法选择源文件。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.startupCreateProject, async (event, request: CreateProjectRequest) => {
    try {
      return await withStartupOperation(event, async (trustedContext) => {
        if (!request
          || typeof request.displayName !== 'string'
          || typeof request.directorySelectionId !== 'string'
          || typeof request.sourceSelectionId !== 'string') {
          throw new VoxWeaverError('IPC_PAYLOAD_INVALID', '新建项目请求无效。', false);
        }
        const rootPath = selections.resolve(event.sender.id, request.directorySelectionId, 'directory');
        const sourcePath = selections.resolve(event.sender.id, request.sourceSelectionId, 'source');
        const result = parseCoreSessionResult(await requestCore(
          CORE_METHODS.createProject,
          { displayName: request.displayName, rootPath, sourcePath },
          trustedContext,
        ));
        selections.consume(request.directorySelectionId, request.sourceSelectionId);
        await createOrFocusProjectWindow(result);
        hideStartupWindowForSender(event);
        return success(result.project);
      });
    } catch (error) {
      return failure(publicError(error, 'PROJECT_CREATE_FAILED', '项目创建失败，请重试。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.startupOpenProjectFromDialog, async (event) => {
    try {
      return await withStartupOperation(event, async (trustedContext) => {
        const result = await showOpenDialogForSender(event, {
          title: '打开 VoxWeaver 项目',
          buttonLabel: '打开项目',
          properties: ['openDirectory'],
        });
        const rootPath = result.filePaths[0];
        if (result.canceled || !rootPath)
          return success<ProjectOpenOutcomeDto>({ kind: 'cancelled' });
        const coreResult = parseCoreOpenResult(await requestCore(
          CORE_METHODS.openProject,
          { rootPath },
          trustedContext,
        ));
        return success(await finalizeOpenOutcome(event, coreResult));
      });
    } catch (error) {
      return failure(publicError(error, 'PROJECT_DIRECTORY_INVALID', '项目无法打开。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.startupOpenRecentProject, async (event, projectId: string) => {
    try {
      return await withStartupOperation(event, async (trustedContext) => {
        const coreResult = parseCoreOpenResult(await requestCore(
          CORE_METHODS.openProject,
          { recentProjectId: requireString(projectId, '最近项目 ID 无效。') },
          trustedContext,
        ));
        return success(await finalizeOpenOutcome(event, coreResult));
      });
    } catch (error) {
      return failure(publicError(error, 'PROJECT_DIRECTORY_INVALID', '最近项目无法打开。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.startupConfirmProjectOpen, async (event, confirmationToken: string) => {
    try {
      return await withStartupOperation(event, async (trustedContext) => {
        const coreResult = parseCoreOpenResult(await requestCore(
          CORE_METHODS.confirmProjectOpen,
          { confirmationToken: requireString(confirmationToken, '确认令牌无效。') },
          trustedContext,
        ));
        return success(await finalizeOpenOutcome(event, coreResult));
      });
    } catch (error) {
      return failure(publicError(error, 'CONFIRMATION_INVALID', '无法确认打开项目。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.startupListRecentProjects, async (event) => {
    try {
      return success(await requestCore(
        CORE_METHODS.listRecentProjects,
        {},
        requireStartupContext(event),
      ));
    } catch (error) {
      return failure(publicError(error, 'CATALOG_UNAVAILABLE', '无法读取最近项目。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.startupRemoveRecentProject, async (event, projectId: string) => {
    try {
      await requestCore(
        CORE_METHODS.removeRecentProject,
        { projectId: requireString(projectId, '最近项目 ID 无效。') },
        requireStartupContext(event),
      );
      return success(undefined);
    } catch (error) {
      return failure(publicError(error, 'CATALOG_UNAVAILABLE', '无法移除最近项目。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.projectGetBootstrap, event => invokeProject(event, CORE_METHODS.getBootstrap, {}));
  ipcMain.handle(IPC_CHANNELS.projectRecordLastPage, (event, pageKey: WorkspacePageKey) => {
    if (!isWorkspacePageKey(pageKey))
      return Promise.resolve(failure(publicError(new VoxWeaverError('IPC_PAYLOAD_INVALID', '页面键无效。', false), 'IPC_PAYLOAD_INVALID', '页面键无效。')));
    return invokeProject(event, CORE_METHODS.recordLastPage, { pageKey });
  });
  ipcMain.handle(IPC_CHANNELS.projectClose, async (event) => {
    try {
      requireProjectContext(event);
      const window = BrowserWindow.fromWebContents(event.sender);
      if (!window)
        throw new VoxWeaverError('FORBIDDEN', '项目窗口不存在。', false);
      setImmediate(() => window.close());
      return success(undefined);
    } catch (error) {
      return failure(publicError(error, 'FORBIDDEN', '无法关闭项目窗口。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.novelImportProbe, event => invokeProject(event, CORE_METHODS.novelImportProbe, {}));
  ipcMain.handle(IPC_CHANNELS.novelImportStart, (event, input: StartNovelImportInput) => invokeProject(event, CORE_METHODS.novelImportStart, input));
  ipcMain.handle(IPC_CHANNELS.novelImportGetTask, (event, taskId: string) => invokeProject(event, CORE_METHODS.novelImportGetTask, { taskId }));
  ipcMain.handle(IPC_CHANNELS.novelImportCancelTask, (event, taskId: string) => invokeProject(event, CORE_METHODS.novelImportCancelTask, { taskId }));
  ipcMain.handle(IPC_CHANNELS.novelImportRetryTask, (event, taskId: string) => invokeProject(event, CORE_METHODS.novelImportRetryTask, { taskId }));
  ipcMain.handle(IPC_CHANNELS.novelImportGetReviewSnapshot, event => invokeProject(event, CORE_METHODS.novelImportGetReviewSnapshot, {}));
  ipcMain.handle(IPC_CHANNELS.novelImportGetTextSlice, (event, input: TextSliceRequest) => invokeProject(event, CORE_METHODS.novelImportGetTextSlice, input));
  ipcMain.handle(IPC_CHANNELS.novelImportPreviewReview, (event, command: NovelImportReviewCommandInput) => invokeProject(event, CORE_METHODS.novelImportPreviewReview, command));
  ipcMain.handle(IPC_CHANNELS.novelImportApplyReview, (event, command: NovelImportReviewCommandInput) => invokeProject(event, CORE_METHODS.novelImportApplyReview, command));

  ipcMain.handle(IPC_CHANNELS.systemGetCoreHealth, async (event): Promise<AppResult<CoreHealthDto>> => {
    try {
      requireKnownContext(event);
      const manager = getCoreManager();
      return success({
        status: manager.status === 'ready'
          ? 'healthy'
          : manager.status === 'starting'
            ? 'starting'
            : 'unavailable',
        canRestart: manager.canRestart,
        protocolVersion: 1,
      });
    } catch (error) {
      return failure(publicError(error, 'CORE_UNAVAILABLE', '无法读取 Core 状态。'));
    }
  });
  ipcMain.handle(IPC_CHANNELS.systemRestartCore, async (event) => {
    try {
      requireKnownContext(event);
      await getCoreManager().restartOnce();
      await recoverKnownProjectSessions();
      return success(undefined);
    } catch (error) {
      return failure(publicError(error, 'CORE_UNAVAILABLE', 'Core 重启失败。'));
    }
  });
}

async function invokeProject(
  event: IpcMainInvokeEvent,
  method: CoreMethodName,
  payload: unknown,
): Promise<AppResult<unknown>> {
  try {
    return success(await requestCore(method, payload, trustedContextForEvent(event)));
  } catch (error) {
    return failure(publicError(error, 'CORE_UNAVAILABLE', '项目操作失败。'));
  }
}

function createCoreManager(): CoreProcessManager {
  return new CoreProcessManager({
    appInstanceId,
    launcher: {
      fork: () => utilityProcess.fork(
        path.join(__dirname, 'core.js'),
        [userDataPath, appInstanceId],
        { serviceName: 'VoxWeaver Core', stdio: 'inherit' },
      ) as unknown as CoreProcessHandle,
    },
  });
}

function focusForSecondInstance(): void {
  if (startupWindow && !startupWindow.isDestroyed()) {
    focusWindow(startupWindow);
    return;
  }
  void createStartupWindow();
}

function focusForAppActivation(): void {
  const activationWindow = findWindowForAppActivation(
    Array.from(projectWindows.values(), record => record.window),
    startupWindow,
  );
  if (activationWindow)
    focusWindow(activationWindow);
  else
    void createStartupWindow();
}

function installApplicationMenu(): void {
  const template = createApplicationMenuTemplate({
    isMacOS: process.platform === 'darwin',
    openProjectLauncher: () => void createStartupWindow(),
  });
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}

if (hasSingleInstanceLock) {
  app.on('second-instance', focusForSecondInstance);
  app.whenReady().then(async () => {
    coreManager = createCoreManager();
    coreManager.subscribeEvents((coreEvent) => {
      let payload: ReturnType<typeof validateNovelImportEvent>;
      try {
        payload = validateNovelImportEvent(coreEvent);
      } catch {
        return;
      }
      const record = projectWindows.get(coreEvent.projectId);
      if (!record || !matchesProjectEventTarget({
        destroyed: record.window.isDestroyed(),
        projectId: record.project.projectId,
        projectSessionId: record.projectSessionId,
      }, coreEvent)) {
        return;
      }
      record.window.webContents.send(IPC_CHANNELS.novelImportEvent, payload);
    });
    await coreManager.start();
    registerIpcHandlers();

    session.defaultSession.setPermissionCheckHandler(() => false);
    session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => callback(false));
    installApplicationMenu();
    await createStartupWindow();
    app.on('activate', focusForAppActivation);
  }).catch(() => app.quit());
}

app.on('before-quit', (event) => {
  if (coreShutdownComplete) {
    for (const record of projectWindows.values())
      record.allowClose = true;
    coreManager?.stop();
    return;
  }

  event.preventDefault();
  if (coreShutdownStarted)
    return;
  coreShutdownStarted = true;
  const manager = coreManager;
  const shutdown = manager?.status === 'ready'
    ? requestCore(CORE_METHODS.shutdown, {}, internalStartupContext()).catch(() => undefined)
    : Promise.resolve();
  void shutdown.finally(() => {
    coreShutdownComplete = true;
    for (const record of projectWindows.values())
      record.allowClose = true;
    manager?.stop();
    app.quit();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin')
    app.quit();
});
