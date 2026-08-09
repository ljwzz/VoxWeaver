/// <reference types="node" />

import type {
  ChapterIndexV1,
  ProcessingSegmentContextV1,
  ProcessingSegmentIndexV1,
  ProcessingSegmentV1,
  SceneIndexV1,
  SceneV1,
  TextRangeV1,
  TxtSourceLocatorV1,
} from '@voxweaver/contracts';
import type {
  CanonicalDocumentBlockV1,
  DocumentBlockIndexV1,
} from './documentBlock.js';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import { parseProcessingSegmentIndexV1 } from '@voxweaver/contracts';

import { validateDocumentBlockIndexV1 } from './blockAlignment.js';
import { validateChapterIndexDomainV1 } from './chapter.js';
import { validateSceneIndexDomainV1 } from './scene.js';

export class ProcessingSegmentIndexDomainValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'ProcessingSegmentIndexDomainValidationError';
  }
}

/**
 * Validates technical ProcessingSegments against their exact Scene, Chapter,
 * canonical block text, and source-locator projection.
 */
export function validateProcessingSegmentIndexDomainV1(
  value: ProcessingSegmentIndexV1,
  sceneIndexValue: SceneIndexV1,
  chapterIndexValue: ChapterIndexV1,
  blockIndexValue: DocumentBlockIndexV1,
): ProcessingSegmentIndexV1 {
  const segmentIndex = parseContract(value);
  const chapterIndex = validateChapterInput(chapterIndexValue);
  const blockIndex = validateBlockInput(blockIndexValue);
  const sceneIndex = validateSceneInput(
    sceneIndexValue,
    chapterIndex,
    blockIndex,
  );
  assertReadyInput(sceneIndex, chapterIndex, blockIndex);
  assertSharedInput(segmentIndex, sceneIndex, chapterIndex, blockIndex);

  const canonicalBytes = Buffer.from(
    blockIndex.blocks.map(block => block.canonicalText).join(''),
    'utf8',
  );
  const scenes = new Map(sceneIndex.scenes.map(scene => [scene.sceneId, scene]));
  const segmentsByScene = groupSegments(segmentIndex.segments, scenes);
  assertSceneCoverage(sceneIndex.scenes, segmentsByScene);
  for (const segment of segmentIndex.segments) {
    const scene = scenes.get(segment.sceneId);
    if (scene === undefined)
      invalid('processing_segment_scene_missing', 'ProcessingSegment Scene is missing');
    assertSegmentTrace(segment, scene, blockIndex.blocks, canonicalBytes);
    assertContexts(
      segment,
      scene,
      canonicalBytes,
      segmentIndex.configuration.contextBeforeBytes,
      segmentIndex.configuration.contextAfterBytes,
    );
  }
  return segmentIndex;
}

function parseContract(value: ProcessingSegmentIndexV1): ProcessingSegmentIndexV1 {
  try {
    return parseProcessingSegmentIndexV1(value);
  } catch (error) {
    invalid(
      'processing_segment_index_contract_invalid',
      `ProcessingSegmentIndexV1 violates its public contract: ${errorMessage(error)}`,
    );
  }
}

function validateChapterInput(value: ChapterIndexV1): ChapterIndexV1 {
  try {
    return validateChapterIndexDomainV1(value);
  } catch (error) {
    invalid(
      'processing_segment_chapter_index_invalid',
      `ProcessingSegment ChapterIndex input is invalid: ${errorMessage(error)}`,
    );
  }
}

function validateBlockInput(value: DocumentBlockIndexV1): DocumentBlockIndexV1 {
  try {
    return validateDocumentBlockIndexV1(value);
  } catch (error) {
    invalid(
      'processing_segment_block_index_invalid',
      `ProcessingSegment block index input is invalid: ${errorMessage(error)}`,
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
      `ProcessingSegment SceneIndex input is invalid: ${errorMessage(error)}`,
    );
  }
}

