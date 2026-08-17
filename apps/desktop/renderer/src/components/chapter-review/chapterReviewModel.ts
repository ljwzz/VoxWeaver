import type {
  Utf8TextRangeDto,
} from '@voxweaver/contracts';
import type { ChapterEditorLine } from './chapterEditorModel';
import type {
  ChapterStructureDraftChapter,
} from './chapterStructureDraftModel';

export interface BoundaryShiftIntent {
  readonly boundary: 'upper' | 'lower';
  readonly direction: 'backward' | 'forward';
  readonly lineCount: 1 | 5;
}

export interface ChapterBoundaryEdit {
  readonly chapterId: string;
  readonly boundary: 'chapter-start' | 'content-end';
  readonly byteOffset: number;
}

export type BoundaryShiftAction = 'fast-backward' | 'backward' | 'forward' | 'fast-forward';

export const BOUNDARY_SHIFT_INTENTS: Readonly<Record<BoundaryShiftAction, Omit<BoundaryShiftIntent, 'boundary'>>> = {
  'fast-backward': { direction: 'backward', lineCount: 5 },
  'backward': { direction: 'backward', lineCount: 1 },
  'forward': { direction: 'forward', lineCount: 1 },
  'fast-forward': { direction: 'forward', lineCount: 5 },
};

const utf8Encoder = new TextEncoder();

export function chapterReceivesUncoveredText(
  chapters: readonly ChapterStructureDraftChapter[],
  chapterIndex: number,
  textByteLength: number,
): boolean {
  const chapter = chapters[chapterIndex];
  if (!chapter)
    return false;
  const previousEndByte = chapters[chapterIndex - 1]?.contentRange.endByte ?? 0;
  const chapterStartByte = chapter.headingRange?.startByte ?? chapter.contentRange.startByte;
  return previousEndByte < chapterStartByte
    || (chapterIndex === chapters.length - 1
      && chapter.contentRange.endByte < textByteLength);
}

export function resolveBoundaryShift(
  chapters: readonly ChapterStructureDraftChapter[],
  chapterIndex: number,
  intent: BoundaryShiftIntent,
  lines: readonly ChapterEditorLine[],
  textByteLength: number,
): ChapterBoundaryEdit | undefined {
  const chapter = chapters[chapterIndex];
  if (!chapter)
    return undefined;

  if (intent.boundary === 'upper') {
    const currentStartByte = chapter.headingRange?.startByte
      ?? chapter.contentRange.startByte;
    const referenceIndex = findBoundaryLineIndex(lines, currentStartByte, textByteLength);
    const targetIndex = shiftIndex(referenceIndex, intent);
    const targetLine = lines[targetIndex];
    if (!targetLine)
      return undefined;
    const byteOffset = trimmedLineStartByte(targetLine);
    if (byteOffset === currentStartByte
      || byteOffset < (chapters[chapterIndex - 1]?.contentRange.startByte ?? 0)
      || byteOffset > chapter.contentRange.endByte) {
      return undefined;
    }
    if (chapter.headingKind === 'source') {
      const headingRange = chapter.headingRange;
      const protectedStartByte = chapter.protectedHeadingStartByte
        ?? headingRange?.startByte;
      if (!headingRange
        || protectedStartByte === undefined
        || byteOffset >= headingRange.endByte
        || byteOffset > protectedStartByte) {
        return undefined;
      }
    } else if (byteOffset > chapter.contentRange.endByte) {
      return undefined;
    }
    return {
      chapterId: chapter.draftId,
      boundary: 'chapter-start',
      byteOffset,
    };
  }

  const referenceIndex = findBoundaryLineIndex(
    lines,
    chapter.contentRange.endByte,
    textByteLength,
  );
  const targetIndex = shiftIndex(referenceIndex, intent);
  if (targetIndex < 0 || targetIndex > lines.length)
    return undefined;
  const byteOffset = targetIndex === lines.length
    ? textByteLength
    : lines[targetIndex]!.startByte;
  if (byteOffset === chapter.contentRange.endByte
    || byteOffset < chapter.contentRange.startByte) {
    return undefined;
  }
  const next = chapters[chapterIndex + 1];
  if (next?.headingKind === 'source') {
    const protectedStartByte = next.protectedHeadingStartByte
      ?? next.headingRange?.startByte;
    if (protectedStartByte === undefined || byteOffset > protectedStartByte)
      return undefined;
  } else if (next && byteOffset > next.contentRange.endByte) {
    return undefined;
  }
  return {
    chapterId: chapter.draftId,
    boundary: 'content-end',
    byteOffset,
  };
}

function trimmedLineStartByte(line: ChapterEditorLine): number {
  const leadingWhitespace = line.text.match(/^\s*/u)?.[0] ?? '';
  return line.startByte + utf8Encoder.encode(leadingWhitespace).byteLength;
}

export function sameUtf8Range(
  left: Utf8TextRangeDto,
  right: Utf8TextRangeDto,
): boolean {
  return left.startByte === right.startByte && left.endByte === right.endByte;
}

function shiftIndex(referenceIndex: number, intent: BoundaryShiftIntent): number {
  if (referenceIndex < 0)
    return -1;
  return referenceIndex + (intent.direction === 'backward' ? -1 : 1) * intent.lineCount;
}

function findBoundaryLineIndex(
  lines: readonly ChapterEditorLine[],
  boundary: number,
  textByteLength: number,
): number {
  if (boundary === textByteLength)
    return lines.length;
  const insertionIndex = lowerBound(lines, boundary, line => line.startByte);
  if (lines[insertionIndex]?.startByte === boundary)
    return insertionIndex;
  const containingIndex = insertionIndex - 1;
  const containingLine = lines[containingIndex];
  return containingLine
    && containingLine.startByte <= boundary
    && containingLine.endByte > boundary
    ? containingIndex
    : -1;
}

function lowerBound(
  lines: readonly ChapterEditorLine[],
  boundary: number,
  select: (line: ChapterEditorLine) => number,
): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (select(lines[middle]!) < boundary)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}
