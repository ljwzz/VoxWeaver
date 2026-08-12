import type { OpenDialogOptions } from 'electron';

import { PROJECT_SOURCE_FILE_CONFIG } from '@voxweaver/contracts';

export function createProjectSourceFileDialogOptions(): OpenDialogOptions {
  return {
    title: '选择小说源文件',
    buttonLabel: '选择源文件',
    filters: [
      {
        name: PROJECT_SOURCE_FILE_CONFIG.displayName,
        extensions: [...PROJECT_SOURCE_FILE_CONFIG.extensions],
      },
    ],
    properties: ['openFile'],
  };
}
