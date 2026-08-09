import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  alignDocumentBlockIndexV1,
  buildNovelReimportPlanV1,
  NovelReimportPlanValidationError,
} from '../dist/index.js';

test('preserves aligned block and chapter IDs without reporting unchanged content', () => {
  const previousBlocks = createBlockIndex([
    row(1, '第一章 起点\n', 'heading'),
    row(2, '甲。\n'),
    row(3, '第二章 继续\n', 'heading'),
    row(4, '乙。\n'),
  ], 100);
  const currentBlocks = alignCurrent(previousBlocks, createBlockIndex([
    row(101, '第一章 起点\n', 'heading'),
    row(102, '甲。\n'),
    row(103, '第二章 继续\n', 'heading'),
    row(104, '乙。\n'),
  ], 200));
  const previousChapters = createChapterIndex(previousBlocks, [
    chapter(0, 1_001),
    chapter(2, 1_002),
  ], 300);
  const currentChapters = createChapterIndex(currentBlocks, [
    chapter(0, 2_001),
    chapter(2, 2_002),
  ], 400);

  const plan = buildPlan(
    previousBlocks,
    currentBlocks,
    previousChapters,
    currentChapters,
  );

  assert.deepEqual(plan.preservedBlockIds, previousBlocks.blocks.map(block => block.blockId));
  assert.deepEqual(plan.preservedChapters, [
    {
      previousChapterId: uuid(1_001),
      currentChapterId: uuid(2_001),
      preservedChapterId: uuid(1_001),
      evidence: 'stable-heading-block',
      evidenceBlockIds: [uuid(1)],
    },
    {
      previousChapterId: uuid(1_002),
      currentChapterId: uuid(2_002),
      preservedChapterId: uuid(1_002),
      evidence: 'stable-heading-block',
      evidenceBlockIds: [uuid(3)],
    },
  ]);
  assert.deepEqual(plan.changes, emptyChanges());
  assert.deepEqual(plan.ambiguities, []);
  assert.equal(plan.reviewStatus, 'not_required');
});

test('keeps a body-plus-title edit out of display while retaining chapter identity', () => {
  const previousBlocks = createBlockIndex([
    row(10, '第一章 起点\n', 'heading'),
    row(11, '甲。\n'),
    row(12, '稳定尾句。\n'),
  ], 500);
  const currentBlocks = alignCurrent(previousBlocks, createBlockIndex([
    row(110, '第一章 起点\n', 'heading'),
    row(111, '乙。\n'),
    row(112, '稳定尾句。\n'),
  ], 600));
  const previousChapters = createChapterIndex(
    previousBlocks,
    [chapter(0, 1_010)],
    700,
  );
  const currentChapters = createChapterIndex(
    currentBlocks,
    [chapter(0, 2_010, { title: '起点（并发显示修改）' })],
    800,
  );

  const plan = buildPlan(
    previousBlocks,
    currentBlocks,
    previousChapters,
    currentChapters,
  );

  assert.deepEqual(plan.changes.content, {
    previousBlockIds: [uuid(11)],
    currentBlockIds: [uuid(111)],
    previousChapterIds: [uuid(1_010)],
    currentChapterIds: [uuid(2_010)],
  });
  assert.deepEqual(plan.changes.structure, emptyAffectedIds());
  assert.deepEqual(plan.changes.display, emptyAffectedIds());
  assert.equal(plan.preservedChapters[0].preservedChapterId, uuid(1_010));
});

