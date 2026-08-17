import type { ChapterDto, Utf8TextRangeDto } from '@voxweaver/contracts';

import { describe, expect, it } from 'vitest';
import {
  createChapterEditorModel,
  createChapterEditorModelCache,
  editorPositionToOriginalCharacter,
  originalCharacterToEditorPosition,
  parseChapterEditorLines,
  utf8ByteToEditorPosition,
} from './chapterEditorModel';

describe('chapter editor model', () => {
  it('同时记录 CodeMirror UTF-16 位置与中文、emoji 的 UTF-8 byte 位置', () => {
    const text = '甲😀\n乙\n';
    const lines = parseChapterEditorLines(text);

    expect(lines).toEqual([
      {
        number: 1,
        text: '甲😀',
        from: 0,
        to: 3,
        end: 4,
        startByte: 0,
        bodyEndByte: 7,
        endByte: 8,
      },
      {
        number: 2,
        text: '乙',
        from: 4,
        to: 5,
        end: 6,
        startByte: 8,
        bodyEndByte: 11,
        endByte: 12,
      },
      {
        number: 3,
        text: '',
        from: 6,
        to: 6,
        end: 6,
        startByte: 12,
        bodyEndByte: 12,
        endByte: 12,
      },
    ]);

    const encoder = new TextEncoder();
    for (const line of lines) {
      expect(text.slice(line.from, line.to)).toBe(line.text);
      expect(encoder.encode(text.slice(0, line.from)).byteLength).toBe(line.startByte);
      expect(encoder.encode(text.slice(0, line.to)).byteLength).toBe(line.bodyEndByte);
      expect(encoder.encode(text.slice(0, line.end)).byteLength).toBe(line.endByte);
    }
  });

  it('空文档至少一行，尾随 LF 产生最终空行', () => {
    expect(parseChapterEditorLines('')).toEqual([{
      number: 1,
      text: '',
      from: 0,
      to: 0,
      end: 0,
      startByte: 0,
      bodyEndByte: 0,
      endByte: 0,
    }]);
    expect(parseChapterEditorLines('a\n').map(line => ({
      number: line.number,
      text: line.text,
      from: line.from,
      to: line.to,
      end: line.end,
    }))).toEqual([
      { number: 1, text: 'a', from: 0, to: 1, end: 2 },
      { number: 2, text: '', from: 2, to: 2, end: 2 },
    ]);
  });

  it('将 CRLF/CR/LF 投影为 CodeMirror LF 位置并保留原始字符与 byte 映射', () => {
    const text = '甲\r\n乙\rc\n😀';
    const model = createChapterEditorModel(text, []);

    expect(model.normalizedText).toBe('甲\n乙\nc\n😀');
    expect(model.lines).toEqual([
      {
        number: 1,
        text: '甲',
        from: 0,
        to: 1,
        end: 2,
        startByte: 0,
        bodyEndByte: 3,
        endByte: 5,
      },
      {
        number: 2,
        text: '乙',
        from: 2,
        to: 3,
        end: 4,
        startByte: 5,
        bodyEndByte: 8,
        endByte: 9,
      },
      {
        number: 3,
        text: 'c',
        from: 4,
        to: 5,
        end: 6,
        startByte: 9,
        bodyEndByte: 10,
        endByte: 11,
      },
      {
        number: 4,
        text: '😀',
        from: 6,
        to: 8,
        end: 8,
        startByte: 11,
        bodyEndByte: 15,
        endByte: 15,
      },
    ]);
    expect(editorPositionToOriginalCharacter(model, 2)).toBe(3);
    expect(originalCharacterToEditorPosition(model, 2)).toBe(2);
    expect(originalCharacterToEditorPosition(model, 3)).toBe(2);
    expect(utf8ByteToEditorPosition(model, 4)).toBe(2);
    expect(utf8ByteToEditorPosition(model, 5)).toBe(2);
    expect(() => editorPositionToOriginalCharacter(model, 7)).toThrow('Unicode 字符边界');
    expect(() => originalCharacterToEditorPosition(model, 8))
      .toThrow('原始文本字符位置 8 不是有效的 Unicode 字符边界。');
    expect(() => utf8ByteToEditorPosition(model, 1))
      .toThrow('原始文本 UTF-8 字节位置 1 不是有效的 Unicode 字符边界。');
  });

  it('将 CR-only 文本按规范化行位置锚定来源标题和正文', () => {
    const text = '前\r第二章\r正文';
    const lines = parseChapterEditorLines(text);
    const model = createChapterEditorModel(text, [{
      chapterId: 'chapter-2',
      order: 1,
      title: '第二章',
      headingKind: 'source',
      headingRange: range(lines[1]!.startByte, lines[1]!.bodyEndByte),
      contentRange: range(lines[2]!.startByte, lines[2]!.endByte),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }]);

    expect(model.normalizedText).toBe('前\n第二章\n正文');
    expect(model.chapterLayouts[0]).toEqual({
      chapterId: 'chapter-2',
      widgetAnchor: { from: 2, lineNumber: 2 },
      headingLineFroms: [2],
      contentStartLineFrom: 6,
    });
  });

  it('大文本位置映射仅按 CRLF 数量保留紧凑断点', () => {
    const text = `${'章'.repeat(50_000)}\r\n${'文'.repeat(50_000)}\r\n尾`;
    const model = createChapterEditorModel(text, []);

    expect(model.positionMap.crlfOriginalEnds).toBeInstanceOf(Float64Array);
    expect([...model.positionMap.crlfOriginalEnds]).toEqual([50_002, 100_004]);
    expect(Object.values(model.positionMap).some(value => value instanceof Map)).toBe(false);
    expect(editorPositionToOriginalCharacter(model, model.normalizedText.length)).toBe(text.length);
    expect(originalCharacterToEditorPosition(model, text.length))
      .toBe(model.normalizedText.length);
  });

  it('仅章节状态变化时复用与正文绑定的投影', () => {
    const text = '第一章\r\n正文';
    const lines = parseChapterEditorLines(text);
    const sourceChapter = chapter(
      'chapter-1',
      1,
      lines,
      1,
      2,
      lines.at(-1)!.endByte,
    );
    const createCachedModel = createChapterEditorModelCache();
    const beforeAcceptance = createCachedModel(text, [sourceChapter]);
    const afterAcceptance = createCachedModel(text, [{
      ...sourceChapter,
      lengthAnomalyAccepted: true,
    }]);

    expect(afterAcceptance.lines).toBe(beforeAcceptance.lines);
    expect(afterAcceptance.positionMap).toBe(beforeAcceptance.positionMap);

    const changedText = `${text}\n尾`;
    const afterTextChange = createCachedModel(changedText, [sourceChapter]);
    expect(afterTextChange.lines).not.toBe(beforeAcceptance.lines);
    expect(afterTextChange.positionMap).not.toBe(beforeAcceptance.positionMap);
  });

  it('为长章节生成正文中段隐藏区并生成来源标题章节锚点', () => {
    const text = numberedLines(80);
    const lines = parseChapterEditorLines(text);
    const chapters = [
      chapter('chapter-1', 1, lines, 1, 2, lineStartByte(lines, 40)),
      chapter('chapter-2', 2, lines, 40, 41, lines.at(-1)!.endByte),
    ];
    const model = createChapterEditorModel(text, chapters);

    expect(model.hiddenRanges).toEqual([
      {
        chapterId: 'chapter-1',
        id: 'chapter-1',
        from: lines[6]!.from,
        to: lines[34]!.from,
        startLine: 7,
        endLine: 34,
        lineCount: 28,
      },
      {
        chapterId: 'chapter-2',
        id: 'chapter-2',
        from: lines[45]!.from,
        to: lines[75]!.from,
        startLine: 46,
        endLine: 75,
        lineCount: 30,
      },
    ]);
    expect(model.chapterLayouts).toEqual([
      {
        chapterId: 'chapter-1',
        widgetAnchor: { from: lines[0]!.from, lineNumber: 1 },
        headingLineFroms: [lines[0]!.from],
        contentStartLineFrom: lines[1]!.from,
      },
      {
        chapterId: 'chapter-2',
        widgetAnchor: { from: lines[39]!.from, lineNumber: 40 },
        headingLineFroms: [lines[39]!.from],
        contentStartLineFrom: lines[40]!.from,
      },
    ]);
  });

  it('missing 章以正文起点锚定，并允许文末零长度正文', () => {
    const text = `${numberedLines(20)}\n`;
    const lines = parseChapterEditorLines(text);
    const endByte = lines.at(-1)!.endByte;
    const model = createChapterEditorModel(text, [{
      chapterId: 'missing-1',
      order: 1,
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: range(endByte, endByte),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }]);

    expect(model.hiddenRanges).toEqual([]);
    expect(model.chapterLayouts).toEqual([{
      chapterId: 'missing-1',
      widgetAnchor: { from: text.length, lineNumber: 21 },
      headingLineFroms: [],
      contentStartLineFrom: text.length,
    }]);
  });

  it.each([
    { bodyLineCount: 10, hiddenLineCount: 0 },
    { bodyLineCount: 11, hiddenLineCount: 1 },
    { bodyLineCount: 16, hiddenLineCount: 6 },
  ])('正文 $bodyLineCount 行时隐藏 $hiddenLineCount 行', ({
    bodyLineCount,
    hiddenLineCount,
  }) => {
    const text = ['第一章', ...numberedLineArray(bodyLineCount)].join('\n');
    const lines = parseChapterEditorLines(text);
    const model = createChapterEditorModel(text, [chapter(
      'chapter-1',
      1,
      lines,
      1,
      2,
      lines.at(-1)!.endByte,
    )]);

    if (hiddenLineCount === 0) {
      expect(model.hiddenRanges).toEqual([]);
      return;
    }
    expect(model.hiddenRanges).toEqual([{
      chapterId: 'chapter-1',
      id: 'chapter-1',
      from: lines[6]!.from,
      to: lines[6 + hiddenLineCount]!.from,
      startLine: 7,
      endLine: 6 + hiddenLineCount,
      lineCount: hiddenLineCount,
    }]);
  });

  it('标题跨多行时全部标题保持在默认隐藏区之外', () => {
    const text = ['卷一', '第一章', ...numberedLineArray(11)].join('\n');
    const lines = parseChapterEditorLines(text);
    const model = createChapterEditorModel(text, [{
      chapterId: 'chapter-1',
      order: 1,
      title: '第一章',
      headingKind: 'source',
      headingRange: range(lines[0]!.startByte, lines[1]!.bodyEndByte),
      contentRange: range(lines[2]!.startByte, lines.at(-1)!.endByte),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }]);

    expect(model.chapterLayouts[0]?.headingLineFroms).toEqual([
      lines[0]!.from,
      lines[1]!.from,
    ]);
    expect(model.hiddenRanges[0]).toMatchObject({
      from: lines[7]!.from,
      to: lines[8]!.from,
      startLine: 8,
      endLine: 8,
      lineCount: 1,
    });
  });

  it.each(['\r\n', '\r'])('按 %j 原始换行的 byte 范围映射正文隐藏行', (separator) => {
    const text = ['第一章', ...numberedLineArray(11)].join(separator);
    const lines = parseChapterEditorLines(text);
    const model = createChapterEditorModel(text, [chapter(
      'chapter-1',
      1,
      lines,
      1,
      2,
      lines.at(-1)!.endByte,
    )]);

    expect(model.normalizedText).toBe(['第一章', ...numberedLineArray(11)].join('\n'));
    expect(model.hiddenRanges[0]).toMatchObject({
      from: lines[6]!.from,
      to: lines[7]!.from,
      startLine: 7,
      endLine: 7,
      lineCount: 1,
    });
  });
});

function numberedLines(count: number): string {
  return numberedLineArray(count).join('\n');
}

function numberedLineArray(count: number): string[] {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`);
}

function chapter(
  chapterId: string,
  order: number,
  lines: readonly ReturnType<typeof parseChapterEditorLines>[number][],
  headingLineNumber: number,
  contentStartLineNumber: number,
  contentEndByte: number,
): ChapterDto {
  const heading = lines[headingLineNumber - 1]!;
  const contentStart = lines[contentStartLineNumber - 1]!;
  return {
    chapterId,
    order,
    title: heading.text,
    headingKind: 'source',
    headingRange: range(heading.startByte, heading.bodyEndByte),
    contentRange: range(contentStart.startByte, contentEndByte),
    reviewStatus: 'pending',
    lengthAnomalyAccepted: false,
  };
}

function lineStartByte(
  lines: readonly ReturnType<typeof parseChapterEditorLines>[number][],
  lineNumber: number,
): number {
  return lines[lineNumber - 1]!.startByte;
}

function range(startByte: number, endByte: number): Utf8TextRangeDto {
  return { offsetUnit: 'utf8-byte', startByte, endByte };
}