function assertReadyInput(
  sceneIndex: SceneIndexV1,
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
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

function assertSharedInput(
  segmentIndex: ProcessingSegmentIndexV1,
  sceneIndex: SceneIndexV1,
  chapterIndex: ChapterIndexV1,
  blockIndex: DocumentBlockIndexV1,
): void {
  if (
    segmentIndex.sourceAssetId !== sceneIndex.sourceAssetId
    || segmentIndex.sourceAssetId !== chapterIndex.sourceAssetId
    || segmentIndex.sourceAssetId !== blockIndex.sourceAssetId
    || segmentIndex.sourceHash !== sceneIndex.sourceHash
    || segmentIndex.sourceHash !== chapterIndex.sourceHash
    || segmentIndex.sourceHash !== blockIndex.sourceContentHash
  ) {
    invalid(
      'processing_segment_source_provenance_mismatch',
      'ProcessingSegment, Scene, Chapter, and block indexes must share one source',
    );
  }
  if (
    !sameRevision(segmentIndex.textRevision, sceneIndex.textRevision)
    || !sameRevision(segmentIndex.textRevision, chapterIndex.textRevision)
    || !sameRevision(segmentIndex.textRevision, blockIndex.canonicalTextRevision)
  ) {
    invalid(
      'processing_segment_text_revision_mismatch',
      'ProcessingSegment inputs must share one canonical text revision',
    );
  }
}

function groupSegments(
  segments: readonly ProcessingSegmentV1[],
  scenes: ReadonlyMap<string, SceneV1>,
): ReadonlyMap<string, readonly ProcessingSegmentV1[]> {
  const grouped = new Map<string, ProcessingSegmentV1[]>();
  let previousSceneStart = -1;
  let previousSceneId: string | undefined;
  for (const segment of segments) {
    const scene = scenes.get(segment.sceneId);
    if (scene === undefined) {
      invalid(
        'processing_segment_scene_missing',
        'Every ProcessingSegment must reference an existing Scene',
      );
    }
    if (
      segment.chapterId !== scene.chapterId
      || segment.sceneStartBoundaryCandidateId !== scene.startBoundaryCandidateId
    ) {
      invalid(
        'processing_segment_scene_reference_invalid',
        'ProcessingSegment must preserve its Scene Chapter and start boundary identity',
      );
    }
    if (segment.sceneId !== previousSceneId) {
      if (scene.range.startByte <= previousSceneStart) {
        invalid(
          'processing_segment_scene_order_invalid',
          'ProcessingSegment Scene groups must follow canonical source order',
        );
      }
      previousSceneStart = scene.range.startByte;
      previousSceneId = segment.sceneId;
    }
    const sceneSegments = grouped.get(segment.sceneId) ?? [];
    sceneSegments.push(segment);
    grouped.set(segment.sceneId, sceneSegments);
  }
  return grouped;
}

function assertSceneCoverage(
  scenes: readonly SceneV1[],
  segmentsByScene: ReadonlyMap<string, readonly ProcessingSegmentV1[]>,
): void {
  for (const scene of scenes) {
    const segments = segmentsByScene.get(scene.sceneId) ?? [];
    if (segments.length === 0) {
      invalid(
        'processing_segment_scene_uncovered',
        'Every Scene must contain at least one ProcessingSegment',
      );
    }
    let cursor = scene.range.startByte;
    for (const segment of segments) {
      if (
        segment.sourceRange.startByte !== cursor
        || segment.sourceRange.endByte > scene.range.endByte
      ) {
        invalid(
          'processing_segment_scene_coverage_invalid',
          'ProcessingSegments must contiguously cover only their Scene range',
        );
      }
      cursor = segment.sourceRange.endByte;
    }
    if (cursor !== scene.range.endByte) {
      invalid(
        'processing_segment_scene_coverage_invalid',
        'ProcessingSegments must reach the end of their Scene range',
      );
    }
  }
}

function assertSegmentTrace(
  segment: ProcessingSegmentV1,
  scene: SceneV1,
  blocks: readonly CanonicalDocumentBlockV1[],
  canonicalBytes: Uint8Array,
): void {
  if (!rangeContains(scene.range, segment.sourceRange)) {
    invalid(
      'processing_segment_range_outside_scene',
      'ProcessingSegment sourceRange must stay inside its Scene',
    );
  }
  const expectedReferences = blocks
    .filter(block => rangesOverlap(block.canonicalRange, segment.sourceRange))
    .map(block => ({
      block,
      range: intersection(block.canonicalRange, segment.sourceRange),
    }));
  if (expectedReferences.length !== segment.blockReferences.length) {
    invalid(
      'processing_segment_block_projection_invalid',
      'ProcessingSegment must reference every intersecting canonical block exactly once',
    );
  }
  for (const [position, reference] of segment.blockReferences.entries()) {
    const expected = expectedReferences[position];
    if (
      expected === undefined
      || reference.blockId !== expected.block.blockId
      || !sameRange(reference.range, expected.range)
      || !sameLocator(reference.sourceLocator, expected.block.sourceLocator)
    ) {
      invalid(
        'processing_segment_block_projection_invalid',
        'ProcessingSegment block projection must preserve ranges and source locators',
      );
    }
  }
  const text = sliceExact(canonicalBytes, segment.sourceRange);
  if (segment.text !== text || segment.contentHash !== sha256(text)) {
    invalid(
      'processing_segment_text_projection_invalid',
      'ProcessingSegment text and hash must exactly match its canonical sourceRange',
    );
  }
}

function assertContexts(
  segment: ProcessingSegmentV1,
  scene: SceneV1,
  canonicalBytes: Uint8Array,
  contextBeforeBytes: number,
  contextAfterBytes: number,
): void {
  const expectedBefore = expectedContext(
    canonicalBytes,
    scene.range,
    segment.sourceRange,
    contextBeforeBytes,
    'before',
  );
  const expectedAfter = expectedContext(
    canonicalBytes,
    scene.range,
    segment.sourceRange,
    contextAfterBytes,
    'after',
  );
  assertContext(segment.contextBefore, expectedBefore, 'contextBefore');
  assertContext(segment.contextAfter, expectedAfter, 'contextAfter');
}

function expectedContext(
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

function assertContext(
  actual: ProcessingSegmentContextV1 | undefined,
  expected: ProcessingSegmentContextV1 | undefined,
  fieldName: string,
): void {
  if (actual === undefined || expected === undefined) {
    if (actual !== expected) {
      invalid(
        'processing_segment_context_projection_invalid',
        `ProcessingSegment ${fieldName} presence must match its explicit byte budget`,
      );
    }
    return;
  }
  if (
    !sameRange(actual.sourceRange, expected.sourceRange)
    || actual.text !== expected.text
    || actual.contentHash !== expected.contentHash
  ) {
    invalid(
      'processing_segment_context_projection_invalid',
      `ProcessingSegment ${fieldName} must be exact adjacent text within its Scene`,
    );
  }
}

function sliceExact(bytes: Uint8Array, value: TextRangeV1): string {
  if (
    !isUtf8ScalarBoundary(bytes, value.startByte)
    || !isUtf8ScalarBoundary(bytes, value.endByte)
  ) {
    invalid(
      'processing_segment_utf8_boundary_invalid',
      'ProcessingSegment ranges must use UTF-8 scalar boundaries',
    );
  }
  const slice = Buffer.from(bytes).subarray(value.startByte, value.endByte);
  const text = slice.toString('utf8');
  if (!Buffer.from(text, 'utf8').equals(slice)) {
    invalid(
      'processing_segment_utf8_invalid',
      'ProcessingSegment ranges must contain exact valid UTF-8 bytes',
    );
  }
  return text;
}

function rangesOverlap(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.startByte < right.endByte && right.startByte < left.endByte;
}

function rangeContains(container: TextRangeV1, contained: TextRangeV1): boolean {
  return sameRangeRevision(container, contained)
    && container.startByte <= contained.startByte
    && contained.endByte <= container.endByte;
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
  left: ProcessingSegmentIndexV1['textRevision'],
  right: ProcessingSegmentIndexV1['textRevision'],
): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength;
}

function sameRange(left: TextRangeV1, right: TextRangeV1): boolean {
  return sameRangeRevision(left, right)
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function sameRangeRevision(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.offsetUnit === right.offsetUnit;
}

function sameLocator(left: TxtSourceLocatorV1, right: TxtSourceLocatorV1): boolean {
  return left.sourceAssetId === right.sourceAssetId
    && left.sourceContentHash === right.sourceContentHash
    && left.sourceEncoding === right.sourceEncoding
    && left.sourceByteRange.offsetUnit === right.sourceByteRange.offsetUnit
    && left.sourceByteRange.startByte === right.sourceByteRange.startByte
    && left.sourceByteRange.endByte === right.sourceByteRange.endByte
    && sameRange(left.rawTextRange, right.rawTextRange)
    && left.lineRange.lineBase === right.lineRange.lineBase
    && left.lineRange.startLine === right.lineRange.startLine
    && left.lineRange.endLineExclusive === right.lineRange.endLineExclusive;
}

function isUtf8ScalarBoundary(bytes: Uint8Array, offset: number): boolean {
  if (offset === 0 || offset === bytes.byteLength)
    return true;
  const byte = bytes[offset];
  return byte !== undefined && (byte & 0b1100_0000) !== 0b1000_0000;
}

function sha256(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown error';
}

function invalid(detailReason: string, message: string): never {
  throw new ProcessingSegmentIndexDomainValidationError(detailReason, message);
}
