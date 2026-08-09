/// <reference types="node" />

import type { ChapterCandidateV1 } from '@voxweaver/contracts';
import type {
  CanonicalDocumentBlockV1,
  DocumentBlockIndexV1,
} from '@voxweaver/novel-domain';
import type { ParsedChapterNumberV1 } from './chapterNumber.js';

import { Buffer } from 'node:buffer';
import { randomUUID } from 'node:crypto';

import { parseChapterCandidateV1 } from '@voxweaver/contracts';
import { validateDocumentBlockIndexV1 } from '@voxweaver/novel-domain';

import { parseChapterNumberV1 } from './chapterNumber.js';

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const NUMBER_TOKEN = '[\\d０１２３４５６７８９零〇一二三四五六七八九两十百千万亿]{1,64}';
const HORIZONTAL_SPACE = '[ \\t\\u00a0\\u3000]';
const HEADING_SEPARATOR = '[ \\t\\u00a0\\u3000:：.—-]';
const NUMBERED_HEADING_PATTERN = new RegExp(
  `^第(${NUMBER_TOKEN})([章回节卷])(${HEADING_SEPARATOR}.*)?$`,
  'u',
);
const ENGLISH_HEADING_PATTERN = new RegExp(
  `^chapter${HORIZONTAL_SPACE}+([\\d０１２３４５６７８９]{1,64})`
  + `(${HEADING_SEPARATOR}.*)?$`,
  'iu',
);
const SPECIAL_HEADING_PATTERN = new RegExp(
  `^(序章|楔子|前言|引子|终章|尾声|番外|后记)`
  + `(${HEADING_SEPARATOR}.*)?$`,
  'u',
);
const INLINE_NUMBERED_PATTERN = new RegExp(
  `第(${NUMBER_TOKEN})([章回节卷])`,
  'gu',
);
const INLINE_ENGLISH_PATTERN
  = /chapter[ \t\u00A0\u3000]+([\d０１２３４５６７８９]{1,64})/giu;
const DIRECTORY_MARKER_PATTERN = /^(?:目\s*录|contents)$/iu;
const DIRECTORY_BOUNDARY_PATTERN
  = /^(?:正文(?:开始|卷)?|[-—*=]{3,})$/u;

export const CHAPTER_HEADING_RULE_VERSION = '1.0.0' as const;
export const CHAPTER_CONFIDENCE_FORMULA_VERSION
  = 'm1-chapter-confidence-v1' as const;
export const CHAPTER_CONTEXT_BLOCK_LIMIT = 2 as const;

export type ChapterHeadingKindV1
  = | 'chapter'
    | 'hui'
    | 'section'
    | 'volume'
    | 'special'
    | 'english-chapter';

export interface ParsedChapterHeadingV1 {
  readonly kind: ChapterHeadingKindV1;
  readonly rawTitle: string;
  readonly normalizedTitle: string;
  readonly ordinal?: ParsedChapterNumberV1;
  readonly specialName?: string;
  readonly ruleId: string;
  readonly ruleVersion: typeof CHAPTER_HEADING_RULE_VERSION;
}

export interface DetectChapterCandidatesOptionsV1 {
  readonly candidateIdFactory?: () => string;
}

interface ConfidenceResult {
  readonly score: number;
  readonly source: string;
}

interface InlineHeadingMatch {
  readonly index: number;
  readonly rawTitle: string;
  readonly parsed: ParsedChapterHeadingV1;
}

export class ChapterCandidateDetectionError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChapterCandidateDetectionError';
  }
}

