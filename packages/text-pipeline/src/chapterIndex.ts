/// <reference types="node" />

import type {
  ChapterCandidateV1,
  ChapterIndexEntryV1,
  ChapterIndexV1,
  CoverageClassificationV1,
  CoverageSegmentV1,
  ImportIssueV1,
  TextRangeV1,
} from '@voxweaver/contracts';
import type {
  CanonicalDocumentBlockV1,
  DocumentBlockIndexV1,
} from '@voxweaver/novel-domain';
import type { ParsedChapterHeadingV1 } from './chapterCandidateDetector.js';

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

import {
  NOVEL_IMPORT_SCHEMA_VERSION,
  parseChapterCandidateV1,
  parseChapterIndexV1,
} from '@voxweaver/contracts';
import {
  validateChapterIndexDomainV1,
  validateDocumentBlockIndexV1,
} from '@voxweaver/novel-domain';

import { parseChapterHeadingV1 } from './chapterCandidateDetector.js';

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const DIRECTORY_MARKER_PATTERN = /^(?:目\s*录|contents)$/iu;
const APPENDIX_MARKER_PATTERN
  = /^(?:(?:附录|附记)(?:[ \t\u00A0\u3000:：.—-].*)?|appendix(?:[ \t\u00A0\u3000:：.—-].*)?)$/iu;
const APPENDIX_SPECIAL_NAMES = new Set(['尾声', '番外', '后记']);

export const CHAPTER_INDEX_PROCESSOR_ID
  = 'voxweaver.text-pipeline.chapter-index' as const;
export const CHAPTER_INDEX_PROCESSOR_VERSION = '1.0.0' as const;

export interface ChapterContentLengthPolicyV1 {
  readonly minimumByteLength?: number;
  readonly maximumByteLength?: number;
}

export interface BuildChapterIndexOptionsV1 {
  readonly chapterIdFactory?: () => string;
  readonly volumeIdFactory?: () => string;
  readonly issueIdFactory?: () => string;
  readonly contentLengthPolicy?: ChapterContentLengthPolicyV1;
}

export interface BuildChapterIndexInputV1 {
  readonly blockIndex: DocumentBlockIndexV1;
  readonly candidates: readonly ChapterCandidateV1[];
  readonly options?: BuildChapterIndexOptionsV1;
}

interface CandidateState {
  readonly candidate: ChapterCandidateV1;
  readonly parsed: ParsedChapterHeadingV1 | null;
  readonly fullLineBlock?: CanonicalDocumentBlockV1;
  readonly directory: boolean;
  readonly conflicted: boolean;
}

type LandmarkKind = 'entry' | 'volume' | 'pending' | 'directory' | 'appendix';

interface Landmark {
  readonly startByte: number;
  readonly kind: LandmarkKind;
  readonly state?: CandidateState;
  entry?: ChapterIndexEntryV1;
  volume?: VolumeState;
}

interface VolumeState {
  readonly volumeNumber: string;
  volumeId?: string;
}

interface IdContext {
  readonly usedIds: Set<string>;
  readonly chapterIdFactory: () => string;
  readonly volumeIdFactory: () => string;
  readonly issueIdFactory: () => string;
}

export class ChapterIndexBuildError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ChapterIndexBuildError';
  }
}

