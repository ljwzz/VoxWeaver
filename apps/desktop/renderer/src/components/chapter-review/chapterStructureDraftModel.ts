import type {
  ChapterDto,
  NovelImportReviewSnapshotDto,
  UpdateChapterStructureCommandInput,
  Utf8TextRangeDto,
} from '@voxweaver/contracts';
import type { ChapterBoundaryEdit } from './chapterReviewModel';

import { detectChapterHeadingLine } from '@voxweaver/novel-import/chapter-heading';
import { CHAPTER_LENGTH_ANOMALY_CONFIG } from './chapterLengthAnomalyConfig';

export type ChapterLengthAnomalyKind = 'empty' | 'short' | 'long';
export type ChapterMergeDirection = 'previous' | 'next';
export type ChapterBoundaryPrioritySide = 'next-chapter-start' | 'previous-content-end';

export interface ChapterBoundaryPreference {
  readonly headingRange?: Utf8TextRangeDto | undefined;
  readonly contentRange: Utf8TextRangeDto;
}

export interface ChapterBoundaryPriority {
  readonly nextChapterId: string;
  readonly previousChapterId: string;
  readonly side: ChapterBoundaryPrioritySide;
}

export interface ChapterStructureDraftChapter {
  readonly draftId: string;
  readonly existingChapterId?: string | undefined;
  readonly title: string;
  readonly headingKind: ChapterDto['headingKind'];
  readonly headingRange?: Utf8TextRangeDto | undefined;
  readonly contentRange: Utf8TextRangeDto;
  readonly lengthAnomalyAccepted: boolean;
  readonly boundaryPreference?: ChapterBoundaryPreference;
  readonly protectedHeadingStartByte?: number | undefined;
}

export interface ChapterStructureDraft {
  readonly baselineRevision: number;
  readonly baselineText: string;
  readonly text: string;
  readonly insertionPoints: readonly number[];
  readonly chapters: readonly ChapterStructureDraftChapter[];
  readonly boundaryPriorities: readonly ChapterBoundaryPriority[];
  readonly unassignedRanges: readonly Utf8TextRangeDto[];
  readonly operationCount: number;
}

export interface ChapterLengthAnomaly {
  readonly chapterId: string;
  readonly codePointCount: number;
  readonly kind: ChapterLengthAnomalyKind;
  readonly reason: string;
}

export interface ChapterCoverageSegment {
  readonly chapterId?: string;
  readonly classification: 'chapter' | 'unknown';
  readonly range: Utf8TextRangeDto;
}

export interface ChapterRangeUpdate {
  readonly chapterId: string;
  readonly headingRange?: Utf8TextRangeDto | undefined;
  readonly contentRange?: Utf8TextRangeDto;
}

const whitespacePattern = /^\p{White_Space}$/u;
export const CHAPTER_TEXT_INDEX_CHECKPOINT_STRIDE = 256;

export interface ChapterTextIndex {
  readonly text: string;
  readonly byteLength: number;
  readonly checkpointByteOffsets: Float64Array;
  readonly checkpointCharacterOffsets: Float64Array;
  readonly checkpointNonWhitespaceCounts: Float64Array;
}

export function createChapterStructureDraft(
  snapshot: NovelImportReviewSnapshotDto,
  text: string,
  textIndex: ChapterTextIndex = createChapterTextIndex(text),
): ChapterStructureDraft {
  assertTextIndex(textIndex, text);
  assertTextByteLength(textIndex, snapshot.textByteLength);
  return {
    baselineRevision: snapshot.baselineRevision,
    baselineText: text,
    text,
    insertionPoints: [],
    chapters: snapshot.chapters.map(chapter => initializeChapterBoundaryState({
      draftId: chapter.chapterId,
      existingChapterId: chapter.chapterId,
      title: chapter.title,
      headingKind: chapter.headingKind,
      headingRange: chapter.headingRange,
      contentRange: chapter.contentRange,
      lengthAnomalyAccepted: chapter.lengthAnomalyAccepted,
    })),
    boundaryPriorities: [],
    unassignedRanges: normalizeRanges(snapshot.coverage.uncoveredRanges),
    operationCount: 0,
  };
}

export function buildUpdateChapterStructureCommand(
  draft: ChapterStructureDraft,
): UpdateChapterStructureCommandInput {
  return {
    commandType: 'update-chapter-structure',
    baselineRevision: draft.baselineRevision,
    insertionPoints: draft.insertionPoints,
    chapters: draft.chapters.map(chapter => ({
      ...(chapter.existingChapterId === undefined
        ? {}
        : { existingChapterId: chapter.existingChapterId }),
      title: chapter.title,
      headingKind: chapter.headingKind,
      ...(chapter.headingRange === undefined ? {} : { headingRange: chapter.headingRange }),
      contentRange: chapter.contentRange,
      lengthAnomalyAccepted: chapter.lengthAnomalyAccepted,
    })),
    unassignedRanges: draft.unassignedRanges,
  };
}

export function characterOffsetToUtf8Byte(
  text: string,
  characterOffset: number,
  textIndex: ChapterTextIndex = createChapterTextIndex(text),
): number {
  assertTextIndex(textIndex, text);
  try {
    return indexedPositionAtCharacter(textIndex, characterOffset).byteOffset;
  } catch {
    throw new RangeError(`字符位置 ${characterOffset} 不是有效的 Unicode 字符间隙。`);
  }
}

export function utf8ByteOffsetToCharacter(
  text: string,
  byteOffset: number,
  textIndex: ChapterTextIndex = createChapterTextIndex(text),
): number {
  assertTextIndex(textIndex, text);
  try {
    return indexedPositionAtByte(textIndex, byteOffset).characterOffset;
  } catch {
    throw new RangeError(`UTF-8 字节位置 ${byteOffset} 不是有效的字符边界。`);
  }
}

export function countNonWhitespaceCodePoints(text: string): number {
  let count = 0;
  for (const codePoint of text) {
    if (!whitespacePattern.test(codePoint))
      count += 1;
  }
  return count;
}

export function createChapterCoverageSegments(
  draft: ChapterStructureDraft,
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
): readonly ChapterCoverageSegment[] {
  assertTextIndex(textIndex, draft.text);
  const maximum = textIndex.byteLength;
  if (draft.chapters.length === 0) {
    return maximum === 0
      ? []
      : [{ classification: 'unknown', range: range(0, maximum) }];
  }

  const unknownRanges = normalizeRanges(draft.unassignedRanges);
  const segments: ChapterCoverageSegment[] = unknownRanges.map(unassigned => ({
    classification: 'unknown',
    range: unassigned,
  }));
  for (const [index, chapter] of draft.chapters.entries()) {
    const startByte = draft.chapters[index - 1]?.contentRange.endByte ?? 0;
    const endByte = index === draft.chapters.length - 1
      ? maximum
      : chapter.contentRange.endByte;
    assertRangeBounds(startByte, endByte, maximum, '章节归属');
    const assignedRanges = subtractNormalizedRanges(range(startByte, endByte), unknownRanges);
    segments.push(...assignedRanges.map(assigned => ({
      chapterId: chapter.draftId,
      classification: 'chapter' as const,
      range: assigned,
    })));
  }
  return segments.sort((left, right) => (
    left.range.startByte - right.range.startByte
    || left.range.endByte - right.range.endByte
    || left.classification.localeCompare(right.classification)
  ));
}

