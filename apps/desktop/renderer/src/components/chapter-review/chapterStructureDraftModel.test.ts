import type {
  ChapterDto,
  NovelImportReviewSnapshotDto,
  Utf8TextRangeDto,
} from '@voxweaver/contracts';

import { describe, expect, it } from 'vitest';
import {
  acceptChapterLengthAnomaly,
  addChapterRecognition,
  applyChapterBoundaryEdit,
  buildUpdateChapterStructureCommand,
  calculateChapterBodyLengths,
  calculateChapterLengthAnomalies,
  canInsertLineBreak,
  canMergeChapter,
  CHAPTER_TEXT_INDEX_CHECKPOINT_STRIDE,
  chapterBoundaryEditCanApply,
  characterOffsetToUtf8Byte,
  countNonWhitespaceCodePoints,
  createChapterStructureDraft,
  createChapterTextIndex,
  deleteChapterRecognition,
  displayChapterTitle,
  insertLineBreak,
  mergeChapter,
  updateChapterRanges,
  utf8ByteOffsetToCharacter,
} from './chapterStructureDraftModel';

const encoder = new TextEncoder();

describe('chapter structure draft model', () => {
  it('精确映射 UTF-16 字符间隙与 UTF-8 byte，并按 code point 排除空白', () => {
    const text = '甲😀\u3000e\u0301\u0085\n';

    expect(characterOffsetToUtf8Byte(text, 0)).toBe(0);
    expect(characterOffsetToUtf8Byte(text, 1)).toBe(3);
    expect(characterOffsetToUtf8Byte(text, 3)).toBe(7);
    expect(utf8ByteOffsetToCharacter(text, 7)).toBe(3);
    expect(() => characterOffsetToUtf8Byte(text, 2)).toThrow('Unicode 字符间隙');
    expect(() => utf8ByteOffsetToCharacter(text, 4)).toThrow('字符边界');
    expect(countNonWhitespaceCodePoints(text)).toBe(4);
  });

  it('大文本使用稀疏 UTF-8 与非空白前缀 checkpoint，不创建逐字符 Map', () => {
    const repeatCount = 20_000;
    const codePointsPerUnit = 5;
    const text = '章😀 \u0085\n'.repeat(repeatCount);
    const textIndex = createChapterTextIndex(text);
    const expectedCheckpointCount = Math.ceil(
      repeatCount * codePointsPerUnit / CHAPTER_TEXT_INDEX_CHECKPOINT_STRIDE,
    ) + 1;
    const snapshot = snapshotForChapters(text, [{
      chapterId: 'chapter-large',
      order: 1,
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: utf8Range(0, textIndex.byteLength),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }]);
    const draft = createChapterStructureDraft(snapshot, text, textIndex);

    expect(textIndex.checkpointCharacterOffsets).toBeInstanceOf(Float64Array);
    expect(textIndex.checkpointByteOffsets).toBeInstanceOf(Float64Array);
    expect(textIndex.checkpointNonWhitespaceCounts).toBeInstanceOf(Float64Array);
    expect(textIndex.checkpointCharacterOffsets).toHaveLength(expectedCheckpointCount);
    expect(Object.values(textIndex).some(value => value instanceof Map)).toBe(false);
    expect(textIndex.byteLength).toBe(encoder.encode(text).byteLength);
    expect(characterOffsetToUtf8Byte(text, text.length, textIndex)).toBe(textIndex.byteLength);
    expect(utf8ByteOffsetToCharacter(text, textIndex.byteLength, textIndex)).toBe(text.length);
    expect(() => characterOffsetToUtf8Byte(text, 2, textIndex)).toThrow('Unicode 字符间隙');
    expect([...calculateChapterBodyLengths(draft, textIndex).values()]).toEqual([
      repeatCount * 2,
    ]);
  });

  it('正文长度按连续归属计算，排除标题与全部空白', () => {
    const fixture = createFixture([
      { title: '第一章', body: '甲 😀\n' },
      { title: '第二章', body: '乙\t丙\n' },
    ]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);

    expect([...calculateChapterBodyLengths(draft).values()]).toEqual([2, 2]);
  });

  it('全局 IQR 与局部 Hampel 同向异常时识别首尾短章与长章', () => {
    const fixture = createLengthFixture([1, 10, 10, 10, 10, 10, 10, 100]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);

    expect(calculateChapterLengthAnomalies(draft)).toEqual([
      { chapterId: 'chapter-1', codePointCount: 1, kind: 'short', reason: '偏短 · 1 字' },
      { chapterId: 'chapter-8', codePointCount: 100, kind: 'long', reason: '偏长 · 100 字' },
    ]);

    const accepted = acceptChapterLengthAnomaly(draft, 'chapter-1');
    expect(calculateChapterLengthAnomalies(accepted)).toEqual([
      { chapterId: 'chapter-8', codePointCount: 100, kind: 'long', reason: '偏长 · 100 字' },
    ]);
    expect(accepted.operationCount).toBe(1);
  });

  it('稳定邻域中的孤立与连续异常均按相邻章节识别', () => {
    const isolatedFixture = createLengthFixture([
      1_000,
      1_000,
      1_000,
      400,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      2_500,
      1_000,
      1_000,
      1_000,
    ]);
    const isolatedDraft = createChapterStructureDraft(
      isolatedFixture.snapshot,
      isolatedFixture.text,
    );
    const consecutiveFixture = createLengthFixture([
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      2_500,
      2_500,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
    ]);
    const consecutiveDraft = createChapterStructureDraft(
      consecutiveFixture.snapshot,
      consecutiveFixture.text,
    );

    expect(calculateChapterLengthAnomalies(isolatedDraft)).toEqual([
      { chapterId: 'chapter-4', codePointCount: 400, kind: 'short', reason: '偏短 · 400 字' },
      { chapterId: 'chapter-10', codePointCount: 2_500, kind: 'long', reason: '偏长 · 2500 字' },
    ]);
    expect(calculateChapterLengthAnomalies(consecutiveDraft)).toEqual([
      { chapterId: 'chapter-6', codePointCount: 2_500, kind: 'long', reason: '偏长 · 2500 字' },
      { chapterId: 'chapter-7', codePointCount: 2_500, kind: 'long', reason: '偏长 · 2500 字' },
    ]);
  });

  it('全局 IQR 或局部 Hampel 任意一个正常时不提示', () => {
    const globalOnlyFixture = createLengthFixture(
      Array.from({ length: 40 }, (_, index) => index < 32 ? 10 : 24),
    );
    const globalOnlyDraft = createChapterStructureDraft(
      globalOnlyFixture.snapshot,
      globalOnlyFixture.text,
    );
    const localOnlyFixture = createLengthFixture(
      Array.from({ length: 24 }, (_, index) => {
        if (index === 5)
          return 25;
        return index < 12 ? 10 : 30;
      }),
    );
    const localOnlyDraft = createChapterStructureDraft(
      localOnlyFixture.snapshot,
      localOnlyFixture.text,
    );

    expect(calculateChapterLengthAnomalies(globalOnlyDraft)).toEqual([]);
    expect(calculateChapterLengthAnomalies(localOnlyDraft)).toEqual([]);
  });

  it('逐渐增长与持续阶跃不视为孤立章节异常', () => {
    const gradualFixture = createLengthFixture(
      Array.from({ length: 16 }, (_, index) => 1_000 + index * 100),
    );
    const gradualDraft = createChapterStructureDraft(
      gradualFixture.snapshot,
      gradualFixture.text,
    );
    const stepFixture = createLengthFixture([
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      1_000,
      2_400,
      2_400,
      2_400,
      2_400,
      2_400,
      2_400,
    ]);
    const stepDraft = createChapterStructureDraft(stepFixture.snapshot, stepFixture.text);

    expect(calculateChapterLengthAnomalies(gradualDraft)).toEqual([]);
    expect(calculateChapterLengthAnomalies(stepDraft)).toEqual([]);
  });

  it('已标记正常的章节仍参与局部样本计算', () => {
    const fixture = createLengthFixture([1, 1, 1, 1, 1, 2]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);
    const accepted = {
      ...draft,
      chapters: draft.chapters.map((chapter, index) => index === 0
        ? { ...chapter, lengthAnomalyAccepted: true }
        : chapter),
    };

    expect(calculateChapterLengthAnomalies(accepted)).toEqual([{
      chapterId: 'chapter-6',
      codePointCount: 2,
      kind: 'long',
      reason: '偏长 · 2 字',
    }]);
  });

  it('空正文始终提示，小样本不判定偏短或偏长', () => {
    const fixture = createFixture([
      { title: '第一章', body: '' },
      { title: '第二章', body: '正文\n' },
      { title: '第三章', body: '很长的正文\n' },
    ]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);

    expect(calculateChapterLengthAnomalies(draft)).toEqual([
      { chapterId: 'chapter-1', codePointCount: 0, kind: 'empty', reason: '无正文' },
    ]);
  });
});

