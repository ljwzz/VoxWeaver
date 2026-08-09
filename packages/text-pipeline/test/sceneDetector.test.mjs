import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  detectScenesV1,
  SCENE_BOUNDARY_RULE_VERSION,
  SCENE_DETECTOR_PROCESSOR_ID,
  SceneDetectionError,
} from '../dist/index.js';

test('accepts only a full-block explicit separator as a deterministic Scene boundary', () => {
  const value = semanticFixture();
  const result = detect(value, factories());
  const explicit = result.candidates.filter(candidate =>
    candidate.reasons.includes('explicit_separator'));

  assert.equal(explicit.length, 1);
  assert.equal(explicit[0].reviewStatus, 'not_required');
  assert.deepEqual(explicit[0].appliedBoundary, explicit[0].proposedBoundary);
  assert.equal(explicit[0].ruleVersion, SCENE_BOUNDARY_RULE_VERSION);
  assert.equal(result.processorId, SCENE_DETECTOR_PROCESSOR_ID);
  assert.equal(result.scenes.length, 2);
  assert.equal(
    result.scenes[1].startBoundaryCandidateId,
    explicit[0].sceneBoundaryCandidateId,
  );
  assert.ok(!result.candidates.some(candidate =>
    candidate.evidence.some(evidence => evidence.includes('inline'))));
});

test('routes time, location, viewpoint, event, memory, and dream cues to review only', () => {
  const result = detect(semanticFixture(), factories());
  const semantic = result.candidates.filter(candidate =>
    !candidate.reasons.includes('explicit_separator'));

  assert.deepEqual(semantic.flatMap(candidate => candidate.reasons), [
    'time_change',
    'location_change',
    'viewpoint_change',
    'event_change',
    'memory_transition',
    'dream_transition',
  ]);
  assert.ok(semantic.every(candidate =>
    candidate.reviewStatus === 'pending'
    && candidate.appliedBoundary === undefined));
  assert.equal(result.issues.length, semantic.length);
  assert.ok(result.issues.every(issue =>
    issue.code === 'scene_boundary_review_required'
    && issue.reviewStatus === 'pending'));
  assert.equal(result.scenes.length, 2);
  assert.equal(result.reviewStatus, 'pending');
});

test('does not split a long Scene by length or by each dialogue', () => {
  const longText = `${'很长的连续叙事。'.repeat(10_000)}\n`;
  const value = createFixture([
    ['第一章 长场景\n', 'heading'],
    [longText, 'paragraph'],
    ['“第一句对白。”\n', 'paragraph'],
    ['“第二句对白。”\n', 'paragraph'],
  ]);
  const result = detect(value, factories());

  assert.equal(result.candidates.length, 0);
  assert.equal(result.issues.length, 0);
  assert.equal(result.scenes.length, 1);
  assert.deepEqual(result.scenes[0].range, value.chapterIndex.entries[0].contentRange);
});

test('applies an approved block-boundary adjustment and rejects a false candidate', () => {
  const value = semanticFixture();
  const first = detect(value, factories());
  const timeCandidate = first.candidates.find(candidate =>
    candidate.reasons.includes('time_change'));
  const locationCandidate = first.candidates.find(candidate =>
    candidate.reasons.includes('location_change'));
  const locationBlock = value.blockIndex.blocks.find(block =>
    block.blockId === locationCandidate.blockId);
  const reviewed = detect(value, {
    ...factories(60_000),
    boundaryReviews: [
      {
        sceneBoundaryCandidateId: timeCandidate.sceneBoundaryCandidateId,
        decision: 'approved',
        adjustedBoundaryByte: locationBlock.canonicalRange.startByte,
      },
      {
        sceneBoundaryCandidateId: locationCandidate.sceneBoundaryCandidateId,
        decision: 'rejected',
      },
    ],
  }, first);
  const reviewedTime = reviewed.candidates.find(candidate =>
    candidate.sceneBoundaryCandidateId === timeCandidate.sceneBoundaryCandidateId);
  const reviewedLocation = reviewed.candidates.find(candidate =>
    candidate.sceneBoundaryCandidateId === locationCandidate.sceneBoundaryCandidateId);

  assert.equal(reviewedTime.reviewStatus, 'approved');
  assert.equal(
    reviewedTime.appliedBoundary.startByte,
    locationBlock.canonicalRange.startByte,
  );
  assert.equal(reviewedLocation.reviewStatus, 'rejected');
  assert.equal(reviewedLocation.appliedBoundary, undefined);
  assert.equal(reviewed.scenes.length, 3);
  assert.equal(
    reviewed.scenes[2].startBoundaryCandidateId,
    reviewedTime.sceneBoundaryCandidateId,
  );
  assert.ok(!reviewed.issues.some(issue =>
    issue.sceneBoundaryCandidateId === reviewedTime.sceneBoundaryCandidateId
    || issue.sceneBoundaryCandidateId === reviewedLocation.sceneBoundaryCandidateId));
  assert.equal(reviewed.scenes[0].sceneId, first.scenes[0].sceneId);
  assert.notEqual(reviewed.scenes[1].sceneId, first.scenes[1].sceneId);
});