export function calculateChapterBodyLengths(
  draft: ChapterStructureDraft,
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
  coverageSegments: readonly ChapterCoverageSegment[] = createChapterCoverageSegments(
    draft,
    textIndex,
  ),
): ReadonlyMap<string, number> {
  assertTextIndex(textIndex, draft.text);
  const lengths = new Map(draft.chapters.map(chapter => [chapter.draftId, 0]));
  const chaptersById = new Map(draft.chapters.map(chapter => [chapter.draftId, chapter]));
  for (const segment of coverageSegments) {
    if (segment.classification !== 'chapter' || !segment.chapterId)
      continue;
    const chapter = chaptersById.get(segment.chapterId);
    if (!chapter)
      continue;
    const bodyRanges = chapter.headingRange
      ? subtractRanges(segment.range, [chapter.headingRange])
      : [segment.range];
    let length = lengths.get(chapter.draftId) ?? 0;
    for (const bodyRange of bodyRanges) {
      length += countIndexedNonWhitespaceCodePoints(textIndex, bodyRange);
    }
    lengths.set(chapter.draftId, length);
  }
  return lengths;
}

export function calculateChapterLengthAnomalies(
  draft: ChapterStructureDraft,
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
  lengths: ReadonlyMap<string, number> = calculateChapterBodyLengths(draft, textIndex),
): readonly ChapterLengthAnomaly[] {
  assertTextIndex(textIndex, draft.text);
  const orderedLengths = draft.chapters.map(chapter => lengths.get(chapter.draftId) ?? 0);

  return draft.chapters.flatMap((chapter, chapterIndex): ChapterLengthAnomaly[] => {
    if (chapter.lengthAnomalyAccepted)
      return [];
    const codePointCount = orderedLengths[chapterIndex] ?? 0;
    if (codePointCount === 0) {
      return [{
        chapterId: chapter.draftId,
        codePointCount,
        kind: 'empty',
        reason: '无正文',
      }];
    }
    const globalAnomalyKind = globalChapterLengthAnomalyKind(
      orderedLengths,
      codePointCount,
    );
    const localAnomalyKind = localChapterLengthAnomalyKind(
      orderedLengths,
      chapterIndex,
      codePointCount,
    );
    const anomalyKind = globalAnomalyKind === localAnomalyKind
      ? globalAnomalyKind
      : undefined;
    if (anomalyKind === 'short') {
      return [{
        chapterId: chapter.draftId,
        codePointCount,
        kind: 'short',
        reason: `偏短 · ${codePointCount} 字`,
      }];
    }
    if (anomalyKind === 'long') {
      return [{
        chapterId: chapter.draftId,
        codePointCount,
        kind: 'long',
        reason: `偏长 · ${codePointCount} 字`,
      }];
    }
    return [];
  });
}

function globalChapterLengthAnomalyKind(
  orderedLengths: readonly number[],
  codePointCount: number,
): Exclude<ChapterLengthAnomalyKind, 'empty'> | undefined {
  const sortedLengths = orderedLengths
    .filter(length => length > 0)
    .sort((left, right) => left - right);
  if (sortedLengths.length < CHAPTER_LENGTH_ANOMALY_CONFIG.minimumSampleCount)
    return undefined;

  const lowerQuartile = interpolatedQuantile(sortedLengths, 0.25);
  const upperQuartile = interpolatedQuantile(sortedLengths, 0.75);
  const interquartileRange = upperQuartile - lowerQuartile;
  const fence = CHAPTER_LENGTH_ANOMALY_CONFIG.iqrFenceMultiplier * interquartileRange;
  if (codePointCount < lowerQuartile - fence)
    return 'short';
  if (codePointCount > upperQuartile + fence)
    return 'long';
  return undefined;
}

function localChapterLengthAnomalyKind(
  orderedLengths: readonly number[],
  chapterIndex: number,
  codePointCount: number,
): Exclude<ChapterLengthAnomalyKind, 'empty'> | undefined {
  const { windowRadius, minimumSampleCount } = CHAPTER_LENGTH_ANOMALY_CONFIG;
  const windowStart = Math.max(0, chapterIndex - windowRadius);
  const windowEnd = Math.min(orderedLengths.length, chapterIndex + windowRadius + 1);
  const logarithmicLengths = orderedLengths
    .slice(windowStart, windowEnd)
    .filter(length => length > 0)
    .map(Math.log);
  if (logarithmicLengths.length < minimumSampleCount)
    return undefined;

  const localMedian = median(logarithmicLengths);
  const medianAbsoluteDeviation = median(
    logarithmicLengths.map(length => Math.abs(length - localMedian)),
  );
  const statisticalThreshold = CHAPTER_LENGTH_ANOMALY_CONFIG.madThreshold
    * CHAPTER_LENGTH_ANOMALY_CONFIG.madConsistencyScale
    * medianAbsoluteDeviation;
  const minimumThreshold = Math.log(CHAPTER_LENGTH_ANOMALY_CONFIG.minimumRatio);
  const deviation = Math.log(codePointCount) - localMedian;
  const threshold = Math.max(statisticalThreshold, minimumThreshold);
  if (deviation < -threshold)
    return 'short';
  if (deviation > threshold)
    return 'long';
  return undefined;
}

function interpolatedQuantile(
  sortedValues: readonly number[],
  probability: 0.25 | 0.75,
): number {
  if (sortedValues.length === 0)
    throw new RangeError('分位数样本不能为空。');
  const rank = (sortedValues.length + 1) * probability;
  if (rank <= 1)
    return sortedValues[0]!;
  if (rank >= sortedValues.length)
    return sortedValues.at(-1)!;
  const lowerRank = Math.floor(rank);
  const fraction = rank - lowerRank;
  const lower = sortedValues[lowerRank - 1]!;
  const upper = sortedValues[lowerRank]!;
  return lower + fraction * (upper - lower);
}

