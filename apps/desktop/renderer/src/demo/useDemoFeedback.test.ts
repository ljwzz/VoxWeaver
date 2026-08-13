import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { showDemoFeedback } from '@/demo/useDemoFeedback';

const messageMocks = vi.hoisted(() => ({
  ElMessage: vi.fn(),
}));

vi.mock('element-plus', () => ({
  ElMessage: messageMocks.ElMessage,
}));

beforeEach(() => {
  messageMocks.ElMessage.mockClear();
});

afterEach(() => {
  vi.restoreAllMocks();
  Reflect.deleteProperty(window, 'voxweaver');
});

describe('showDemoFeedback', () => {
  it('统一声明演示状态、合并重复消息并使用短时反馈', () => {
    showDemoFeedback('章节参数已更新', 'success');

    expect(messageMocks.ElMessage).toHaveBeenCalledOnce();
    expect(messageMocks.ElMessage).toHaveBeenCalledWith({
      duration: 1_800,
      grouping: true,
      message: '演示状态：章节参数已更新（仅作预览，不会持久化）',
      type: 'success',
    });
  });

  it('不访问 IPC、存储或定时器', () => {
    const voxweaverGetter = vi.fn();
    Object.defineProperty(window, 'voxweaver', {
      configurable: true,
      get: voxweaverGetter,
    });
    const localStorageSet = vi.spyOn(window.localStorage, 'setItem');
    const sessionStorageSet = vi.spyOn(window.sessionStorage, 'setItem');
    const setTimeoutSpy = vi.spyOn(globalThis, 'setTimeout');

    showDemoFeedback('操作已应用');

    expect(voxweaverGetter).not.toHaveBeenCalled();
    expect(localStorageSet).not.toHaveBeenCalled();
    expect(sessionStorageSet).not.toHaveBeenCalled();
    expect(setTimeoutSpy).not.toHaveBeenCalled();
    expect(messageMocks.ElMessage).toHaveBeenCalledWith(expect.objectContaining({
      type: 'info',
    }));
  });
});
