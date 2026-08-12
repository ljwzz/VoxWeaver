import type {
  AppError,
  AppErrorCode,
  AppResult,
  CreateProjectRequest,
  ProjectSummary,
  WindowContext,
} from '@voxweaver/contracts';
import type { IpcMainInvokeEvent } from 'electron';

import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { AppCoreService } from '@voxweaver/app-core';
import {
  failure,
  IPC_CHANNELS,
  isSupportedProjectSourceFileName,
  success,
  toProjectSummary,
  VoxWeaverError,
} from '@voxweaver/contracts';
import { app, BrowserWindow, dialog, ipcMain, session } from 'electron';
import { createProjectSourceFileDialogOptions } from './dialogConfig.ts';
import { SelectionStore } from './selectionStore.ts';
import { findWindowForAppActivation } from './windowActivation.ts';
import { PROJECT_WINDOW_CONFIG, STARTUP_WINDOW_CONFIG } from './windowConfig.ts';

// Keep the existing catalog location stable while productName controls visible branding.
const userDataPath = path.join(app.getPath('appData'), '@voxweaver', 'desktop');
mkdirSync(userDataPath, { recursive: true });
app.setPath('userData', userDataPath);

interface ProjectWindowSession {
  window: BrowserWindow;
  project: ProjectSummary;
}

let startupWindow: BrowserWindow | undefined;
let appCore: AppCoreService | undefined;
let appCoreClosed = false;

const projectWindows = new Map<string, ProjectWindowSession>();
const windowContexts = new Map<number, WindowContext>();
const runningStartupOperations = new Set<number>();
const selections = new SelectionStore();
const shouldOpenDevTools = process.env.VOXWEAVER_OPEN_DEVTOOLS === '1';

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

  return {
    titleBarOverlay: true,
    titleBarStyle: 'hidden',
  };
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
  return error instanceof Error
    && 'code' in error
    && error.code === 'ERR_ABORTED';
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

