import type {
  ChapterDto,
  NovelImportReviewSnapshotDto,
  Utf8TextRangeDto,
} from '@voxweaver/contracts';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { characterOffsetToUtf8Byte } from './chapterStructureDraftModel';
import { useChapterStructureDraft } from './useChapterStructureDraft';

const textIndexBuild = vi.hoisted(() => vi.fn());

vi.mock('./chapterStructureDraftModel', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./chapterStructureDraftModel')>();
  return {
    ...actual,
    createChapterTextIndex: (
      ...args: Parameters<typeof actual.createChapterTextIndex>
    ): ReturnType<typeof actual.createChapterTextIndex> => {
      textIndexBuild();
      return actual.createChapterTextIndex(...args);
    },
  };
});

const encoder = new TextEncoder();

describe('useChapterStructureDraft', () => {
  beforeEach(() => {
    textIndexBuild.mockClear();
  });

  it('以单一 readonly draft 派生 dirty、coverage、异常与命令', () => {
    const fixture = createFixture();
    const controller = useChapterStructureDraft();

    expect(controller.draft.value).toBeUndefined();
    expect(controller.dirty.value).toBe(false);
    expect(controller.operationCount.value).toBe(0);
    expect(controller.coverageComplete.value).toBe(false);
    expect(controller.command.value).toBeUndefined();

    controller.reset(fixture.snapshot, fixture.text);

    expect(controller.text.value).toBe(fixture.text);
    expect(controller.chapters.value).toHaveLength(2);
    expect(controller.dirty.value).toBe(false);
    expect(controller.coverageComplete.value).toBe(true);
    expect(controller.anomalies.value).toEqual([
      { chapterId: 'chapter-2', codePointCount: 0, kind: 'empty', reason: '无正文' },
    ]);
    expect(controller.command.value).toMatchObject({
      commandType: 'update-chapter-structure',
      baselineRevision: 4,
      insertionPoints: [],
    });
  });

  it('所有显式 action 只替换内部 draft，并累计未保存操作', () => {
    const fixture = createFixture();
    const controller = useChapterStructureDraft();
    controller.reset(fixture.snapshot, fixture.text);
    const initial = controller.draft.value;

    controller.acceptChapterLengthAnomaly('chapter-2');
    expect(controller.draft.value).not.toBe(initial);
    expect(controller.anomalies.value).toEqual([]);
    expect(controller.operationCount.value).toBe(1);

    const insertAt = fixture.text.indexOf('乙');
    controller.insertLineBreak(insertAt);
    expect(controller.text.value).toContain('甲\n乙');
    expect(controller.command.value?.insertionPoints).toEqual([
      characterOffsetToUtf8Byte(fixture.text, insertAt),
    ]);
    expect(controller.operationCount.value).toBe(2);

    controller.deleteChapterRecognition('chapter-2');
    expect(controller.chapters.value).toHaveLength(1);
    expect(controller.unassignedRanges.value).toHaveLength(1);
    expect(controller.coverageComplete.value).toBe(false);
    expect(controller.dirty.value).toBe(true);
    expect(controller.operationCount.value).toBe(3);

    controller.reset(fixture.snapshot, fixture.text);
    expect(controller.dirty.value).toBe(false);
    expect(controller.operationCount.value).toBe(0);
    expect(controller.coverageComplete.value).toBe(true);
  });

  it('新增、范围更新与合并 action 统一进入同一 draft', () => {
    const text = '第一章\n旧正文\n第二章：新章\n新正文\n';
    const firstHeadingEnd = encoder.encode('第一章').byteLength;
    const snapshot = snapshotFor(text, [{
      chapterId: 'chapter-1',
      order: 1,
      title: '第一章',
      headingKind: 'source',
      headingRange: utf8Range(0, firstHeadingEnd),
      contentRange: utf8Range(firstHeadingEnd + 1, encoder.encode(text).byteLength),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    }]);
    const controller = useChapterStructureDraft();
    controller.reset(snapshot, text);

    controller.addChapterRecognition(text.indexOf('第二章') + 1);
    expect(controller.chapters.value.map(chapter => chapter.title)).toEqual([
      '第一章',
      '第二章：新章',
    ]);
    expect(controller.operationCount.value).toBe(1);

    const first = controller.chapters.value[0]!;
    controller.updateChapterRanges([{
      chapterId: first.draftId,
      contentRange: first.contentRange,
    }]);
    expect(controller.operationCount.value).toBe(1);

    controller.mergeChapter(controller.chapters.value[1]!.draftId, 'previous');
    expect(controller.chapters.value).toHaveLength(1);
    expect(controller.operationCount.value).toBe(2);
    expect(controller.command.value?.chapters).toHaveLength(1);
  });

  it('语义边界编辑保留用户期望，命令只投影有效范围，失败不丢草稿', () => {
    const fixture = createFixture();
    const controller = useChapterStructureDraft();
    controller.reset(fixture.snapshot, fixture.text);
    const desiredSecondStart = characterOffsetToUtf8Byte(
      fixture.text,
      fixture.text.indexOf('乙'),
    );

    controller.applyChapterBoundaryEdit({
      chapterId: 'chapter-2',
      boundary: 'chapter-start',
      byteOffset: desiredSecondStart,
    });
    expect(controller.chapters.value[0]!.contentRange.endByte).toBe(desiredSecondStart);
    expect(controller.chapters.value[0]!.boundaryPreference?.contentRange.endByte)
      .toBe(characterOffsetToUtf8Byte(fixture.text, fixture.text.indexOf('第二章')));
    expect(controller.command.value?.chapters[0]!.contentRange.endByte)
      .toBe(desiredSecondStart);
    expect(controller.operationCount.value).toBe(1);

    const conflictedDraft = controller.draft.value;
    const protectedStart = controller.chapters.value[1]!.protectedHeadingStartByte!;
    expect(() => controller.applyChapterBoundaryEdit({
      chapterId: 'chapter-1',
      boundary: 'content-end',
      byteOffset: protectedStart + 1,
    })).toThrow('来源标题');
    expect(controller.draft.value).toBe(conflictedDraft);
    expect(controller.operationCount.value).toBe(1);

    controller.reset(fixture.snapshot, fixture.text);
    expect(controller.operationCount.value).toBe(0);
    expect(controller.chapters.value[0]!.boundaryPreference?.contentRange)
      .toEqual(controller.chapters.value[0]!.contentRange);
    expect(controller.draft.value?.boundaryPriorities).toEqual([]);
  });

  it('结构与正常标记复用文本索引，仅 reset 和正文换行重建', () => {
    const fixture = createFixture();
    const controller = useChapterStructureDraft();

    controller.reset(fixture.snapshot, fixture.text);
    expect(textIndexBuild).toHaveBeenCalledTimes(1);

    controller.acceptChapterLengthAnomaly('chapter-2');
    expect(controller.anomalies.value).toEqual([]);
    expect(textIndexBuild).toHaveBeenCalledTimes(1);

    controller.deleteChapterRecognition('chapter-2');
    expect(controller.unassignedRanges.value).toHaveLength(1);
    expect(controller.anomalies.value).toEqual([]);
    expect(textIndexBuild).toHaveBeenCalledTimes(1);

    controller.addChapterRecognition(fixture.text.indexOf('第二章') + 1);
    expect(controller.chapters.value).toHaveLength(2);
    expect(textIndexBuild).toHaveBeenCalledTimes(1);

    const first = controller.chapters.value[0]!;
    controller.updateChapterRanges([{
      chapterId: first.draftId,
      contentRange: first.contentRange,
    }]);
    expect(textIndexBuild).toHaveBeenCalledTimes(1);

    controller.mergeChapter(controller.chapters.value[1]!.draftId, 'previous');
    expect(controller.chapters.value).toHaveLength(1);
    expect(textIndexBuild).toHaveBeenCalledTimes(1);

    controller.insertLineBreak(fixture.text.indexOf('乙'));
    expect(controller.text.value).toContain('甲\n乙');
    expect(textIndexBuild).toHaveBeenCalledTimes(2);
  });

  it('clear 与未初始化 action 行为显式', () => {
    const fixture = createFixture();
    const controller = useChapterStructureDraft();

    expect(() => controller.deleteChapterRecognition('chapter-1')).toThrow('尚未初始化');
    controller.reset(fixture.snapshot, fixture.text);
    controller.clear();

    expect(controller.draft.value).toBeUndefined();
    expect(controller.text.value).toBe('');
    expect(controller.chapters.value).toEqual([]);
    expect(controller.command.value).toBeUndefined();
  });
});

