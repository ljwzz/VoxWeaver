import type {
  CreateProjectRequest,
  DesktopApi,
  NovelImportEventDto,
  NovelImportEventListener,
  NovelImportReviewCommandInput,
  StartNovelImportInput,
  TextSliceRequest,
  WorkspacePageKey,
} from '@voxweaver/contracts';

import { IPC_CHANNELS } from '@voxweaver/contracts';
import { contextBridge, ipcRenderer } from 'electron';

const api: DesktopApi = Object.freeze({
  startup: Object.freeze({
    selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.startupSelectProjectDirectory),
    selectSourceFile: () => ipcRenderer.invoke(IPC_CHANNELS.startupSelectSourceFile),
    createProject: (input: CreateProjectRequest) => ipcRenderer.invoke(IPC_CHANNELS.startupCreateProject, input),
    openProjectFromDialog: () => ipcRenderer.invoke(IPC_CHANNELS.startupOpenProjectFromDialog),
    openRecentProject: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.startupOpenRecentProject, projectId),
    confirmProjectOpen: (confirmationToken: string) => ipcRenderer.invoke(IPC_CHANNELS.startupConfirmProjectOpen, confirmationToken),
    listRecentProjects: () => ipcRenderer.invoke(IPC_CHANNELS.startupListRecentProjects),
    removeRecentProject: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.startupRemoveRecentProject, projectId),
  }),
  project: Object.freeze({
    getBootstrap: () => ipcRenderer.invoke(IPC_CHANNELS.projectGetBootstrap),
    recordLastPage: (pageKey: WorkspacePageKey) => ipcRenderer.invoke(IPC_CHANNELS.projectRecordLastPage, pageKey),
    close: () => ipcRenderer.invoke(IPC_CHANNELS.projectClose),
  }),
  novelImport: Object.freeze({
    probe: () => ipcRenderer.invoke(IPC_CHANNELS.novelImportProbe),
    start: (input: StartNovelImportInput) => ipcRenderer.invoke(IPC_CHANNELS.novelImportStart, input),
    getTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.novelImportGetTask, taskId),
    cancelTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.novelImportCancelTask, taskId),
    retryTask: (taskId: string) => ipcRenderer.invoke(IPC_CHANNELS.novelImportRetryTask, taskId),
    getReviewSnapshot: () => ipcRenderer.invoke(IPC_CHANNELS.novelImportGetReviewSnapshot),
    getTextSlice: (input: TextSliceRequest) => ipcRenderer.invoke(IPC_CHANNELS.novelImportGetTextSlice, input),
    previewReview: (command: NovelImportReviewCommandInput) => ipcRenderer.invoke(IPC_CHANNELS.novelImportPreviewReview, command),
    applyReview: (command: NovelImportReviewCommandInput) => ipcRenderer.invoke(IPC_CHANNELS.novelImportApplyReview, command),
    onEvent: (listener: NovelImportEventListener) => {
      const handler = (_event: Electron.IpcRendererEvent, value: NovelImportEventDto) => listener(value);
      ipcRenderer.on(IPC_CHANNELS.novelImportEvent, handler);
      return () => ipcRenderer.removeListener(IPC_CHANNELS.novelImportEvent, handler);
    },
  }),
  system: Object.freeze({
    getCoreHealth: () => ipcRenderer.invoke(IPC_CHANNELS.systemGetCoreHealth),
    restartCore: () => ipcRenderer.invoke(IPC_CHANNELS.systemRestartCore),
  }),
});

contextBridge.exposeInMainWorld('voxweaver', api);