describe('chapter structure operations', () => {
  it('标题规则匹配时整行建立来源标题章并拆分原章节', () => {
    const fixture = createFixture([{
      title: '第一章',
      body: '旧正文\n  第二章 ： 新章  \n新正文😀\n',
    }]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);
    const titleLineStart = fixture.text.indexOf('  第二章');
    const titleStart = fixture.text.indexOf('第二章');
    const titleLineEnd = fixture.text.indexOf('\n', titleStart);
    const contentStart = titleLineEnd + 1;

    const added = addChapterRecognition(draft, titleStart + 2);

    expect(added.text).toBe(fixture.text);
    expect(added.chapters).toHaveLength(2);
    expect(added.chapters[0]?.contentRange.endByte)
      .toBe(characterOffsetToUtf8Byte(fixture.text, titleLineStart));
    expect(added.chapters[1]).toMatchObject({
      draftId: 'draft-chapter-1',
      title: '第二章 ： 新章',
      headingKind: 'source',
      headingRange: utf8Range(
        characterOffsetToUtf8Byte(fixture.text, titleLineStart),
        characterOffsetToUtf8Byte(fixture.text, titleLineEnd),
      ),
      contentRange: utf8Range(
        characterOffsetToUtf8Byte(fixture.text, contentStart),
        encoder.encode(fixture.text).byteLength,
      ),
      lengthAnomalyAccepted: false,
    });
    expect(added.chapters[0]!.boundaryPreference?.contentRange.endByte)
      .toBe(characterOffsetToUtf8Byte(fixture.text, titleLineStart));
    expect(added.chapters[1]!.boundaryPreference).toEqual({
      headingRange: added.chapters[1]!.headingRange,
      contentRange: added.chapters[1]!.contentRange,
    });
    expect(added.chapters[1]!.protectedHeadingStartByte)
      .toBe(added.chapters[1]!.headingRange!.startByte);
    expect(added.operationCount).toBe(1);
  });

  it('兼容 CRLF/CR 标题识别并保留原始分隔符 byte 范围', () => {
    for (const separator of ['\r\n', '\r']) {
      const text = `第一章${separator}旧正文${separator}  第二章 ： 新章  ${separator}新正文`;
      const firstHeadingEnd = text.indexOf(separator);
      const contentStart = firstHeadingEnd + separator.length;
      const snapshot = snapshotForChapters(text, [{
        chapterId: 'chapter-1',
        order: 1,
        title: '第一章',
        headingKind: 'source',
        headingRange: utf8Range(0, characterOffsetToUtf8Byte(text, firstHeadingEnd)),
        contentRange: utf8Range(
          characterOffsetToUtf8Byte(text, contentStart),
          encoder.encode(text).byteLength,
        ),
        reviewStatus: 'pending',
        lengthAnomalyAccepted: false,
      }]);
      const draft = createChapterStructureDraft(snapshot, text);
      const titleLineStart = text.indexOf('  第二章');
      const titleClick = text.indexOf('第二章') + 2;
      const titleLineEnd = text.indexOf(separator, titleClick);
      const nextContentStart = titleLineEnd + separator.length;

      const added = addChapterRecognition(draft, titleClick);

      expect(added.chapters[0]!.contentRange.endByte)
        .toBe(characterOffsetToUtf8Byte(text, titleLineStart));
      expect(added.chapters[1]).toMatchObject({
        title: '第二章 ： 新章',
        headingKind: 'source',
        headingRange: utf8Range(
          characterOffsetToUtf8Byte(text, titleLineStart),
          characterOffsetToUtf8Byte(text, titleLineEnd),
        ),
        contentRange: utf8Range(
          characterOffsetToUtf8Byte(text, nextContentStart),
          encoder.encode(text).byteLength,
        ),
      });
    }
  });

  it('标题规则不匹配时从精确字符 gap 建立无标题章', () => {
    const fixture = createFixture([{ title: '第一章', body: '甲😀乙\n' }]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);
    const click = fixture.text.indexOf('乙');
    const clickByte = characterOffsetToUtf8Byte(fixture.text, click);

    const added = addChapterRecognition(draft, click);

    expect(added.text).toBe(fixture.text);
    expect(added.chapters[0]?.contentRange.endByte).toBe(clickByte);
    expect(added.chapters[1]).toMatchObject({
      title: '未命名章节',
      headingKind: 'missing',
      headingRange: undefined,
      contentRange: utf8Range(clickByte, encoder.encode(fixture.text).byteLength),
    });
  });

  it('在显式未归属范围重新识别时恢复该段 coverage', () => {
    const fixture = createFixture([
      { title: '第一章', body: '一\n' },
      { title: '第二章', body: '二\n' },
      { title: '第三章', body: '三\n' },
    ]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);
    const deleted = deleteChapterRecognition(draft, 'chapter-2');

    const restored = addChapterRecognition(deleted, fixture.text.indexOf('第二章') + 1);

    expect(restored.text).toBe(fixture.text);
    expect(restored.chapters.map(chapter => chapter.title)).toEqual(['第一章', '第二章', '第三章']);
    expect(restored.chapters[1]?.existingChapterId).toBeUndefined();
    expect(restored.unassignedRanges).toEqual([]);
  });

  it('已有识别位置不能重复新增', () => {
    const fixture = createFixture([{ title: '第一章', body: '正文\n' }]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);

    expect(() => addChapterRecognition(draft, 1)).toThrow('已有章节识别');
  });

  it('通用范围更新将多个边界作为一次草稿操作，并拒绝重叠', () => {
    const fixture = createFixture([
      { title: '第一章', body: '甲\n乙\n' },
      { title: '第二章', body: '丙\n' },
    ]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);
    const boundary = characterOffsetToUtf8Byte(fixture.text, fixture.text.indexOf('乙'));
    const updated = updateChapterRanges(draft, [
      { chapterId: 'chapter-1', contentRange: utf8Range(draft.chapters[0]!.contentRange.startByte, boundary) },
      {
        chapterId: 'chapter-2',
        headingRange: utf8Range(boundary, draft.chapters[1]!.headingRange!.endByte),
      },
    ]);

    expect(updated.operationCount).toBe(1);
    expect(updated.chapters[0]?.contentRange.endByte).toBe(boundary);
    expect(updated.chapters[1]?.headingRange?.startByte).toBe(boundary);
    expect(updateChapterRanges(updated, [{
      chapterId: 'chapter-1',
      contentRange: updated.chapters[0]!.contentRange,
    }])).toBe(updated);
    expect(() => updateChapterRanges(draft, [{
      chapterId: 'chapter-1',
      contentRange: utf8Range(
        draft.chapters[0]!.contentRange.startByte,
        draft.chapters[1]!.headingRange!.endByte,
      ),
    }])).toThrow('不能重叠');
  });

  it('首章章首向前扩展会逐段吸收前置未归属范围，回退时恢复该范围', () => {
    const text = '书名\n作者\n第一章 山边小村\n正文\n';
    const headingStart = characterOffsetToUtf8Byte(text, text.indexOf('第一章'));
    const headingEnd = characterOffsetToUtf8Byte(text, text.indexOf('\n', text.indexOf('第一章')));
    const contentStart = characterOffsetToUtf8Byte(text, text.indexOf('正文'));
    const totalByteLength = encoder.encode(text).byteLength;
    const baseSnapshot = snapshotForChapters(text, [{
      chapterId: 'chapter-1',
      order: 1,
      title: '第一章 山边小村',
      headingKind: 'source',
      headingRange: utf8Range(headingStart, headingEnd),
      contentRange: utf8Range(contentStart, totalByteLength),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }]);
    const snapshot: NovelImportReviewSnapshotDto = {
      ...baseSnapshot,
      coverage: {
        ...baseSnapshot.coverage,
        classifiedByteLength: totalByteLength - headingStart,
        unclassifiedByteLength: headingStart,
        complete: false,
        uncoveredRanges: [utf8Range(0, headingStart)],
      },
    };
    const draft = createChapterStructureDraft(snapshot, text);
    const expandedStart = characterOffsetToUtf8Byte(text, text.indexOf('作者'));
    const expanded = updateChapterRanges(draft, [{
      chapterId: 'chapter-1',
      headingRange: utf8Range(expandedStart, headingEnd),
    }]);

    expect(expanded.unassignedRanges).toEqual([utf8Range(0, expandedStart)]);
    expect(expanded.chapters[0]?.headingRange).toEqual(utf8Range(expandedStart, headingEnd));

    const restored = updateChapterRanges(expanded, [{
      chapterId: 'chapter-1',
      headingRange: utf8Range(headingStart, headingEnd),
    }]);
    expect(restored.unassignedRanges).toEqual([utf8Range(0, headingStart)]);
  });

  it('删除后的显式未归属范围不能被边界操作隐式占用', () => {
    const fixture = createFixture([
      { title: '第一章', body: '一\n' },
      { title: '第二章', body: '二\n' },
      { title: '第三章', body: '三\n' },
    ]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);
    const deleted = deleteChapterRecognition(draft, 'chapter-2');
    const unassigned = deleted.unassignedRanges[0]!;
    const third = deleted.chapters[1]!;

    expect(() => updateChapterRanges(deleted, [{
      chapterId: third.draftId,
      headingRange: utf8Range(unassigned.startByte, third.headingRange!.endByte),
    }])).toThrow('显式未归属范围');
    expect(deleted.operationCount).toBe(1);
  });

  it('后章章首最后编辑时收缩前章，冲突解除后只恢复前章用户期望', () => {
    const draft = createBoundaryDraft([
      missingChapter('chapter-1', 1, 10),
      missingChapter('chapter-2', 13, 20),
    ]);

    const overlapped = applyChapterBoundaryEdit(draft, {
      chapterId: 'chapter-2',
      boundary: 'chapter-start',
      byteOffset: 8,
    });
    expect(overlapped.chapters[0]!.contentRange).toEqual(utf8Range(1, 8));
    expect(overlapped.chapters[1]!.contentRange).toEqual(utf8Range(8, 20));
    expect(overlapped.chapters[0]!.boundaryPreference?.contentRange)
      .toEqual(utf8Range(1, 10));
    expect(overlapped.boundaryPriorities).toEqual([{
      previousChapterId: 'chapter-1',
      nextChapterId: 'chapter-2',
      side: 'next-chapter-start',
    }]);

    const released = applyChapterBoundaryEdit(overlapped, {
      chapterId: 'chapter-2',
      boundary: 'chapter-start',
      byteOffset: 12,
    });
    expect(released.chapters[0]!.contentRange).toEqual(utf8Range(1, 10));
    expect(released.chapters[1]!.contentRange).toEqual(utf8Range(12, 20));
    expect(buildUpdateChapterStructureCommand(released).chapters.map(chapter => (
      chapter.contentRange
    ))).toEqual([
      utf8Range(1, 10),
      utf8Range(12, 20),
    ]);
  });

  it('前章正文末端最后编辑时对称夹紧后章，双方独立编辑以最后一次为准', () => {
    const draft = createBoundaryDraft([
      missingChapter('chapter-1', 1, 10),
      missingChapter('chapter-2', 13, 20),
    ]);
    const nextMoved = applyChapterBoundaryEdit(draft, {
      chapterId: 'chapter-2',
      boundary: 'chapter-start',
      byteOffset: 8,
    });
    const previousWins = applyChapterBoundaryEdit(nextMoved, {
      chapterId: 'chapter-1',
      boundary: 'content-end',
      byteOffset: 10,
    });

    expect(previousWins.chapters[0]!.contentRange).toEqual(utf8Range(1, 10));
    expect(previousWins.chapters[1]!.contentRange).toEqual(utf8Range(10, 20));
    expect(previousWins.chapters[1]!.boundaryPreference?.contentRange)
      .toEqual(utf8Range(8, 20));
    expect(previousWins.boundaryPriorities[0]?.side).toBe('previous-content-end');

    const nextWinsAgain = applyChapterBoundaryEdit(previousWins, {
      chapterId: 'chapter-2',
      boundary: 'chapter-start',
      byteOffset: 12,
    });
    expect(nextWinsAgain.chapters[0]!.contentRange).toEqual(utf8Range(1, 10));
    expect(nextWinsAgain.chapters[1]!.contentRange).toEqual(utf8Range(12, 20));
    expect(nextWinsAgain.boundaryPriorities[0]?.side).toBe('next-chapter-start');
  });

  it('来源标题保护点阻止正文吞标题，无标题章可被夹紧为零正文', () => {
    const sourceDraft = createBoundaryDraft([
      missingChapter('chapter-1', 1, 10),
      {
        chapterId: 'chapter-2',
        order: 2,
        title: '第二章',
        headingKind: 'source',
        headingRange: utf8Range(13, 15),
        contentRange: utf8Range(15, 20),
        reviewStatus: 'pending',
        lengthAnomalyAccepted: false,
      },
    ]);
    const expandedStart = applyChapterBoundaryEdit(sourceDraft, {
      chapterId: 'chapter-2',
      boundary: 'chapter-start',
      byteOffset: 8,
    });
    const safe = applyChapterBoundaryEdit(expandedStart, {
      chapterId: 'chapter-1',
      boundary: 'content-end',
      byteOffset: 12,
    });
    expect(safe.chapters[1]!.headingRange).toEqual(utf8Range(12, 15));
    const unsafeEdit = {
      chapterId: 'chapter-1',
      boundary: 'content-end' as const,
      byteOffset: 14,
    };
    expect(chapterBoundaryEditCanApply(
      expandedStart.chapters,
      expandedStart.unassignedRanges,
      unsafeEdit,
      expandedStart.text.length,
    )).toBe(false);
    expect(() => applyChapterBoundaryEdit(expandedStart, unsafeEdit)).toThrow('来源标题');

    const missingDraft = createBoundaryDraft([
      missingChapter('chapter-1', 1, 10),
      missingChapter('chapter-2', 13, 20),
    ]);
    const zeroBody = applyChapterBoundaryEdit(missingDraft, {
      chapterId: 'chapter-1',
      boundary: 'content-end',
      byteOffset: 20,
    });
    expect(zeroBody.chapters[1]!.contentRange).toEqual(utf8Range(20, 20));
  });

  it('边界投影拒绝显式未归属范围与级联吞并，并支持首尾独立调整', () => {
    const base = createBoundaryDraft([
      missingChapter('chapter-1', 1, 10),
      missingChapter('chapter-2', 13, 15),
      missingChapter('chapter-3', 17, 20),
    ]);
    const withUnassigned = {
      ...base,
      unassignedRanges: [utf8Range(10, 13)],
    };
    expect(chapterBoundaryEditCanApply(
      withUnassigned.chapters,
      withUnassigned.unassignedRanges,
      { chapterId: 'chapter-1', boundary: 'content-end', byteOffset: 13 },
      withUnassigned.text.length,
    )).toBe(false);
    expect(() => applyChapterBoundaryEdit(base, {
      chapterId: 'chapter-1',
      boundary: 'content-end',
      byteOffset: 16,
    })).toThrow('级联');

    const firstMoved = applyChapterBoundaryEdit(base, {
      chapterId: 'chapter-1',
      boundary: 'chapter-start',
      byteOffset: 0,
    });
    const lastMoved = applyChapterBoundaryEdit(firstMoved, {
      chapterId: 'chapter-3',
      boundary: 'content-end',
      byteOffset: 24,
    });
    expect(lastMoved.chapters[0]!.contentRange.startByte).toBe(0);
    expect(lastMoved.chapters[2]!.contentRange.endByte).toBe(24);
  });

  it('无标题章持久化固定标题，界面按无标题章顺序编号', () => {
    const fixture = createFixture([
      { title: '第一章', body: '正文\n' },
      { body: '无标题正文\n' },
      { title: '第三章', body: '正文\n' },
      { body: '另一段\n' },
    ]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);

    expect(draft.chapters[1]?.title).toBe('未命名章节');
    expect(displayChapterTitle(draft.chapters[1]!, draft.chapters)).toBe('未命名章节 1');
    expect(displayChapterTitle(draft.chapters[3]!, draft.chapters)).toBe('未命名章节 2');
    expect(displayChapterTitle(draft.chapters[0]!, draft.chapters)).toBe('第一章');
  });

  it('首尾合并禁用，并入上一章延长正文，并入下一章仅移除识别', () => {
    const fixture = createFixture([
      { title: '第一章', body: '一\n' },
      { title: '第二章', body: '二\n' },
      { title: '第三章', body: '三\n' },
    ]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);

    expect(canMergeChapter(draft, 'chapter-1', 'previous')).toBe(false);
    expect(canMergeChapter(draft, 'chapter-3', 'next')).toBe(false);
    expect(() => mergeChapter(draft, 'chapter-1', 'previous')).toThrow('首章');
    expect(() => mergeChapter(draft, 'chapter-3', 'next')).toThrow('末章');

    const intoPrevious = mergeChapter(draft, 'chapter-2', 'previous');
    expect(intoPrevious.chapters.map(chapter => chapter.draftId)).toEqual([
      'chapter-1',
      'chapter-3',
    ]);
    expect(intoPrevious.chapters[0]?.contentRange.endByte)
      .toBe(draft.chapters[1]?.contentRange.endByte);
    expect(intoPrevious.chapters[0]?.boundaryPreference?.contentRange.endByte)
      .toBe(draft.chapters[1]?.boundaryPreference?.contentRange.endByte);
    expect(intoPrevious.operationCount).toBe(1);

    const intoNext = mergeChapter(draft, 'chapter-2', 'next');
    expect(intoNext.chapters.map(chapter => chapter.draftId)).toEqual([
      'chapter-1',
      'chapter-3',
    ]);
    expect(intoNext.chapters[0]?.contentRange).toEqual(draft.chapters[0]?.contentRange);
    expect(intoNext.chapters[1]?.contentRange).toEqual(draft.chapters[2]?.contentRange);
  });

  it('删除识别后正文完整保留并形成显式未归属范围', () => {
    const fixture = createFixture([
      { title: '第一章', body: '一\n' },
      { title: '第二章', body: '二\n' },
      { title: '第三章', body: '三\n' },
    ]);
    const draft = createChapterStructureDraft(fixture.snapshot, fixture.text);
    const deleted = deleteChapterRecognition(draft, 'chapter-2');

    expect(deleted.text).toBe(fixture.text);
    expect(deleted.chapters.map(chapter => chapter.draftId)).toEqual(['chapter-1', 'chapter-3']);
    expect(deleted.unassignedRanges).toEqual([utf8Range(
      draft.chapters[0]!.contentRange.endByte,
      draft.chapters[1]!.contentRange.endByte,
    )]);
    expect(canMergeChapter(deleted, 'chapter-3', 'previous')).toBe(false);
    expect(() => mergeChapter(deleted, 'chapter-3', 'previous'))
      .toThrow('显式未归属范围');

    const oneChapter = deleteChapterRecognition(deleted, 'chapter-1');
    const none = deleteChapterRecognition(oneChapter, 'chapter-3');
    expect(none.chapters).toEqual([]);
    expect(none.unassignedRanges).toEqual([utf8Range(0, encoder.encode(fixture.text).byteLength)]);
  });

  it('精确插入 LF，记录 baseline byte 并映射后续范围', () => {
    const text = '甲😀乙';
    const total = encoder.encode(text).byteLength;
    const snapshot = snapshotForChapters(text, [{
      chapterId: 'chapter-1',
      order: 1,
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: utf8Range(0, total),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }]);
    const draft = createChapterStructureDraft(snapshot, text);

    const afterSecond = insertLineBreak(draft, 3);
    expect(afterSecond.text).toBe('甲😀\n乙');
    expect(afterSecond.insertionPoints).toEqual([7]);
    expect(afterSecond.chapters[0]?.contentRange).toEqual(utf8Range(0, 11));
    expect(afterSecond.chapters[0]?.boundaryPreference?.contentRange)
      .toEqual(utf8Range(0, 11));
    expect(canInsertLineBreak(afterSecond, 3)).toBe(false);
    expect(canInsertLineBreak(afterSecond, 4)).toBe(false);

    const afterFirst = insertLineBreak(afterSecond, 1);
    expect(afterFirst.text).toBe('甲\n😀\n乙');
    expect(afterFirst.insertionPoints).toEqual([3, 7]);
    expect(afterFirst.chapters[0]?.contentRange).toEqual(utf8Range(0, 12));
    expect(afterFirst.chapters[0]?.boundaryPreference?.contentRange)
      .toEqual(utf8Range(0, 12));
    expect(afterFirst.operationCount).toBe(2);
  });

  it('在 CRLF/CR 邻接位置禁用换行，合法 gap 记录原始 baseline byte', () => {
    const text = '甲\r\n乙丁\r丙';
    const total = encoder.encode(text).byteLength;
    const snapshot = snapshotForChapters(text, [{
      chapterId: 'chapter-1',
      order: 1,
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: utf8Range(0, total),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }]);
    const draft = createChapterStructureDraft(snapshot, text);
    const crlfStart = text.indexOf('\r\n');
    const crOnlyStart = text.lastIndexOf('\r');
    const insertionCharacter = text.indexOf('乙') + 1;

    expect([
      crlfStart,
      crlfStart + 1,
      crlfStart + 2,
      crOnlyStart,
      crOnlyStart + 1,
    ].map(position => canInsertLineBreak(draft, position))).toEqual([
      false,
      false,
      false,
      false,
      false,
    ]);

    const inserted = insertLineBreak(draft, insertionCharacter);
    expect(inserted.text).toBe('甲\r\n乙\n丁\r丙');
    expect(inserted.insertionPoints).toEqual([
      characterOffsetToUtf8Byte(text, insertionCharacter),
    ]);
    expect(inserted.chapters[0]!.contentRange).toEqual(utf8Range(0, total + 1));
  });

  it('命令按数组顺序投影 existing/new 章节、换行与永久正常标记', () => {
    const fixture = createFixture([
      { title: '第一章', body: '甲乙\n' },
      { body: '' },
    ]);
    const initial = createChapterStructureDraft(fixture.snapshot, fixture.text);
    const accepted = acceptChapterLengthAnomaly(initial, 'chapter-2');
    const inserted = insertLineBreak(accepted, fixture.text.indexOf('乙'));
    const draft = {
      ...inserted,
      chapters: [
        inserted.chapters[0]!,
        { ...inserted.chapters[1]!, draftId: 'draft-new', existingChapterId: undefined },
      ],
    };

    expect(buildUpdateChapterStructureCommand(draft)).toEqual({
      commandType: 'update-chapter-structure',
      baselineRevision: 7,
      insertionPoints: [characterOffsetToUtf8Byte(fixture.text, fixture.text.indexOf('乙'))],
      chapters: [
        {
          existingChapterId: 'chapter-1',
          title: '第一章',
          headingKind: 'source',
          headingRange: draft.chapters[0]!.headingRange,
          contentRange: draft.chapters[0]!.contentRange,
          lengthAnomalyAccepted: false,
        },
        {
          title: '未命名章节',
          headingKind: 'missing',
          contentRange: draft.chapters[1]!.contentRange,
          lengthAnomalyAccepted: true,
        },
      ],
      unassignedRanges: [],
    });
  });
});

