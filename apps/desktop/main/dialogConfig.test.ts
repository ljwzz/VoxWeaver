// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { createProjectSourceFileDialogOptions } from './dialogConfig.ts';

describe('dialog config', () => {
  it('项目源文件选择器只允许 TXT 文件', () => {
    expect(createProjectSourceFileDialogOptions()).toEqual({
      title: '选择小说源文件',
      buttonLabel: '选择源文件',
      filters: [
        {
          name: 'TXT 文本文件',
          extensions: ['txt'],
        },
      ],
      properties: ['openFile'],
    });
  });
});