function openDevToolsWhenReady(window: BrowserWindow): void {
  if (!shouldOpenDevTools)
    return;

  window.webContents.once('did-finish-load', () => {
    window.webContents.openDevTools({ activate: true, mode: 'detach' });
  });
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
  openDevToolsWhenReady(window);
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

async function createOrFocusProjectWindow(project: ProjectSummary): Promise<BrowserWindow> {
  const existing = projectWindows.get(project.projectId);
  if (existing && !existing.window.isDestroyed()) {
    focusWindow(existing.window);
    return existing.window;
  }

  let window: BrowserWindow | undefined;
  try {
    window = new BrowserWindow({
      ...commonWindowOptions(),
      ...PROJECT_WINDOW_CONFIG,
      title: `VoxWeaver · ${project.displayName}`,
    });
    const session: ProjectWindowSession = { window, project };
    const webContentsId = window.webContents.id;
    projectWindows.set(project.projectId, session);
    windowContexts.set(webContentsId, { kind: 'project', project });
    configureWindowSecurity(window);
    openDevToolsWhenReady(window);
    window.once('ready-to-show', () => window?.show());
    window.on('closed', () => {
      windowContexts.delete(webContentsId);
      if (projectWindows.get(project.projectId)?.window === window)
        projectWindows.delete(project.projectId);
    });

    await loadRendererRoute(window, '/project');
    return window;
  } catch {
    if (window && !window.isDestroyed())
      window.destroy();
    projectWindows.delete(project.projectId);
    throw new VoxWeaverError(
      'PROJECT_WINDOW_OPEN_FAILED',
      '项目已保存，但工作台窗口打开失败。请从最近项目重试。',
    );
  }
}

function getCore(): AppCoreService {
  if (!appCore)
    throw new VoxWeaverError('CATALOG_UNAVAILABLE', '应用服务尚未就绪。');
  return appCore;
}

function publicError(error: unknown, fallbackCode: AppErrorCode, fallbackMessage: string): AppError {
  if (error instanceof VoxWeaverError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: fallbackCode,
    message: fallbackMessage,
    retryable: true,
  };
}

function requireKnownContext(event: IpcMainInvokeEvent): WindowContext {
  const browserWindow = BrowserWindow.fromWebContents(event.sender);
  const context = windowContexts.get(event.sender.id);
  if (!browserWindow || !context || event.senderFrame?.url !== event.sender.getURL())
    throw new VoxWeaverError('FORBIDDEN', '当前窗口无权执行此操作。', false);

  return context;
}

function requireStartupContext(event: IpcMainInvokeEvent): void {
  if (requireKnownContext(event).kind !== 'startup')
    throw new VoxWeaverError('FORBIDDEN', '只有启动窗口可以执行此操作。', false);
}

function closeStartupWindowForSender(event: IpcMainInvokeEvent): void {
  const window = BrowserWindow.fromWebContents(event.sender);
  if (!window || window !== startupWindow || window.isDestroyed())
    return;

  setImmediate(() => {
    if (!window.isDestroyed())
      window.close();
  });
}

function requireProjectContext(event: IpcMainInvokeEvent): Extract<WindowContext, { kind: 'project' }> {
  const context = requireKnownContext(event);
  if (context.kind !== 'project')
    throw new VoxWeaverError('FORBIDDEN', '只有项目工作台可以执行此操作。', false);
  return context;
}

async function withStartupOperation<T>(
  event: IpcMainInvokeEvent,
  operation: () => Promise<AppResult<T>>,
): Promise<AppResult<T>> {
  requireStartupContext(event);
  if (runningStartupOperations.has(event.sender.id)) {
    return failure({
      code: 'PROJECT_OPERATION_IN_PROGRESS',
      message: '已有项目操作正在进行，请等待完成。',
      retryable: true,
    });
  }

  runningStartupOperations.add(event.sender.id);
  try {
    return await operation();
  } finally {
    runningStartupOperations.delete(event.sender.id);
  }
}

function registerIpcHandlers(): void {
  ipcMain.handle(IPC_CHANNELS.selectProjectDirectory, async (event): Promise<AppResult<ReturnType<SelectionStore['create']> | null>> => {
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

  ipcMain.handle(IPC_CHANNELS.selectSourceFile, async (event): Promise<AppResult<ReturnType<SelectionStore['create']> | null>> => {
    try {
      requireStartupContext(event);
      const result = await showOpenDialogForSender(event, createProjectSourceFileDialogOptions());
      const sourcePath = result.filePaths[0];
      if (result.canceled || !sourcePath)
        return success(null);

      if (!isSupportedProjectSourceFileName(path.basename(sourcePath))) {
        throw new VoxWeaverError(
          'SOURCE_FILE_INVALID',
          '当前仅支持 TXT（.txt）源文件。',
          false,
        );
      }

      return success(selections.create(event.sender.id, 'source', sourcePath));
    } catch (error) {
      return failure(publicError(error, 'SOURCE_FILE_INVALID', '无法选择源文件。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.createProject, async (event, request: CreateProjectRequest): Promise<AppResult<ProjectSummary>> => {
    try {
      return await withStartupOperation(event, async () => {
        if (!request
          || typeof request.displayName !== 'string'
          || typeof request.directorySelectionId !== 'string'
          || typeof request.sourceSelectionId !== 'string') {
          throw new VoxWeaverError('SELECTION_INVALID', '新建项目请求无效。');
        }

        const rootPath = selections.resolve(event.sender.id, request.directorySelectionId, 'directory');
        const sourcePath = selections.resolve(event.sender.id, request.sourceSelectionId, 'source');
        const outcome = await getCore().projects.createProject({
          displayName: request.displayName,
          rootPath,
          sourcePath,
        });
        selections.consume(request.directorySelectionId, request.sourceSelectionId);
        const project = toProjectSummary(outcome.project.manifest);
        await createOrFocusProjectWindow(project);
        closeStartupWindowForSender(event);
        return success(project, outcome.warnings);
      });
    } catch (error) {
      return failure(publicError(error, 'PROJECT_CREATE_FAILED', '项目创建失败，请重试。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.openProjectFromDialog, async (event): Promise<AppResult<ProjectSummary | null>> => {
    try {
      return await withStartupOperation(event, async () => {
        const result = await showOpenDialogForSender(event, {
          title: '打开 VoxWeaver 项目',
          buttonLabel: '打开项目',
          properties: ['openDirectory'],
        });
        const rootPath = result.filePaths[0];
        if (result.canceled || !rootPath)
          return success(null);

        const outcome = await getCore().projects.openProject(rootPath);
        const project = toProjectSummary(outcome.project.manifest);
        await createOrFocusProjectWindow(project);
        closeStartupWindowForSender(event);
        return success(project, outcome.warnings);
      });
    } catch (error) {
      return failure(publicError(error, 'PROJECT_DIRECTORY_INVALID', '项目无法打开。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.listRecentProjects, async (event) => {
    try {
      requireStartupContext(event);
      return success(await getCore().projects.listRecentProjects());
    } catch (error) {
      return failure(publicError(error, 'CATALOG_UNAVAILABLE', '无法读取最近项目。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.openRecentProject, async (event, projectId: string): Promise<AppResult<ProjectSummary>> => {
    try {
      return await withStartupOperation(event, async () => {
        if (typeof projectId !== 'string' || !projectId)
          throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '最近项目 ID 无效。', false);

        const outcome = await getCore().projects.openRecentProject(projectId);
        const project = toProjectSummary(outcome.project.manifest);
        await createOrFocusProjectWindow(project);
        closeStartupWindowForSender(event);
        return success(project, outcome.warnings);
      });
    } catch (error) {
      return failure(publicError(error, 'PROJECT_DIRECTORY_INVALID', '最近项目无法打开。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.removeRecentProject, async (event, projectId: string): Promise<AppResult<void>> => {
    try {
      requireStartupContext(event);
      if (typeof projectId !== 'string' || !projectId)
        throw new VoxWeaverError('PROJECT_DIRECTORY_INVALID', '最近项目 ID 无效。', false);
      await getCore().projects.removeRecentProject(projectId);
      return success(undefined);
    } catch (error) {
      return failure(publicError(error, 'CATALOG_UNAVAILABLE', '无法移除最近项目。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.getWindowContext, async (event): Promise<AppResult<WindowContext>> => {
    try {
      return success(requireKnownContext(event));
    } catch (error) {
      return failure(publicError(error, 'FORBIDDEN', '无法读取窗口上下文。'));
    }
  });

  ipcMain.handle(IPC_CHANNELS.closeCurrentProject, async (event): Promise<AppResult<void>> => {
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
}

app.whenReady().then(async () => {
  appCore = new AppCoreService(app.getPath('userData'));
  registerIpcHandlers();

  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  await createStartupWindow();

  app.on('activate', () => {
    const activationWindow = findWindowForAppActivation(
      Array.from(projectWindows.values(), session => session.window),
      startupWindow,
    );

    if (activationWindow)
      focusWindow(activationWindow);
    else
      void createStartupWindow();
  });
});

app.on('before-quit', () => {
  if (!appCoreClosed) {
    appCore?.close();
    appCoreClosed = true;
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin')
    app.quit();
});
