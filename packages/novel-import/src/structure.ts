import type {
  ChapterDto,
  CoverageReportDto,
  CoverageSegmentDto,
  Utf8TextRangeDto,
} from '@voxweaver/contracts';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { detectChapterHeadingLine } from './chapterHeading.ts';

export { CHAPTER_HEADING_MAX_CODE_POINTS } from './chapterHeading.ts';

export interface NovelStructureAnalysis {
  readonly chapters: readonly ChapterDto[];
  readonly coverage: CoverageReportDto;
}

interface LineRecord {
  readonly body: string;
  readonly startByte: number;
  readonly bodyEndByte: number;
  readonly endByte: number;
}

interface DetectedHeading {
  readonly headingRange: Utf8TextRangeDto;
  readonly lineStartByte: number;
  readonly lineEndByte: number;
  readonly normalizedTitle: string;
}

export function analyzeNovelStructure(
  text: string,
  sourceHash: string,
): NovelStructureAnalysis {
  const textByteLength = Buffer.byteLength(text, 'utf8');
  const detected = scanLines(text)
    .map(line => detectHeading(line))
    .filter((heading): heading is DetectedHeading => heading !== undefined);
  const chapters = detected.map((heading, index): ChapterDto => {
    const next = detected[index + 1];
    const contentEndByte = next?.lineStartByte ?? textByteLength;
    return {
      chapterId: stableId(
        'chapter',
        sourceHash,
        heading.headingRange.startByte,
        heading.headingRange.endByte,
        heading.normalizedTitle,
      ),
      order: index + 1,
      title: heading.normalizedTitle,
      headingKind: 'source',
      headingRange: heading.headingRange,
      contentRange: range(heading.lineEndByte, contentEndByte),
      reviewStatus: 'pending',
      lengthAnomalyAccepted: false,
    };
  });

  return {
    chapters,
    coverage: createChapterCoverage(textByteLength, chapters),
  };
}

function scanLines(text: string): LineRecord[] {
  const lines: LineRecord[] = [];
  let characterOffset = 0;
  let byteOffset = 0;
  while (characterOffset < text.length) {
    let bodyEnd = characterOffset;
    while (bodyEnd < text.length
      && text[bodyEnd] !== '\r'
      && text[bodyEnd] !== '\n') {
      bodyEnd += 1;
    }

    let lineEnd = bodyEnd;
    if (text[lineEnd] === '\r') {
      lineEnd += 1;
      if (text[lineEnd] === '\n')
        lineEnd += 1;
    } else if (text[lineEnd] === '\n') {
      lineEnd += 1;
    }

    const body = text.slice(characterOffset, bodyEnd);
    const fullLine = text.slice(characterOffset, lineEnd);
    const bodyByteLength = Buffer.byteLength(body, 'utf8');
    const lineByteLength = Buffer.byteLength(fullLine, 'utf8');
    lines.push({
      body,
      startByte: byteOffset,
      bodyEndByte: byteOffset + bodyByteLength,
      endByte: byteOffset + lineByteLength,
    });
    characterOffset = lineEnd;
    byteOffset += lineByteLength;
  }
  return lines;
}

function detectHeading(line: LineRecord): DetectedHeading | undefined {
  const detected = detectChapterHeadingLine(line.body);
  if (detected === undefined)
    return undefined;

  const startByte = line.startByte + Buffer.byteLength(
    line.body.slice(0, detected.startCharacter),
    'utf8',
  );
  const endByte = startByte + Buffer.byteLength(
    line.body.slice(detected.startCharacter, detected.endCharacter),
    'utf8',
  );
  const headingRange = range(startByte, endByte);
  return {
    headingRange,
    lineStartByte: line.startByte,
    lineEndByte: line.endByte,
    normalizedTitle: detected.title,
  };
}