test('reuses all stable candidate, Scene, and pending issue IDs with different factories', () => {
  const value = semanticFixture();
  const first = detect(value, factories(30_000));
  const rebuilt = detect(value, {
    candidateIdFactory: unusedFactory,
    issueIdFactory: unusedFactory,
    sceneIdFactory: unusedFactory,
  }, first);

  assert.deepEqual(
    rebuilt.candidates.map(candidate => candidate.sceneBoundaryCandidateId),
    first.candidates.map(candidate => candidate.sceneBoundaryCandidateId),
  );
  assert.deepEqual(
    rebuilt.scenes.map(scene => scene.sceneId),
    first.scenes.map(scene => scene.sceneId),
  );
  assert.deepEqual(
    rebuilt.issues.map(issue => issue.issueId),
    first.issues.map(issue => issue.issueId),
  );
});

test('preserves approved and rejected decisions until an explicit review overrides them', () => {
  const value = semanticFixture();
  const first = detect(value, factories(30_000));
  const timeCandidate = first.candidates.find(candidate =>
    candidate.reasons.includes('time_change'));
  const locationCandidate = first.candidates.find(candidate =>
    candidate.reasons.includes('location_change'));
  const locationBlock = value.blockIndex.blocks.find(block =>
    block.blockId === locationCandidate.blockId);
  const reviewed = detect(value, {
    ...factories(60_000),
    boundaryReviews: [
      {
        sceneBoundaryCandidateId: timeCandidate.sceneBoundaryCandidateId,
        decision: 'approved',
        adjustedBoundaryByte: locationBlock.canonicalRange.startByte,
      },
      {
        sceneBoundaryCandidateId: locationCandidate.sceneBoundaryCandidateId,
        decision: 'rejected',
      },
    ],
  }, first);
  const rebuilt = detect(value, {
    candidateIdFactory: unusedFactory,
    issueIdFactory: unusedFactory,
    sceneIdFactory: unusedFactory,
  }, reviewed);

  assert.deepEqual(rebuilt, reviewed);
  assert.equal(
    rebuilt.candidates.find(candidate =>
      candidate.sceneBoundaryCandidateId === timeCandidate.sceneBoundaryCandidateId)
      .reviewStatus,
    'approved',
  );
  assert.equal(
    rebuilt.candidates.find(candidate =>
      candidate.sceneBoundaryCandidateId === locationCandidate.sceneBoundaryCandidateId)
      .reviewStatus,
    'rejected',
  );
});

test('does not inherit IDs or decisions across a processor-version change', () => {
  const value = semanticFixture();
  const first = detect(value, factories(30_000));
  const timeCandidate = first.candidates.find(candidate =>
    candidate.reasons.includes('time_change'));
  const reviewed = detect(value, {
    ...factories(60_000),
    boundaryReviews: [{
      sceneBoundaryCandidateId: timeCandidate.sceneBoundaryCandidateId,
      decision: 'approved',
    }],
  }, first);
  const incompatiblePrevious = {
    ...reviewed,
    processorVersion: 'different-processor-version',
  };
  const rebuilt = detect(value, factories(90_000), incompatiblePrevious);
  const rebuiltTime = rebuilt.candidates.find(candidate =>
    candidate.reasons.includes('time_change'));

  assert.notEqual(rebuiltTime.sceneBoundaryCandidateId, timeCandidate.sceneBoundaryCandidateId);
  assert.equal(rebuiltTime.reviewStatus, 'pending');
  assert.equal(rebuiltTime.appliedBoundary, undefined);
});