function median(values: readonly number[]): number {
  if (values.length === 0)
    throw new RangeError('中位数样本不能为空。');
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1)
    return sorted[middle]!;
  return (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function displayChapterTitle(
  chapter: ChapterStructureDraftChapter,
  chapters: readonly ChapterStructureDraftChapter[],
): string {
  if (chapter.headingKind === 'source')
    return chapter.title;
  const index = chapters.findIndex(candidate => candidate.draftId === chapter.draftId);
  const unnamedOrder = chapters
    .slice(0, index < 0 ? chapters.length : index + 1)
    .filter(candidate => candidate.headingKind === 'missing')
    .length;
  return `未命名章节 ${Math.max(1, unnamedOrder)}`;
}

export function updateChapterRanges(
  draft: ChapterStructureDraft,
  updates: readonly ChapterRangeUpdate[],
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
): ChapterStructureDraft {
  if (updates.length === 0)
    return draft;
  const updatesById = new Map<string, ChapterRangeUpdate>();
  for (const update of updates) {
    if (updatesById.has(update.chapterId))
      throw new RangeError(`章节 ${update.chapterId} 的范围不能重复更新。`);
    if (!draft.chapters.some(chapter => chapter.draftId === update.chapterId))
      throw new RangeError(`找不到章节 ${update.chapterId}。`);
    updatesById.set(update.chapterId, update);
  }
  let changed = false;
  const chapters = draft.chapters.map((chapter) => {
    const update = updatesById.get(chapter.draftId);
    if (!update)
      return chapter;
    const headingRange = Object.hasOwn(update, 'headingRange')
      ? update.headingRange
      : chapter.headingRange;
    const contentRange = update.contentRange ?? chapter.contentRange;
    changed ||= !sameOptionalRange(chapter.headingRange, headingRange)
      || !sameRange(chapter.contentRange, contentRange);
    const preference = chapterBoundaryPreference(chapter);
    return {
      ...chapter,
      headingRange,
      contentRange,
      boundaryPreference: {
        headingRange: Object.hasOwn(update, 'headingRange')
          ? headingRange
          : preference.headingRange,
        contentRange: update.contentRange ?? preference.contentRange,
      },
    };
  });
  if (!changed)
    return draft;
  assertTextIndex(textIndex, draft.text);
  assertValidChapterRanges(textIndex, chapters);
  const unassignedRanges = reconcileFirstChapterUpperBoundary(
    draft.chapters,
    chapters,
    draft.unassignedRanges,
  );
  if (chaptersOverlapUnassignedRanges(chapters, unassignedRanges)) {
    throw new RangeError('章节边界不能进入显式未归属范围，请先重新识别该段正文。');
  }
  return {
    ...draft,
    chapters,
    boundaryPriorities: retainAdjacentBoundaryPriorities(
      draft.boundaryPriorities,
      chapters,
    ),
    unassignedRanges,
    operationCount: draft.operationCount + 1,
  };
}

export function chapterRangeUpdatesCanApply(
  chapters: readonly ChapterStructureDraftChapter[],
  unassignedRanges: readonly Utf8TextRangeDto[],
  updates: readonly ChapterRangeUpdate[],
): boolean {
  const updatesById = new Map<string, ChapterRangeUpdate>();
  for (const update of updates) {
    if (updatesById.has(update.chapterId)
      || !chapters.some(chapter => chapter.draftId === update.chapterId)) {
      return false;
    }
    updatesById.set(update.chapterId, update);
  }
  const projected = chapters.map((chapter) => {
    const update = updatesById.get(chapter.draftId);
    if (!update)
      return chapter;
    return {
      ...chapter,
      headingRange: Object.hasOwn(update, 'headingRange')
        ? update.headingRange
        : chapter.headingRange,
      contentRange: update.contentRange ?? chapter.contentRange,
    };
  });
  const projectedUnassigned = reconcileFirstChapterUpperBoundary(
    chapters,
    projected,
    unassignedRanges,
  );
  return !chaptersOverlapUnassignedRanges(projected, projectedUnassigned);
}

export function applyChapterBoundaryEdit(
  draft: ChapterStructureDraft,
  edit: ChapterBoundaryEdit,
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
): ChapterStructureDraft {
  assertTextIndex(textIndex, draft.text);
  const chapters = projectChapterBoundaryEdit(
    draft.chapters,
    draft.unassignedRanges,
    edit,
    textIndex.byteLength,
  );
  assertValidChapterRanges(textIndex, chapters);
  assertValidChapterBoundaryState(textIndex, chapters);

  const chapterIndex = draft.chapters.findIndex(chapter => chapter.draftId === edit.chapterId);
  const priority = boundaryPriorityForEdit(draft.chapters, chapterIndex, edit.boundary);
  const boundaryPriorities = priority
    ? replaceBoundaryPriority(draft.boundaryPriorities, priority)
    : draft.boundaryPriorities;
  const chaptersChanged = chapters.some((chapter, index) => (
    !sameChapterBoundaryState(chapter, draft.chapters[index]!)
  ));
  const prioritiesChanged = !sameBoundaryPriorities(
    boundaryPriorities,
    draft.boundaryPriorities,
  );
  if (!chaptersChanged && !prioritiesChanged)
    return draft;

  return {
    ...draft,
    chapters,
    boundaryPriorities,
    operationCount: draft.operationCount + 1,
  };
}

export function chapterBoundaryEditCanApply(
  chapters: readonly ChapterStructureDraftChapter[],
  unassignedRanges: readonly Utf8TextRangeDto[],
  edit: ChapterBoundaryEdit,
  textByteLength: number,
): boolean {
  try {
    projectChapterBoundaryEdit(chapters, unassignedRanges, edit, textByteLength);
    return true;
  } catch {
    return false;
  }
}

export function projectChapterBoundaryEdit(
  chapters: readonly ChapterStructureDraftChapter[],
  unassignedRanges: readonly Utf8TextRangeDto[],
  edit: ChapterBoundaryEdit,
  textByteLength: number,
): readonly ChapterStructureDraftChapter[] {
  if (!Number.isSafeInteger(edit.byteOffset)
    || edit.byteOffset < 0
    || edit.byteOffset > textByteLength) {
    throw new RangeError(`章节边界位置无效：${edit.byteOffset}。`);
  }
  const chapterIndex = chapters.findIndex(chapter => chapter.draftId === edit.chapterId);
  if (chapterIndex < 0)
    throw new RangeError(`找不到章节 ${edit.chapterId}。`);

  const projected = [...chapters];
  const chapter = chapters[chapterIndex]!;
  const preference = chapterBoundaryPreference(chapter);
  if (edit.boundary === 'chapter-start') {
    projected[chapterIndex] = setDesiredAndEffectiveChapterStart(
      chapter,
      preference,
      edit.byteOffset,
    );
    const previous = chapters[chapterIndex - 1];
    if (previous) {
      const previousPreference = chapterBoundaryPreference(previous);
      projected[chapterIndex - 1] = setEffectiveContentEnd(
        previous,
        Math.min(previousPreference.contentRange.endByte, edit.byteOffset),
      );
    }
  } else {
    projected[chapterIndex] = setDesiredAndEffectiveContentEnd(
      chapter,
      preference,
      edit.byteOffset,
    );
    const next = chapters[chapterIndex + 1];
    if (next) {
      const desiredNextStart = chapterStartByte(chapterBoundaryPreference(next));
      const effectiveNextStart = Math.max(desiredNextStart, edit.byteOffset);
      assertProtectedChapterStart(next, effectiveNextStart);
      projected[chapterIndex + 1] = setEffectiveChapterStart(next, effectiveNextStart);
    }
  }

  assertProjectableChapterRanges(projected, textByteLength);
  if (chaptersOverlapUnassignedRanges(projected, unassignedRanges)) {
    throw new RangeError('章节边界不能进入显式未归属范围，请先重新识别该段正文。');
  }
  return projected;
}

function initializeChapterBoundaryState(
  chapter: ChapterStructureDraftChapter,
): ChapterStructureDraftChapter {
  return {
    ...chapter,
    boundaryPreference: {
      headingRange: chapter.headingRange,
      contentRange: chapter.contentRange,
    },
    protectedHeadingStartByte: chapter.headingKind === 'source'
      ? chapter.headingRange?.startByte
      : undefined,
  };
}

function chapterBoundaryPreference(
  chapter: ChapterStructureDraftChapter,
): ChapterBoundaryPreference {
  return chapter.boundaryPreference ?? {
    headingRange: chapter.headingRange,
    contentRange: chapter.contentRange,
  };
}

function chapterStartByte(preference: ChapterBoundaryPreference): number {
  return preference.headingRange?.startByte ?? preference.contentRange.startByte;
}

function setDesiredAndEffectiveChapterStart(
  chapter: ChapterStructureDraftChapter,
  preference: ChapterBoundaryPreference,
  startByte: number,
): ChapterStructureDraftChapter {
  assertProtectedChapterStart(chapter, startByte);
  if (chapter.headingKind === 'source') {
    if (!chapter.headingRange || !preference.headingRange)
      throw new RangeError('来源标题章必须包含标题范围。');
    return {
      ...chapter,
      headingRange: range(startByte, chapter.headingRange.endByte),
      boundaryPreference: {
        headingRange: range(startByte, preference.headingRange.endByte),
        contentRange: preference.contentRange,
      },
    };
  }
  return {
    ...chapter,
    contentRange: range(startByte, chapter.contentRange.endByte),
    boundaryPreference: {
      contentRange: range(startByte, preference.contentRange.endByte),
    },
  };
}

function setDesiredAndEffectiveContentEnd(
  chapter: ChapterStructureDraftChapter,
  preference: ChapterBoundaryPreference,
  endByte: number,
): ChapterStructureDraftChapter {
  return {
    ...chapter,
    contentRange: range(chapter.contentRange.startByte, endByte),
    boundaryPreference: {
      headingRange: preference.headingRange,
      contentRange: range(preference.contentRange.startByte, endByte),
    },
  };
}

function setEffectiveChapterStart(
  chapter: ChapterStructureDraftChapter,
  startByte: number,
): ChapterStructureDraftChapter {
  if (chapter.headingKind === 'source') {
    if (!chapter.headingRange)
      throw new RangeError('来源标题章必须包含标题范围。');
    return {
      ...chapter,
      headingRange: range(startByte, chapter.headingRange.endByte),
    };
  }
  return {
    ...chapter,
    contentRange: range(startByte, chapter.contentRange.endByte),
  };
}

function setEffectiveContentEnd(
  chapter: ChapterStructureDraftChapter,
  endByte: number,
): ChapterStructureDraftChapter {
  return {
    ...chapter,
    contentRange: range(chapter.contentRange.startByte, endByte),
  };
}

function assertProtectedChapterStart(
  chapter: ChapterStructureDraftChapter,
  startByte: number,
): void {
  if (chapter.headingKind === 'source') {
    const headingRange = chapter.headingRange
      ?? chapterBoundaryPreference(chapter).headingRange;
    const protectedStartByte = chapter.protectedHeadingStartByte
      ?? headingRange?.startByte;
    if (!headingRange || protectedStartByte === undefined)
      throw new RangeError('来源标题章必须包含标题范围。');
    if (startByte > protectedStartByte)
      throw new RangeError('正文末端不能吞掉下一章的来源标题。');
    if (startByte >= headingRange.endByte)
      throw new RangeError('章节标题范围不能为空。');
    return;
  }
  if (startByte > chapter.contentRange.endByte)
    throw new RangeError('正文末端不能级联吞并后续章节。');
}

function assertProjectableChapterRanges(
  chapters: readonly ChapterStructureDraftChapter[],
  maximum: number,
): void {
  for (const [chapterIndex, chapter] of chapters.entries()) {
    assertRangeBounds(
      chapter.contentRange.startByte,
      chapter.contentRange.endByte,
      maximum,
      '章节正文',
    );
    const preference = chapterBoundaryPreference(chapter);
    assertRangeBounds(
      preference.contentRange.startByte,
      preference.contentRange.endByte,
      maximum,
      '用户期望章节正文',
    );
    if (chapter.headingKind === 'source') {
      if (!chapter.headingRange || !preference.headingRange)
        throw new RangeError('来源标题章必须包含标题范围。');
      assertRangeBounds(
        chapter.headingRange.startByte,
        chapter.headingRange.endByte,
        maximum,
        '章节标题',
      );
      assertRangeBounds(
        preference.headingRange.startByte,
        preference.headingRange.endByte,
        maximum,
        '用户期望章节标题',
      );
      if (chapter.headingRange.startByte === chapter.headingRange.endByte
        || preference.headingRange.startByte === preference.headingRange.endByte
        || chapter.headingRange.endByte > chapter.contentRange.startByte
        || preference.headingRange.endByte > preference.contentRange.startByte) {
        throw new RangeError('章节标题不能与正文范围重叠。');
      }
      const protectedStartByte = chapter.protectedHeadingStartByte
        ?? preference.headingRange.startByte;
      if (!Number.isSafeInteger(protectedStartByte)
        || protectedStartByte < preference.headingRange.startByte
        || protectedStartByte >= preference.headingRange.endByte) {
        throw new RangeError('来源标题受保护起点无效。');
      }
    } else if (chapter.headingRange || preference.headingRange) {
      throw new RangeError('无标题章不能包含标题范围。');
    }
    const previous = chapters[chapterIndex - 1];
    const anchor = chapter.headingRange?.startByte ?? chapter.contentRange.startByte;
    if (previous && previous.contentRange.endByte > anchor)
      throw new RangeError('相邻章节范围不能重叠。');
  }
}

function assertValidChapterBoundaryState(
  textIndex: ChapterTextIndex,
  chapters: readonly ChapterStructureDraftChapter[],
): void {
  for (const chapter of chapters) {
    const preference = chapterBoundaryPreference(chapter);
    assertValidUtf8Range(textIndex, preference.contentRange, true, '用户期望章节正文');
    if (preference.headingRange) {
      assertValidUtf8Range(textIndex, preference.headingRange, false, '用户期望章节标题');
    }
    if (chapter.protectedHeadingStartByte !== undefined
      && !isIndexedByteBoundary(textIndex, chapter.protectedHeadingStartByte)) {
      throw new RangeError('来源标题受保护起点不是有效的 UTF-8 字符边界。');
    }
  }
}

function boundaryPriorityForEdit(
  chapters: readonly ChapterStructureDraftChapter[],
  chapterIndex: number,
  boundary: ChapterBoundaryEdit['boundary'],
): ChapterBoundaryPriority | undefined {
  if (boundary === 'chapter-start') {
    const previous = chapters[chapterIndex - 1];
    const next = chapters[chapterIndex];
    return previous && next
      ? {
          previousChapterId: previous.draftId,
          nextChapterId: next.draftId,
          side: 'next-chapter-start',
        }
      : undefined;
  }
  const previous = chapters[chapterIndex];
  const next = chapters[chapterIndex + 1];
  return previous && next
    ? {
        previousChapterId: previous.draftId,
        nextChapterId: next.draftId,
        side: 'previous-content-end',
      }
    : undefined;
}

function replaceBoundaryPriority(
  priorities: readonly ChapterBoundaryPriority[],
  replacement: ChapterBoundaryPriority,
): readonly ChapterBoundaryPriority[] {
  const index = priorities.findIndex(priority => (
    priority.previousChapterId === replacement.previousChapterId
    && priority.nextChapterId === replacement.nextChapterId
  ));
  if (index < 0)
    return [...priorities, replacement];
  if (priorities[index]!.side === replacement.side)
    return priorities;
  const updated = [...priorities];
  updated[index] = replacement;
  return updated;
}

function retainAdjacentBoundaryPriorities(
  priorities: readonly ChapterBoundaryPriority[],
  chapters: readonly ChapterStructureDraftChapter[],
): readonly ChapterBoundaryPriority[] {
  const adjacentPairs = new Set(chapters.slice(1).map((chapter, index) => (
    `${chapters[index]!.draftId}\u0000${chapter.draftId}`
  )));
  return priorities.filter(priority => adjacentPairs.has(
    `${priority.previousChapterId}\u0000${priority.nextChapterId}`,
  ));
}

function sameBoundaryPriorities(
  left: readonly ChapterBoundaryPriority[],
  right: readonly ChapterBoundaryPriority[],
): boolean {
  return left.length === right.length && left.every((priority, index) => {
    const candidate = right[index]!;
    return priority.previousChapterId === candidate.previousChapterId
      && priority.nextChapterId === candidate.nextChapterId
      && priority.side === candidate.side;
  });
}

function sameChapterBoundaryState(
  left: ChapterStructureDraftChapter,
  right: ChapterStructureDraftChapter,
): boolean {
  const leftPreference = chapterBoundaryPreference(left);
  const rightPreference = chapterBoundaryPreference(right);
  return sameOptionalRange(left.headingRange, right.headingRange)
    && sameRange(left.contentRange, right.contentRange)
    && sameOptionalRange(leftPreference.headingRange, rightPreference.headingRange)
    && sameRange(leftPreference.contentRange, rightPreference.contentRange)
    && left.protectedHeadingStartByte === right.protectedHeadingStartByte;
}

function reconcileFirstChapterUpperBoundary(
  previousChapters: readonly ChapterStructureDraftChapter[],
  chapters: readonly ChapterStructureDraftChapter[],
  unassignedRanges: readonly Utf8TextRangeDto[],
): readonly Utf8TextRangeDto[] {
  const previousStartByte = previousChapters[0]?.headingRange?.startByte;
  const startByte = chapters[0]?.headingRange?.startByte;
  if (previousStartByte === undefined
    || startByte === undefined
    || previousStartByte === startByte) {
    return unassignedRanges;
  }
  if (startByte < previousStartByte) {
    const absorbedRange = range(startByte, previousStartByte);
    return normalizeRanges(unassignedRanges.flatMap(unassigned => (
      subtractRanges(unassigned, [absorbedRange])
    )));
  }
  return normalizeRanges([
    ...unassignedRanges,
    range(previousStartByte, startByte),
  ]);
}

export function addChapterRecognition(
  draft: ChapterStructureDraft,
  characterOffset: number,
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
): ChapterStructureDraft {
  assertTextIndex(textIndex, draft.text);
  const clickByte = characterOffsetToUtf8Byte(draft.text, characterOffset, textIndex);
  const line = lineAtCharacterOffset(draft.text, characterOffset);
  const detected = detectChapterHeadingLine(line.text);
  const lineStartByte = characterOffsetToUtf8Byte(draft.text, line.from, textIndex);
  const lineBodyEndByte = characterOffsetToUtf8Byte(draft.text, line.to, textIndex);
  const lineEndByte = characterOffsetToUtf8Byte(draft.text, line.end, textIndex);
  const headingRange = detected
    ? range(lineStartByte, lineBodyEndByte)
    : undefined;
  const splitByte = detected ? lineStartByte : clickByte;
  const contentStartByte = detected ? lineEndByte : clickByte;
  const anchorByte = detected ? lineStartByte : contentStartByte;
  if (draft.chapters.some(chapter => (
    recognitionCoverageStartByte(draft.text, chapter, textIndex) === anchorByte
  ))) {
    throw new RangeError('当前位置已有章节识别。');
  }

  const insertionIndex = draft.chapters.findIndex(chapter => (
    recognitionCoverageStartByte(draft.text, chapter, textIndex) > anchorByte
  ));
  const targetIndex = insertionIndex < 0 ? draft.chapters.length : insertionIndex;
  const previous = draft.chapters[targetIndex - 1];
  const next = draft.chapters[targetIndex];
  const maximum = textIndex.byteLength;
  const containingUnassigned = draft.unassignedRanges.find(unassigned => (
    unassigned.startByte <= clickByte && clickByte < unassigned.endByte
  ));
  const previousOwnsClick = previous !== undefined
    && splitByte >= previous.contentRange.startByte
    && splitByte <= (targetIndex === draft.chapters.length
      ? maximum
      : previous.contentRange.endByte)
    && !containingUnassigned;
  const contentEndByte = containingUnassigned?.endByte
    ?? (previousOwnsClick
      ? (targetIndex === draft.chapters.length ? maximum : previous.contentRange.endByte)
      : (next ? recognitionCoverageStartByte(draft.text, next, textIndex) : maximum));
  if (contentStartByte > contentEndByte)
    throw new RangeError('当前位置不足以形成有效章节范围。');

  const chapters = [...draft.chapters];
  if (previousOwnsClick) {
    if (splitByte < previous!.contentRange.startByte)
      throw new RangeError('不能在上一章标题范围内新增章节。');
    const previousPreference = chapterBoundaryPreference(previous!);
    chapters[targetIndex - 1] = {
      ...previous!,
      contentRange: range(previous!.contentRange.startByte, splitByte),
      boundaryPreference: {
        headingRange: previousPreference.headingRange,
        contentRange: range(previousPreference.contentRange.startByte, splitByte),
      },
    };
  }
  const draftId = nextDraftChapterId(draft.chapters);
  chapters.splice(targetIndex, 0, initializeChapterBoundaryState({
    draftId,
    title: detected?.title ?? '未命名章节',
    headingKind: detected ? 'source' : 'missing',
    headingRange,
    contentRange: range(contentStartByte, contentEndByte),
    lengthAnomalyAccepted: false,
  }));
  assertValidChapterRanges(textIndex, chapters);

  const restoredCoverage = range(splitByte, contentEndByte);
  return {
    ...draft,
    chapters,
    boundaryPriorities: retainAdjacentBoundaryPriorities(
      draft.boundaryPriorities,
      chapters,
    ),
    unassignedRanges: draft.unassignedRanges.flatMap(unassigned => (
      subtractRanges(unassigned, [restoredCoverage])
    )),
    operationCount: draft.operationCount + 1,
  };
}

export function canMergeChapter(
  draft: ChapterStructureDraft,
  chapterId: string,
  direction: ChapterMergeDirection,
): boolean {
  return canMergeChapterProjection(
    draft.chapters,
    draft.unassignedRanges,
    chapterId,
    direction,
  );
}

export function canMergeChapterProjection(
  chapters: readonly ChapterStructureDraftChapter[],
  unassignedRanges: readonly Utf8TextRangeDto[],
  chapterId: string,
  direction: ChapterMergeDirection,
): boolean {
  const index = chapters.findIndex(chapter => chapter.draftId === chapterId);
  if (index < 0)
    return false;
  if (direction === 'next')
    return index < chapters.length - 1;
  if (index === 0)
    return false;
  const previous = chapters[index - 1]!;
  const current = chapters[index]!;
  const projectedPrevious = {
    ...previous,
    contentRange: range(previous.contentRange.startByte, current.contentRange.endByte),
  };
  return !chaptersOverlapUnassignedRanges([projectedPrevious], unassignedRanges);
}

export function mergeChapter(
  draft: ChapterStructureDraft,
  chapterId: string,
  direction: ChapterMergeDirection,
): ChapterStructureDraft {
  const index = draft.chapters.findIndex(chapter => chapter.draftId === chapterId);
  if (index < 0)
    throw new RangeError(`找不到章节 ${chapterId}。`);
  if ((direction === 'previous' && index === 0)
    || (direction === 'next' && index === draft.chapters.length - 1)) {
    throw new RangeError(direction === 'previous' ? '首章不能并入上一章。' : '末章不能并入下一章。');
  }
  if (!canMergeChapter(draft, chapterId, direction))
    throw new RangeError('不能跨越显式未归属范围合并章节。');

  const chapters = [...draft.chapters];
  const chapter = chapters[index]!;
  if (direction === 'previous') {
    const previous = chapters[index - 1]!;
    const previousPreference = chapterBoundaryPreference(previous);
    const chapterPreference = chapterBoundaryPreference(chapter);
    chapters[index - 1] = {
      ...previous,
      contentRange: range(previous.contentRange.startByte, chapter.contentRange.endByte),
      boundaryPreference: {
        headingRange: previousPreference.headingRange,
        contentRange: range(
          previousPreference.contentRange.startByte,
          chapterPreference.contentRange.endByte,
        ),
      },
    };
  }
  chapters.splice(index, 1);
  return {
    ...draft,
    chapters,
    boundaryPriorities: retainAdjacentBoundaryPriorities(
      draft.boundaryPriorities,
      chapters,
    ),
    operationCount: draft.operationCount + 1,
  };
}

export function deleteChapterRecognition(
  draft: ChapterStructureDraft,
  chapterId: string,
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
): ChapterStructureDraft {
  assertTextIndex(textIndex, draft.text);
  const index = draft.chapters.findIndex(chapter => chapter.draftId === chapterId);
  if (index < 0)
    throw new RangeError(`找不到章节 ${chapterId}。`);
  const maximum = textIndex.byteLength;
  const coverageStart = draft.chapters[index - 1]?.contentRange.endByte ?? 0;
  const coverageEnd = index === draft.chapters.length - 1
    ? maximum
    : draft.chapters[index]!.contentRange.endByte;
  const chapters = draft.chapters.filter(chapter => chapter.draftId !== chapterId);
  const newlyUnassigned = coverageStart < coverageEnd
    ? [...draft.unassignedRanges, range(coverageStart, coverageEnd)]
    : [...draft.unassignedRanges];
  return {
    ...draft,
    chapters,
    boundaryPriorities: retainAdjacentBoundaryPriorities(
      draft.boundaryPriorities,
      chapters,
    ),
    unassignedRanges: chapters.length === 0 && maximum > 0
      ? [range(0, maximum)]
      : normalizeRanges(newlyUnassigned),
    operationCount: draft.operationCount + 1,
  };
}

export function acceptChapterLengthAnomaly(
  draft: ChapterStructureDraft,
  chapterId: string,
): ChapterStructureDraft {
  const chapter = draft.chapters.find(candidate => candidate.draftId === chapterId);
  if (!chapter)
    throw new RangeError(`找不到章节 ${chapterId}。`);
  if (chapter.lengthAnomalyAccepted)
    return draft;
  return {
    ...draft,
    chapters: draft.chapters.map(candidate => candidate.draftId === chapterId
      ? { ...candidate, lengthAnomalyAccepted: true }
      : candidate),
    operationCount: draft.operationCount + 1,
  };
}

export function canInsertLineBreak(
  draft: ChapterStructureDraft,
  characterOffset: number,
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
): boolean {
  try {
    characterOffsetToUtf8Byte(draft.text, characterOffset, textIndex);
  } catch {
    return false;
  }
  return !isLineBreakCharacter(draft.text[characterOffset - 1])
    && !isLineBreakCharacter(draft.text[characterOffset]);
}

export function insertLineBreak(
  draft: ChapterStructureDraft,
  characterOffset: number,
  textIndex: ChapterTextIndex = createChapterTextIndex(draft.text),
  baselineTextIndex: ChapterTextIndex = draft.baselineText === draft.text
    ? textIndex
    : createChapterTextIndex(draft.baselineText),
): ChapterStructureDraft {
  assertTextIndex(textIndex, draft.text);
  assertTextIndex(baselineTextIndex, draft.baselineText);
  if (!canInsertLineBreak(draft, characterOffset, textIndex))
    throw new RangeError('当前位置已经是换行边界，或不是有效的字符间隙。');
  const editedByteOffset = characterOffsetToUtf8Byte(draft.text, characterOffset, textIndex);
  const baselineByteOffset = editedByteToBaselineByte(
    draft,
    editedByteOffset,
    baselineTextIndex,
  );
  if (draft.insertionPoints.includes(baselineByteOffset))
    throw new RangeError('同一基线位置不能重复插入换行。');

  return {
    ...draft,
    text: `${draft.text.slice(0, characterOffset)}\n${draft.text.slice(characterOffset)}`,
    insertionPoints: [...draft.insertionPoints, baselineByteOffset].sort((left, right) => left - right),
    chapters: draft.chapters.map((chapter) => {
      const preference = chapterBoundaryPreference(chapter);
      return {
        ...chapter,
        headingRange: chapter.headingRange
          ? mapRangeAfterInsertion(chapter.headingRange, editedByteOffset, false)
          : undefined,
        contentRange: mapRangeAfterInsertion(chapter.contentRange, editedByteOffset, true),
        boundaryPreference: {
          headingRange: preference.headingRange
            ? mapRangeAfterInsertion(preference.headingRange, editedByteOffset, false)
            : undefined,
          contentRange: mapRangeAfterInsertion(
            preference.contentRange,
            editedByteOffset,
            true,
          ),
        },
        protectedHeadingStartByte: chapter.protectedHeadingStartByte === undefined
          ? undefined
          : chapter.protectedHeadingStartByte
            + (chapter.protectedHeadingStartByte >= editedByteOffset ? 1 : 0),
      };
    }),
    unassignedRanges: draft.unassignedRanges.map(unassigned => (
      mapRangeAfterInsertion(unassigned, editedByteOffset, true)
    )),
    operationCount: draft.operationCount + 1,
  };
}

function editedByteToBaselineByte(
  draft: ChapterStructureDraft,
  editedByteOffset: number,
  baselineTextIndex: ChapterTextIndex,
): number {
  let insertedBefore = 0;
  for (const [index, insertionPoint] of draft.insertionPoints.entries()) {
    const insertedEditedByte = insertionPoint + index;
    if (insertedEditedByte < editedByteOffset)
      insertedBefore += 1;
  }
  const baselineByteOffset = editedByteOffset - insertedBefore;
  utf8ByteOffsetToCharacter(draft.baselineText, baselineByteOffset, baselineTextIndex);
  return baselineByteOffset;
}

function mapRangeAfterInsertion(
  source: Utf8TextRangeDto,
  insertionByte: number,
  includeInsertionAtEnd: boolean,
): Utf8TextRangeDto {
  if (source.startByte === source.endByte) {
    const shift = source.startByte >= insertionByte ? 1 : 0;
    return range(source.startByte + shift, source.endByte + shift);
  }
  const startByte = source.startByte + (source.startByte >= insertionByte ? 1 : 0);
  const endByte = source.endByte + (
    source.endByte > insertionByte
    || (includeInsertionAtEnd && source.endByte === insertionByte)
      ? 1
      : 0
  );
  return range(startByte, endByte);
}

function lineAtCharacterOffset(
  text: string,
  characterOffset: number,
): { readonly from: number; readonly to: number; readonly end: number; readonly text: string } {
  let from = 0;
  let offset = 0;
  while (offset < text.length) {
    const separatorLength = lineBreakLengthAt(text, offset);
    if (separatorLength === 0) {
      offset += 1;
      continue;
    }
    const to = offset;
    const end = offset + separatorLength;
    if (characterOffset <= to) {
      return {
        from,
        to,
        end,
        text: text.slice(from, to),
      };
    }
    from = end;
    offset = end;
  }
  return {
    from,
    to: text.length,
    end: text.length,
    text: text.slice(from),
  };
}

function recognitionCoverageStartByte(
  text: string,
  chapter: ChapterStructureDraftChapter,
  textIndex: ChapterTextIndex,
): number {
  if (!chapter.headingRange)
    return chapter.contentRange.startByte;
  const headingCharacter = utf8ByteOffsetToCharacter(
    text,
    chapter.headingRange.startByte,
    textIndex,
  );
  const lineStartCharacter = lineAtCharacterOffset(text, headingCharacter).from;
  return characterOffsetToUtf8Byte(text, lineStartCharacter, textIndex);
}

function lineBreakLengthAt(text: string, characterOffset: number): 0 | 1 | 2 {
  if (text[characterOffset] === '\n')
    return 1;
  if (text[characterOffset] !== '\r')
    return 0;
  return text[characterOffset + 1] === '\n' ? 2 : 1;
}

function isLineBreakCharacter(character: string | undefined): boolean {
  return character === '\r' || character === '\n';
}

function nextDraftChapterId(chapters: readonly ChapterStructureDraftChapter[]): string {
  const used = new Set(chapters.map(chapter => chapter.draftId));
  let sequence = 1;
  while (used.has(`draft-chapter-${sequence}`))
    sequence += 1;
  return `draft-chapter-${sequence}`;
}

function assertValidChapterRanges(
  textIndex: ChapterTextIndex,
  chapters: readonly ChapterStructureDraftChapter[],
): void {
  for (const [chapterIndex, chapter] of chapters.entries()) {
    assertValidUtf8Range(textIndex, chapter.contentRange, true, '章节正文');
    if (chapter.headingKind === 'source') {
      if (!chapter.headingRange)
        throw new RangeError('来源标题章必须包含标题范围。');
      assertValidUtf8Range(textIndex, chapter.headingRange, false, '章节标题');
      if (chapter.headingRange.endByte > chapter.contentRange.startByte)
        throw new RangeError('章节标题不能与正文范围重叠。');
    } else if (chapter.headingRange) {
      throw new RangeError('无标题章不能包含标题范围。');
    }
    const previous = chapters[chapterIndex - 1];
    const anchor = chapter.headingRange?.startByte ?? chapter.contentRange.startByte;
    if (previous && previous.contentRange.endByte > anchor)
      throw new RangeError('相邻章节范围不能重叠。');
  }
}

function chaptersOverlapUnassignedRanges(
  chapters: readonly ChapterStructureDraftChapter[],
  unassignedRanges: readonly Utf8TextRangeDto[],
): boolean {
  const normalizedUnassigned = normalizeRanges(unassignedRanges);
  return chapters.some(chapter => normalizedUnassigned.some(unassigned => (
    (chapter.headingRange !== undefined && rangesOverlap(chapter.headingRange, unassigned))
    || rangesOverlap(chapter.contentRange, unassigned)
  )));
}

function rangesOverlap(left: Utf8TextRangeDto, right: Utf8TextRangeDto): boolean {
  return left.startByte < right.endByte && right.startByte < left.endByte;
}

function assertValidUtf8Range(
  textIndex: ChapterTextIndex,
  value: Utf8TextRangeDto,
  allowEmpty: boolean,
  label: string,
): void {
  if (value.startByte < 0
    || value.endByte < value.startByte
    || (!allowEmpty && value.endByte === value.startByte)
    || value.endByte > textIndex.byteLength
    || !isIndexedByteBoundary(textIndex, value.startByte)
    || !isIndexedByteBoundary(textIndex, value.endByte)) {
    throw new RangeError(`${label}范围无效：${value.startByte}-${value.endByte}。`);
  }
}

function sameOptionalRange(
  left: Utf8TextRangeDto | undefined,
  right: Utf8TextRangeDto | undefined,
): boolean {
  return left === undefined ? right === undefined : right !== undefined && sameRange(left, right);
}

function sameRange(left: Utf8TextRangeDto, right: Utf8TextRangeDto): boolean {
  return left.startByte === right.startByte && left.endByte === right.endByte;
}

function assertTextByteLength(textIndex: ChapterTextIndex, expected: number): void {
  if (textIndex.byteLength !== expected) {
    throw new RangeError(
      `正文 UTF-8 字节长度不一致：预期 ${expected}，实际 ${textIndex.byteLength}。`,
    );
  }
}

function normalizeRanges(ranges: readonly Utf8TextRangeDto[]): Utf8TextRangeDto[] {
  const sorted = [...ranges]
    .filter(range => range.endByte > range.startByte)
    .map(source => range(source.startByte, source.endByte))
    .sort((left, right) => left.startByte - right.startByte || left.endByte - right.endByte);
  const merged: Utf8TextRangeDto[] = [];
  for (const current of sorted) {
    const previous = merged.at(-1);
    if (previous && current.startByte <= previous.endByte) {
      merged[merged.length - 1] = range(
        previous.startByte,
        Math.max(previous.endByte, current.endByte),
      );
    } else {
      merged.push(current);
    }
  }
  return merged;
}

export function createChapterTextIndex(text: string): ChapterTextIndex {
  const checkpointByteOffsets = [0];
  const checkpointCharacterOffsets = [0];
  const checkpointNonWhitespaceCounts = [0];
  let characterOffset = 0;
  let byteOffset = 0;
  let codePointOffset = 0;
  let nonWhitespaceCount = 0;
  for (const codePoint of text) {
    characterOffset += codePoint.length;
    byteOffset += utf8CodePointByteLength(codePoint.codePointAt(0)!);
    codePointOffset += 1;
    if (!whitespacePattern.test(codePoint))
      nonWhitespaceCount += 1;
    if (codePointOffset % CHAPTER_TEXT_INDEX_CHECKPOINT_STRIDE === 0) {
      checkpointCharacterOffsets.push(characterOffset);
      checkpointByteOffsets.push(byteOffset);
      checkpointNonWhitespaceCounts.push(nonWhitespaceCount);
    }
  }
  if (checkpointCharacterOffsets.at(-1) !== characterOffset) {
    checkpointCharacterOffsets.push(characterOffset);
    checkpointByteOffsets.push(byteOffset);
    checkpointNonWhitespaceCounts.push(nonWhitespaceCount);
  }
  return {
    text,
    byteLength: byteOffset,
    checkpointByteOffsets: Float64Array.from(checkpointByteOffsets),
    checkpointCharacterOffsets: Float64Array.from(checkpointCharacterOffsets),
    checkpointNonWhitespaceCounts: Float64Array.from(checkpointNonWhitespaceCounts),
  };
}

interface IndexedTextPosition {
  readonly byteOffset: number;
  readonly characterOffset: number;
  readonly nonWhitespaceCount: number;
}

function indexedPositionAtCharacter(
  textIndex: ChapterTextIndex,
  targetCharacterOffset: number,
): IndexedTextPosition {
  if (!Number.isSafeInteger(targetCharacterOffset)
    || targetCharacterOffset < 0
    || targetCharacterOffset > textIndex.text.length) {
    throw new RangeError('invalid character offset');
  }
  const checkpointIndex = checkpointAtOrBefore(
    textIndex.checkpointCharacterOffsets,
    targetCharacterOffset,
  );
  let characterOffset = textIndex.checkpointCharacterOffsets[checkpointIndex]!;
  let byteOffset = textIndex.checkpointByteOffsets[checkpointIndex]!;
  let nonWhitespaceCount = textIndex.checkpointNonWhitespaceCounts[checkpointIndex]!;
  while (characterOffset < targetCharacterOffset) {
    const codePoint = textIndex.text.codePointAt(characterOffset)!;
    const characterLength = codePoint > 0xFFFF ? 2 : 1;
    if (characterOffset + characterLength > targetCharacterOffset)
      throw new RangeError('invalid character offset');
    characterOffset += characterLength;
    byteOffset += utf8CodePointByteLength(codePoint);
    if (!whitespacePattern.test(String.fromCodePoint(codePoint)))
      nonWhitespaceCount += 1;
  }
  return { byteOffset, characterOffset, nonWhitespaceCount };
}

function indexedPositionAtByte(
  textIndex: ChapterTextIndex,
  targetByteOffset: number,
): IndexedTextPosition {
  if (!Number.isSafeInteger(targetByteOffset)
    || targetByteOffset < 0
    || targetByteOffset > textIndex.byteLength) {
    throw new RangeError('invalid byte offset');
  }
  const checkpointIndex = checkpointAtOrBefore(
    textIndex.checkpointByteOffsets,
    targetByteOffset,
  );
  let characterOffset = textIndex.checkpointCharacterOffsets[checkpointIndex]!;
  let byteOffset = textIndex.checkpointByteOffsets[checkpointIndex]!;
  let nonWhitespaceCount = textIndex.checkpointNonWhitespaceCounts[checkpointIndex]!;
  while (byteOffset < targetByteOffset) {
    const codePoint = textIndex.text.codePointAt(characterOffset)!;
    const characterLength = codePoint > 0xFFFF ? 2 : 1;
    const byteLength = utf8CodePointByteLength(codePoint);
    if (byteOffset + byteLength > targetByteOffset)
      throw new RangeError('invalid byte offset');
    characterOffset += characterLength;
    byteOffset += byteLength;
    if (!whitespacePattern.test(String.fromCodePoint(codePoint)))
      nonWhitespaceCount += 1;
  }
  return { byteOffset, characterOffset, nonWhitespaceCount };
}

function checkpointAtOrBefore(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle]! <= target)
      low = middle + 1;
    else
      high = middle;
  }
  return Math.max(0, low - 1);
}