export function parseChapterHeadingV1(
  value: string,
): ParsedChapterHeadingV1 | null {
  if (typeof value !== 'string')
    return null;
  const rawTitle = value.trim();
  if (rawTitle.length === 0 || /[\r\n]/u.test(rawTitle))
    return null;

  const numbered = NUMBERED_HEADING_PATTERN.exec(rawTitle);
  if (numbered !== null) {
    const ordinal = parseChapterNumberV1(numbered[1]);
    if (ordinal === null)
      return null;
    const kind = unitKind(numbered[2]);
    const suffix = stripHeadingSeparator(numbered[3]);
    return {
      kind,
      rawTitle,
      normalizedTitle: suffix.length > 0 ? suffix : rawTitle,
      ordinal,
      ruleId: `m1.chapter-heading.numbered.${kind}`,
      ruleVersion: CHAPTER_HEADING_RULE_VERSION,
    };
  }

  const special = SPECIAL_HEADING_PATTERN.exec(rawTitle);
  if (special !== null) {
    return {
      kind: 'special',
      rawTitle,
      normalizedTitle: rawTitle,
      specialName: special[1],
      ruleId: 'm1.chapter-heading.special',
      ruleVersion: CHAPTER_HEADING_RULE_VERSION,
    };
  }

  const english = ENGLISH_HEADING_PATTERN.exec(rawTitle);
  if (english !== null) {
    const ordinal = parseChapterNumberV1(english[1]);
    if (ordinal === null)
      return null;
    const suffix = stripHeadingSeparator(english[2]);
    return {
      kind: 'english-chapter',
      rawTitle,
      normalizedTitle: suffix.length > 0 ? suffix : rawTitle,
      ordinal,
      ruleId: 'm1.chapter-heading.english-chapter',
      ruleVersion: CHAPTER_HEADING_RULE_VERSION,
    };
  }

  return null;
}

export function detectChapterCandidatesV1(
  index: DocumentBlockIndexV1,
  options: DetectChapterCandidatesOptionsV1 = {},
): readonly ChapterCandidateV1[] {
  const validatedIndex = validateIndex(index);
  const idFactory = validateFactory(options.candidateIdFactory);
  const usedIds = new Set<string>();
  const candidates: ChapterCandidateV1[] = [];
  let inDirectory = false;

  for (let blockIndex = 0; blockIndex < validatedIndex.blocks.length; blockIndex++) {
    const block = validatedIndex.blocks[blockIndex];
    const blockTitle = block.canonicalText.trim();
    if (DIRECTORY_MARKER_PATTERN.test(blockTitle)) {
      inDirectory = true;
      continue;
    }
    if (
      inDirectory
      && (block.kind === 'separator' || DIRECTORY_BOUNDARY_PATTERN.test(blockTitle))
    ) {
      inDirectory = false;
      continue;
    }

    const parsed = parseChapterHeadingV1(block.canonicalText);
    if (parsed !== null) {
      candidates.push(createFullLineCandidate(
        parsed,
        block,
        blockIndex,
        validatedIndex,
        inDirectory,
        nextCandidateId(idFactory, usedIds),
      ));
      continue;
    }

    for (const inlineMatch of findInlineMatches(block.canonicalText)) {
      candidates.push(createInlineCandidate(
        inlineMatch,
        block,
        blockIndex,
        validatedIndex,
        nextCandidateId(idFactory, usedIds),
      ));
    }
  }

  candidates.sort((left, right) => left.headingRange.startByte
    - right.headingRange.startByte
    || left.headingRange.endByte - right.headingRange.endByte);
  for (const [candidateIndex, candidate] of candidates.entries()) {
    try {
      parseChapterCandidateV1(candidate, validatedIndex.canonicalTextRevision);
    } catch (error) {
      invalid(
        'chapter_candidate_contract_invalid',
        `Candidate ${candidateIndex} violates ChapterCandidateV1: ${errorMessage(error)}`,
      );
    }
  }
  return candidates;
}

function createFullLineCandidate(
  parsed: ParsedChapterHeadingV1,
  block: CanonicalDocumentBlockV1,
  blockIndex: number,
  index: DocumentBlockIndexV1,
  inDirectory: boolean,
  chapterCandidateId: string,
): ChapterCandidateV1 {
  const confidence = fullLineConfidence(block, inDirectory);
  const evidence = [
    'match-scope:full-line',
    `heading-kind:${parsed.kind}`,
    `block-kind:${block.kind}`,
    parsed.ordinal === undefined
      ? `special-heading:${parsed.specialName}`
      : `ordinal:${parsed.ordinal.normalizedDecimal}`,
    parsed.ordinal === undefined
      ? 'ordinal-source:not-applicable'
      : `ordinal-source:${parsed.ordinal.sourceKind}`,
    inDirectory
      ? 'directory-context:after-marker-before-explicit-boundary'
      : 'directory-context:false',
  ];
  if (parsed.kind === 'volume')
    evidence.push('structural-role:volume-marker');

  return {
    chapterCandidateId,
    headingRange: block.canonicalRange,
    lineRange: block.sourceLocator.lineRange,
    rawTitle: parsed.rawTitle,
    normalizedTitle: parsed.normalizedTitle,
    ruleId: parsed.ruleId,
    ruleVersion: parsed.ruleVersion,
    ruleConfidence: confidence.score,
    confidenceSource: confidence.source,
    evidence,
    contextBefore: contextBefore(index.blocks, blockIndex),
    contextAfter: contextAfter(index.blocks, blockIndex),
    reviewStatus: inDirectory || block.kind !== 'heading'
      ? 'pending'
      : 'not_required',
  };
}