test('keeps explicit-looking prose and a rejected semantic cue out of Scene splits', () => {
  const value = createFixture([
    ['第一章 误判\n', 'heading'],
    ['开场。\n', 'paragraph'],
    ['正文里有 *** 符号，但不是独立分隔符。\n', 'paragraph'],
    ['翌日，也许只是叙述提示。\n', 'paragraph'],
    ['收束。\n', 'paragraph'],
  ]);
  const first = detect(value, factories());
  assert.equal(first.candidates.length, 1);
  const rejected = detect(value, {
    ...factories(60_000),
    boundaryReviews: [{
      sceneBoundaryCandidateId: first.candidates[0].sceneBoundaryCandidateId,
      decision: 'rejected',
    }],
  }, first);

  assert.equal(rejected.candidates[0].reviewStatus, 'rejected');
  assert.equal(rejected.issues.length, 0);
  assert.equal(rejected.scenes.length, 1);
});

test('preserves Chapter, canonical block, and source locator lookup for every Scene range', () => {
  const value = semanticFixture();
  const result = detect(value, factories());
  const blocks = new Map(value.blockIndex.blocks.map(block => [block.blockId, block]));

  for (const scene of result.scenes) {
    assert.equal(scene.chapterId, value.chapterIndex.entries[0].chapterId);
    for (const reference of scene.blockReferences) {
      const block = blocks.get(reference.blockId);
      assert.ok(block);
      assert.deepEqual(reference.sourceLocator, block.sourceLocator);
      assert.ok(reference.range.startByte >= block.canonicalRange.startByte);
      assert.ok(reference.range.endByte <= block.canonicalRange.endByte);
    }
  }
  assert.equal(result.scenes[0].range.startByte, value.chapterIndex.entries[0].contentRange.startByte);
  assert.equal(result.scenes.at(-1).range.endByte, value.chapterIndex.entries[0].contentRange.endByte);
});

test('rejects stale reviews, invalid factories, and unsafe manual boundaries', () => {
  const value = semanticFixture();
  const first = detect(value, factories());
  const candidate = first.candidates.find(item => item.reasons.includes('time_change'));
  const candidateBlock = value.blockIndex.blocks.find(block =>
    block.blockId === candidate.blockId);
  const invalid = [
    {
      ...factories(),
      boundaryReviews: [{
        sceneBoundaryCandidateId: uuid(999_999),
        decision: 'approved',
      }],
    },
    {
      ...factories(),
      boundaryReviews: [{
        sceneBoundaryCandidateId: candidate.sceneBoundaryCandidateId,
        decision: 'approved',
        adjustedBoundaryByte: candidateBlock.canonicalRange.startByte + 1,
      }],
    },
    {
      ...factories(),
      boundaryReviews: [{
        sceneBoundaryCandidateId: candidate.sceneBoundaryCandidateId,
        decision: 'approved',
        adjustedBoundaryByte: value.chapterIndex.entries[0].contentRange.endByte,
      }],
    },
  ];

  for (const options of invalid) {
    assert.throws(
      () => detect(value, options, first),
      SceneDetectionError,
    );
  }
  assert.throws(
    () => detect(value, {
      ...factories(),
      candidateIdFactory: () => 'not-a-uuid',
    }),
    error => isDetectionError(error, 'scene_candidate_id_invalid'),
  );
  assert.throws(
    () => detect(value, {
      ...factories(),
      candidateIdFactory: () => value.chapterIndex.entries[0].chapterId,
    }),
    error => isDetectionError(error, 'scene_id_duplicate'),
  );
});

