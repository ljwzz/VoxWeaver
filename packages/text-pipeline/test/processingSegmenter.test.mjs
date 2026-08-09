import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  createProcessingSegmentsV1,
  PROCESSING_SEGMENT_BOUNDARY_POLICY_VERSION,
  PROCESSING_SEGMENTER_PROCESSOR_ID,
  ProcessingSegmenterError,
} from '../dist/processingSegmenter.js';

test('keeps a short Scene as one caller-bounded ProcessingSegment', () => {
  const value = createFixture([
    ['短场景。\n', 'paragraph'],
  ]);
  const maxSegmentBytes = Buffer.byteLength('短场景。\n', 'utf8');
  const result = create(value, options(maxSegmentBytes));

  assert.equal(result.processorId, PROCESSING_SEGMENTER_PROCESSOR_ID);
  assert.equal(
    result.configuration.boundaryPolicyVersion,
    PROCESSING_SEGMENT_BOUNDARY_POLICY_VERSION,
  );
  assert.equal(result.configuration.maxSegmentBytes, maxSegmentBytes);
  assert.equal(result.segments.length, 1);
  assert.equal(result.segments[0].text, '短场景。\n');
  assert.equal(result.segments[0].contentHash, sha256(result.segments[0].text));
});

test('prioritizes paragraph, complete-dialogue, and sentence boundaries under the max', () => {
  const paragraphFixture = createFixture([
    ['甲段。\n', 'paragraph'],
    ['乙段。\n', 'paragraph'],
    ['丙段。\n', 'paragraph'],
  ]);
  const twoParagraphBytes = Buffer.byteLength('甲段。\n乙段。\n', 'utf8');
  const paragraphResult = create(paragraphFixture, options(twoParagraphBytes));
  assert.equal(paragraphResult.segments[0].text, '甲段。\n乙段。\n');

  const dialogueText = '前奏仍在继续，“第一句。第二句。”尾声还会继续很久。\n';
  const dialogueEnd = dialogueText.indexOf('”') + 1;
  const dialoguePrefix = dialogueText.slice(0, dialogueEnd);
  const dialogueFixture = createFixture([[dialogueText, 'paragraph']]);
  const dialogueResult = create(
    dialogueFixture,
    options(Buffer.byteLength(dialoguePrefix, 'utf8')),
  );
  assert.equal(dialogueResult.segments[0].text, dialoguePrefix);
  assert.ok(dialogueResult.segments[0].text.includes('第一句。第二句。'));

  const sentenceText = '第一句较长。第二句继续延伸。第三句收束。\n';
  const firstSentence = '第一句较长。';
  const sentenceFixture = createFixture([[sentenceText, 'paragraph']]);
  const sentenceResult = create(
    sentenceFixture,
    options(Buffer.byteLength(firstSentence, 'utf8') + 2),
  );
  assert.equal(sentenceResult.segments[0].text, firstSentence);
});

test('hard-splits long unpunctuated text only at UTF-8 scalar boundaries', () => {
  const longText = `${'无标点😀连续文本'.repeat(40)}\n`;
  const value = createFixture([[longText, 'paragraph']]);
  const result = create(value, options(10));

  assert.ok(result.segments.length > 1);
  assert.ok(result.segments.every(segment =>
    Buffer.byteLength(segment.text, 'utf8') <= 10));
  assert.equal(result.segments.map(segment => segment.text).join(''), longText);
  assert.ok(result.segments.every(segment =>
    Buffer.from(segment.text, 'utf8').toString('utf8') === segment.text));
});

test('keeps context outside lossless monotonic body ranges and preserves source trace', () => {
  const value = createFixture([
    ['甲段正文。\n', 'paragraph'],
    ['乙段正文😀。\n', 'paragraph'],
    ['丙段正文。\n', 'paragraph'],
  ]);
  const result = create(value, options(18, 7, 8));
  const scene = value.sceneIndex.scenes[0];
  const restored = result.segments.map(segment => segment.text).join('');
  const expected = sliceRange(value.blockIndex, scene.range);

  assert.equal(restored, expected);
  let cursor = scene.range.startByte;
  for (const segment of result.segments) {
    assert.equal(segment.sourceRange.startByte, cursor);
    cursor = segment.sourceRange.endByte;
    assert.equal(segment.contentHash, sha256(segment.text));
    assert.ok(segment.blockReferences.length >= 1);
    assert.equal(
      segment.blockReferences.map(reference =>
        sliceRange(value.blockIndex, reference.range)).join(''),
      segment.text,
    );
    if (segment.contextBefore !== undefined) {
      assert.equal(
        segment.contextBefore.sourceRange.endByte,
        segment.sourceRange.startByte,
      );
      assert.ok(!segment.text.startsWith(segment.contextBefore.text));
    }
    if (segment.contextAfter !== undefined) {
      assert.equal(
        segment.contextAfter.sourceRange.startByte,
        segment.sourceRange.endByte,
      );
      assert.ok(!segment.text.endsWith(segment.contextAfter.text));
    }
  }
  assert.equal(cursor, scene.range.endByte);
});