export function createChapterCoverage(
  totalByteLength: number,
  chapters: readonly ChapterDto[],
  explicitUnassignedRanges?: readonly Utf8TextRangeDto[],
): CoverageReportDto {
  if (explicitUnassignedRanges !== undefined) {
    return createExplicitChapterCoverage(
      totalByteLength,
      chapters,
      explicitUnassignedRanges,
    );
  }

  if (chapters.length === 0) {
    const entireDocument = range(0, totalByteLength);
    return {
      totalByteLength,
      classifiedByteLength: 0,
      unclassifiedByteLength: totalByteLength,
      complete: false,
      segments: [{ classification: 'unknown', range: entireDocument }],
      uncoveredRanges: [entireDocument],
    };
  }

  const segments: CoverageSegmentDto[] = [];
  const ordered = [...chapters].sort((left, right) => left.order - right.order);
  let cursor = 0;
  for (const chapter of ordered) {
    const chapterStartByte = chapter.headingRange?.startByte ?? chapter.contentRange.startByte;
    if (cursor < chapterStartByte) {
      segments.push({
        classification: 'chapter',
        range: range(cursor, chapterStartByte),
        chapterId: chapter.chapterId,
        reason: 'uncovered-to-next',
      });
    }
    if (chapterStartByte < chapter.contentRange.endByte) {
      segments.push({
        classification: 'chapter',
        range: range(chapterStartByte, chapter.contentRange.endByte),
        chapterId: chapter.chapterId,
      });
    }
    cursor = chapter.contentRange.endByte;
  }
  if (cursor < totalByteLength) {
    segments.push({
      classification: 'chapter',
      range: range(cursor, totalByteLength),
      chapterId: ordered.at(-1)!.chapterId,
      reason: 'uncovered-to-last',
    });
  }
  return {
    totalByteLength,
    classifiedByteLength: totalByteLength,
    unclassifiedByteLength: 0,
    complete: true,
    segments,
    uncoveredRanges: [],
  };
}

function createExplicitChapterCoverage(
  totalByteLength: number,
  chapters: readonly ChapterDto[],
  explicitUnassignedRanges: readonly Utf8TextRangeDto[],
): CoverageReportDto {
  const orderedUnassignedRanges = [...explicitUnassignedRanges]
    .sort((left, right) => left.startByte - right.startByte || left.endByte - right.endByte);
  const inheritedChapterSegments = chapters.length === 0
    ? []
    : createChapterCoverage(totalByteLength, chapters).segments.filter(
        segment => segment.classification === 'chapter',
      );
  const chapterSegments = inheritedChapterSegments.flatMap(segment => (
    subtractRanges(segment, orderedUnassignedRanges)
  ));
  const unassignedSegments: CoverageSegmentDto[] = orderedUnassignedRanges.map(unassignedRange => ({
    classification: 'unknown',
    range: unassignedRange,
  }));
  const segments = [...chapterSegments, ...unassignedSegments]
    .sort((left, right) => (
      left.range.startByte - right.range.startByte
      || left.range.endByte - right.range.endByte
    ));
  const classifiedByteLength = chapterSegments.reduce(
    (total, segment) => total + segment.range.endByte - segment.range.startByte,
    0,
  );
  const unclassifiedByteLength = orderedUnassignedRanges.reduce(
    (total, unassignedRange) => total + unassignedRange.endByte - unassignedRange.startByte,
    0,
  );
  return {
    totalByteLength,
    classifiedByteLength,
    unclassifiedByteLength,
    complete: classifiedByteLength === totalByteLength && unclassifiedByteLength === 0,
    segments,
    uncoveredRanges: orderedUnassignedRanges,
  };
}

function subtractRanges(
  segment: CoverageSegmentDto,
  excludedRanges: readonly Utf8TextRangeDto[],
): CoverageSegmentDto[] {
  const fragments: CoverageSegmentDto[] = [];
  let cursor = segment.range.startByte;
  for (const excludedRange of excludedRanges) {
    if (excludedRange.endByte <= cursor)
      continue;
    if (excludedRange.startByte >= segment.range.endByte)
      break;
    if (cursor < excludedRange.startByte) {
      fragments.push({
        ...segment,
        range: range(cursor, Math.min(excludedRange.startByte, segment.range.endByte)),
      });
    }
    cursor = Math.max(cursor, excludedRange.endByte);
    if (cursor >= segment.range.endByte)
      break;
  }
  if (cursor < segment.range.endByte) {
    fragments.push({
      ...segment,
      range: range(cursor, segment.range.endByte),
    });
  }
  return fragments;
}

function stableId(
  namespace: string,
  sourceHash: string,
  startByte: number,
  endByte: number,
  content: string,
): string {
  const digest = createHash('sha256')
    .update(JSON.stringify({ namespace, sourceHash, startByte, endByte, content }))
    .digest('hex');
  return `${namespace}-${digest.slice(0, 32)}`;
}

function range(startByte: number, endByte: number): Utf8TextRangeDto {
  return { offsetUnit: 'utf8-byte', startByte, endByte };
}
