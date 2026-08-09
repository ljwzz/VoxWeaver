import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  ProcessingSegmentIndexDomainValidationError,
  validateProcessingSegmentIndexDomainV1,
} from '../dist/processingSegment.js';

test('validates lossless ProcessingSegments with exact Scene, block, and context trace', () => {
  const value = fixture();
  assert.equal(
    validateProcessingSegmentIndexDomainV1(
      value.segmentIndex,
      value.sceneIndex,
      value.chapterIndex,
      value.blockIndex,
    ),
    value.segmentIndex,
  );

  const restored = value.segmentIndex.segments.map(segment => segment.text).join('');
  const expected = value.blockIndex.blocks.slice(1)
    .map(block => block.canonicalText)
    .join('');
  assert.equal(restored, expected);
  assert.ok(value.segmentIndex.segments.every(segment =>
    segment.contextBefore === undefined
    || segment.contextBefore.sourceRange.endByte === segment.sourceRange.startByte));
  assert.ok(value.segmentIndex.segments.every(segment =>
    segment.contextAfter === undefined
    || segment.contextAfter.sourceRange.startByte === segment.sourceRange.endByte));
});

test('rejects gaps, overlaps, and incomplete Scene coverage', () => {
  const value = fixture();
  const [first, second, third] = value.segmentIndex.segments;
  const invalid = [
    { ...value.segmentIndex, segments: [first, third] },
    {
      ...value.segmentIndex,
      segments: [first, {
        ...second,
        sourceRange: range(
          value.blockIndex,
          second.sourceRange.startByte + 1,
          second.sourceRange.endByte,
        ),
        text: second.text.slice(1),
      }, third],
    },
    { ...value.segmentIndex, segments: [first, second] },
  ];

  for (const segmentIndex of invalid) {
    assert.throws(
      () => validateProcessingSegmentIndexDomainV1(
        segmentIndex,
        value.sceneIndex,
        value.chapterIndex,
        value.blockIndex,
      ),
      ProcessingSegmentIndexDomainValidationError,
    );
  }
});

test('rejects text, hash, block locator, and context projection drift', () => {
  const value = fixture();
  const textDrift = structuredClone(value.segmentIndex);
  textDrift.segments[0].contentHash = 'f'.repeat(64);

  const locatorDrift = structuredClone(value.segmentIndex);
  locatorDrift.segments[1].blockReferences[0].sourceLocator.lineRange = {
    lineBase: 1,
    startLine: 20,
    endLineExclusive: 21,
  };

  const contextDrift = structuredClone(value.segmentIndex);
  const contextBefore = contextDrift.segments[1].contextBefore;
  contextBefore.text = contextBefore.text.replace(/^./u, '错');
  contextBefore.contentHash = sha256(contextBefore.text);

  const crossSceneContext = structuredClone(value.segmentIndex);
  const first = crossSceneContext.segments[0];
  const heading = value.blockIndex.blocks[0];
  const contextText = sliceCanonical(
    value.blockIndex,
    heading.canonicalRange.endByte - 1,
    heading.canonicalRange.endByte,
  );
  first.contextBefore = {
    sourceRange: range(
      value.blockIndex,
      heading.canonicalRange.endByte - 1,
      heading.canonicalRange.endByte,
    ),
    text: contextText,
    contentHash: sha256(contextText),
  };

  for (const segmentIndex of [textDrift, locatorDrift, contextDrift, crossSceneContext]) {
    assert.throws(
      () => validateProcessingSegmentIndexDomainV1(
        segmentIndex,
        value.sceneIndex,
        value.chapterIndex,
        value.blockIndex,
      ),
      ProcessingSegmentIndexDomainValidationError,
    );
  }
});

test('rejects a stale Scene identity and public UUID/range violations', () => {
  const value = fixture();
  const staleScene = structuredClone(value.segmentIndex);
  for (const segment of staleScene.segments)
    segment.sceneId = uuid(999);
  assert.throws(
    () => validateProcessingSegmentIndexDomainV1(
      staleScene,
      value.sceneIndex,
      value.chapterIndex,
      value.blockIndex,
    ),
    error => isDomainError(error, 'processing_segment_scene_missing'),
  );

  const invalidUuid = structuredClone(value.segmentIndex);
  invalidUuid.segments[0].processingSegmentId = 'not-a-uuid';
  assert.throws(
    () => validateProcessingSegmentIndexDomainV1(
      invalidUuid,
      value.sceneIndex,
      value.chapterIndex,
      value.blockIndex,
    ),
    error => isDomainError(error, 'processing_segment_index_contract_invalid'),
  );

  const invalidRange = structuredClone(value.segmentIndex);
  invalidRange.segments[0].sourceRange.endByte
    = value.segmentIndex.textRevision.byteLength + 1;
  assert.throws(
    () => validateProcessingSegmentIndexDomainV1(
      invalidRange,
      value.sceneIndex,
      value.chapterIndex,
      value.blockIndex,
    ),
    error => isDomainError(error, 'processing_segment_index_contract_invalid'),
  );
});