test('rebuilds changed Scene identities and reuses untouched Scene segments', () => {
  const base = createFixture([
    ['甲一。\n', 'paragraph'],
    ['乙二。\n', 'paragraph'],
    ['丙三。\n', 'paragraph'],
    ['丁四。\n', 'paragraph'],
    ['戊五。\n', 'paragraph'],
    ['己六。\n', 'paragraph'],
  ]);
  const value = {
    ...base,
    sceneIndex: sceneIndexWithBoundaries(base, [1, 3]),
  };
  const maxSegmentBytes = Buffer.byteLength('甲一。\n', 'utf8');
  const first = create(value, options(maxSegmentBytes, 0, 0, 30_000));
  const adjustedSceneIndex = sceneIndexWithBoundaries(
    value,
    [2, 3],
    value.sceneIndex.candidates,
    [uuid(12_000), uuid(12_001), value.sceneIndex.scenes[2].sceneId],
  );
  const adjusted = {
    ...value,
    sceneIndex: adjustedSceneIndex,
  };
  const rebuilt = createProcessingSegmentsV1({
    ...adjusted,
    previousProcessingSegmentIndex: first,
    options: options(maxSegmentBytes, 0, 0, 40_000),
  });
  const firstByText = new Map(first.segments.map(segment => [segment.text, segment]));
  const rebuiltByText = new Map(rebuilt.segments.map(segment => [segment.text, segment]));

  for (const text of ['甲一。\n', '乙二。\n', '丙三。\n', '丁四。\n']) {
    assert.notEqual(
      rebuiltByText.get(text).processingSegmentId,
      firstByText.get(text).processingSegmentId,
    );
  }
  for (const text of ['戊五。\n', '己六。\n']) {
    assert.equal(
      rebuiltByText.get(text).processingSegmentId,
      firstByText.get(text).processingSegmentId,
    );
    assert.equal(
      rebuiltByText.get(text).sceneId,
      value.sceneIndex.scenes[2].sceneId,
    );
  }
});

test('does not inherit IDs across configuration, policy, or processor changes', () => {
  const value = createFixture([['配置稳定文本。\n', 'paragraph']]);
  const first = create(value, options(64, 0, 0, 30_000));
  const changedConfig = createProcessingSegmentsV1({
    ...value,
    previousProcessingSegmentIndex: first,
    options: options(65, 0, 0, 40_000),
  });
  assert.notEqual(
    changedConfig.segments[0].processingSegmentId,
    first.segments[0].processingSegmentId,
  );

  const changedPolicyPrevious = {
    ...first,
    configuration: {
      ...first.configuration,
      boundaryPolicyVersion: 'different-boundary-policy',
    },
  };
  const changedPolicy = createProcessingSegmentsV1({
    ...value,
    previousProcessingSegmentIndex: changedPolicyPrevious,
    options: options(64, 0, 0, 50_000),
  });
  assert.notEqual(
    changedPolicy.segments[0].processingSegmentId,
    first.segments[0].processingSegmentId,
  );

  const changedProcessor = createProcessingSegmentsV1({
    ...value,
    previousProcessingSegmentIndex: {
      ...first,
      processorVersion: 'different-processor-version',
    },
    options: options(64, 0, 0, 60_000),
  });
  assert.notEqual(
    changedProcessor.segments[0].processingSegmentId,
    first.segments[0].processingSegmentId,
  );
});

test('rejects implicit or unsafe budgets, unresolved inputs, and invalid IDs', () => {
  const value = createFixture([['中文。\n', 'paragraph']]);
  const invalidOptions = [
    undefined,
    { ...options(10), maxSegmentBytes: 0 },
    { ...options(10), contextBeforeBytes: -1 },
  ];
  for (const candidateOptions of invalidOptions) {
    assert.throws(
      () => createProcessingSegmentsV1({ ...value, options: candidateOptions }),
      ProcessingSegmenterError,
    );
  }
  assert.throws(
    () => create(value, options(1)),
    error => isSegmenterError(error, 'processing_segment_limit_too_small'),
  );
  assert.throws(
    () => create(value, {
      ...options(10),
      processingSegmentIdFactory: () => value.sceneIndex.scenes[0].sceneId,
    }),
    error => isSegmenterError(error, 'processing_segment_id_duplicate'),
  );
  assert.throws(
    () => createProcessingSegmentsV1({
      ...value,
      sceneIndex: { ...value.sceneIndex, reviewStatus: 'pending' },
      options: options(10),
    }),
    error => isSegmenterError(error, 'processing_segment_scene_review_required'),
  );
  assert.throws(
    () => createProcessingSegmentsV1({
      ...value,
      blockIndex: { ...value.blockIndex, reviewStatus: 'rejected' },
      options: options(10),
    }),
    error => isSegmenterError(error, 'processing_segment_block_review_required'),
  );
});

