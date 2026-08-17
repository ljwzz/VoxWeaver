import type { AppResult, DesktopApi, SourceTextPreviewDto } from '@voxweaver/contracts';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useSourceTextPreview } from './useSourceTextPreview';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function chunk(
  sourceEncoding: SourceTextPreviewDto['sourceEncoding'],
  text: string,
): AppResult<SourceTextPreviewDto> {
  return {
    ok: true,
    value: {
      sourceHash: 'a'.repeat(64),
      sourceEncoding,
      startByte: 0,
      endByte: new TextEncoder().encode(text).byteLength,
      text,
      completeLineCount: 1,
      done: true,
    },
  };
}

describe('useSourceTextPreview', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'voxweaver', {
      configurable: true,
      value: { novelImport: { getSourcePreview: vi.fn() } } as unknown as DesktopApi,
    });
  });

  it('同时只发出一个分片请求', async () => {
    const response = deferred<AppResult<SourceTextPreviewDto>>();
    vi.mocked(window.voxweaver.novelImport.getSourcePreview).mockReturnValue(response.promise);
    const preview = useSourceTextPreview();
    preview.setSource('a'.repeat(64), 'utf-8');

    const first = preview.loadMore(100);
    await preview.loadMore(400);
    expect(window.voxweaver.novelImport.getSourcePreview).toHaveBeenCalledTimes(1);
    response.resolve(chunk('utf-8', '第一行\n'));
    await first;
    expect(preview.ready.value).toBe(true);
  });

  it('编码切换会清空旧内容并丢弃迟到响应', async () => {
    const oldResponse = deferred<AppResult<SourceTextPreviewDto>>();
    const getSourcePreview = vi.mocked(window.voxweaver.novelImport.getSourcePreview);
    getSourcePreview
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(chunk('gbk', '新编码\n'));
    const preview = useSourceTextPreview();
    preview.setSource('a'.repeat(64), 'utf-8');
    const oldRequest = preview.loadMore(100);

    preview.setSource('a'.repeat(64), 'gbk');
    oldResponse.resolve(chunk('utf-8', '旧编码\n'));
    await oldRequest;
    expect(preview.text.value).toBe('');
    expect(preview.ready.value).toBe(false);

    await preview.loadMore(100);
    expect(preview.text.value).toBe('新编码\n');
    expect(preview.ready.value).toBe(true);
  });
});