interface FixtureBlock {
  readonly title?: string;
  readonly body: string;
}

function createLengthFixture(lengths: readonly number[]): ReturnType<typeof createFixture> {
  return createFixture(lengths.map((length, index) => ({
    title: `第${index + 1}章`,
    body: `${'字'.repeat(length)}\n`,
  })));
}

function createFixture(blocks: readonly FixtureBlock[]): {
  readonly snapshot: NovelImportReviewSnapshotDto;
  readonly text: string;
} {
  const pieces: string[] = [];
  const chapters: ChapterDto[] = [];
  let byteCursor = 0;
  for (const [index, block] of blocks.entries()) {
    const heading = block.title === undefined ? '' : `${block.title}\n`;
    const headingByteLength = encoder.encode(heading).byteLength;
    const bodyByteLength = encoder.encode(block.body).byteLength;
    const headingRange = block.title === undefined
      ? undefined
      : utf8Range(byteCursor, byteCursor + headingByteLength - 1);
    chapters.push({
      chapterId: `chapter-${index + 1}`,
      order: index + 1,
      title: block.title ?? '未命名章节',
      headingKind: block.title === undefined ? 'missing' : 'source',
      ...(headingRange === undefined ? {} : { headingRange }),
      contentRange: utf8Range(byteCursor + headingByteLength, byteCursor + headingByteLength + bodyByteLength),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    });
    pieces.push(heading, block.body);
    byteCursor += headingByteLength + bodyByteLength;
  }
  const text = pieces.join('');
  return { snapshot: snapshotForChapters(text, chapters), text };
}

