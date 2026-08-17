import type { ChapterDto } from '@voxweaver/contracts';

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createChapterCoverage } from './index.ts';

test('coverage assigns gaps to the next chapter and the trailing range to the last chapter', () => {
  const chapters: readonly ChapterDto[] = [
    chapter('chapter-1', 1, 10, 20, 20, 40),
    chapter('chapter-2', 2, 50, 60, 60, 80),
  ];

  const coverage = createChapterCoverage(100, chapters);

  assert.equal(coverage.complete, true);
  assert.equal(coverage.classifiedByteLength, 100);
  assert.equal(coverage.unclassifiedByteLength, 0);
  assert.deepEqual(coverage.uncoveredRanges, []);
  assert.deepEqual(coverage.segments, [
    segment(0, 10, 'chapter-1', 'uncovered-to-next'),
    segment(10, 40, 'chapter-1'),
    segment(40, 50, 'chapter-2', 'uncovered-to-next'),
    segment(50, 80, 'chapter-2'),
    segment(80, 100, 'chapter-2', 'uncovered-to-last'),
  ]);
});

test('coverage supports a missing heading and a zero-length chapter body', () => {
  const chapters: readonly ChapterDto[] = [
    {
      chapterId: 'chapter-1',
      order: 1,
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: range(5, 5),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    },
    chapter('chapter-2', 2, 5, 8, 8, 12),
  ];

  const coverage = createChapterCoverage(12, chapters);

  assert.equal(coverage.complete, true);
  assert.deepEqual(coverage.segments, [
    segment(0, 5, 'chapter-1', 'uncovered-to-next'),
    segment(5, 12, 'chapter-2'),
  ]);
});

test('explicit unassigned ranges remain unknown instead of being assigned to adjacent chapters', () => {
  const chapters: readonly ChapterDto[] = [
    chapter('chapter-1', 1, 0, 2, 2, 5),
    {
      chapterId: 'chapter-2',
      order: 2,
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: range(8, 12),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    },
  ];
  const unassigned = [range(5, 8)];

  const coverage = createChapterCoverage(12, chapters, unassigned);

  assert.equal(coverage.complete, false);
  assert.equal(coverage.classifiedByteLength, 9);
  assert.equal(coverage.unclassifiedByteLength, 3);
  assert.deepEqual(coverage.segments, [
    segment(0, 5, 'chapter-1'),
    { classification: 'unknown', range: range(5, 8) },
    segment(8, 12, 'chapter-2'),
  ]);
  assert.deepEqual(coverage.uncoveredRanges, unassigned);
});

test('explicit coverage omits a zero-length missing chapter segment', () => {
  const chapters: readonly ChapterDto[] = [
    {
      chapterId: 'chapter-empty',
      order: 1,
      title: '未命名章节',
      headingKind: 'missing',
      contentRange: range(0, 0),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    },
    chapter('chapter-2', 2, 0, 2, 2, 5),
  ];

  const coverage = createChapterCoverage(5, chapters, []);

  assert.equal(coverage.complete, true);
  assert.deepEqual(coverage.segments, [segment(0, 5, 'chapter-2')]);
  assert.deepEqual(coverage.uncoveredRanges, []);
});

test('explicit unassigned ranges split inherited leading, inter-chapter, and trailing ownership', () => {
  const chapters: readonly ChapterDto[] = [
    chapter('chapter-1', 1, 2, 3, 5, 6),
    chapter('chapter-2', 2, 10, 11, 12, 14),
  ];
  const unassigned = [range(0, 1), range(7, 9), range(15, 16)];

  const coverage = createChapterCoverage(16, chapters, unassigned);

  assert.equal(coverage.classifiedByteLength, 12);
  assert.equal(coverage.unclassifiedByteLength, 4);
  assert.deepEqual(coverage.uncoveredRanges, unassigned);
  assert.equal(coverage.segments[0]?.range.startByte, 0);
  assert.equal(coverage.segments.at(-1)?.range.endByte, 16);
  for (let index = 1; index < coverage.segments.length; index += 1) {
    assert.equal(
      coverage.segments[index - 1]?.range.endByte,
      coverage.segments[index]?.range.startByte,
    );
  }
});

function chapter(
  chapterId: string,
  order: number,
  headingStartByte: number,
  headingEndByte: number,
  contentStartByte: number,
  contentEndByte: number,
): ChapterDto {
  return {
    chapterId,
    order,
    title: chapterId,
    headingKind: 'source',
    headingRange: range(headingStartByte, headingEndByte),
    contentRange: range(contentStartByte, contentEndByte),
    reviewStatus: 'pending',
    lengthAnomalyAccepted: false,
  };
}

function segment(
  startByte: number,
  endByte: number,
  chapterId: string,
  reason?: 'uncovered-to-next' | 'uncovered-to-last',
) {
  return {
    classification: 'chapter' as const,
    range: range(startByte, endByte),
    chapterId,
    ...(reason ? { reason } : {}),
  };
}

function range(startByte: number, endByte: number) {
  return { offsetUnit: 'utf8-byte' as const, startByte, endByte };
}