function countIndexedNonWhitespaceCodePoints(
  textIndex: ChapterTextIndex,
  source: Utf8TextRangeDto,
): number {
  try {
    const start = indexedPositionAtByte(textIndex, source.startByte);
    const end = indexedPositionAtByte(textIndex, source.endByte);
    return end.nonWhitespaceCount - start.nonWhitespaceCount;
  } catch {
    throw new RangeError('章节范围不是有效的 UTF-8 字符边界。');
  }
}

function isIndexedByteBoundary(textIndex: ChapterTextIndex, byteOffset: number): boolean {
  try {
    indexedPositionAtByte(textIndex, byteOffset);
    return true;
  } catch {
    return false;
  }
}

function assertTextIndex(textIndex: ChapterTextIndex, text: string): void {
  if (textIndex.text !== text)
    throw new RangeError('正文文本索引与当前草稿不一致。');
}

function utf8CodePointByteLength(codePoint: number): 1 | 2 | 3 | 4 {
  if (codePoint <= 0x7F)
    return 1;
  if (codePoint <= 0x7FF)
    return 2;
  if (codePoint <= 0xFFFF)
    return 3;
  return 4;
}

function subtractRanges(
  source: Utf8TextRangeDto,
  exclusions: readonly Utf8TextRangeDto[],
): Utf8TextRangeDto[] {
  return subtractNormalizedRanges(source, normalizeRanges(exclusions));
}

