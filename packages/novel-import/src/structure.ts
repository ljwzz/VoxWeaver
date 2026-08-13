import type {
  ChapterCandidateDto,
  ChapterDto,
  CoverageReportDto,
  CoverageSegmentDto,
  NormalizationProposalDto,
  Utf8TextRangeDto,
} from '@voxweaver/contracts';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

export const CHAPTER_HEADING_MAX_CODE_POINTS = 120;

export interface NovelStructureAnalysis {
  readonly candidates: readonly ChapterCandidateDto[];
  readonly chapters: readonly ChapterDto[];
  readonly coverage: CoverageReportDto;
  readonly normalizationProposals: readonly NormalizationProposalDto[];
}

interface LineRecord {
  readonly body: string;
  readonly startByte: number;
  readonly bodyEndByte: number;
  readonly endByte: number;
}

interface DetectedHeading {
  readonly candidate: ChapterCandidateDto;
  readonly lineStartByte: number;
  readonly lineEndByte: number;
}

export function analyzeNovelStructure(
  text: string,
  sourceHash: string,
): NovelStructureAnalysis {
  const textByteLength = Buffer.byteLength(text, 'utf8');
  const detected = scanLines(text)
    .map(line => detectHeading(line, sourceHash))
    .filter((heading): heading is DetectedHeading => heading !== undefined);
  const candidates = detected.map(heading => heading.candidate);
  const chapters = detected.map((heading, index): ChapterDto => {
    const next = detected[index + 1];
    const contentEndByte = next?.lineStartByte ?? textByteLength;
    return {
      chapterId: stableId(
        'chapter',
        sourceHash,
        heading.candidate.headingRange.startByte,
        heading.candidate.headingRange.endByte,
        heading.candidate.normalizedTitle,
      ),
      order: index + 1,
      title: heading.candidate.normalizedTitle,
      headingRange: heading.candidate.headingRange,
      contentRange: range(heading.lineEndByte, contentEndByte),
      reviewStatus: 'pending',
    };
  });

  return {
    candidates,
    chapters,
    coverage: createCoverage(textByteLength, detected, chapters),
    normalizationProposals: createNormalizationProposals(text, sourceHash),
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

function detectHeading(
  line: LineRecord,
  sourceHash: string,
): DetectedHeading | undefined {
  const leadingWhitespace = line.body.match(/^\s*/u)?.[0] ?? '';
  const trailingWhitespace = line.body.match(/\s*$/u)?.[0] ?? '';
  const rawTitle = line.body.slice(
    leadingWhitespace.length,
    line.body.length - trailingWhitespace.length,
  );
  const codePointLength = [...rawTitle].length;
  if (codePointLength === 0 || codePointLength > CHAPTER_HEADING_MAX_CODE_POINTS)
    return undefined;

  const headingKind = classifyHeading(rawTitle);
  if (headingKind === undefined)
    return undefined;

  const startByte = line.startByte + Buffer.byteLength(leadingWhitespace, 'utf8');
  const endByte = startByte + Buffer.byteLength(rawTitle, 'utf8');
  const normalizedTitle = normalizeHeadingTitle(rawTitle);
  const headingRange = range(startByte, endByte);
  return {
    lineStartByte: line.startByte,
    lineEndByte: line.endByte,
    candidate: {
      candidateId: stableId(
        'candidate',
        sourceHash,
        startByte,
        endByte,
        normalizedTitle,
      ),
      rawTitle,
      normalizedTitle,
      headingRange,
      confidence: headingKind === 'numbered' ? 0.98 : 0.95,
      evidence: ['standalone-line', `${headingKind}-heading-pattern`],
      reviewStatus: 'pending',
    },
  };
}

function classifyHeading(rawTitle: string): 'numbered' | 'special' | 'english' | undefined {
  const titleStart = /^(?:第[^\s，。！？!?]{1,24}[章回节卷部篇集]|序章|序言|楔子|前言|引子|终章|尾声|后记|番外(?:\s*[0-9〇零一二三四五六七八九十百千万两]+)?|chapter\s+(?:\d+|[ivxlcdm]+))/iu.exec(rawTitle);
  if (titleStart === null)
    return undefined;
  const suffix = rawTitle.slice(titleStart[0].length);
  if (suffix.length > 0 && !isHeadingSuffix(suffix))
    return undefined;

  if (titleStart[0].startsWith('第'))
    return 'numbered';
  if (!titleStart[0].toLowerCase().startsWith('chapter'))
    return 'special';
  return 'english';
}

function isHeadingSuffix(suffix: string): boolean {
  return /^[\s:：.．·\-—]/u.test(suffix);
}

function normalizeHeadingTitle(rawTitle: string): string {
  return rawTitle.trim().replace(/[\t \u3000]+/gu, ' ');
}

function createCoverage(
  totalByteLength: number,
  headings: readonly DetectedHeading[],
  chapters: readonly ChapterDto[],
): CoverageReportDto {
  if (headings.length === 0) {
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
  const firstHeading = headings[0]!;
  if (firstHeading.lineStartByte > 0) {
    segments.push({
      classification: 'front-matter',
      range: range(0, firstHeading.lineStartByte),
    });
  }
  for (const [index, heading] of headings.entries()) {
    const chapter = chapters[index]!;
    segments.push({
      classification: 'chapter',
      range: range(
        heading.lineStartByte,
        headings[index + 1]?.lineStartByte ?? totalByteLength,
      ),
      chapterId: chapter.chapterId,
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

function createNormalizationProposals(
  text: string,
  sourceHash: string,
): NormalizationProposalDto[] {
  const proposals: NormalizationProposalDto[] = [];
  let characterOffset = 0;
  let byteOffset = 0;
  while (characterOffset < text.length) {
    const codePoint = text.codePointAt(characterOffset)!;
    const character = String.fromCodePoint(codePoint);
    const characterLength = character.length;
    const characterByteLength = Buffer.byteLength(character, 'utf8');

    if (character === '\r') {
      const isCrLf = text[characterOffset + 1] === '\n';
      const beforeText = isCrLf ? '\r\n' : '\r';
      const beforeByteLength = Buffer.byteLength(beforeText, 'utf8');
      proposals.push(proposal(
        sourceHash,
        byteOffset,
        byteOffset + beforeByteLength,
        beforeText,
        '\n',
        '统一换行为 LF',
      ));
      characterOffset += beforeText.length;
      byteOffset += beforeByteLength;
      continue;
    }

    if (character === '\u00A0') {
      proposals.push(proposal(
        sourceHash,
        byteOffset,
        byteOffset + characterByteLength,
        character,
        ' ',
        '将不换行空格替换为普通空格',
      ));
    }
    characterOffset += characterLength;
    byteOffset += characterByteLength;
  }
  return proposals;
}

function proposal(
  sourceHash: string,
  startByte: number,
  endByte: number,
  beforeText: string,
  afterText: string,
  reason: string,
): NormalizationProposalDto {
  return {
    proposalId: stableId('normalization', sourceHash, startByte, endByte, afterText),
    range: range(startByte, endByte),
    beforeText,
    afterText,
    reason,
    decision: 'pending',
  };
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
