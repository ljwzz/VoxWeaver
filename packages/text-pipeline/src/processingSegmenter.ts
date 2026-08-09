/// <reference types="node" />

import type {
  ChapterIndexV1,
  ProcessingSegmentConfigurationV1,
  ProcessingSegmentContextV1,
  ProcessingSegmentIndexV1,
  ProcessingSegmentV1,
  SceneIndexV1,
  SceneV1,
  TextRangeV1,
} from '@voxweaver/contracts';
import type {
  CanonicalDocumentBlockV1,
  DocumentBlockIndexV1,
} from '@voxweaver/novel-domain';

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';

import {
  NOVEL_IMPORT_SCHEMA_VERSION,
  parseProcessingSegmentIndexV1,
} from '@voxweaver/contracts';
import {
  validateChapterIndexDomainV1,
  validateDocumentBlockIndexV1,
  validateProcessingSegmentIndexDomainV1,
  validateSceneIndexDomainV1,
} from '@voxweaver/novel-domain';

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SENTENCE_END_CHARACTERS = new Set(['。', '！', '？', '!', '?', '；', ';', '…']);
const CLOSING_QUOTE_CHARACTERS = new Set(['”', '’', '」', '』', '"']);
const OPENING_QUOTE_PAIRS = new Map([
  ['“', '”'],
  ['‘', '’'],
  ['「', '」'],
  ['『', '』'],
  ['"', '"'],
]);

export const PROCESSING_SEGMENTER_PROCESSOR_ID
  = 'voxweaver.text-pipeline.processing-segmenter' as const;
export const PROCESSING_SEGMENTER_PROCESSOR_VERSION = '1.0.0' as const;
export const PROCESSING_SEGMENT_BOUNDARY_POLICY_VERSION
  = 'm2-processing-segment-boundary-v1' as const;

export interface CreateProcessingSegmentsOptionsV1 {
  readonly maxSegmentBytes: number;
  readonly contextBeforeBytes: number;
  readonly contextAfterBytes: number;
  readonly processingSegmentIdFactory?: () => string;
}

export interface CreateProcessingSegmentsInputV1 {
  readonly chapterIndex: ChapterIndexV1;
  readonly sceneIndex: SceneIndexV1;
  readonly blockIndex: DocumentBlockIndexV1;
  readonly previousProcessingSegmentIndex?: ProcessingSegmentIndexV1;
  readonly options: CreateProcessingSegmentsOptionsV1;
}

interface BoundarySets {
  readonly paragraph: readonly number[];
  readonly dialogue: readonly number[];
  readonly sentence: readonly number[];
}

interface IdContext {
  readonly unavailableFreshIds: Set<string>;
  readonly claimedOutputIds: Set<string>;
  readonly processingSegmentIdFactory: () => string;
  readonly previousSegmentIds: ReadonlyMap<string, string>;
}

export class ProcessingSegmenterError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProcessingSegmenterError';
  }
}

