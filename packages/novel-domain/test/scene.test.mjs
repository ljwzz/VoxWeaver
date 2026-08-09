import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  SceneIndexDomainValidationError,
  validateSceneIndexDomainV1,
} from '../dist/index.js';

test('validates contiguous Scenes and preserves Chapter, block, and source lookup', () => {
  const value = fixture();
  assert.equal(
    validateSceneIndexDomainV1(value.sceneIndex, value.chapterIndex, value.blockIndex),
    value.sceneIndex,
  );

  assert.deepEqual(
    value.sceneIndex.scenes.flatMap(scene => scene.blockReferences.map(reference => ({
      chapterId: scene.chapterId,
      blockId: reference.blockId,
      canonicalRange: reference.range,
      sourceByteRange: reference.sourceLocator.sourceByteRange,
    }))),
    value.blockIndex.blocks.slice(1).map(block => ({
      chapterId: value.chapterIndex.entries[0].chapterId,
      blockId: block.blockId,
      canonicalRange: block.canonicalRange,
      sourceByteRange: block.sourceLocator.sourceByteRange,
    })),
  );
});

test('rejects a Scene range that does not cover its complete Chapter content', () => {
  const value = fixture();
  const chapter = value.chapterIndex.entries[0];
  const startByte = chapter.contentRange.startByte + 1;
  const scene = sceneForRange(
    value.blockIndex,
    uuid(700),
    chapter.chapterId,
    0,
    startByte,
    chapter.contentRange.endByte,
  );
  const sceneIndex = {
    ...value.sceneIndex,
    candidates: [],
    scenes: [scene],
  };

  assert.throws(
    () => validateSceneIndexDomainV1(sceneIndex, value.chapterIndex, value.blockIndex),
    error => isDomainError(error, 'scene_chapter_coverage_invalid'),
  );
});

test('rejects a candidate and Scene locator that do not match the canonical block', () => {
  const value = fixture();
  const changedLocator = {
    ...value.sceneIndex.candidates[0].sourceLocator,
    lineRange: { lineBase: 1, startLine: 20, endLineExclusive: 21 },
  };
  const sceneIndex = structuredClone(value.sceneIndex);
  sceneIndex.candidates[0].sourceLocator = changedLocator;
  const reference = sceneIndex.scenes[0].blockReferences.find(candidate =>
    candidate.blockId === sceneIndex.candidates[0].blockId);
  reference.sourceLocator = changedLocator;

  assert.throws(
    () => validateSceneIndexDomainV1(sceneIndex, value.chapterIndex, value.blockIndex),
    error => isDomainError(error, 'scene_block_projection_invalid'),
  );
});

test('rejects a manually adjusted boundary inside a canonical block', () => {
  const value = fixture();
  const chapter = value.chapterIndex.entries[0];
  const finalBlock = value.blockIndex.blocks.at(-1);
  const invalidBoundary = finalBlock.canonicalRange.startByte + 1;
  const boundary = value.sceneIndex.candidates[0];
  const sceneIndex = {
    ...value.sceneIndex,
    candidates: [{
      ...boundary,
      appliedBoundary: cursor(value.blockIndex, invalidBoundary),
      reviewStatus: 'approved',
    }],
    scenes: [
      sceneForRange(
        value.blockIndex,
        uuid(710),
        chapter.chapterId,
        0,
        chapter.contentRange.startByte,
        invalidBoundary,
      ),
      {
        ...sceneForRange(
          value.blockIndex,
          uuid(711),
          chapter.chapterId,
          1,
          invalidBoundary,
          chapter.contentRange.endByte,
        ),
        startBoundaryCandidateId: boundary.sceneBoundaryCandidateId,
      },
    ],
  };

  assert.throws(
    () => validateSceneIndexDomainV1(sceneIndex, value.chapterIndex, value.blockIndex),
    error => isDomainError(error, 'scene_boundary_block_boundary_invalid'),
  );
});

test('wraps invalid UUID and public range contracts as typed domain failures', () => {
  const value = fixture();
  const invalidUuid = structuredClone(value.sceneIndex);
  invalidUuid.scenes[0].sceneId = 'not-a-uuid';
  assert.throws(
    () => validateSceneIndexDomainV1(invalidUuid, value.chapterIndex, value.blockIndex),
    error => isDomainError(error, 'scene_index_contract_invalid'),
  );

  const invalidRange = structuredClone(value.sceneIndex);
  invalidRange.scenes[0].range.endByte = value.sceneIndex.textRevision.byteLength + 1;
  assert.throws(
    () => validateSceneIndexDomainV1(invalidRange, value.chapterIndex, value.blockIndex),
    error => isDomainError(error, 'scene_index_contract_invalid'),
  );
});

function fixture() {
  const blockIndex = createBlockIndex([
    ['第一章 起点\n', 'heading'],
    ['甲。\n', 'paragraph'],
    ['***\n', 'paragraph'],
    ['乙😀。\n', 'paragraph'],
  ]);
  const heading = blockIndex.blocks[0];
  const contentBlocks = blockIndex.blocks.slice(1);
  const chapterId = uuid(600);
  const chapterIndex = {
    documentType: 'chapter-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'test-chapter-index',
    processorVersion: '1',
    textRevision: blockIndex.canonicalTextRevision,
    candidates: [{
      chapterCandidateId: uuid(601),
      headingRange: heading.canonicalRange,
      lineRange: heading.sourceLocator.lineRange,
      rawTitle: '第一章 起点',
      normalizedTitle: '起点',
      ruleId: 'test',
      ruleVersion: '1',
      ruleConfidence: 1,
      confidenceSource: 'synthetic deterministic evidence',
      evidence: ['synthetic heading'],
      contextBefore: [],
      contextAfter: ['甲。'],
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
      detectedBy: 'rule:test@1',
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
  const separator = blockIndex.blocks[2];
  const boundaryByte = separator.canonicalRange.endByte;
  const candidate = {
    sceneBoundaryCandidateId: uuid(610),
    chapterId,
    blockId: separator.blockId,
    reasons: ['explicit_separator'],
    evidenceRange: separator.canonicalRange,
    proposedBoundary: cursor(blockIndex, boundaryByte),
    appliedBoundary: cursor(blockIndex, boundaryByte),
    sourceLocator: separator.sourceLocator,
    ruleId: 'm2.scene-boundary.explicit-separator',
    ruleVersion: '1',
    evidence: ['full-block explicit separator'],
    reviewStatus: 'not_required',
  };
  const contentRange = chapterIndex.entries[0].contentRange;
  const sceneIndex = {
    documentType: 'scene-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'test-scene-detector',
    processorVersion: '1',
    textRevision: blockIndex.canonicalTextRevision,
    candidates: [candidate],
    scenes: [
      sceneForRange(
        blockIndex,
        uuid(620),
        chapterId,
        0,
        contentRange.startByte,
        boundaryByte,
      ),
      {
        ...sceneForRange(
          blockIndex,
          uuid(621),
          chapterId,
          1,
          boundaryByte,
          contentRange.endByte,
        ),
        startBoundaryCandidateId: candidate.sceneBoundaryCandidateId,
      },
    ],
    issues: [],
    reviewStatus: 'not_required',
  };
  return { blockIndex, chapterIndex, sceneIndex };
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

function sceneForRange(blockIndex, sceneId, chapterId, order, startByte, endByte) {
  return {
    sceneId,
    chapterId,
    order,
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

function cursor(blockIndex, byte) {
  return range(blockIndex, byte, byte);
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
  return error instanceof SceneIndexDomainValidationError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
