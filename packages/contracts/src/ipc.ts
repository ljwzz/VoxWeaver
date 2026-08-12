export const IPC_CHANNELS = Object.freeze({
  closeCurrentProject: 'project:close-current',
  createProject: 'project:create',
  getWindowContext: 'window:get-context',
  listRecentProjects: 'project:list-recent',
  openProjectFromDialog: 'project:open-from-dialog',
  openRecentProject: 'project:open-recent',
  removeRecentProject: 'project:remove-recent',
  selectProjectDirectory: 'dialog:select-project-directory',
  selectSourceFile: 'dialog:select-source-file',
} as const);