function create(value, segmentOptions) {
  return createProcessingSegmentsV1({ ...value, options: segmentOptions });
}

function options(
  maxSegmentBytes,
  contextBeforeBytes = 0,
  contextAfterBytes = 0,
  idStart = 20_000,
) {
  return {
    maxSegmentBytes,
    contextBeforeBytes,
    contextAfterBytes,
    processingSegmentIdFactory: sequentialIdFactory(idStart),
  };
}

function createFixture(contentSpecs) {
  const blockIndex = createBlockIndex([
    ['第一章 起点\n', 'heading'],
    ...contentSpecs,
  ]);
  const heading = blockIndex.blocks[0];
  const contentBlocks = blockIndex.blocks.slice(1);
  const chapterId = uuid(10_000);
  const chapterIndex = {
    documentType: 'chapter-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'synthetic-chapter-index',
    processorVersion: '1',
    textRevision: blockIndex.canonicalTextRevision,
    candidates: [{
      chapterCandidateId: uuid(10_001),
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
      contextAfter: [contentBlocks[0].canonicalText.trim()],
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
  const contentRange = chapterIndex.entries[0].contentRange;
  const scenes = [sceneForRange(
    blockIndex,
    uuid(11_000),
    chapterId,
    0,
    contentRange.startByte,
    contentRange.endByte,
  )];
  const sceneIndex = {
    documentType: 'scene-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'synthetic-scene-detector',
    processorVersion: '1',
    textRevision: blockIndex.canonicalTextRevision,
    candidates: [],
    scenes,
    issues: [],
    reviewStatus: 'not_required',
  };
  return { blockIndex, chapterIndex, sceneIndex };
}

function sceneIndexWithBoundaries(
  value,
  boundaryAfterContentPositions,
  previousCandidates,
  sceneIds,
) {
  const contentBlocks = value.blockIndex.blocks.slice(1);
  const boundaryBytes = boundaryAfterContentPositions.map(position =>
    contentBlocks[position].canonicalRange.endByte);
  const candidates = boundaryAfterContentPositions.map((position, index) => {
    const boundaryBlock = contentBlocks[position];
    const boundaryByte = boundaryBlock.canonicalRange.endByte;
    const previous = previousCandidates?.[index];
    if (previous !== undefined) {
      return {
        ...previous,
        appliedBoundary: cursor(value.blockIndex, boundaryByte),
        reviewStatus: previous.appliedBoundary.startByte === boundaryByte
          ? previous.reviewStatus
          : 'approved',
      };
    }
    return {
      sceneBoundaryCandidateId: uuid(11_010 + index),
      chapterId: value.chapterIndex.entries[0].chapterId,
      blockId: boundaryBlock.blockId,
      reasons: ['explicit_separator'],
      evidenceRange: boundaryBlock.canonicalRange,
      proposedBoundary: cursor(value.blockIndex, boundaryByte),
      appliedBoundary: cursor(value.blockIndex, boundaryByte),
      sourceLocator: boundaryBlock.sourceLocator,
      ruleId: 'synthetic-explicit-separator',
      ruleVersion: '1',
      evidence: ['synthetic explicit boundary'],
      reviewStatus: 'not_required',
    };
  });
  const starts = [contentBlocks[0].canonicalRange.startByte, ...boundaryBytes];
  const ends = [...boundaryBytes, contentBlocks.at(-1).canonicalRange.endByte];
  const scenes = starts.map((startByte, order) => ({
    ...sceneForRange(
      value.blockIndex,
      sceneIds?.[order] ?? uuid(11_000 + order),
      value.chapterIndex.entries[0].chapterId,
      order,
      startByte,
      ends[order],
    ),
    ...(order === 0
      ? {}
      : { startBoundaryCandidateId: candidates[order - 1].sceneBoundaryCandidateId }),
  }));
  return {
    ...value.sceneIndex,
    candidates,
    scenes,
  };
}

function createBlockIndex(specs) {
  const sourceAssetId = uuid(9_000);
  const rawRevisionId = uuid(9_001);
  const canonicalRevisionId = uuid(9_002);
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
      blockId: uuid(9_100 + position),
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

function sliceRange(blockIndex, value) {
  const bytes = Buffer.from(
    blockIndex.blocks.map(block => block.canonicalText).join(''),
    'utf8',
  );
  return bytes.subarray(value.startByte, value.endByte).toString('utf8');
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

function sequentialIdFactory(start) {
  let value = start;
  return () => uuid(value++);
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isSegmenterError(error, detailReason) {
  return error instanceof ProcessingSegmenterError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