function fixture() {
  const blockIndex = createBlockIndex([
    ['第一章 起点\n', 'heading'],
    ['甲段。\n', 'paragraph'],
    ['“完整对话。”\n', 'paragraph'],
    ['尾声😀。\n', 'paragraph'],
  ]);
  const heading = blockIndex.blocks[0];
  const contentBlocks = blockIndex.blocks.slice(1);
  const chapterId = uuid(600);
  const chapterIndex = {
    documentType: 'chapter-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'synthetic-chapter-index',
    processorVersion: '1',
    textRevision: blockIndex.canonicalTextRevision,
    candidates: [{
      chapterCandidateId: uuid(601),
      headingRange: heading.canonicalRange,
      lineRange: heading.sourceLocator.lineRange,
      rawTitle: '第一章 起点',
      normalizedTitle: '起点',
      ruleId: 'synthetic',
      ruleVersion: '1',
      ruleConfidence: 1,
      confidenceSource: 'synthetic deterministic evidence',
      evidence: ['synthetic heading'],
      contextBefore: [],
      contextAfter: ['甲段。'],
      reviewStatus: 'not_required',
    }],
    entries: [{
      chapterId,
      order: 0,
      chapterNumber: '1',
      title: '起点',
      rawHeading: '第一章 起点',
      headingRange: heading.canonicalRange,
      contentRange: range(
        blockIndex,
        contentBlocks[0].canonicalRange.startByte,
        contentBlocks.at(-1).canonicalRange.endByte,
      ),
      sourceLineRange: {
        lineBase: 1,
        startLine: heading.sourceLocator.lineRange.startLine,
        endLineExclusive: contentBlocks.at(-1).sourceLocator.lineRange.endLineExclusive,
      },
      confidence: 1,
      detectedBy: 'rule:synthetic@1',
      reviewStatus: 'not_required',
    }],
    coverageReport: {
      textRevisionId: blockIndex.canonicalTextRevision.textRevisionId,
      textLayer: 'canonical',
      totalByteLength: blockIndex.canonicalTextRevision.byteLength,
      classifiedByteLength: blockIndex.canonicalTextRevision.byteLength,
      unclassifiedByteLength: 0,
      complete: true,
      segments: [{
        classification: 'chapter',
        range: range(blockIndex, 0, blockIndex.canonicalTextRevision.byteLength),
        chapterId,
      }],
      unclassifiedRanges: [],
    },
    issues: [],
    reviewStatus: 'not_required',
  };
  const sceneId = uuid(610);
  const scene = sceneForRange(
    blockIndex,
    sceneId,
    chapterId,
    chapterIndex.entries[0].contentRange.startByte,
    chapterIndex.entries[0].contentRange.endByte,
  );
  const sceneIndex = {
    documentType: 'scene-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'synthetic-scene-detector',
    processorVersion: '1',
    textRevision: blockIndex.canonicalTextRevision,
    candidates: [],
    scenes: [scene],
    issues: [],
    reviewStatus: 'not_required',
  };
  const configuration = {
    maxSegmentBytes: Math.max(...contentBlocks.map(block =>
      block.canonicalRange.endByte - block.canonicalRange.startByte)),
    contextBeforeBytes: 7,
    contextAfterBytes: 7,
    boundaryPolicyVersion: 'm2-processing-segment-boundary-v1',
  };
  const segments = contentBlocks.map((block, order) => segmentForBlock(
    blockIndex,
    scene,
    block,
    order,
    configuration,
  ));
  const segmentIndex = {
    documentType: 'processing-segment-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'synthetic-processing-segmenter',
    processorVersion: '1',
    textRevision: blockIndex.canonicalTextRevision,
    configuration,
    segments,
  };
  return { blockIndex, chapterIndex, sceneIndex, segmentIndex };
}

function segmentForBlock(blockIndex, scene, block, order, configuration) {
  const contextBefore = contextFor(
    blockIndex,
    scene.range,
    block.canonicalRange,
    configuration.contextBeforeBytes,
    'before',
  );
  const contextAfter = contextFor(
    blockIndex,
    scene.range,
    block.canonicalRange,
    configuration.contextAfterBytes,
    'after',
  );
  return {
    processingSegmentId: uuid(620 + order),
    chapterId: scene.chapterId,
    sceneId: scene.sceneId,
    order,
    sourceRange: block.canonicalRange,
    text: block.canonicalText,
    contentHash: block.contentHash,
    blockReferences: [{
      blockId: block.blockId,
      range: block.canonicalRange,
      sourceLocator: block.sourceLocator,
    }],
    ...(contextBefore === undefined ? {} : { contextBefore }),
    ...(contextAfter === undefined ? {} : { contextAfter }),
  };
}