test('keeps a boundary-plus-title edit out of content and display scopes', () => {
  const previousBlocks = createBlockIndex([
    row(20, '第一章 起点\n', 'heading'),
    row(21, '章内正文。\n'),
    row(22, '边界外资料。\n'),
    row(23, '第二章 继续\n', 'heading'),
    row(24, '第二章正文。\n'),
  ], 900);
  const currentBlocks = createBlockIndex([
    row(20, '第一章 起点\n', 'heading'),
    row(21, '章内正文。\n'),
    row(22, '边界外资料。\n'),
    row(23, '第二章 继续\n', 'heading'),
    row(24, '第二章正文。\n'),
  ], 1_000);
  const previousChapters = createChapterIndex(previousBlocks, [
    chapter(0, 1_020, { contentEndBlockIndex: 2, contentEndOffset: 3 }),
    chapter(3, 1_021),
  ], 1_100);
  const currentChapters = createChapterIndex(currentBlocks, [
    chapter(0, 2_020, {
      contentEndBlockIndex: 2,
      contentEndOffset: 6,
      title: '起点（边界调整）',
    }),
    chapter(3, 2_021),
  ], 1_200);

  const plan = buildPlan(
    previousBlocks,
    currentBlocks,
    previousChapters,
    currentChapters,
  );

  assert.deepEqual(plan.changes.content, emptyAffectedIds());
  assert.deepEqual(plan.changes.structure, {
    previousBlockIds: [uuid(22)],
    currentBlockIds: [uuid(22)],
    previousChapterIds: [uuid(1_020)],
    currentChapterIds: [uuid(2_020)],
  });
  assert.deepEqual(plan.changes.display, emptyAffectedIds());
});

test('keeps a display-title edit out of content and structure scopes', () => {
  const previousBlocks = createBlockIndex([
    row(30, '第一章 起点\n', 'heading'),
    row(31, '正文。\n'),
  ], 1_300);
  const currentBlocks = createBlockIndex([
    row(30, '第一章 起点\n', 'heading'),
    row(31, '正文。\n'),
  ], 1_400);
  const previousChapters = createChapterIndex(
    previousBlocks,
    [chapter(0, 1_030, { title: '第一章 起点' })],
    1_500,
  );
  const currentChapters = createChapterIndex(
    currentBlocks,
    [chapter(0, 2_030, { title: '起点（显示名）' })],
    1_600,
  );

  const plan = buildPlan(
    previousBlocks,
    currentBlocks,
    previousChapters,
    currentChapters,
  );

  assert.deepEqual(plan.changes.content, emptyAffectedIds());
  assert.deepEqual(plan.changes.structure, emptyAffectedIds());
  assert.deepEqual(plan.changes.display, {
    previousBlockIds: [],
    currentBlockIds: [],
    previousChapterIds: [uuid(1_030)],
    currentChapterIds: [uuid(2_030)],
  });
});

test('handles restored historical content through stable anchors instead of offsets', () => {
  const historicalBlocks = createBlockIndex([
    row(40, '第一章 原题\n', 'heading'),
    row(41, '原始版本。\n'),
    row(42, '稳定尾锚。\n'),
  ], 1_700);
  const previousBlocks = alignCurrent(historicalBlocks, createBlockIndex([
    row(140, '第一章 改写\n', 'heading'),
    row(141, '当前版本。\n'),
    row(142, '稳定尾锚。\n'),
  ], 1_800));
  const currentBlocks = alignCurrent(previousBlocks, createBlockIndex([
    row(240, '新增前言。\n'),
    row(241, '第一章 原题\n', 'heading'),
    row(242, '原始版本。\n'),
    row(243, '稳定尾锚。\n'),
  ], 1_900));
  const previousChapters = createChapterIndex(previousBlocks, [
    chapter(0, 1_040, { title: '第一章' }),
  ], 2_000);
  const currentChapters = createChapterIndex(currentBlocks, [
    chapter(1, 2_040, { title: '第一章' }),
  ], 2_100);

  const plan = buildPlan(
    previousBlocks,
    currentBlocks,
    previousChapters,
    currentChapters,
  );

  assert.equal(
    currentBlocks.blocks[2].contentHash,
    historicalBlocks.blocks[1].contentHash,
  );
  assert.notEqual(currentBlocks.blocks[2].blockId, historicalBlocks.blocks[1].blockId);
  assert.notEqual(
    currentBlocks.blocks[1].canonicalRange.startByte,
    previousBlocks.blocks[0].canonicalRange.startByte,
  );
  assert.deepEqual(plan.preservedChapters, [{
    previousChapterId: uuid(1_040),
    currentChapterId: uuid(2_040),
    preservedChapterId: uuid(1_040),
    evidence: 'reciprocal-stable-block-anchors',
    evidenceBlockIds: [uuid(42)],
  }]);
  assert.deepEqual(plan.changes.structure.previousChapterIds, [uuid(1_040)]);
  assert.deepEqual(plan.changes.structure.currentChapterIds, [uuid(2_040)]);
  assert.equal(plan.reviewStatus, 'not_required');
});