export function createProcessingSegmentsV1(
  input: CreateProcessingSegmentsInputV1,
): ProcessingSegmentIndexV1 {
  assertUnresolvedReviewStatus(
    input?.chapterIndex,
    'processing_segment_chapter_review_required',
    'ProcessingSegment creation requires a resolved ChapterIndex',
  );
  assertUnresolvedReviewStatus(
    input?.blockIndex,
    'processing_segment_block_review_required',
    'ProcessingSegment creation requires a resolved canonical block index',
  );
  assertUnresolvedReviewStatus(
    input?.sceneIndex,
    'processing_segment_scene_review_required',
    'ProcessingSegment creation requires a confirmed SceneIndex',
  );
  const chapterIndex = validateChapterInput(input?.chapterIndex);
  const blockIndex = validateBlockInput(input?.blockIndex);
  const sceneIndex = validateSceneInput(
    input?.sceneIndex,
    chapterIndex,
    blockIndex,
  );
  assertReadyInput(chapterIndex, blockIndex, sceneIndex);
  const options = validateOptions(input?.options);
  const configuration: ProcessingSegmentConfigurationV1 = {
    maxSegmentBytes: options.maxSegmentBytes,
    contextBeforeBytes: options.contextBeforeBytes,
    contextAfterBytes: options.contextAfterBytes,
    boundaryPolicyVersion: PROCESSING_SEGMENT_BOUNDARY_POLICY_VERSION,
  };
  const previous = validatePreviousInput(
    input?.previousProcessingSegmentIndex,
    chapterIndex,
    blockIndex,
  );
  const ids = createIdContext(
    chapterIndex,
    sceneIndex,
    blockIndex,
    previous,
    options,
  );
  const canonicalBytes = canonicalTextBytes(blockIndex);
  const segments = buildSegments(
    sceneIndex,
    blockIndex,
    canonicalBytes,
    configuration,
    ids,
  );
  const value: ProcessingSegmentIndexV1 = {
    documentType: 'processing-segment-index',
    schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: PROCESSING_SEGMENTER_PROCESSOR_ID,
    processorVersion: PROCESSING_SEGMENTER_PROCESSOR_VERSION,
    textRevision: blockIndex.canonicalTextRevision,
    configuration,
    segments,
  };
  try {
    parseProcessingSegmentIndexV1(value);
    return validateProcessingSegmentIndexDomainV1(
      value,
      sceneIndex,
      chapterIndex,
      blockIndex,
    );
  } catch (error) {
    invalid(
      'processing_segment_output_invalid',
      `Generated ProcessingSegmentIndexV1 is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateChapterInput(value: ChapterIndexV1): ChapterIndexV1 {
  try {
    return validateChapterIndexDomainV1(value);
  } catch (error) {
    invalid(
      'processing_segment_chapter_index_invalid',
      `ProcessingSegment ChapterIndex is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateBlockInput(value: DocumentBlockIndexV1): DocumentBlockIndexV1 {
  try {
    return validateDocumentBlockIndexV1(value);
  } catch (error) {
    invalid(
      'processing_segment_block_index_invalid',
      `ProcessingSegment block index is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateSceneInput(
  value: SceneIndexV1,
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
): SceneIndexV1 {
  try {
    return validateSceneIndexDomainV1(value, chapterIndex, blockIndex);
  } catch (error) {
    invalid(
      'processing_segment_scene_index_invalid',
      `ProcessingSegment SceneIndex is invalid: ${errorMessage(error)}`,
    );
  }
}

function assertReadyInput(
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
  sceneIndex: SceneIndexV1,
): void {
  if (
    chapterIndex.reviewStatus !== 'not_required'
    && chapterIndex.reviewStatus !== 'approved'
  ) {
    invalid(
      'processing_segment_chapter_review_required',
      'ProcessingSegment creation requires a resolved ChapterIndex',
    );
  }
  if (!chapterIndex.coverageReport.complete) {
    invalid(
      'processing_segment_chapter_coverage_incomplete',
      'ProcessingSegment creation requires complete Chapter coverage',
    );
  }
  const blockReviewStatus: unknown = blockIndex.reviewStatus;
  if (blockReviewStatus !== 'not_required' && blockReviewStatus !== 'approved') {
    invalid(
      'processing_segment_block_review_required',
      'ProcessingSegment creation requires a resolved canonical block index',
    );
  }
  if (
    sceneIndex.reviewStatus !== 'not_required'
    && sceneIndex.reviewStatus !== 'approved'
  ) {
    invalid(
      'processing_segment_scene_review_required',
      'ProcessingSegment creation requires a confirmed SceneIndex',
    );
  }
}

function assertUnresolvedReviewStatus(
  value: unknown,
  detailReason: string,
  message: string,
): void {
  if (typeof value !== 'object' || value === null)
    return;
  const reviewStatus = (value as { readonly reviewStatus?: unknown }).reviewStatus;
  if (reviewStatus === 'pending' || reviewStatus === 'rejected')
    invalid(detailReason, message);
}

function validateOptions(
  value: CreateProcessingSegmentsOptionsV1,
): CreateProcessingSegmentsOptionsV1 {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    invalid(
      'processing_segment_options_invalid',
      'ProcessingSegment options with explicit byte budgets are required',
    );
  }
  assertByteBudget(value.maxSegmentBytes, false, 'maxSegmentBytes');
  assertByteBudget(value.contextBeforeBytes, true, 'contextBeforeBytes');
  assertByteBudget(value.contextAfterBytes, true, 'contextAfterBytes');
  if (
    value.processingSegmentIdFactory !== undefined
    && typeof value.processingSegmentIdFactory !== 'function'
  ) {
    invalid(
      'processing_segment_id_factory_invalid',
      'ProcessingSegment ID factory must be a function',
    );
  }
  return value;
}

function assertByteBudget(
  value: number,
  allowZero: boolean,
  fieldName: string,
): void {
  if (
    !Number.isSafeInteger(value)
    || value < (allowZero ? 0 : 1)
  ) {
    invalid(
      'processing_segment_budget_invalid',
      `${fieldName} must be an explicit ${allowZero ? 'non-negative' : 'positive'} safe integer`,
    );
  }
}

function validatePreviousInput(
  value: ProcessingSegmentIndexV1 | undefined,
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
): ProcessingSegmentIndexV1 | undefined {
  if (value === undefined)
    return undefined;
  let previous: ProcessingSegmentIndexV1;
  try {
    previous = parseProcessingSegmentIndexV1(value);
  } catch (error) {
    invalid(
      'processing_segment_previous_index_invalid',
      `Previous ProcessingSegmentIndex is invalid: ${errorMessage(error)}`,
    );
  }
  if (
    previous.sourceAssetId !== chapterIndex.sourceAssetId
    || previous.sourceAssetId !== blockIndex.sourceAssetId
    || previous.sourceHash !== chapterIndex.sourceHash
    || previous.sourceHash !== blockIndex.sourceContentHash
    || !sameRevision(previous.textRevision, chapterIndex.textRevision)
    || !sameRevision(previous.textRevision, blockIndex.canonicalTextRevision)
  ) {
    invalid(
      'processing_segment_previous_input_mismatch',
      'Previous ProcessingSegmentIndex must reference the same source and revision',
    );
  }
  return previous;
}

function createIdContext(
  chapterIndex: ChapterIndexV1,
  sceneIndex: SceneIndexV1,
  blockIndex: DocumentBlockIndexV1,
  previous: ProcessingSegmentIndexV1 | undefined,
  options: CreateProcessingSegmentsOptionsV1,
): IdContext {
  const upstreamIds = collectUpstreamIds(chapterIndex, sceneIndex, blockIndex);
  const previousOutputIds = new Set<string>();
  if (previous !== undefined) {
    for (const segment of previous.segments) {
      if (
        upstreamIds.has(segment.processingSegmentId)
        || previousOutputIds.has(segment.processingSegmentId)
      ) {
        invalid(
          'processing_segment_previous_id_collision',
          'Previous ProcessingSegment IDs must be unique and disjoint from upstream IDs',
        );
      }
      previousOutputIds.add(segment.processingSegmentId);
    }
  }
  const reusablePrevious = previous?.processorId === PROCESSING_SEGMENTER_PROCESSOR_ID
    && previous.processorVersion === PROCESSING_SEGMENTER_PROCESSOR_VERSION
    ? previous
    : undefined;
  return {
    unavailableFreshIds: new Set([...upstreamIds, ...previousOutputIds]),
    claimedOutputIds: new Set<string>(),
    processingSegmentIdFactory: options.processingSegmentIdFactory ?? randomUUID,
    previousSegmentIds: uniquePreviousIdMap(
      reusablePrevious?.segments.map(segment => [
        segmentStableKey(segment, reusablePrevious.configuration),
        segment.processingSegmentId,
      ]) ?? [],
    ),
  };
}

function collectUpstreamIds(
  chapterIndex: ChapterIndexV1,
  sceneIndex: SceneIndexV1,
  blockIndex: DocumentBlockIndexV1,
): Set<string> {
  const ids = new Set<string>([
    chapterIndex.sourceAssetId,
    chapterIndex.textRevision.textRevisionId,
    blockIndex.rawTextRevision.textRevisionId,
    blockIndex.canonicalTextRevision.textRevisionId,
  ]);
  for (const candidate of chapterIndex.candidates)
    ids.add(candidate.chapterCandidateId);
  for (const chapter of chapterIndex.entries) {
    ids.add(chapter.chapterId);
    if (chapter.volumeId !== undefined)
      ids.add(chapter.volumeId);
  }
  for (const issue of chapterIndex.issues)
    ids.add(issue.issueId);
  for (const block of blockIndex.blocks)
    ids.add(block.blockId);
  for (const candidate of sceneIndex.candidates)
    ids.add(candidate.sceneBoundaryCandidateId);
  for (const scene of sceneIndex.scenes)
    ids.add(scene.sceneId);
  for (const issue of sceneIndex.issues)
    ids.add(issue.issueId);
  return ids;
}

function uniquePreviousIdMap(
  entries: readonly (readonly [string, string])[],
): ReadonlyMap<string, string> {
  const ids = new Map<string, string>();
  const ambiguous = new Set<string>();
  for (const [key, id] of entries) {
    if (ids.has(key)) {
      ids.delete(key);
      ambiguous.add(key);
    } else if (!ambiguous.has(key)) {
      ids.set(key, id);
    }
  }
  return ids;
}

function buildSegments(
  sceneIndex: SceneIndexV1,
  blockIndex: DocumentBlockIndexV1,
  canonicalBytes: Uint8Array,
  configuration: ProcessingSegmentConfigurationV1,
  ids: IdContext,
): readonly ProcessingSegmentV1[] {
  const segments: ProcessingSegmentV1[] = [];
  const blocks = new Map(blockIndex.blocks.map(block => [block.blockId, block]));
  for (const scene of sceneIndex.scenes) {
    const boundaries = collectBoundaries(scene, blocks, canonicalBytes);
    let startByte = scene.range.startByte;
    let order = 0;
    while (startByte < scene.range.endByte) {
      const endByte = selectSegmentEnd(
        startByte,
        scene.range.endByte,
        configuration.maxSegmentBytes,
        boundaries,
        canonicalBytes,
      );
      const sourceRange = rangeLike(scene.range, startByte, endByte);
      const text = sliceExact(canonicalBytes, sourceRange);
      const contextBefore = buildContext(
        canonicalBytes,
        scene.range,
        sourceRange,
        configuration.contextBeforeBytes,
        'before',
      );
      const contextAfter = buildContext(
        canonicalBytes,
        scene.range,
        sourceRange,
        configuration.contextAfterBytes,
        'after',
      );
      const segment: Omit<ProcessingSegmentV1, 'processingSegmentId'> = {
        chapterId: scene.chapterId,
        sceneId: scene.sceneId,
        ...(scene.startBoundaryCandidateId === undefined
          ? {}
          : { sceneStartBoundaryCandidateId: scene.startBoundaryCandidateId }),
        order,
        sourceRange,
        text,
        contentHash: sha256(text),
        blockReferences: blockReferences(scene, sourceRange),
        ...(contextBefore === undefined ? {} : { contextBefore }),
        ...(contextAfter === undefined ? {} : { contextAfter }),
      };
      const previousId = ids.previousSegmentIds.get(
        segmentStableKey(segment, configuration),
      );
      segments.push({
        processingSegmentId: stableOutputId(previousId, ids),
        ...segment,
      });
      startByte = endByte;
      order += 1;
    }
  }
  return segments;
}

function collectBoundaries(
  scene: SceneV1,
  blocks: ReadonlyMap<string, CanonicalDocumentBlockV1>,
  canonicalBytes: Uint8Array,
): BoundarySets {
  const paragraph = scene.blockReferences
    .map(reference => reference.range.endByte)
    .filter(offset => offset < scene.range.endByte);
  for (const reference of scene.blockReferences) {
    if (!blocks.has(reference.blockId)) {
      invalid(
        'processing_segment_scene_block_missing',
        'Scene references a canonical block that is not available',
      );
    }
  }
  const text = sliceExact(canonicalBytes, scene.range);
  const dialogue = new Set<number>();
  const sentence = new Set<number>();
  const quoteStack: string[] = [];
  let byteCursor = scene.range.startByte;
  let pendingSentenceBoundary: number | undefined;
  for (const character of text) {
    byteCursor += Buffer.byteLength(character, 'utf8');
    const expectedClose = quoteStack[quoteStack.length - 1];
    if (expectedClose !== undefined && character === expectedClose) {
      quoteStack.pop();
      if (quoteStack.length === 0)
        dialogue.add(byteCursor);
    } else {
      const closing = OPENING_QUOTE_PAIRS.get(character);
      if (closing !== undefined)
        quoteStack.push(closing);
    }

    if (SENTENCE_END_CHARACTERS.has(character)) {
      pendingSentenceBoundary = byteCursor;
    } else if (
      pendingSentenceBoundary !== undefined
      && CLOSING_QUOTE_CHARACTERS.has(character)
    ) {
      pendingSentenceBoundary = byteCursor;
    } else if (pendingSentenceBoundary !== undefined) {
      sentence.add(pendingSentenceBoundary);
      pendingSentenceBoundary = undefined;
    }
  }
  if (pendingSentenceBoundary !== undefined)
    sentence.add(pendingSentenceBoundary);
  return {
    paragraph: [...new Set(paragraph)].sort(compareNumber),
    dialogue: [...dialogue].sort(compareNumber),
    sentence: [...sentence].sort(compareNumber),
  };
}

function selectSegmentEnd(
  startByte: number,
  sceneEndByte: number,
  maxSegmentBytes: number,
  boundaries: BoundarySets,
  canonicalBytes: Uint8Array,
): number {
  if (sceneEndByte - startByte <= maxSegmentBytes)
    return sceneEndByte;
  let hardLimit = startByte + maxSegmentBytes;
  while (hardLimit > startByte && !isUtf8ScalarBoundary(canonicalBytes, hardLimit))
    hardLimit -= 1;
  if (hardLimit === startByte) {
    invalid(
      'processing_segment_limit_too_small',
      'maxSegmentBytes cannot contain the next complete UTF-8 scalar value',
    );
  }
  for (const candidates of [
    boundaries.paragraph,
    boundaries.dialogue,
    boundaries.sentence,
  ]) {
    const selected = greatestBoundary(candidates, startByte, hardLimit);
    if (selected !== undefined)
      return selected;
  }
  return hardLimit;
}

function greatestBoundary(
  candidates: readonly number[],
  startByte: number,
  endByte: number,
): number | undefined {
  let selected: number | undefined;
  for (const candidate of candidates) {
    if (candidate <= startByte)
      continue;
    if (candidate > endByte)
      break;
    selected = candidate;
  }
  return selected;
}

function blockReferences(
  scene: SceneV1,
  sourceRange: TextRangeV1,
): ProcessingSegmentV1['blockReferences'] {
  return scene.blockReferences
    .filter(reference => rangesOverlap(reference.range, sourceRange))
    .map(reference => ({
      blockId: reference.blockId,
      range: intersection(reference.range, sourceRange),
      sourceLocator: reference.sourceLocator,
    }));
}

function buildContext(
  canonicalBytes: Uint8Array,
  sceneRange: TextRangeV1,
  segmentRange: TextRangeV1,
  maxBytes: number,
  direction: 'after' | 'before',
): ProcessingSegmentContextV1 | undefined {
  let startByte: number;
  let endByte: number;
  if (direction === 'before') {
    startByte = Math.max(sceneRange.startByte, segmentRange.startByte - maxBytes);
    endByte = segmentRange.startByte;
    while (startByte < endByte && !isUtf8ScalarBoundary(canonicalBytes, startByte))
      startByte += 1;
  } else {
    startByte = segmentRange.endByte;
    endByte = Math.min(sceneRange.endByte, segmentRange.endByte + maxBytes);
    while (endByte > startByte && !isUtf8ScalarBoundary(canonicalBytes, endByte))
      endByte -= 1;
  }
  if (startByte === endByte)
    return undefined;
  const sourceRange = rangeLike(segmentRange, startByte, endByte);
  const text = sliceExact(canonicalBytes, sourceRange);
  return { sourceRange, text, contentHash: sha256(text) };
}

function canonicalTextBytes(blockIndex: DocumentBlockIndexV1): Uint8Array {
  const text = blockIndex.blocks.map(block => block.canonicalText).join('');
  const bytes = Buffer.from(text, 'utf8');
  if (
    bytes.byteLength !== blockIndex.canonicalTextRevision.byteLength
    || sha256Bytes(bytes) !== blockIndex.canonicalTextRevision.contentHash
  ) {
    invalid(
      'processing_segment_canonical_text_invalid',
      'Canonical block bytes must exactly match their text revision',
    );
  }
  return bytes;
}

function sliceExact(bytes: Uint8Array, value: TextRangeV1): string {
  if (
    !isUtf8ScalarBoundary(bytes, value.startByte)
    || !isUtf8ScalarBoundary(bytes, value.endByte)
  ) {
    invalid(
      'processing_segment_utf8_boundary_invalid',
      'ProcessingSegment range must use UTF-8 scalar boundaries',
    );
  }
  const slice = Buffer.from(bytes).subarray(value.startByte, value.endByte);
  const text = slice.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(slice)) {
    invalid(
      'processing_segment_utf8_invalid',
      'ProcessingSegment range must contain exact valid UTF-8 bytes',
    );
  }
  return text;
}

function stableOutputId(
  previousId: string | undefined,
  ids: IdContext,
): string {
  if (previousId !== undefined) {
    if (
      !ids.unavailableFreshIds.has(previousId)
      || ids.claimedOutputIds.has(previousId)
    ) {
      invalid(
        'processing_segment_stable_id_collision',
        'A previous ProcessingSegment ID may be reused only once',
      );
    }
    ids.claimedOutputIds.add(previousId);
    return previousId;
  }
  let id: unknown;
  try {
    id = ids.processingSegmentIdFactory();
  } catch (error) {
    invalid(
      'processing_segment_id_factory_failed',
      `ProcessingSegment ID factory failed: ${errorMessage(error)}`,
    );
  }
  if (typeof id !== 'string' || !UUID_V4_PATTERN.test(id)) {
    invalid(
      'processing_segment_id_invalid',
      'ProcessingSegment ID factory must return UUID v4',
    );
  }
  if (ids.unavailableFreshIds.has(id) || ids.claimedOutputIds.has(id)) {
    invalid(
      'processing_segment_id_duplicate',
      'Fresh ProcessingSegment IDs must not collide with upstream or previous IDs',
    );
  }
  ids.unavailableFreshIds.add(id);
  ids.claimedOutputIds.add(id);
  return id;
}

function segmentStableKey(
  segment: Omit<ProcessingSegmentV1, 'processingSegmentId'> | ProcessingSegmentV1,
  configuration: ProcessingSegmentConfigurationV1,
): string {
  return JSON.stringify([
    segment.chapterId,
    segment.sceneId,
    segment.sceneStartBoundaryCandidateId ?? null,
    rangeStableKey(segment.sourceRange),
    segment.text,
    segment.contentHash,
    segment.blockReferences.map(reference => [
      reference.blockId,
      rangeStableKey(reference.range),
      locatorStableKey(reference.sourceLocator),
    ]),
    contextStableKey(segment.contextBefore),
    contextStableKey(segment.contextAfter),
    configuration.maxSegmentBytes,
    configuration.contextBeforeBytes,
    configuration.contextAfterBytes,
    configuration.boundaryPolicyVersion,
  ]);
}

function contextStableKey(
  context: ProcessingSegmentContextV1 | undefined,
): readonly unknown[] | null {
  return context === undefined
    ? null
    : [rangeStableKey(context.sourceRange), context.text, context.contentHash];
}

function rangeStableKey(value: TextRangeV1): readonly unknown[] {
  return [
    value.textRevisionId,
    value.textLayer,
    value.offsetUnit,
    value.startByte,
    value.endByte,
  ];
}

function locatorStableKey(
  value: CanonicalDocumentBlockV1['sourceLocator'],
): readonly unknown[] {
  return [
    value.sourceAssetId,
    value.sourceContentHash,
    value.sourceEncoding,
    value.sourceByteRange.offsetUnit,
    value.sourceByteRange.startByte,
    value.sourceByteRange.endByte,
    rangeStableKey(value.rawTextRange),
    value.lineRange.lineBase,
    value.lineRange.startLine,
    value.lineRange.endLineExclusive,
  ];
}

function rangesOverlap(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.startByte < right.endByte && right.startByte < left.endByte;
}

function intersection(left: TextRangeV1, right: TextRangeV1): TextRangeV1 {
  return rangeLike(
    left,
    Math.max(left.startByte, right.startByte),
    Math.min(left.endByte, right.endByte),
  );
}

function rangeLike(
  reference: TextRangeV1,
  startByte: number,
  endByte: number,
): TextRangeV1 {
  return { ...reference, startByte, endByte };
}

function sameRevision(
  left: ChapterIndexV1['textRevision'],
  right: DocumentBlockIndexV1['canonicalTextRevision'],
): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength;
}

function isUtf8ScalarBoundary(bytes: Uint8Array, offset: number): boolean {
  if (offset === 0 || offset === bytes.byteLength)
    return true;
  const byte = bytes[offset];
  return byte !== undefined && (byte & 0b1100_0000) !== 0b1000_0000;
}

function compareNumber(left: number, right: number): number {
  return left - right;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new ProcessingSegmenterError(detailReason, message);
}
