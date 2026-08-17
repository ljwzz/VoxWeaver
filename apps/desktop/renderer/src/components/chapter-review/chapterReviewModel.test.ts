import type { ChapterStructureDraftChapter } from './chapterStructureDraftModel';

import { describe, expect, it } from 'vitest';
import { parseChapterEditorLines } from './chapterEditorModel';
import { resolveBoundaryShift } from './chapterReviewModel';

const text = `${[
  'T1',
  ...Array.from({ length: 8 }, (_, index) => `a${index + 1}`),
  'T2',
  ...Array.from({ length: 8 }, (_, index) => `b${index + 1}`),
  'T3',
  ...Array.from({ length: 8 }, (_, index) => `c${index + 1}`),
].join('\n')}\n`;

const starts = ['T1', 'T2', 'T3'].map(title => text.indexOf(title));
const chapters: readonly ChapterStructureDraftChapter[] = starts.map((startByte, index) => ({
  draftId: `chapter-${index + 1}`,
  existingChapterId: `chapter-${index + 1}`,
  title: `T${index + 1}`,
  headingKind: 'source',
  headingRange: range(startByte, startByte + 2),
  contentRange: range(startByte + 3, starts[index + 1] ?? text.length),
  lengthAnomalyAccepted: false,
  protectedHeadingStartByte: startByte,
}));

const loadedLines = parseChapterEditorLines(text);

describe('chapter review boundary model', () => {
  it('章首按目标行生成且只生成主动章节的语义编辑', () => {
    expect(resolveBoundaryShift(chapters, 1, {
      boundary: 'upper',
      direction: 'backward',
      lineCount: 1,
    }, loadedLines, text.length)).toEqual({
      chapterId: 'chapter-2',
      boundary: 'chapter-start',
      byteOffset: text.indexOf('a8'),
    });
    expect(resolveBoundaryShift(chapters, 1, {
      boundary: 'upper',
      direction: 'backward',
      lineCount: 5,
    }, loadedLines, text.length)).toEqual({
      chapterId: 'chapter-2',
      boundary: 'chapter-start',
      byteOffset: text.indexOf('a4'),
    });
    expect(resolveBoundaryShift(chapters, 0, {
      boundary: 'upper',
      direction: 'backward',
      lineCount: 1,
    }, loadedLines, text.length)).toBeUndefined();
  });

  it('首章存在前置内容时可按一行或五行向前扩展章首', () => {
    const leadingText = `${[
      '书名',
      '作者',
      '简介一',
      '简介二',
      '简介三',
      '第一卷',
      '',
      '第一章 山边小村',
      '正文',
    ].join('\n')}\n`;
    const leadingLines = parseChapterEditorLines(leadingText);
    const totalByteLength = new TextEncoder().encode(leadingText).byteLength;
    const headingLine = leadingLines[7]!;
    const firstChapter: ChapterStructureDraftChapter = {
      draftId: 'chapter-1',
      existingChapterId: 'chapter-1',
      title: '第一章 山边小村',
      headingKind: 'source',
      headingRange: range(headingLine.startByte, headingLine.bodyEndByte),
      contentRange: range(headingLine.endByte, totalByteLength),
      lengthAnomalyAccepted: false,
      protectedHeadingStartByte: headingLine.startByte,
    };

    expect(resolveBoundaryShift([firstChapter], 0, {
      boundary: 'upper',
      direction: 'backward',
      lineCount: 1,
    }, leadingLines, totalByteLength)).toEqual({
      chapterId: 'chapter-1',
      boundary: 'chapter-start',
      byteOffset: leadingLines[6]!.startByte,
    });
    expect(resolveBoundaryShift([firstChapter], 0, {
      boundary: 'upper',
      direction: 'backward',
      lineCount: 5,
    }, leadingLines, totalByteLength)?.byteOffset).toBe(leadingLines[2]!.startByte);
  });

  it('正文控件移动 contentRange.endByte，按一行或五行使用逻辑行边界', () => {
    expect(resolveBoundaryShift(chapters, 0, {
      boundary: 'lower',
      direction: 'backward',
      lineCount: 1,
    }, loadedLines, text.length)).toEqual({
      chapterId: 'chapter-1',
      boundary: 'content-end',
      byteOffset: text.indexOf('a8'),
    });
    expect(resolveBoundaryShift(chapters, 0, {
      boundary: 'lower',
      direction: 'backward',
      lineCount: 5,
    }, loadedLines, text.length)?.byteOffset).toBe(text.indexOf('a4'));

    const shortened = chapters.map((chapter, index) => index === 0
      ? { ...chapter, contentRange: range(chapter.contentRange.startByte, text.indexOf('a4')) }
      : chapter);
    expect(resolveBoundaryShift(shortened, 0, {
      boundary: 'lower',
      direction: 'forward',
      lineCount: 1,
    }, loadedLines, text.length)?.byteOffset).toBe(text.indexOf('a5'));
  });

  it('来源标题保护、无标题零正文、首尾范围在生成语义编辑前即校验', () => {
    expect(resolveBoundaryShift(chapters, 0, {
      boundary: 'lower',
      direction: 'forward',
      lineCount: 1,
    }, loadedLines, text.length)).toBeUndefined();

    const missing = {
      ...chapters[1]!,
      headingKind: 'missing' as const,
      headingRange: undefined,
      protectedHeadingStartByte: undefined,
      contentRange: range(starts[1]!, text.indexOf('b1')),
    };
    const withMissing = [chapters[0]!, missing, chapters[2]!];
    expect(resolveBoundaryShift(withMissing, 0, {
      boundary: 'lower',
      direction: 'forward',
      lineCount: 1,
    }, loadedLines, text.length)).toEqual({
      chapterId: 'chapter-1',
      boundary: 'content-end',
      byteOffset: text.indexOf('b1'),
    });
    expect(resolveBoundaryShift(chapters, 2, {
      boundary: 'lower',
      direction: 'forward',
      lineCount: 1,
    }, loadedLines, text.length)).toBeUndefined();
  });
});

function range(startByte: number, endByte: number) {
  return { offsetUnit: 'utf8-byte' as const, startByte, endByte };
}
