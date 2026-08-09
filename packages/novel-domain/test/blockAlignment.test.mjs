import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  alignDocumentBlockIndexV1,
  DocumentBlockIndexValidationError,
  validateDocumentBlockIndexV1,
} from '../dist/index.js';

const ASSET_A = uuid(900);
const ASSET_B = uuid(901);
const CANONICAL_REVISION = uuid(902);
const RAW_REVISION = uuid(903);

test('validates UTF-8 ranges, exact hashes, provenance, and zero-length canonical blocks', () => {
  const value = createIndex([
    row(1, '中'),
    row(2, '😀'),
    row(3, 'e\u0301'),
    row(4, '', { rawByteLength: 3 }),
  ]);

  assert.equal(validateDocumentBlockIndexV1(value), value);
  assert.deepEqual(
    value.blocks.map(block => [
      block.canonicalRange.startByte,
      block.canonicalRange.endByte,
    ]),
    [[0, 3], [3, 7], [7, 10], [10, 10]],
  );
});

test('reuses exact-locator IDs across asset IDs and at both source-hash priorities', () => {
  const previous = createIndex([row(10, '甲'), row(11, '乙')], {
    sourceAssetId: ASSET_A,
    sourceContentHash: sha256('same-source'),
  });
  const sameHash = createIndex([row(20, '甲'), row(21, '乙')], {
    sourceAssetId: ASSET_B,
    sourceContentHash: previous.sourceContentHash,
  });
  const changedHash = createIndex([row(30, '甲'), row(31, '乙')], {
    sourceAssetId: ASSET_B,
    sourceContentHash: sha256('changed-source'),
  });

  assert.deepEqual(
    alignDocumentBlockIndexV1(sameHash, previous).blocks.map(block => block.blockId),
    previous.blocks.map(block => block.blockId),
  );
  assert.deepEqual(
    alignDocumentBlockIndexV1(changedHash, previous).blocks.map(block => block.blockId),
    previous.blocks.map(block => block.blockId),
  );
});