test('propagates actual five-level block ambiguity for repeated paragraphs', () => {
  const previousBlocks = createBlockIndex([
    row(50, '第一章 重复\n', 'heading'),
    row(51, 'A'),
    row(52, 'X'),
    row(53, 'M'),
    row(54, 'X'),
    row(55, 'B'),
  ], 2_200);
  const currentBlocks = alignCurrent(previousBlocks, createBlockIndex([
    row(150, '第一章 重复\n', 'heading'),
    row(151, 'A'),
    row(152, ' ', 'separator'),
    row(153, 'X'),
    row(154, ' ', 'separator'),
    row(155, 'B'),
  ], 2_300));
  const previousChapters = createChapterIndex(
    previousBlocks,
    [chapter(0, 1_050)],
    2_400,
  );
  const currentChapters = createChapterIndex(
    currentBlocks,
    [chapter(0, 2_050)],
    2_500,
  );

  const plan = buildPlan(
    previousBlocks,
    currentBlocks,
    previousChapters,
    currentChapters,
  );
  const blockIssues = plan.ambiguities.filter(item => item.entityType === 'block');

  assert.equal(currentBlocks.issues.length, 1);
  assert.deepEqual(blockIssues, [{
    entityType: 'block',
    code: 'block_alignment_ambiguous',
    currentBlockId: currentBlocks.issues[0].currentBlockId,
    candidatePreviousBlockIds: currentBlocks.issues[0].candidateOldBlockIds,
    evidenceLevel: currentBlocks.issues[0].evidenceLevel,
    reviewStatus: 'pending',
  }]);
  assert.ok(!plan.preservedBlockIds.includes(currentBlocks.issues[0].currentBlockId));
  assert.equal(plan.reviewStatus, 'pending');
});

test('does not preserve a previous chapter across a split with tied anchors', () => {
  const previousBlocks = createBlockIndex([
    row(60, '旧章节\n', 'heading'),
    row(61, '稳定甲。\n'),
    row(62, '稳定乙。\n'),
  ], 2_600);
  const currentBlocks = alignCurrent(previousBlocks, createBlockIndex([
    row(160, '新章节一\n', 'heading'),
    row(161, '稳定甲。\n'),
    row(162, '新章节二\n', 'heading'),
    row(163, '稳定乙。\n'),
  ], 2_700));
  const previousChapters = createChapterIndex(
    previousBlocks,
    [chapter(0, 1_060)],
    2_800,
  );
  const currentChapters = createChapterIndex(currentBlocks, [
    chapter(0, 2_060),
    chapter(2, 2_061),
  ], 2_900);

  const plan = buildPlan(
    previousBlocks,
    currentBlocks,
    previousChapters,
    currentChapters,
  );
  const chapterIssues = plan.ambiguities.filter(item => item.entityType === 'chapter');

  assert.deepEqual(plan.preservedChapters, []);
  assert.deepEqual(
    chapterIssues.map(issue => issue.candidatePreviousChapterIds),
    [[uuid(1_060)], [uuid(1_060)]],
  );
  assert.deepEqual(
    chapterIssues.map(issue => issue.evidenceBlockIds),
    [[uuid(61)], [uuid(62)]],
  );
  assert.equal(plan.reviewStatus, 'pending');
});

