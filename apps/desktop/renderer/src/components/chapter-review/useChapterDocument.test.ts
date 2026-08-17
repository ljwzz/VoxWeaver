import type { AppResult, DesktopApi, TextSliceDto } from '@voxweaver/contracts';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useChapterDocument } from './useChapterDocument';

const CONTINUITY_ERROR = '正文分片范围不连续，无法安全显示。';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function byteLength(text: string): number {
  return new TextEncoder().encode(text).byteLength;
}

function sliceResult(value: TextSliceDto): AppResult<TextSliceDto> {
  return { ok: true, value };
}

function slice(
  revisionId: string,
  startByte: number,
  endByte: number,
  text: string,
  done: boolean,
): TextSliceDto {
  return {
    revisionId,
    range: { offsetUnit: 'utf8-byte', startByte, endByte },
    text,
    done,
  };
}

describe('useChapterDocument', () => {
  beforeEach(() => {
    Object.defineProperty(window, 'voxweaver', {
      configurable: true,
      value: { novelImport: { getTextSlice: vi.fn() } } as unknown as DesktopApi,
    });
  });

  it('按 UTF-8 byte 范围加载多块正文并完整拼接内容', async () => {
    const revisionId = 'revision-multiple-slices';
    const parts = ['第一章 雨夜\n', '路灯照着😀与 café。\n', '尾声'];
    const firstEnd = byteLength(parts[0]!);
    const secondEnd = firstEnd + byteLength(parts[1]!);
    const totalByteLength = secondEnd + byteLength(parts[2]!);
    const getTextSlice = vi.mocked(window.voxweaver.novelImport.getTextSlice);
    getTextSlice
      .mockResolvedValueOnce(sliceResult(slice(revisionId, 0, firstEnd, parts[0]!, false)))
      .mockResolvedValueOnce(sliceResult(slice(revisionId, firstEnd, secondEnd, parts[1]!, false)))
      .mockResolvedValueOnce(sliceResult(slice(revisionId, secondEnd, totalByteLength, parts[2]!, true)));
    const document = useChapterDocument();

    await document.load(revisionId, totalByteLength);

    expect(getTextSlice.mock.calls).toEqual([
      [{ revisionId, startByte: 0, endByte: totalByteLength }],
      [{ revisionId, startByte: firstEnd, endByte: totalByteLength }],
      [{ revisionId, startByte: secondEnd, endByte: totalByteLength }],
    ]);
    expect(document.text.value).toBe(parts.join(''));
    expect(byteLength(document.text.value)).toBe(totalByteLength);
    expect(document.status.value).toBe('loaded');
    expect(document.errorMessage.value).toBe('');
  });

  it.each([
    {
      name: 'revision 不一致',
      value: slice('other-revision', 0, 6, '正文', true),
      textByteLength: 6,
    },
    {
      name: '起点与游标不连续',
      value: slice('revision-invalid', 1, 6, '正文', true),
      textByteLength: 6,
    },
    {
      name: '范围没有前进',
      value: slice('revision-invalid', 0, 0, '', false),
      textByteLength: 6,
    },
    {
      name: '终点超过正文长度',
      value: slice('revision-invalid', 0, 7, '正文', false),
      textByteLength: 6,
    },
    {
      name: 'done 与终点不匹配',
      value: slice('revision-invalid', 0, 3, '正', true),
      textByteLength: 6,
    },
  ])('$name 时拒绝分片', async ({ value, textByteLength }) => {
    vi.mocked(window.voxweaver.novelImport.getTextSlice).mockResolvedValue(sliceResult(value));
    const document = useChapterDocument();

    await document.load('revision-invalid', textByteLength);

    expect(document.text.value).toBe('');
    expect(document.status.value).toBe('error');
    expect(document.errorMessage.value).toBe(CONTINUITY_ERROR);
    expect(window.voxweaver.novelImport.getTextSlice).toHaveBeenCalledTimes(1);
  });

  it('取消加载后丢弃迟到的分片响应', async () => {
    const revisionId = 'revision-cancelled';
    const text = '迟到正文';
    const totalByteLength = byteLength(text);
    const response = deferred<AppResult<TextSliceDto>>();
    vi.mocked(window.voxweaver.novelImport.getTextSlice).mockReturnValue(response.promise);
    const document = useChapterDocument();

    const loading = document.load(revisionId, totalByteLength);
    expect(document.status.value).toBe('loading');

    document.cancel();
    response.resolve(sliceResult(slice(revisionId, 0, totalByteLength, text, true)));
    await loading;

    expect(document.status.value).toBe('idle');
    expect(document.text.value).toBe('');
    expect(document.errorMessage.value).toBe('');
    expect(window.voxweaver.novelImport.getTextSlice).toHaveBeenCalledTimes(1);
  });

  it('新加载完成后不被旧加载的迟到响应覆盖', async () => {
    const oldText = '旧正文';
    const newText = '新正文😀';
    const oldResponse = deferred<AppResult<TextSliceDto>>();
    const getTextSlice = vi.mocked(window.voxweaver.novelImport.getTextSlice);
    getTextSlice
      .mockReturnValueOnce(oldResponse.promise)
      .mockResolvedValueOnce(sliceResult(slice(
        'revision-new',
        0,
        byteLength(newText),
        newText,
        true,
      )));
    const document = useChapterDocument();

    const oldLoading = document.load('revision-old', byteLength(oldText));
    await document.load('revision-new', byteLength(newText));
    oldResponse.resolve(sliceResult(slice(
      'revision-old',
      0,
      byteLength(oldText),
      oldText,
      true,
    )));
    await oldLoading;

    expect(document.status.value).toBe('loaded');
    expect(document.text.value).toBe(newText);
    expect(document.errorMessage.value).toBe('');
    expect(getTextSlice).toHaveBeenCalledTimes(2);
  });
});