test('keeps head insertions and edits fresh while reusing uniquely proven blocks', () => {
  const previous = createIndex([
    row(40, '甲\n'),
    row(41, '乙\n'),
    row(42, '丙\n'),
  ]);
  const current = createIndex([
    row(50, '前言\n'),
    row(51, '甲\n'),
    row(52, '修改\n'),
    row(53, '丙\n'),
  ], { sourceContentHash: sha256('head-insert-and-edit') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.deepEqual(result.blocks.map(block => block.blockId), [
    uuid(50),
    uuid(40),
    uuid(52),
    uuid(42),
  ]);
  assert.equal(result.issues.length, 0);
  assert.equal(new Set(result.blocks.map(block => block.blockId)).size, 4);
});

test('uses independent nearest non-whitespace hashes as two-sided anchors', () => {
  const previous = createIndex([
    row(60, '左'),
    row(61, '重复'),
    row(62, '右'),
    row(63, '另左'),
    row(64, '重复'),
    row(65, '另右'),
  ]);
  const current = createIndex([
    row(70, '前'),
    row(71, '左'),
    row(72, ' \n', { kind: 'separator' }),
    row(73, '重复'),
    row(74, '\n', { kind: 'separator' }),
    row(75, '右'),
  ], { sourceContentHash: sha256('two-sided-current') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.equal(result.blocks[3].blockId, uuid(61));
  assert.equal(result.issues.length, 0);
});

test('uses a matched nearest anchor and monotonic order for one-sided evidence', () => {
  const previous = createIndex([
    row(80, '锚'),
    row(81, '重复'),
    row(82, '尾'),
    row(83, '另锚'),
    row(84, '重复'),
  ]);
  const current = createIndex([
    row(90, '锚'),
    row(91, '  ', { kind: 'separator' }),
    row(92, '重复'),
    row(93, '变化'),
  ], { sourceContentHash: sha256('single-sided-current') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.equal(result.blocks[0].blockId, uuid(80));
  assert.equal(result.blocks[2].blockId, uuid(81));
  assert.equal(result.issues.length, 0);
});

test('marks one-sided multiple candidates immediately within the same snapshot', () => {
  const previous = createIndex([
    row(94, 'A'),
    row(95, 'X'),
    row(96, 'M'),
    row(97, 'X'),
    row(98, 'B'),
  ]);
  const current = createIndex([
    row(99, 'A'),
    row(991, ' ', { kind: 'separator' }),
    row(992, 'X'),
    row(993, ' ', { kind: 'separator' }),
    row(994, 'B'),
  ], { sourceContentHash: sha256('one-side-multiple-current') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.equal(result.blocks[2].blockId, uuid(992));
  assert.deepEqual(result.issues.map(issue => ({
    currentBlockId: issue.currentBlockId,
    candidateOldBlockIds: issue.candidateOldBlockIds,
    evidenceLevel: issue.evidenceLevel,
  })), [{
    currentBlockId: uuid(992),
    candidateOldBlockIds: [uuid(95), uuid(97)],
    evidenceLevel: 'one-sided-matched-anchor',
  }]);
});

test('marks same-level multiple candidates without descending to a tie-breaker', () => {
  const previous = createIndex([
    row(100, '左'),
    row(101, '重复'),
    row(102, '右'),
    row(103, '左'),
    row(104, '重复'),
    row(105, '右'),
  ]);
  const current = createIndex([
    row(110, '前'),
    row(111, '左'),
    row(112, '重复'),
    row(113, '右'),
  ], { sourceContentHash: sha256('multiple-candidates') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.equal(result.blocks[2].blockId, uuid(112));
  assert.deepEqual(result.issues, [{
    code: 'ambiguous_reimport_alignment',
    severity: 'warning',
    reviewStatus: 'pending',
    message: 'Block alignment is ambiguous at evidence level two-sided-content-anchors',
    currentBlockId: uuid(112),
    candidateOldBlockIds: [uuid(101), uuid(104)],
    evidenceLevel: 'two-sided-content-anchors',
  }]);
  assert.equal(result.reviewStatus, 'pending');
});

test('marks every current contender when two blocks compete for one old block', () => {
  const previous = createIndex([
    row(120, '左'),
    row(121, '重复'),
    row(122, '右'),
  ]);
  const current = createIndex([
    row(130, '前'),
    row(131, '左'),
    row(132, '重复'),
    row(133, '右'),
    row(134, '左'),
    row(135, '重复'),
    row(136, '右'),
  ], { sourceContentHash: sha256('one-old-many-current') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.equal(result.blocks[2].blockId, uuid(132));
  assert.equal(result.blocks[5].blockId, uuid(135));
  assert.deepEqual(
    result.issues.map(issue => ({
      currentBlockId: issue.currentBlockId,
      candidateOldBlockIds: issue.candidateOldBlockIds,
      evidenceLevel: issue.evidenceLevel,
    })),
    [
      {
        currentBlockId: uuid(132),
        candidateOldBlockIds: [uuid(121)],
        evidenceLevel: 'two-sided-content-anchors',
      },
      {
        currentBlockId: uuid(135),
        candidateOldBlockIds: [uuid(121)],
        evidenceLevel: 'two-sided-content-anchors',
      },
    ],
  );
});

test('does not guess ID reuse for a whole-block move that violates monotonic order', () => {
  const previous = createIndex([
    row(140, '甲'),
    row(141, '乙'),
    row(142, '丙'),
  ]);
  const current = createIndex([
    row(149, ' ', { kind: 'separator' }),
    row(150, '丙'),
    row(151, '乙'),
    row(152, '甲'),
  ], { sourceContentHash: sha256('moved-current') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.deepEqual(
    result.blocks.map(block => block.blockId),
    [uuid(149), uuid(150), uuid(151), uuid(152)],
  );
  assert.equal(result.issues.length, 3);
  assert.ok(
    result.issues.every(
      issue => issue.evidenceLevel === 'globally-unique-content',
    ),
  );
});

test('uses full-book uniqueness rather than uniqueness after an earlier match', () => {
  const previous = createIndex([
    row(160, '重复'),
    row(161, '旧中间'),
    row(162, '重复'),
  ]);
  const current = createIndex([
    row(170, '重复'),
    row(171, '新中间内容'),
    row(172, '重复'),
  ], { sourceContentHash: sha256('full-book-count-current') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.equal(result.blocks[0].blockId, uuid(160));
  assert.equal(result.blocks[2].blockId, uuid(172));
  assert.equal(result.issues.length, 0);
});

test('does not treat a hash shared by another block kind as globally unique', () => {
  const previous = createIndex([
    row(173, '同文'),
    row(174, '同文', { kind: 'heading' }),
  ]);
  const current = createIndex([
    row(175, ' ', { kind: 'separator' }),
    row(176, '同文'),
  ], { sourceContentHash: sha256('cross-kind-hash-current') });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.equal(result.blocks[1].blockId, uuid(176));
  assert.equal(result.issues.length, 0);
});

test('keeps completely unrelated content as ordinary fresh blocks without false issues', () => {
  const previous = createIndex([row(180, '旧甲'), row(181, '旧乙')]);
  const current = createIndex([row(190, '新甲'), row(191, '新乙')], {
    sourceContentHash: sha256('unrelated-current'),
  });

  const result = alignDocumentBlockIndexV1(current, previous);
  assert.deepEqual(
    result.blocks.map(block => block.blockId),
    [uuid(190), uuid(191)],
  );
  assert.deepEqual(result.issues, []);
  assert.equal(result.reviewStatus, 'not_required');
});

test('rejects invalid hash, provenance, duplicate locator, overflow, and duplicate IDs', () => {
  const cases = [
    {
      detailReason: 'canonical_block_hash_mismatch',
      mutate(value) {
        value.blocks[0].contentHash = '0'.repeat(64);
      },
    },
    {
      detailReason: 'source_locator_provenance_invalid',
      mutate(value) {
        value.blocks[0].sourceLocator.sourceAssetId = ASSET_B;
      },
    },
    {
      detailReason: 'source_locator_duplicate',
      mutate(value) {
        value.blocks[1].sourceLocator.sourceByteRange
          = value.blocks[0].sourceLocator.sourceByteRange;
      },
    },
    {
      detailReason: 'source_locator_range_invalid',
      mutate(value) {
        value.blocks[1].sourceLocator.sourceByteRange.endByte
          = value.sourceByteLength + 1;
      },
    },
    {
      detailReason: 'block_id_duplicate',
      mutate(value) {
        value.blocks[1].blockId = value.blocks[0].blockId;
      },
    },
    {
      detailReason: 'raw_coverage_invalid',
      mutate(value) {
        value.rawTextRevision.byteLength += 1;
      },
    },
    {
      detailReason: 'raw_locator_range_invalid',
      mutate(value) {
        value.rawTextRevision.textRevisionId = uuid(904);
      },
    },
  ];

  for (const { detailReason, mutate } of cases) {
    const value = structuredClone(createIndex([row(200, '甲'), row(201, '乙')]));
    mutate(value);
    assert.throws(
      () => validateDocumentBlockIndexV1(value),
      error => error instanceof DocumentBlockIndexValidationError
        && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
        && error.detailReason === detailReason,
    );
  }
});

test('rejects duplicate candidate IDs and unknown evidence levels in issues', () => {
  const cases = [
    {
      candidateOldBlockIds: [uuid(300), uuid(300)],
      evidenceLevel: 'globally-unique-content',
    },
    {
      candidateOldBlockIds: [uuid(300)],
      evidenceLevel: 'unknown-evidence',
    },
  ];

  for (const issueFields of cases) {
    const value = createIndex([row(301, '待审')]);
    value.issues = [{
      code: 'ambiguous_reimport_alignment',
      severity: 'warning',
      reviewStatus: 'pending',
      message: 'synthetic pending review',
      currentBlockId: uuid(301),
      ...issueFields,
    }];
    value.reviewStatus = 'pending';
    assert.throws(
      () => validateDocumentBlockIndexV1(value),
      error => error instanceof DocumentBlockIndexValidationError
        && error.detailReason === 'alignment_issue_invalid',
    );
  }
});

function row(id, canonicalText, options = {}) {
  return {
    blockId: uuid(id),
    canonicalText,
    kind: options.kind ?? 'paragraph',
    rawByteLength: options.rawByteLength
      ?? Math.max(1, Buffer.byteLength(canonicalText, 'utf8')),
  };
}

function createIndex(rows, options = {}) {
  const canonicalText = rows.map(value => value.canonicalText).join('');
  const sourceAssetId = options.sourceAssetId ?? ASSET_A;
  const sourceContentHash
    = options.sourceContentHash ?? sha256(`source:${canonicalText}`);
  let canonicalCursor = 0;
  let sourceCursor = 0;
  let rawCursor = 0;
  const blocks = rows.map((value, rowIndex) => {
    const canonicalStart = canonicalCursor;
    const sourceStart = sourceCursor;
    const rawStart = rawCursor;
    canonicalCursor += Buffer.byteLength(value.canonicalText, 'utf8');
    sourceCursor += value.rawByteLength;
    rawCursor += value.rawByteLength;
    return {
      blockId: value.blockId,
      kind: value.kind,
      canonicalText: value.canonicalText,
      canonicalRange: {
        textRevisionId: CANONICAL_REVISION,
        textLayer: 'canonical',
        offsetUnit: 'utf8-byte',
        startByte: canonicalStart,
        endByte: canonicalCursor,
      },
      contentHash: sha256(value.canonicalText),
      sourceLocator: {
        sourceAssetId,
        sourceContentHash,
        sourceEncoding: 'utf-8',
        sourceByteRange: {
          offsetUnit: 'source-byte',
          startByte: sourceStart,
          endByte: sourceCursor,
        },
        rawTextRange: {
          textRevisionId: RAW_REVISION,
          textLayer: 'raw',
          offsetUnit: 'utf8-byte',
          startByte: rawStart,
          endByte: rawCursor,
        },
        lineRange: {
          lineBase: 1,
          startLine: rowIndex + 1,
          endLineExclusive: rowIndex + 2,
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
    sourceByteLength: sourceCursor,
    sourceEncoding: 'utf-8',
    rawTextRevision: {
      textRevisionId: RAW_REVISION,
      textLayer: 'raw',
      contentHash: sha256(`raw:${canonicalText}`),
      byteLength: rawCursor,
    },
    canonicalTextRevision: {
      textRevisionId: CANONICAL_REVISION,
      textLayer: 'canonical',
      contentHash: sha256(canonicalText),
      byteLength: Buffer.byteLength(canonicalText, 'utf8'),
    },
    blocks,
    issues: [],
    reviewStatus: 'not_required',
  };
}

function uuid(value) {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