function createInlineCandidate(
  match: InlineHeadingMatch,
  block: CanonicalDocumentBlockV1,
  blockIndex: number,
  index: DocumentBlockIndexV1,
  chapterCandidateId: string,
): ChapterCandidateV1 {
  const startByte = block.canonicalRange.startByte
    + Buffer.byteLength(block.canonicalText.slice(0, match.index), 'utf8');
  const endByte = startByte + Buffer.byteLength(match.rawTitle, 'utf8');
  const confidence = inlineConfidence(block);
  const evidence = [
    'match-scope:inline-only',
    `heading-kind:${match.parsed.kind}`,
    `block-kind:${block.kind}`,
    `ordinal:${match.parsed.ordinal?.normalizedDecimal}`,
    `ordinal-source:${match.parsed.ordinal?.sourceKind}`,
    'structural-evidence:prose-surrounds-match',
  ];
  if (match.parsed.kind === 'volume')
    evidence.push('structural-role:volume-marker');

  return {
    chapterCandidateId,
    headingRange: {
      ...block.canonicalRange,
      startByte,
      endByte,
    },
    lineRange: block.sourceLocator.lineRange,
    rawTitle: match.rawTitle,
    normalizedTitle: match.rawTitle,
    ruleId: 'm1.chapter-heading.inline-rejected',
    ruleVersion: CHAPTER_HEADING_RULE_VERSION,
    ruleConfidence: confidence.score,
    confidenceSource: confidence.source,
    evidence,
    contextBefore: contextBefore(index.blocks, blockIndex),
    contextAfter: contextAfter(index.blocks, blockIndex),
    reviewStatus: 'rejected',
  };
}

function findInlineMatches(text: string): readonly InlineHeadingMatch[] {
  const matches: InlineHeadingMatch[] = [];
  for (const match of text.matchAll(INLINE_NUMBERED_PATTERN)) {
    const ordinal = parseChapterNumberV1(match[1]);
    if (ordinal === null || match.index === undefined)
      continue;
    const rawTitle = match[0];
    const kind = unitKind(match[2]);
    matches.push({
      index: match.index,
      rawTitle,
      parsed: {
        kind,
        rawTitle,
        normalizedTitle: rawTitle,
        ordinal,
        ruleId: `m1.chapter-heading.numbered.${kind}`,
        ruleVersion: CHAPTER_HEADING_RULE_VERSION,
      },
    });
  }
  for (const match of text.matchAll(INLINE_ENGLISH_PATTERN)) {
    const ordinal = parseChapterNumberV1(match[1]);
    if (ordinal === null || match.index === undefined)
      continue;
    const rawTitle = match[0];
    matches.push({
      index: match.index,
      rawTitle,
      parsed: {
        kind: 'english-chapter',
        rawTitle,
        normalizedTitle: rawTitle,
        ordinal,
        ruleId: 'm1.chapter-heading.english-chapter',
        ruleVersion: CHAPTER_HEADING_RULE_VERSION,
      },
    });
  }
  return matches.sort((left, right) => left.index - right.index);
}

function fullLineConfidence(
  block: CanonicalDocumentBlockV1,
  inDirectory: boolean,
): ConfidenceResult {
  const components = [
    ['full-line-grammar', 0.45] as const,
    ['valid-heading-token', 0.25] as const,
    ['heading-block-kind', block.kind === 'heading' ? 0.2 : 0] as const,
    ['outside-directory', inDirectory ? 0 : 0.1] as const,
    ['directory-conflict', inDirectory ? -0.4 : 0] as const,
  ];
  return confidence(components);
}

