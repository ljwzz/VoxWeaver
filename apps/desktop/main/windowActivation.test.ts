// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { findWindowForAppActivation } from './windowActivation.ts';

interface TestWindow {
  id: string;
  isDestroyed: () => boolean;
}

function createWindow(id: string, destroyed = false): TestWindow {
  return {
    id,
    isDestroyed: () => destroyed,
  };
}

describe('find window for app activation', () => {
  it('优先返回已打开的项目窗口', () => {
    const projectWindow = createWindow('project');
    const startupWindow = createWindow('startup');

    expect(findWindowForAppActivation([projectWindow], startupWindow)).toBe(projectWindow);
  });

  it('忽略已销毁的项目窗口', () => {
    const destroyedProjectWindow = createWindow('destroyed-project', true);
    const openProjectWindow = createWindow('open-project');

    expect(findWindowForAppActivation([destroyedProjectWindow, openProjectWindow])).toBe(openProjectWindow);
  });

  it('没有项目窗口时返回启动页窗口', () => {
    const startupWindow = createWindow('startup');

    expect(findWindowForAppActivation([], startupWindow)).toBe(startupWindow);
  });

  it('没有可用窗口时返回 undefined', () => {
    expect(findWindowForAppActivation([], createWindow('startup', true))).toBeUndefined();
  });
});
