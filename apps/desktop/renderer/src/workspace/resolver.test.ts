import type {
  TaskSummaryDto,
  WorkspaceBootstrapDto,
  WorkspacePageKey,
} from '@voxweaver/contracts';

import { describe, expect, it } from 'vitest';
import { resolveWorkspaceEntry } from '@/workspace/resolver';

const baseTask: TaskSummaryDto = {
  taskId: 'task-1',
  taskType: 'novel-import',
  status: 'running',
  recoveryStatus: 'none',
  attempt: 1,
  progress: { completed: 1, total: 10, percent: 10, message: '导入中' },
  canCancel: true,
  canRetry: false,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

function bootstrap(overrides: Partial<WorkspaceBootstrapDto> = {}): WorkspaceBootstrapDto {
  return {
    project: {
      projectId: '00000000-0000-4000-8000-000000000001',
      displayName: '测试项目',
      sourceFileName: 'novel.txt',
      createdAt: '2026-08-13T00:00:00.000Z',
      updatedAt: '2026-08-13T00:00:00.000Z',
      layoutVersion: 2,
    },
    sourceAsset: {
      id: '00000000-0000-4000-8000-000000000002',
      originalName: 'novel.txt',
      relativePath: 'inputs/source-assets/id/novel.txt',
      byteLength: 12,
      sha256: 'a'.repeat(64),
    },
    stages: [
      { stageId: '01', status: 'ready', title: '小说导入', detail: '待导入' },
      { stageId: '02', status: 'blocked', title: '文本校对', detail: '等待阶段 01' },
    ],
    capabilities: {} as WorkspaceBootstrapDto['capabilities'],
    recoverableTasks: [],
    recommendedPage: 'text-extraction',
    coreHealth: { status: 'healthy', canRestart: false, protocolVersion: 1 },
    ...overrides,
  };
}

describe('workspace entry resolver', () => {
  it('有效最后页面优先于运行中或可恢复任务', () => {
    expect(resolveWorkspaceEntry(bootstrap({
      currentTask: baseTask,
      lastPage: 'project-settings',
    }))).toBe('project-settings');

    expect(resolveWorkspaceEntry(bootstrap({
      recoverableTasks: [{
        ...baseTask,
        status: 'failed',
        recoveryStatus: 'retryable',
      }],
      lastPage: 'project-settings',
    }))).toBe('project-settings');
  });

  it('返回最后一个有效正式页面', () => {
    const lastPages: WorkspacePageKey[] = ['chapter-cover', 'software-settings'];
    for (const lastPage of lastPages)
      expect(resolveWorkspaceEntry(bootstrap({ lastPage }))).toBe(lastPage);
  });

  it('没有最后页面时恢复运行中或可恢复任务', () => {
    expect(resolveWorkspaceEntry(bootstrap({ currentTask: baseTask }))).toBe('text-extraction');
    expect(resolveWorkspaceEntry(bootstrap({
      recoverableTasks: [{
        ...baseTask,
        status: 'failed',
        recoveryStatus: 'retryable',
      }],
    }))).toBe('text-extraction');
  });

  it('再按阶段 01 状态进入文本提取或章节切割', () => {
    expect(resolveWorkspaceEntry(bootstrap())).toBe('text-extraction');
    expect(resolveWorkspaceEntry(bootstrap({
      stages: [{ stageId: '01', status: 'review-required', title: '小说导入', detail: '待复核' }],
    }))).toBe('chapter-splitting');
  });

  it('阶段 01 已完成时进入第一个待处理后续阶段', () => {
    expect(resolveWorkspaceEntry(bootstrap({
      stages: [
        { stageId: '01', status: 'completed', title: '小说导入', detail: '已确认' },
        { stageId: '02', status: 'ready', title: '文本校对', detail: '待处理' },
      ],
    }))).toBe('proofreading');
  });
});