export function buildChapterIndexV1(
  input: BuildChapterIndexInputV1,
): ChapterIndexV1 {
  const blockIndex = validateBlockIndex(input?.blockIndex);
  const canonicalBytes = exactCanonicalBytes(blockIndex);
  const candidates = validateCandidates(input?.candidates, blockIndex, canonicalBytes);
  const options = validateOptions(input.options);
  const idContext: IdContext = {
    usedIds: new Set(candidates.map(candidate => candidate.chapterCandidateId)),
    chapterIdFactory: validateFactory(options.chapterIdFactory, 'chapter'),
    volumeIdFactory: validateFactory(options.volumeIdFactory, 'volume'),
    issueIdFactory: validateFactory(options.issueIdFactory, 'issue'),
  };
  const lengthPolicy = validateLengthPolicy(options.contentLengthPolicy);
  const issues: ImportIssueV1[] = [];
  const conflicts = findCandidateConflicts(candidates, issues, idContext);
  const blocksByRange = new Map(blockIndex.blocks.map(block => [
    rangeKey(block.canonicalRange),
    block,
  ]));
  const states = candidates.map(candidate => candidateState(
    candidate,
    blocksByRange,
    conflicts.has(candidate.chapterCandidateId),
  ));
  const landmarks = buildLandmarks(states, blockIndex, issues, idContext);
  const entries = buildEntries(landmarks, blockIndex, idContext);
  const segments = buildCoverageSegments(landmarks, entries, blockIndex);

  appendBlockIndexIssue(blockIndex, issues, idContext);
  appendEntryIssues(entries, canonicalBytes, issues, idContext, lengthPolicy);
  if (entries.length === 0) {
    issues.push(createIssue(
      idContext,
      'no_chapters_detected',
      'No deterministic body chapter entry could be established',
      undefined,
      'error',
    ));
  }

  const value: ChapterIndexV1 = {
    documentType: 'chapter-index',
    schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: CHAPTER_INDEX_PROCESSOR_ID,
    processorVersion: CHAPTER_INDEX_PROCESSOR_VERSION,
    textRevision: blockIndex.canonicalTextRevision,
    candidates,
    entries,
    coverageReport: {
      textRevisionId: blockIndex.canonicalTextRevision.textRevisionId,
      textLayer: 'canonical',
      totalByteLength: blockIndex.canonicalTextRevision.byteLength,
      classifiedByteLength: blockIndex.canonicalTextRevision.byteLength,
      unclassifiedByteLength: 0,
      complete: true,
      segments,
      unclassifiedRanges: [],
    },
    issues,
    reviewStatus: issues.length === 0 ? 'not_required' : 'pending',
  };

  try {
    parseChapterIndexV1(value);
    return validateChapterIndexDomainV1(value);
  } catch (error) {
    invalid(
      'chapter_index_output_invalid',
      `Generated ChapterIndexV1 is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateBlockIndex(value: DocumentBlockIndexV1): DocumentBlockIndexV1 {
  try {
    return validateDocumentBlockIndexV1(value);
  } catch (error) {
    invalid(
      'chapter_index_block_index_invalid',
      `ChapterIndex block input is invalid: ${errorMessage(error)}`,
    );
  }
}

function exactCanonicalBytes(index: DocumentBlockIndexV1): Buffer {
  const bytes = Buffer.allocUnsafe(index.canonicalTextRevision.byteLength);
  let cursor = 0;
  for (const block of index.blocks) {
    const expectedByteLength
      = block.canonicalRange.endByte - block.canonicalRange.startByte;
    const written = bytes.write(
      block.canonicalText,
      cursor,
      expectedByteLength,
      'utf8',
    );
    if (written !== expectedByteLength) {
      invalid(
        'canonical_text_length_mismatch',
        'Canonical block text byteLength is invalid',
      );
    }
    if (
      bytes.subarray(cursor, cursor + written).toString('utf8')
      !== block.canonicalText
    ) {
      invalid(
        'canonical_text_utf8_invalid',
        'Canonical block text must be exactly representable as UTF-8',
      );
    }
    cursor += written;
  }
  if (cursor !== bytes.byteLength)
    invalid('canonical_text_length_mismatch', 'Canonical block text byteLength is invalid');
  return bytes;
}

function validateCandidates(
  value: readonly ChapterCandidateV1[],
  index: DocumentBlockIndexV1,
  bytes: Buffer,
): readonly ChapterCandidateV1[] {
  if (!Array.isArray(value))
    invalid('chapter_candidates_invalid', 'Chapter candidates must be an array');
  const ids = new Set<string>();
  const candidates = value.map((candidate, position) => {
    let parsed: ChapterCandidateV1;
    try {
      parsed = parseChapterCandidateV1(candidate, index.canonicalTextRevision);
    } catch (error) {
      invalid(
        'chapter_candidate_invalid',
        `Chapter candidate ${position} is invalid: ${errorMessage(error)}`,
      );
    }
    if (ids.has(parsed.chapterCandidateId)) {
      invalid(
        'chapter_candidate_id_duplicate',
        'Chapter candidates must have unique opaque IDs',
      );
    }
    ids.add(parsed.chapterCandidateId);
    if (
      !isUtf8ScalarBoundary(bytes, parsed.headingRange.startByte)
      || !isUtf8ScalarBoundary(bytes, parsed.headingRange.endByte)
    ) {
      invalid(
        'chapter_candidate_utf8_boundary_invalid',
        'Chapter candidate ranges must use UTF-8 scalar boundaries',
      );
    }
    return parsed;
  });
  return candidates.sort((left, right) =>
    left.headingRange.startByte - right.headingRange.startByte
    || left.headingRange.endByte - right.headingRange.endByte
    || compareCodeUnits(left.chapterCandidateId, right.chapterCandidateId));
}

function findCandidateConflicts(
  candidates: readonly ChapterCandidateV1[],
  issues: ImportIssueV1[],
  ids: IdContext,
): ReadonlySet<string> {
  const conflicted = new Set<string>();
  const active = candidates.filter(candidate => candidate.reviewStatus !== 'rejected');
  const firstByRange = new Map<string, ChapterCandidateV1>();
  let overlapFrontier: ChapterCandidateV1 | undefined;
  for (const candidate of active) {
    const duplicate = firstByRange.get(rangeKey(candidate.headingRange));
    let conflictingCandidate = duplicate;
    if (
      conflictingCandidate === undefined
      && overlapFrontier !== undefined
      && candidate.headingRange.startByte < overlapFrontier.headingRange.endByte
    ) {
      conflictingCandidate = overlapFrontier;
    }
    if (conflictingCandidate !== undefined) {
      conflicted.add(conflictingCandidate.chapterCandidateId);
      conflicted.add(candidate.chapterCandidateId);
      issues.push(createIssue(
        ids,
        duplicate === undefined
          ? 'overlapping_chapter_candidates'
          : 'duplicate_chapter_candidate',
        duplicate === undefined
          ? 'Chapter candidate heading ranges overlap and require review'
          : 'Multiple chapter candidates reference the same canonical heading range',
        candidate.headingRange,
      ));
    }
    if (duplicate === undefined)
      firstByRange.set(rangeKey(candidate.headingRange), candidate);
    if (
      overlapFrontier === undefined
      || candidate.headingRange.endByte > overlapFrontier.headingRange.endByte
    ) {
      overlapFrontier = candidate;
    }
  }
  return conflicted;
}

function candidateState(
  candidate: ChapterCandidateV1,
  blocksByRange: ReadonlyMap<string, CanonicalDocumentBlockV1>,
  conflicted: boolean,
): CandidateState {
  const fullLine = candidate.evidence.includes('match-scope:full-line');
  const block = fullLine ? blocksByRange.get(rangeKey(candidate.headingRange)) : undefined;
  if (block !== undefined && !sameLineRange(block, candidate)) {
    invalid(
      'chapter_candidate_line_range_mismatch',
      'Full-line candidate source lines must match its canonical block provenance',
    );
  }
  if (block !== undefined && block.canonicalText.trim() !== candidate.rawTitle) {
    invalid(
      'chapter_candidate_text_mismatch',
      'Full-line candidate rawTitle must match its exact canonical block text',
    );
  }
  const parsed = parseChapterHeadingV1(candidate.rawTitle);
  if (parsed !== null && parsed.normalizedTitle !== candidate.normalizedTitle) {
    invalid(
      'chapter_candidate_normalized_title_mismatch',
      'Chapter candidate normalizedTitle must match the deterministic heading rule',
    );
  }
  return {
    candidate,
    parsed,
    fullLineBlock: block,
    directory: candidate.evidence.includes(
      'directory-context:after-marker-before-explicit-boundary',
    ),
    conflicted,
  };
}

function buildLandmarks(
  states: readonly CandidateState[],
  index: DocumentBlockIndexV1,
  issues: ImportIssueV1[],
  ids: IdContext,
): Landmark[] {
  const landmarks: Landmark[] = [];
  for (const block of index.blocks) {
    const title = block.canonicalText.trim();
    if (DIRECTORY_MARKER_PATTERN.test(title)) {
      landmarks.push({ startByte: block.canonicalRange.startByte, kind: 'directory' });
    } else if (APPENDIX_MARKER_PATTERN.test(title)) {
      landmarks.push({ startByte: block.canonicalRange.startByte, kind: 'appendix' });
    }
  }

  for (const state of states) {
    const { candidate } = state;
    if (candidate.reviewStatus === 'rejected')
      continue;
    if (state.fullLineBlock === undefined) {
      issues.push(createIssue(
        ids,
        'chapter_candidate_not_full_block',
        'A non-rejected chapter candidate is not an exact full canonical block',
        candidate.headingRange,
      ));
      continue;
    }
    if (state.conflicted) {
      landmarks.push({ startByte: candidate.headingRange.startByte, kind: 'pending', state });
      continue;
    }
    if (state.directory) {
      issues.push(createIssue(
        ids,
        'chapter_directory_candidate_conflict',
        'A directory candidate is retained as evidence and excluded from body order',
        candidate.headingRange,
      ));
      landmarks.push({ startByte: candidate.headingRange.startByte, kind: 'directory', state });
      continue;
    }
    if (candidate.reviewStatus === 'pending' || state.parsed === null) {
      issues.push(createIssue(
        ids,
        'chapter_candidate_review_required',
        'A pending or unrecognized candidate was excluded from the formal chapter index',
        candidate.headingRange,
      ));
      landmarks.push({
        startByte: candidate.headingRange.startByte,
        kind: isAppendixState(state) ? 'appendix' : 'pending',
        state,
      });
      continue;
    }
    if (state.parsed.kind === 'volume') {
      landmarks.push({
        startByte: candidate.headingRange.startByte,
        kind: 'volume',
        state,
        volume: { volumeNumber: state.parsed.ordinal!.normalizedDecimal },
      });
      continue;
    }
    landmarks.push({ startByte: candidate.headingRange.startByte, kind: 'entry', state });
  }

  const priority: Readonly<Record<LandmarkKind, number>> = {
    entry: 0,
    volume: 1,
    appendix: 2,
    directory: 3,
    pending: 4,
  };
  landmarks.sort((left, right) =>
    left.startByte - right.startByte || priority[left.kind] - priority[right.kind]);
  return landmarks.filter((landmark, position) =>
    position === 0 || landmark.startByte !== landmarks[position - 1].startByte);
}

function buildEntries(
  landmarks: Landmark[],
  index: DocumentBlockIndexV1,
  ids: IdContext,
): readonly ChapterIndexEntryV1[] {
  const entries: ChapterIndexEntryV1[] = [];
  let currentVolume: VolumeState | undefined;
  for (const [landmarkIndex, landmark] of landmarks.entries()) {
    if (landmark.kind === 'volume') {
      currentVolume = landmark.volume;
      continue;
    }
    if (landmark.kind === 'pending' && landmark.state?.parsed?.kind === 'volume') {
      currentVolume = undefined;
      continue;
    }
    if (landmark.kind !== 'entry' || landmark.state === undefined)
      continue;
    const { candidate, parsed } = landmark.state;
    if (parsed === null)
      continue;
    const contentEnd = landmarks[landmarkIndex + 1]?.startByte
      ?? index.canonicalTextRevision.byteLength;
    if (contentEnd < candidate.headingRange.endByte) {
      invalid(
        'chapter_content_boundary_invalid',
        'Chapter structural boundaries overlap its heading',
      );
    }
    if (currentVolume !== undefined && currentVolume.volumeId === undefined) {
      currentVolume.volumeId = nextId(ids, ids.volumeIdFactory, 'volume');
    }
    const entry: ChapterIndexEntryV1 = {
      chapterId: nextId(ids, ids.chapterIdFactory, 'chapter'),
      order: entries.length,
      ...(currentVolume === undefined
        ? {}
        : {
            volumeId: currentVolume.volumeId,
            volumeNumber: currentVolume.volumeNumber,
          }),
      ...(parsed.ordinal === undefined
        ? {}
        : { chapterNumber: parsed.ordinal.normalizedDecimal }),
      title: candidate.normalizedTitle,
      rawHeading: candidate.rawTitle,
      headingRange: candidate.headingRange,
      contentRange: rangeLike(candidate.headingRange, candidate.headingRange.endByte, contentEnd),
      sourceLineRange: {
        lineBase: 1,
        startLine: candidate.lineRange.startLine,
        endLineExclusive: Math.max(
          candidate.lineRange.endLineExclusive,
          sourceLineAtCursor(index, contentEnd),
        ),
      },
      confidence: candidate.ruleConfidence,
      detectedBy: `rule:${candidate.ruleId}@${candidate.ruleVersion}`,
      reviewStatus: candidate.reviewStatus,
    };
    landmark.entry = entry;
    entries.push(entry);
  }
  return entries;
}

function buildCoverageSegments(
  landmarks: readonly Landmark[],
  entries: readonly ChapterIndexEntryV1[],
  index: DocumentBlockIndexV1,
): readonly CoverageSegmentV1[] {
  const total = index.canonicalTextRevision.byteLength;
  if (total === 0)
    return [];
  const boundaries = [...new Set([0, ...landmarks.map(item => item.startByte), total])]
    .sort((left, right) => left - right);
  const landmarkByStart = new Map(landmarks.map(landmark => [landmark.startByte, landmark]));
  const entryByStart = new Map(entries.map(entry => [entry.headingRange.startByte, entry]));
  const segments: CoverageSegmentV1[] = [];

  for (let indexPosition = 0; indexPosition < boundaries.length - 1; indexPosition++) {
    const startByte = boundaries[indexPosition];
    const endByte = boundaries[indexPosition + 1];
    if (startByte === endByte)
      continue;
    const entry = entryByStart.get(startByte);
    if (entry !== undefined) {
      segments.push({
        classification: 'chapter',
        range: rangeLike(entry.headingRange, startByte, endByte),
        chapterId: entry.chapterId,
      });
      continue;
    }
    const classification = nonChapterClassification(
      landmarkByStart.get(startByte),
      startByte,
      endByte,
      entries,
      index,
    );
    appendNonChapterSegment(
      segments,
      classification,
      revisionRange(index, startByte, endByte),
    );
  }
  return segments;
}

function nonChapterClassification(
  landmark: Landmark | undefined,
  startByte: number,
  endByte: number,
  entries: readonly ChapterIndexEntryV1[],
  index: DocumentBlockIndexV1,
): Exclude<CoverageClassificationV1, 'chapter'> {
  if (landmark?.kind === 'appendix')
    return 'appendix';
  if (landmark !== undefined)
    return landmark.kind === 'entry' ? 'unknown' : 'unknown';
  if (entries.length === 0)
    return intervalIsNoise(index, startByte, endByte) ? 'noise' : 'unknown';
  if (endByte <= entries[0].headingRange.startByte)
    return intervalIsNoise(index, startByte, endByte) ? 'noise' : 'front_matter';
  return intervalIsNoise(index, startByte, endByte) ? 'noise' : 'unknown';
}

function appendNonChapterSegment(
  segments: CoverageSegmentV1[],
  classification: Exclude<CoverageClassificationV1, 'chapter'>,
  range: TextRangeV1,
): void {
  const previous = segments[segments.length - 1];
  if (
    previous !== undefined
    && previous.classification !== 'chapter'
    && previous.classification === classification
    && previous.range.endByte === range.startByte
  ) {
    segments[segments.length - 1] = {
      classification,
      range: { ...previous.range, endByte: range.endByte },
    };
    return;
  }
  segments.push({ classification, range });
}

function appendBlockIndexIssue(
  index: DocumentBlockIndexV1,
  issues: ImportIssueV1[],
  ids: IdContext,
): void {
  if (index.reviewStatus !== 'pending')
    return;
  issues.push(createIssue(
    ids,
    'block_alignment_review_required',
    'The source block alignment remains pending review',
  ));
}

function appendEntryIssues(
  entries: readonly ChapterIndexEntryV1[],
  bytes: Buffer,
  issues: ImportIssueV1[],
  ids: IdContext,
  policy: ChapterContentLengthPolicyV1 | undefined,
): void {
  const titles = new Map<string, ChapterIndexEntryV1>();
  const contents = new Map<string, ChapterIndexEntryV1>();
  const sequences = new Map<string, { last: bigint; seen: Set<string> }>();

  for (const entry of entries) {
    const previousTitle = titles.get(entry.title);
    if (previousTitle !== undefined) {
      issues.push(createIssue(
        ids,
        'duplicate_chapter_title',
        'A normalized chapter title is repeated in body order',
        entry.headingRange,
      ));
    } else {
      titles.set(entry.title, entry);
    }

    const content = exactSlice(bytes, entry.contentRange);
    const contentText = content.toString('utf8');
    if (contentText.trim().length === 0) {
      issues.push(createIssue(
        ids,
        'empty_chapter',
        'A chapter has no non-whitespace body content',
        rangeLike(entry.headingRange, entry.headingRange.startByte, entry.contentRange.endByte),
      ));
    } else {
      const contentKey = createHash('sha256').update(content).digest('hex');
      if (contents.has(contentKey)) {
        issues.push(createIssue(
          ids,
          'duplicate_chapter_content',
          'Exact chapter body content is repeated and requires review',
          entry.contentRange,
        ));
      } else {
        contents.set(contentKey, entry);
      }
    }

    appendLengthPolicyIssues(entry, content.byteLength, policy, issues, ids);
    if (entry.chapterNumber !== undefined)
      appendSequenceIssues(entry, sequences, issues, ids);
  }
}

function appendSequenceIssues(
  entry: ChapterIndexEntryV1,
  sequences: Map<string, { last: bigint; seen: Set<string> }>,
  issues: ImportIssueV1[],
  ids: IdContext,
): void {
  const key = entry.volumeId ?? 'without-volume';
  const value = BigInt(entry.chapterNumber!);
  const sequence = sequences.get(key);
  if (sequence === undefined) {
    sequences.set(key, { last: value, seen: new Set([entry.chapterNumber!]) });
    return;
  }
  if (sequence.seen.has(entry.chapterNumber!)) {
    issues.push(createIssue(
      ids,
      'duplicate_chapter_number',
      'A chapter number is repeated within the same volume context',
      entry.headingRange,
    ));
  } else if (value < sequence.last) {
    issues.push(createIssue(
      ids,
      'chapter_number_out_of_order',
      'Chapter numbering decreases within source order',
      entry.headingRange,
    ));
  } else if (value > sequence.last + 1n) {
    issues.push(createIssue(
      ids,
      'missing_chapter_number',
      'Chapter numbering has a gap within source order',
      entry.headingRange,
    ));
  }
  sequence.seen.add(entry.chapterNumber!);
  sequence.last = value;
}

function appendLengthPolicyIssues(
  entry: ChapterIndexEntryV1,
  byteLength: number,
  policy: ChapterContentLengthPolicyV1 | undefined,
  issues: ImportIssueV1[],
  ids: IdContext,
): void {
  if (policy?.minimumByteLength !== undefined && byteLength < policy.minimumByteLength) {
    issues.push(createIssue(
      ids,
      'chapter_content_below_policy_minimum',
      'Chapter content is below the caller-supplied byte-length policy',
      entry.contentRange,
    ));
  }
  if (policy?.maximumByteLength !== undefined && byteLength > policy.maximumByteLength) {
    issues.push(createIssue(
      ids,
      'chapter_content_above_policy_maximum',
      'Chapter content is above the caller-supplied byte-length policy',
      entry.contentRange,
    ));
  }
}

function validateLengthPolicy(
  value: ChapterContentLengthPolicyV1 | undefined,
): ChapterContentLengthPolicyV1 | undefined {
  if (value === undefined)
    return undefined;
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(
      'chapter_content_length_policy_invalid',
      'Chapter content byte-length policy must be an object',
    );
  }
  for (const number of [value.minimumByteLength, value.maximumByteLength]) {
    if (number !== undefined && (!Number.isSafeInteger(number) || number < 0)) {
      invalid(
        'chapter_content_length_policy_invalid',
        'Chapter content byte-length policy values must be safe non-negative integers',
      );
    }
  }
  if (
    value.minimumByteLength !== undefined
    && value.maximumByteLength !== undefined
    && value.minimumByteLength > value.maximumByteLength
  ) {
    invalid(
      'chapter_content_length_policy_invalid',
      'Chapter content minimum byteLength must not exceed its maximum',
    );
  }
  return value;
}

function validateOptions(
  value: BuildChapterIndexOptionsV1 | undefined,
): BuildChapterIndexOptionsV1 {
  if (value === undefined)
    return {};
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(
      'chapter_index_options_invalid',
      'ChapterIndex build options must be an object',
    );
  }
  return value;
}

function validateFactory(
  value: (() => string) | undefined,
  entity: 'chapter' | 'volume' | 'issue',
): () => string {
  if (value === undefined)
    return randomUUID;
  if (typeof value !== 'function') {
    invalid(
      `${entity}_id_factory_invalid`,
      `${entity} ID factory must be a function`,
    );
  }
  return value;
}

function nextId(
  context: IdContext,
  factory: () => string,
  entity: 'chapter' | 'volume' | 'issue',
): string {
  let value: string;
  try {
    value = factory();
  } catch (error) {
    invalid(
      `${entity}_id_factory_failed`,
      `${entity} ID factory failed: ${errorMessage(error)}`,
    );
  }
  if (typeof value !== 'string' || !UUID_V4_PATTERN.test(value)) {
    invalid(
      `${entity}_id_invalid`,
      `${entity} IDs must be opaque UUID v4 values`,
    );
  }
  if (context.usedIds.has(value)) {
    invalid(
      `${entity}_id_duplicate`,
      `${entity} ID factory returned an already-used UUID v4`,
    );
  }
  context.usedIds.add(value);
  return value;
}

function createIssue(
  ids: IdContext,
  code: string,
  message: string,
  textRange?: TextRangeV1,
  severity: 'info' | 'warning' | 'error' = 'warning',
): ImportIssueV1 {
  return {
    issueId: nextId(ids, ids.issueIdFactory, 'issue'),
    code,
    severity,
    reviewStatus: 'pending',
    message,
    ...(textRange === undefined ? {} : { textRange }),
  };
}

function isAppendixState(state: CandidateState): boolean {
  return state.parsed?.kind === 'special'
    && state.parsed.specialName !== undefined
    && APPENDIX_SPECIAL_NAMES.has(state.parsed.specialName);
}

function sourceLineAtCursor(index: DocumentBlockIndexV1, cursor: number): number {
  if (index.blocks.length === 0)
    return 1;
  if (cursor >= index.canonicalTextRevision.byteLength) {
    const lastBlock = index.blocks[index.blocks.length - 1];
    return lastBlock.sourceLocator.lineRange.endLineExclusive;
  }
  const block = index.blocks[firstBlockEndingAfter(index.blocks, cursor)];
  if (cursor <= block.canonicalRange.startByte)
    return block.sourceLocator.lineRange.startLine;

  const relative = cursor - block.canonicalRange.startByte;
  const prefix = Buffer.from(block.canonicalText, 'utf8')
    .subarray(0, relative)
    .toString('utf8');
  let newlineCount = 0;
  for (const character of prefix) {
    if (character === '\n')
      newlineCount++;
  }
  return Math.min(
    block.sourceLocator.lineRange.startLine + newlineCount,
    block.sourceLocator.lineRange.endLineExclusive,
  );
}

function intervalIsNoise(
  index: DocumentBlockIndexV1,
  startByte: number,
  endByte: number,
): boolean {
  let blockIndex = firstBlockEndingAfter(index.blocks, startByte);
  let found = false;
  while (blockIndex < index.blocks.length) {
    const block = index.blocks[blockIndex];
    if (block.canonicalRange.startByte >= endByte)
      break;
    if (
      block.canonicalRange.endByte > startByte
      && block.canonicalRange.startByte < endByte
    ) {
      found = true;
      if (block.kind !== 'separator' && block.canonicalText.trim().length > 0)
        return false;
    }
    blockIndex++;
  }
  return found;
}

function firstBlockEndingAfter(
  blocks: readonly CanonicalDocumentBlockV1[],
  cursor: number,
): number {
  let low = 0;
  let high = blocks.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (blocks[middle].canonicalRange.endByte > cursor)
      high = middle;
    else
      low = middle + 1;
  }
  return low;
}

function exactSlice(bytes: Buffer, range: TextRangeV1): Buffer {
  return bytes.subarray(range.startByte, range.endByte);
}

function sameLineRange(
  block: CanonicalDocumentBlockV1,
  candidate: ChapterCandidateV1,
): boolean {
  return block.sourceLocator.lineRange.startLine === candidate.lineRange.startLine
    && block.sourceLocator.lineRange.endLineExclusive
    === candidate.lineRange.endLineExclusive;
}

function rangeKey(range: TextRangeV1): string {
  return `${range.startByte}:${range.endByte}`;
}

function compareCodeUnits(left: string, right: string): number {
  if (left < right)
    return -1;
  if (left > right)
    return 1;
  return 0;
}

function rangeLike(
  range: TextRangeV1,
  startByte: number,
  endByte: number,
): TextRangeV1 {
  return { ...range, startByte, endByte };
}

function revisionRange(
  index: DocumentBlockIndexV1,
  startByte: number,
  endByte: number,
): TextRangeV1 {
  return {
    textRevisionId: index.canonicalTextRevision.textRevisionId,
    textLayer: 'canonical',
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function isUtf8ScalarBoundary(bytes: Uint8Array, offset: number): boolean {
  if (offset === 0 || offset === bytes.byteLength)
    return true;
  const byte = bytes[offset];
  return byte !== undefined && (byte & 0b1100_0000) !== 0b1000_0000;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new ChapterIndexBuildError(detailReason, message);
}
