import type { CreateProjectRequest, DesktopApi } from '@voxweaver/contracts';

import { IPC_CHANNELS } from '@voxweaver/contracts';
import { contextBridge, ipcRenderer } from 'electron';

const api: DesktopApi = Object.freeze({
  selectProjectDirectory: () => ipcRenderer.invoke(IPC_CHANNELS.selectProjectDirectory),
  selectSourceFile: () => ipcRenderer.invoke(IPC_CHANNELS.selectSourceFile),
  createProject: (request: CreateProjectRequest) => ipcRenderer.invoke(IPC_CHANNELS.createProject, request),
  openProjectFromDialog: () => ipcRenderer.invoke(IPC_CHANNELS.openProjectFromDialog),
  listRecentProjects: () => ipcRenderer.invoke(IPC_CHANNELS.listRecentProjects),
  openRecentProject: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.openRecentProject, projectId),
  removeRecentProject: (projectId: string) => ipcRenderer.invoke(IPC_CHANNELS.removeRecentProject, projectId),
  getWindowContext: () => ipcRenderer.invoke(IPC_CHANNELS.getWindowContext),
  closeCurrentProject: () => ipcRenderer.invoke(IPC_CHANNELS.closeCurrentProject),
});

contextBridge.exposeInMainWorld('voxweaver', api);
