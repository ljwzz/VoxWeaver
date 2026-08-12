// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { SelectionStore } from './selectionStore.ts';

describe('selection store', () => {
  it('令牌绑定窗口和选择用途', () => {
    const store = new SelectionStore();
    const selection = store.create(1, 'directory', '/projects/empty');

    expect(store.resolve(1, selection.selectionId, 'directory')).toBe('/projects/empty');
    expect(() => store.resolve(2, selection.selectionId, 'directory')).toThrowError('选择已失效');
    expect(() => store.resolve(1, selection.selectionId, 'source')).toThrowError('选择已失效');
  });

  it('令牌成功消费后不能复用', () => {
    const store = new SelectionStore();
    const selection = store.create(1, 'source', '/books/source.txt');
    store.consume(selection.selectionId);

    expect(() => store.resolve(1, selection.selectionId, 'source')).toThrowError('选择已失效');
  });

  it('五分钟后令牌失效', () => {
    let now = 0;
    const store = new SelectionStore(300_000, () => now);
    const selection = store.create(1, 'directory', '/projects/empty');
    now = 300_000;

    expect(() => store.resolve(1, selection.selectionId, 'directory')).toThrowError('选择已失效');
  });
});