test('rejects inconsistent block membership and unsupported preserved-ID evidence', () => {
  const previousBlocks = createBlockIndex([
    row(70, '第一章\n', 'heading'),
    row(71, '正文。\n'),
  ], 3_000);
  const currentBlocks = createBlockIndex([
    row(70, '已变化标题\n', 'heading'),
    row(71, '正文。\n'),
  ], 3_100);
  const previousChapters = createChapterIndex(
    previousBlocks,
    [chapter(0, 1_070)],
    3_200,
  );
  const currentChapters = createChapterIndex(
    currentBlocks,
    [chapter(0, 2_070)],
    3_300,
  );

  assert.throws(
    () => buildPlan(
      previousBlocks,
      currentBlocks,
      previousChapters,
      currentChapters,
    ),
    error => isPlanError(error, 'preserved_block_identity_invalid'),
  );

  const mismatchedChapters = {
    ...previousChapters,
    sourceAssetId: uuid(99_999),
  };
  assert.throws(
    () => buildPlan(
      previousBlocks,
      previousBlocks,
      mismatchedChapters,
      previousChapters,
    ),
    error => isPlanError(error, 'previous_chapter_block_revision_mismatch'),
  );
});

function buildPlan(
  previousBlockIndex,
  currentBlockIndex,
  previousChapterIndex,
  currentChapterIndex,
) {
  return buildNovelReimportPlanV1({
    previousBlockIndex,
    currentBlockIndex,
    previousChapterIndex,
    currentChapterIndex,
  });
}

function alignCurrent(previous, current) {
  const alignment = alignDocumentBlockIndexV1(current, previous);
  return {
    ...current,
    blocks: alignment.blocks,
    issues: alignment.issues,
    reviewStatus: alignment.reviewStatus,
  };
}

function row(blockId, canonicalText, kind = 'paragraph') {
  return { blockId: uuid(blockId), canonicalText, kind };
}

function chapter(headingBlockIndex, chapterId, options = {}) {
  return { headingBlockIndex, chapterId: uuid(chapterId), ...options };
}

function createBlockIndex(rows, seed) {
  const canonicalText = rows.map(value => value.canonicalText).join('');
  const canonicalRevisionId = uuid(100_000 + seed);
  const rawRevisionId = uuid(200_000 + seed);
  const sourceAssetId = uuid(300_000 + seed);
  const sourceContentHash = sha256(`source:${seed}:${canonicalText}`);
  let cursor = 0;
  const blocks = rows.map((value, index) => {
    const startByte = cursor;
    cursor += Buffer.byteLength(value.canonicalText, 'utf8');
    return {
      blockId: value.blockId,
      kind: value.kind,
      canonicalText: value.canonicalText,
      canonicalRange: range(canonicalRevisionId, startByte, cursor),
      contentHash: sha256(value.canonicalText),
      sourceLocator: {
        sourceAssetId,
        sourceContentHash,
        sourceEncoding: 'utf-8',
        sourceByteRange: {
          offsetUnit: 'source-byte',
          startByte,
          endByte: cursor,
        },
        rawTextRange: {
          ...range(rawRevisionId, startByte, cursor),
          textLayer: 'raw',
        },
        lineRange: {
          lineBase: 1,
          startLine: index + 1,
          endLineExclusive: index + 2,
        },
      },
    };
  });
  return {
    documentType: 'document-block-index',
    schemaVersion: 1,
    alignmentPolicyVersion: 'm1-block-alignment-v1',
    sourceAssetId,
    sourceContentHash,
    sourceByteLength: cursor,
    sourceEncoding: 'utf-8',
    rawTextRevision: {
      textRevisionId: rawRevisionId,
      textLayer: 'raw',
      contentHash: sha256(canonicalText),
      byteLength: cursor,
    },
    canonicalTextRevision: {
      textRevisionId: canonicalRevisionId,
      textLayer: 'canonical',
      contentHash: sha256(canonicalText),
      byteLength: cursor,
    },
    blocks,
    issues: [],
    reviewStatus: 'not_required',
  };
}