test('keeps a review stale when its previous structural candidate disappeared', () => {
  const value = semanticFixture();
  const first = detect(value, factories(30_000));
  const timeCandidate = first.candidates.find(candidate =>
    candidate.reasons.includes('time_change'));
  const changedBlockIndex = structuredClone(value.blockIndex);
  const changedBlock = changedBlockIndex.blocks.find(block =>
    block.blockId === timeCandidate.blockId);
  changedBlock.kind = 'quote';

  assert.throws(
    () => detectScenesV1({
      chapterIndex: value.chapterIndex,
      blockIndex: changedBlockIndex,
      previousSceneIndex: first,
      options: {
        ...factories(60_000),
        boundaryReviews: [{
          sceneBoundaryCandidateId: timeCandidate.sceneBoundaryCandidateId,
          decision: 'approved',
        }],
      },
    }),
    error => isDetectionError(error, 'scene_review_candidate_missing'),
  );
});

test('rejects unresolved Chapter and block input instead of treating it as complete', () => {
  const value = semanticFixture();
  for (const reviewStatus of ['pending', 'rejected']) {
    assert.throws(
      () => detectScenesV1({
        ...value,
        chapterIndex: { ...value.chapterIndex, reviewStatus },
        options: factories(),
      }),
      error => isDetectionError(error, 'scene_chapter_review_required'),
    );
    assert.throws(
      () => detectScenesV1({
        ...value,
        blockIndex: { ...value.blockIndex, reviewStatus },
        options: factories(),
      }),
      error => isDetectionError(error, 'scene_block_review_required'),
    );
  }
  assert.throws(
    () => detectScenesV1({
      ...value,
      chapterIndex: { ...value.chapterIndex, sourceHash: 'f'.repeat(64) },
      options: factories(),
    }),
    error => isDetectionError(error, 'scene_input_provenance_mismatch'),
  );
});

function semanticFixture() {
  return createFixture([
    ['第一章 起点\n', 'heading'],
    ['开场叙事。\n', 'paragraph'],
    ['***\n', 'paragraph'],
    ['分隔后的叙事。\n', 'paragraph'],
    ['翌日，众人重新出发。\n', 'paragraph'],
    ['城外，风声渐紧。\n', 'paragraph'],
    ['另一边，守卫仍在等待。\n', 'paragraph'],
    ['话分两头，旧事再起。\n', 'paragraph'],
    ['他忽然想起，许多年前的约定。\n', 'paragraph'],
    ['梦中，长街覆雪。\n', 'paragraph'],
    ['她说：“第二天再见。”\n', 'paragraph'],
    ['正文里有 *** 符号。\n', 'paragraph'],
    ['收束。\n', 'paragraph'],
  ]);
}

function detect(value, options, previousSceneIndex) {
  return detectScenesV1({
    chapterIndex: value.chapterIndex,
    blockIndex: value.blockIndex,
    previousSceneIndex,
    options,
  });
}

function createFixture(specs) {
  const blockIndex = createBlockIndex(specs);
  const heading = blockIndex.blocks[0];
  const contentBlocks = blockIndex.blocks.slice(1);
  const chapterId = uuid(20_000);
  const chapterIndex = {
    documentType: 'chapter-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'synthetic-chapter-index',
    processorVersion: '1',
    textRevision: blockIndex.canonicalTextRevision,
    candidates: [{
      chapterCandidateId: uuid(20_001),
      headingRange: heading.canonicalRange,
      lineRange: heading.sourceLocator.lineRange,
      rawTitle: heading.canonicalText.trim(),
      normalizedTitle: heading.canonicalText.trim().replace(/^第一章\s*/u, ''),
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
      title: heading.canonicalText.trim().replace(/^第一章\s*/u, ''),
      rawHeading: heading.canonicalText.trim(),
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
  return { blockIndex, chapterIndex };
}

function createBlockIndex(specs) {
  const sourceAssetId = uuid(10_000);
  const rawRevisionId = uuid(10_001);
  const canonicalRevisionId = uuid(10_002);
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
      blockId: uuid(10_100 + position),
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

function factories(start = 30_000) {
  return {
    candidateIdFactory: sequentialIdFactory(start),
    issueIdFactory: sequentialIdFactory(start + 1_000),
    sceneIdFactory: sequentialIdFactory(start + 2_000),
  };
}

function sequentialIdFactory(start) {
  let value = start;
  return () => uuid(value++);
}

function unusedFactory() {
  throw new Error('stable structure must not consume a fresh ID');
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

function isDetectionError(error, detailReason) {
  return error instanceof SceneDetectionError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