function createFixture(): {
  readonly snapshot: NovelImportReviewSnapshotDto;
  readonly text: string;
} {
  const text = '第一章\n甲乙\n第二章\n';
  const firstHeadingEnd = encoder.encode('第一章').byteLength;
  const secondHeadingStart = encoder.encode('第一章\n甲乙\n').byteLength;
  const secondHeadingEnd = encoder.encode('第一章\n甲乙\n第二章').byteLength;
  const chapters: readonly ChapterDto[] = [
    {
      chapterId: 'chapter-1',
      order: 1,
      title: '第一章',
      headingKind: 'source',
      headingRange: utf8Range(0, firstHeadingEnd),
      contentRange: utf8Range(firstHeadingEnd + 1, secondHeadingStart),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    },
    {
      chapterId: 'chapter-2',
      order: 2,
      title: '第二章',
      headingKind: 'source',
      headingRange: utf8Range(secondHeadingStart, secondHeadingEnd),
      contentRange: utf8Range(secondHeadingEnd + 1, encoder.encode(text).byteLength),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    },
  ];
  return { snapshot: snapshotFor(text, chapters), text };
}

function snapshotFor(
  text: string,
  chapters: readonly ChapterDto[],
): NovelImportReviewSnapshotDto {
  const textByteLength = encoder.encode(text).byteLength;
  return {
    revisionId: 'revision-4',
    baselineRevision: 4,
    source: {
      sourceAssetId: 'source-1',
      originalName: 'novel.txt',
      byteLength: textByteLength,
      sha256: 'b'.repeat(64),
    },
    encoding: 'utf-8',
    encodingMethod: 'strict-utf8',
    textByteLength,
    chapters,
    coverage: {
      totalByteLength: textByteLength,
      classifiedByteLength: textByteLength,
      unclassifiedByteLength: 0,
      complete: true,
      segments: [],
      uncoveredRanges: [],
    },
    revisionHistory: [],
    reviewStatus: 'pending',
    createdAt: '2026-08-15T00:00:00.000Z',
  };
}

function utf8Range(startByte: number, endByte: number): Utf8TextRangeDto {
  return { offsetUnit: 'utf8-byte', startByte, endByte };
}