function createChapterIndex(blockIndex, definitions, seed) {
  const sorted = definitions.slice().sort(
    (left, right) => left.headingBlockIndex - right.headingBlockIndex,
  );
  const candidates = [];
  const entries = [];
  for (const [position, definition] of sorted.entries()) {
    const heading = blockIndex.blocks[definition.headingBlockIndex];
    const nextHeading = sorted[position + 1]?.headingBlockIndex;
    const contentEndByte = definition.contentEndBlockIndex === undefined
      ? (nextHeading === undefined
          ? blockIndex.canonicalTextRevision.byteLength
          : blockIndex.blocks[nextHeading].canonicalRange.startByte)
      : blockIndex.blocks[definition.contentEndBlockIndex].canonicalRange.startByte
        + (definition.contentEndOffset ?? 0);
    const rawHeading = heading.canonicalText.trim();
    const title = definition.title ?? rawHeading;
    const endLineExclusive = blockIndex.blocks
      .filter(block => block.canonicalRange.startByte < contentEndByte)
      .filter(block => block.canonicalRange.endByte > heading.canonicalRange.startByte)
      .reduce(
        (maximum, block) => Math.max(
          maximum,
          block.sourceLocator.lineRange.endLineExclusive,
        ),
        heading.sourceLocator.lineRange.endLineExclusive,
      );
    const candidateId = uuid(400_000 + seed + position);
    candidates.push({
      chapterCandidateId: candidateId,
      headingRange: heading.canonicalRange,
      lineRange: heading.sourceLocator.lineRange,
      rawTitle: rawHeading,
      normalizedTitle: title,
      ruleId: 'test-heading',
      ruleVersion: '1',
      ruleConfidence: 1,
      confidenceSource: 'deterministic test fixture',
      evidence: ['match-scope:full-line'],
      contextBefore: [],
      contextAfter: [],
      reviewStatus: 'not_required',
    });
    entries.push({
      chapterId: definition.chapterId,
      order: position,
      ...(definition.chapterNumber === undefined
        ? {}
        : { chapterNumber: definition.chapterNumber }),
      title,
      rawHeading,
      headingRange: heading.canonicalRange,
      contentRange: range(
        blockIndex.canonicalTextRevision.textRevisionId,
        heading.canonicalRange.endByte,
        contentEndByte,
      ),
      sourceLineRange: {
        lineBase: 1,
        startLine: heading.sourceLocator.lineRange.startLine,
        endLineExclusive,
      },
      confidence: 1,
      detectedBy: 'rule:test-heading@1',
      reviewStatus: 'not_required',
    });
  }

  const segments = [];
  let cursor = 0;
  for (const entry of entries) {
    if (cursor < entry.headingRange.startByte) {
      segments.push({
        classification: cursor === 0 ? 'front_matter' : 'unknown',
        range: range(
          blockIndex.canonicalTextRevision.textRevisionId,
          cursor,
          entry.headingRange.startByte,
        ),
      });
    }
    segments.push({
      classification: 'chapter',
      chapterId: entry.chapterId,
      range: range(
        blockIndex.canonicalTextRevision.textRevisionId,
        entry.headingRange.startByte,
        entry.contentRange.endByte,
      ),
    });
    cursor = entry.contentRange.endByte;
  }
  if (cursor < blockIndex.canonicalTextRevision.byteLength) {
    segments.push({
      classification: cursor === 0 ? 'front_matter' : 'unknown',
      range: range(
        blockIndex.canonicalTextRevision.textRevisionId,
        cursor,
        blockIndex.canonicalTextRevision.byteLength,
      ),
    });
  }

  return {
    documentType: 'chapter-index',
    schemaVersion: 1,
    sourceAssetId: blockIndex.sourceAssetId,
    sourceHash: blockIndex.sourceContentHash,
    processorId: 'test.chapter-index',
    processorVersion: '1',
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
    issues: [],
    reviewStatus: 'not_required',
  };
}

function range(textRevisionId, startByte, endByte) {
  return {
    textRevisionId,
    textLayer: 'canonical',
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function emptyChanges() {
  return {
    content: emptyAffectedIds(),
    structure: emptyAffectedIds(),
    display: emptyAffectedIds(),
  };
}

function emptyAffectedIds() {
  return {
    previousBlockIds: [],
    currentBlockIds: [],
    previousChapterIds: [],
    currentChapterIds: [],
  };
}

function uuid(value) {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function isPlanError(error, detailReason) {
  return error instanceof NovelReimportPlanValidationError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
