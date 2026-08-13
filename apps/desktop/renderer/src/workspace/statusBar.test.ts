import { describe, expect, it } from 'vitest';
import {
  getWorkspaceCoreStatusPresentation,
  groupWorkspaceStatusBarItems,
  WORKSPACE_APPLICATION_STATUS_ORDER,
  WORKSPACE_PROJECT_STATUS_ORDER,
} from '@/workspace/statusBar';

describe('workspace status bar model', () => {
  it('固定应用状态与项目状态的扩展顺序', () => {
    expect(WORKSPACE_APPLICATION_STATUS_ORDER).toEqual({ core: 10, tts: 20, asr: 30 });
    expect(WORKSPACE_PROJECT_STATUS_ORDER).toEqual({ novelImport: 10 });
  });

  it('左侧升序、右侧降序，并以 key 打破同序号并列', () => {
    const groups = groupWorkspaceStatusBarItems([
      { key: 'tts', region: 'application', order: 20, label: 'TTS', value: '正常' },
      { key: 'core', region: 'application', order: 10, label: 'Core', value: '正常' },
      { key: 'project-z', region: 'project', order: 20, label: 'Z', value: '正常' },
      { key: 'project-b', region: 'project', order: 10, label: 'B', value: '正常' },
      { key: 'project-a', region: 'project', order: 10, label: 'A', value: '正常' },
    ]);

    expect(groups.application.map(item => item.key)).toEqual(['core', 'tts']);
    expect(groups.project.map(item => item.key)).toEqual(['project-z', 'project-a', 'project-b']);
  });

  it('允许任一分区为空且不修改输入数组', () => {
    const items = [
      { key: 'core', region: 'application' as const, order: 10, label: 'Core', value: '正常' },
    ];
    const groups = groupWorkspaceStatusBarItems(items);

    expect(groups.application.map(item => item.key)).toEqual(['core']);
    expect(groups.project).toEqual([]);
    expect(items.map(item => item.key)).toEqual(['core']);
  });

  it('完整映射 Core 健康状态到中性图标与文字', () => {
    expect(getWorkspaceCoreStatusPresentation('healthy')).toEqual({ icon: 'ok', value: '正常' });
    expect(getWorkspaceCoreStatusPresentation('starting')).toEqual({ icon: 'loading', value: '启动中' });
    expect(getWorkspaceCoreStatusPresentation('unavailable')).toEqual({ icon: 'error', value: '不可用' });
    expect(getWorkspaceCoreStatusPresentation(undefined)).toEqual({ icon: 'loading', value: '读取中' });
  });
});