function subtractNormalizedRanges(
  source: Utf8TextRangeDto,
  exclusions: readonly Utf8TextRangeDto[],
): Utf8TextRangeDto[] {
  const remaining: Utf8TextRangeDto[] = [];
  let cursor = source.startByte;
  for (const exclusion of exclusions) {
    if (exclusion.endByte <= cursor)
      continue;
    if (exclusion.startByte >= source.endByte)
      break;
    if (exclusion.startByte > cursor) {
      remaining.push(range(cursor, Math.min(exclusion.startByte, source.endByte)));
    }
    cursor = Math.max(cursor, exclusion.endByte);
    if (cursor >= source.endByte)
      break;
  }
  if (cursor < source.endByte)
    remaining.push(range(cursor, source.endByte));
  return remaining;
}

function assertRangeBounds(
  startByte: number,
  endByte: number,
  maximum: number,
  label: string,
): void {
  if (!Number.isSafeInteger(startByte)
    || !Number.isSafeInteger(endByte)
    || startByte < 0
    || endByte < startByte
    || endByte > maximum) {
    throw new RangeError(`${label}范围无效：${startByte}-${endByte}。`);
  }
}

function range(startByte: number, endByte: number): Utf8TextRangeDto {
  return { offsetUnit: 'utf8-byte', startByte, endByte };
}