function inlineConfidence(block: CanonicalDocumentBlockV1): ConfidenceResult {
  return confidence([
    ['inline-token-only', 0.05],
    ['valid-ordinal', 0.1],
    ['heading-block-kind', block.kind === 'heading' ? 0.05 : 0],
  ]);
}

function confidence(
  components: readonly (readonly [string, number])[],
): ConfidenceResult {
  const score = Math.max(
    0,
    Math.min(1, components.reduce((sum, component) => sum + component[1], 0)),
  );
  const roundedScore = Number(score.toFixed(2));
  const componentText = components
    .map(([name, value]) => `${name}=${value.toFixed(2)}`)
    .join(',');
  return {
    score: roundedScore,
    source: `${CHAPTER_CONFIDENCE_FORMULA_VERSION};${componentText};score=${roundedScore.toFixed(2)}`,
  };
}

function contextBefore(
  blocks: readonly CanonicalDocumentBlockV1[],
  currentIndex: number,
): readonly string[] {
  const context: string[] = [];
  for (let index = currentIndex - 1; index >= 0; index--) {
    const text = blocks[index].canonicalText.trim();
    if (text.length === 0)
      continue;
    context.unshift(text);
    if (context.length === CHAPTER_CONTEXT_BLOCK_LIMIT)
      break;
  }
  return context;
}

function contextAfter(
  blocks: readonly CanonicalDocumentBlockV1[],
  currentIndex: number,
): readonly string[] {
  const context: string[] = [];
  for (let index = currentIndex + 1; index < blocks.length; index++) {
    const text = blocks[index].canonicalText.trim();
    if (text.length === 0)
      continue;
    context.push(text);
    if (context.length === CHAPTER_CONTEXT_BLOCK_LIMIT)
      break;
  }
  return context;
}

function validateIndex(index: DocumentBlockIndexV1): DocumentBlockIndexV1 {
  try {
    return validateDocumentBlockIndexV1(index);
  } catch (error) {
    invalid(
      'chapter_candidate_index_invalid',
      `Chapter candidate input index is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateFactory(
  factory: DetectChapterCandidatesOptionsV1['candidateIdFactory'],
): () => string {
  if (factory === undefined)
    return randomUUID;
  if (typeof factory !== 'function') {
    invalid(
      'chapter_candidate_id_factory_invalid',
      'Chapter candidate ID factory must be a function',
    );
  }
  return factory;
}

function nextCandidateId(
  factory: () => string,
  usedIds: Set<string>,
): string {
  let candidateId: string;
  try {
    candidateId = factory();
  } catch (error) {
    invalid(
      'chapter_candidate_id_factory_failed',
      `Chapter candidate ID factory failed: ${errorMessage(error)}`,
    );
  }
  if (typeof candidateId !== 'string' || !UUID_V4_PATTERN.test(candidateId)) {
    invalid(
      'chapter_candidate_id_invalid',
      'Chapter candidate IDs must be opaque UUID v4 values',
    );
  }
  if (usedIds.has(candidateId)) {
    invalid(
      'chapter_candidate_id_duplicate',
      'Chapter candidate ID factory returned a duplicate UUID v4',
    );
  }
  usedIds.add(candidateId);
  return candidateId;
}

function unitKind(unit: string): ChapterHeadingKindV1 {
  switch (unit) {
    case '章':
      return 'chapter';
    case '回':
      return 'hui';
    case '节':
      return 'section';
    case '卷':
      return 'volume';
    default:
      return invalid('chapter_heading_unit_invalid', 'Unsupported heading unit');
  }
}

function stripHeadingSeparator(value: string | undefined): string {
  if (value === undefined)
    return '';
  const trimmedStart = value.trimStart();
  const withoutPunctuation = /^[:：.—-]/u.test(trimmedStart)
    ? trimmedStart.slice(1)
    : trimmedStart;
  return withoutPunctuation.trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new ChapterCandidateDetectionError(detailReason, message);
}