function createBoundaryDraft(
  chapters: readonly ChapterDto[],
  text = 'x'.repeat(24),
) {
  return createChapterStructureDraft(snapshotForChapters(text, chapters), text);
}

function missingChapter(
  chapterId: string,
  startByte: number,
  endByte: number,
): ChapterDto {
  return {
    chapterId,
    order: Number(chapterId.split('-').at(-1) ?? 1),
    title: '未命名章节',
    headingKind: 'missing',
    contentRange: utf8Range(startByte, endByte),
    reviewStatus: 'pending',
    lengthAnomalyAccepted: false,
  };
}

function snapshotForChapters(
  text: string,
  chapters: readonly ChapterDto[],
): NovelImportReviewSnapshotDto {
  const textByteLength = encoder.encode(text).byteLength;
  return {
    revisionId: 'revision-7',
    baselineRevision: 7,
    source: {
      sourceAssetId: 'source-1',
      originalName: 'novel.txt',
      byteLength: textByteLength,
      sha256: 'a'.repeat(64),
    },
    encoding: 'utf-8',
    encodingMethod: 'strict-utf8',
    textByteLength,
    chapters,
    coverage: {
      totalByteLength: textByteLength,
      classifiedByteLength: textByteLength,
      unclassifiedByteLength: 0,
      complete: chapters.length > 0,
      segments: [],
      uncoveredRanges: chapters.length > 0 || textByteLength === 0
        ? []
        : [utf8Range(0, textByteLength)],
    },
    revisionHistory: [],
    reviewStatus: 'pending',
    createdAt: '2026-08-15T00:00:00.000Z',
  };
}

function utf8Range(startByte: number, endByte: number): Utf8TextRangeDto {
  return { offsetUnit: 'utf8-byte', startByte, endByte };
}