function contextFor(blockIndex, sceneRange, segmentRange, maxBytes, direction) {
  const bytes = canonicalBytes(blockIndex);
  let startByte;
  let endByte;
  if (direction === 'before') {
    startByte = Math.max(sceneRange.startByte, segmentRange.startByte - maxBytes);
    endByte = segmentRange.startByte;
    while (startByte < endByte && !isUtf8ScalarBoundary(bytes, startByte))
      startByte += 1;
  } else {
    startByte = segmentRange.endByte;
    endByte = Math.min(sceneRange.endByte, segmentRange.endByte + maxBytes);
    while (endByte > startByte && !isUtf8ScalarBoundary(bytes, endByte))
      endByte -= 1;
  }
  if (startByte === endByte)
    return undefined;
  const text = Buffer.from(bytes).subarray(startByte, endByte).toString('utf8');
  return {
    sourceRange: range(blockIndex, startByte, endByte),
    text,
    contentHash: sha256(text),
  };
}

function createBlockIndex(specs) {
  const sourceAssetId = uuid(500);
  const rawRevisionId = uuid(501);
  const canonicalRevisionId = uuid(502);
  const text = specs.map(([value]) => value).join('');
  const sourceHash = sha256(text);
  let byteCursor = 0;
  let lineCursor = 1;
  const blocks = specs.map(([canonicalText, kind], position) => {
    const startByte = byteCursor;
    byteCursor += Buffer.byteLength(canonicalText, 'utf8');
    const startLine = lineCursor;
    lineCursor += [...canonicalText].filter(character => character === '\n').length;
    return {
      blockId: uuid(510 + position),
      kind,
      canonicalText,
      canonicalRange: textRange(canonicalRevisionId, 'canonical', startByte, byteCursor),
      contentHash: sha256(canonicalText),
      sourceLocator: {
        sourceAssetId,
        sourceContentHash: sourceHash,
        sourceEncoding: 'utf-8',
        sourceByteRange: { offsetUnit: 'source-byte', startByte, endByte: byteCursor },
        rawTextRange: textRange(rawRevisionId, 'raw', startByte, byteCursor),
        lineRange: { lineBase: 1, startLine, endLineExclusive: lineCursor },
      },
    };
  });
  return {
    documentType: 'document-block-index',
    schemaVersion: 1,
    alignmentPolicyVersion: 'm1-block-alignment-v1',
    sourceAssetId,
    sourceContentHash: sourceHash,
    sourceByteLength: byteCursor,
    sourceEncoding: 'utf-8',
    rawTextRevision: revision(rawRevisionId, 'raw', text),
    canonicalTextRevision: revision(canonicalRevisionId, 'canonical', text),
    blocks,
    issues: [],
    reviewStatus: 'not_required',
  };
}

function sceneForRange(blockIndex, sceneId, chapterId, startByte, endByte) {
  return {
    sceneId,
    chapterId,
    order: 0,
    range: range(blockIndex, startByte, endByte),
    blockReferences: blockIndex.blocks
      .filter(block => block.canonicalRange.startByte < endByte
        && startByte < block.canonicalRange.endByte)
      .map(block => ({
        blockId: block.blockId,
        range: range(
          blockIndex,
          Math.max(startByte, block.canonicalRange.startByte),
          Math.min(endByte, block.canonicalRange.endByte),
        ),
        sourceLocator: block.sourceLocator,
      })),
  };
}

function sliceCanonical(blockIndex, startByte, endByte) {
  return Buffer.from(canonicalBytes(blockIndex))
    .subarray(startByte, endByte)
    .toString('utf8');
}

function canonicalBytes(blockIndex) {
  return Buffer.from(blockIndex.blocks.map(block => block.canonicalText).join(''), 'utf8');
}

function isUtf8ScalarBoundary(bytes, offset) {
  if (offset === 0 || offset === bytes.byteLength)
    return true;
  return (bytes[offset] & 0b1100_0000) !== 0b1000_0000;
}

function range(blockIndex, startByte, endByte) {
  return textRange(
    blockIndex.canonicalTextRevision.textRevisionId,
    'canonical',
    startByte,
    endByte,
  );
}

function revision(textRevisionId, textLayer, text) {
  return {
    textRevisionId,
    textLayer,
    contentHash: sha256(text),
    byteLength: Buffer.byteLength(text, 'utf8'),
  };
}

function textRange(textRevisionId, textLayer, startByte, endByte) {
  return { textRevisionId, textLayer, offsetUnit: 'utf8-byte', startByte, endByte };
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isDomainError(error, detailReason) {
  return error instanceof ProcessingSegmentIndexDomainValidationError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
