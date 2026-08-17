import type { TaskSummaryDto } from '@voxweaver/contracts';

import { mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { describe, expect, it } from 'vitest';
import TextExtractionActionBar from './TextExtractionActionBar.vue';

const baseTask: TaskSummaryDto = {
  taskId: 'task-1',
  taskType: 'novel-import',
  status: 'running',
  recoveryStatus: 'none',
  attempt: 1,
  progress: { completed: 35, total: 100, percent: 35, message: '正在解码' },
  canCancel: true,
  canRetry: false,
  createdAt: '2026-08-14T00:00:00.000Z',
  updatedAt: '2026-08-14T00:00:01.000Z',
};

function render(task?: TaskSummaryDto, hasCompletedRevision = false) {
  return mount(TextExtractionActionBar, {
    props: {
      canConfirm: true,
      hasCompletedRevision,
      task,
    },
    global: { plugins: [ElementPlus] },
  });
}

describe('text extraction action bar', () => {
  it('确认与进入复核共用一个操作，并保留 running 和 failed 操作', async () => {
    const idle = render();
    const proceedButton = idle.findAll('button').find(button => (
      button.text().includes('确定文本解析正确并进入章节复核')
    ));
    expect(proceedButton).toBeDefined();
    await proceedButton?.trigger('click');
    expect(idle.emitted('proceed')).toHaveLength(1);

    const running = render(baseTask);
    expect(running.text()).toContain('正在解码');
    expect(running.text()).toContain('取消');

    const failed = render({
      ...baseTask,
      status: 'failed',
      canCancel: false,
      canRetry: true,
      errorMessage: '解码失败',
    });
    expect(failed.text()).toContain('解码失败');
    expect(failed.text()).toContain('重试');

    const succeeded = render(undefined, true);
    expect(succeeded.findAll('button').filter(button => (
      button.text().includes('进入章节复核')
    ))).toHaveLength(1);
  });
});
