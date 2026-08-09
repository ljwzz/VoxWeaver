import type { DesktopRequest } from '@voxweaver/contracts';
import type { CoreMessageChannel, CoreProcessChild, CoreProcessLauncher } from './coreProcessManager.js';
import type {
  DesktopNovelImportPayloadEnvelope,
  DesktopNovelImportTrustedRequestContext,
  DesktopTrustedRequestContext,
} from './desktopMainController.js';

import { basename, join } from 'node:path';
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  MessageChannelMain,
  utilityProcess,
} from 'electron';
import {
  CoreProcessManager,
} from './coreProcessManager.js';
import {
  DesktopMainController,
} from './desktopMainController.js';

let coreManager: CoreProcessManager | undefined;
let desktopController: DesktopMainController | undefined;
let mainWindow: BrowserWindow | undefined;

function createMainWindow(): BrowserWindow {
  const window = new BrowserWindow({
    backgroundColor: '#10141d',
    height: 720,
    minHeight: 560,
    minWidth: 840,
    show: false,
    title: 'VoxWeaver',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      preload: MAIN_WINDOW_PRELOAD_WEBPACK_ENTRY,
      sandbox: true,
    },
    width: 1120,
  });

  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  window.webContents.on('will-attach-webview', (event) => {
    event.preventDefault();
  });
  window.webContents.on('will-navigate', (event) => {
    event.preventDefault();
  });
  window.webContents.session.setPermissionCheckHandler(() => false);
  window.webContents.session.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });
  window.webContents.once('did-finish-load', () => {
    publishCoreState(window);
  });
  window.once('ready-to-show', () => {
    window.show();
  });
  window.once('closed', () => {
    desktopController?.handleWindowClosed(window.id);
    if (mainWindow === window)
      mainWindow = undefined;
  });

  void window.loadURL(MAIN_WINDOW_WEBPACK_ENTRY);
  return window;
}

function createDesktopController(manager: CoreProcessManager): DesktopMainController {
  return new DesktopMainController({
    coreClient: {
      async dispatch(request, trustedContext) {
        return dispatchToCore(manager, request, trustedContext);
      },
      async dispatchNovelImport(request, trustedContext) {
        return dispatchNovelImportToCore(manager, request, trustedContext);
      },
    },
    directoryPicker: {
      async selectDirectory({ purpose, windowId }) {
        const window = BrowserWindow.fromId(windowId);
        if (!window || window !== mainWindow)
          return undefined;

        const result = await dialog.showOpenDialog(window, {
          properties: ['createDirectory', 'openDirectory'],
          title: directoryDialogTitle(purpose),
        });
        const projectDirectory = result.canceled ? undefined : result.filePaths[0];
        if (!projectDirectory)
          return undefined;

        return {
          displayName: basename(projectDirectory),
          projectDirectory,
        };
      },
    },
    novelSourceFilePicker: {
      async selectSourceFile({ windowId }) {
        const window = BrowserWindow.fromId(windowId);
        if (!window || window !== mainWindow)
          return undefined;

        const result = await dialog.showOpenDialog(window, {
          filters: [{ extensions: ['txt'], name: 'TXT 文本' }],
          properties: ['openFile'],
          title: '选择 TXT 小说源文件',
        });
        const sourceFilePath = result.canceled ? undefined : result.filePaths[0];
        if (!sourceFilePath)
          return undefined;

        return {
          displayName: basename(sourceFilePath),
          sourceFilePath,
        };
      },
    },
    windowIdFromIpcEvent(event) {
      if (!isIpcEvent(event))
        return undefined;
      const window = BrowserWindow.fromWebContents(event.sender);
      return window && window === mainWindow ? window.id : undefined;
    },
  });
}

async function dispatchToCore(
  manager: CoreProcessManager,
  request: DesktopRequest,
  trustedContext: DesktopTrustedRequestContext | undefined,
): Promise<unknown> {
  if (manager.status === 'stopped' || manager.status === 'starting') {
    await manager.start();
  } else if (
    manager.status === 'unavailable'
    && request.method === 'app.getHealth'
    && manager.canRestart
  ) {
    await manager.restartOnce();
  }

  return manager.request(request, trustedContext);
}

async function dispatchNovelImportToCore(
  manager: CoreProcessManager,
  request: DesktopNovelImportPayloadEnvelope,
  trustedContext: DesktopNovelImportTrustedRequestContext | undefined,
): Promise<unknown> {
  if (manager.status === 'stopped' || manager.status === 'starting')
    await manager.start();

  return manager.request(request, trustedContext);
}

function createElectronCoreLauncher(): CoreProcessLauncher {
  return {
    createMessageChannel(): CoreMessageChannel {
      const channel = new MessageChannelMain();
      return {
        port1: channel.port1 as unknown as CoreMessageChannel['port1'],
        port2: channel.port2 as unknown as CoreMessageChannel['port2'],
      };
    },
    fork(): CoreProcessChild {
      const child = utilityProcess.fork(join(__dirname, 'core', 'index.js'));
      return {
        kill: () => child.kill(),
        off: (event, listener) => child.off(event, listener),
        on: (event, listener) => child.on(event, listener),
        postMessage: (message, transfer) => {
          child.postMessage(
            message,
            transfer as unknown as Electron.MessagePortMain[],
          );
        },
      };
    },
  };
}

function publishCoreState(target = mainWindow): void {
  if (!target || target.isDestroyed() || !coreManager)
    return;

  target.webContents.send('voxweaver:core-state', {
    canRestart: coreManager.canRestart,
    status: coreManager.status === 'ready'
      ? 'ready'
      : coreManager.status === 'starting'
        ? 'starting'
        : 'unavailable',
  });
}

function directoryDialogTitle(purpose: string): string {
  switch (purpose) {
    case 'create-project-parent':
      return '选择新建项目所在目录';
    case 'switch-project':
      return '选择要切换的项目目录';
    default:
      return '选择项目目录';
  }
}

function isIpcEvent(value: unknown): value is { readonly sender: Electron.WebContents } {
  return typeof value === 'object'
    && value !== null
    && 'sender' in value
    && typeof (value as { sender?: unknown }).sender === 'object'
    && (value as { sender?: unknown }).sender !== null;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow === undefined) {
      mainWindow = createMainWindow();
      return;
    }

    if (mainWindow.isMinimized())
      mainWindow.restore();
    mainWindow.focus();
  });

  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin')
      app.quit();
  });

  app.on('before-quit', () => {
    coreManager?.stop();
  });

  void app.whenReady().then(() => {
    const manager = new CoreProcessManager({
      launcher: createElectronCoreLauncher(),
      userDataDirectory: app.getPath('userData'),
    });
    coreManager = manager;
    desktopController = createDesktopController(manager);
    desktopController.registerIpcHandlers(ipcMain);
    desktopController.registerNovelImportIpcHandlers(ipcMain);
    manager.subscribe(() => publishCoreState());
    mainWindow = createMainWindow();

    void manager.start().catch(() => {
      // The Renderer receives the path-free unavailable state and may issue one
      // explicit health retry through the narrow bridge.
    });

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0)
        mainWindow = createMainWindow();
    });
  });
}
