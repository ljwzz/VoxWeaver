import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildDocumentBlockIndexV1,
  canonicalizeRawTextV1,
  DocumentBlockIndexValidationError,
} from '../dist/index.js';

const SOURCE_ASSET_ID = uuid(700);
const RAW_REVISION_ID = uuid(701);
const CANONICAL_REVISION_ID = uuid(702);

test('maps BOM and CRLF block boundaries using canonical UTF-8 byte cursors', () => {
  const fixture = createFixture([
    { text: '\uFEFF中\r\n', blockId: uuid(1) },
    { text: '😀e\u0301\n', blockId: uuid(2) },
    { text: '尾\r', blockId: uuid(3) },
  ]);

  const result = buildDocumentBlockIndexV1(fixture.input);
  assert.equal(result.blocks.map(block => block.canonicalText).join(''), '中\n😀e\u0301\n尾\n');
  assert.deepEqual(
    result.blocks.map(block => [
      block.canonicalRange.startByte,
      block.canonicalRange.endByte,
    ]),
    [[0, 4], [4, 12], [12, 16]],
  );
  assert.deepEqual(
    result.blocks.map(block => block.blockId),
    [uuid(1), uuid(2), uuid(3)],
  );
  assert.equal(result.sourceAssetId, SOURCE_ASSET_ID);
  assert.equal(result.sourceContentHash, fixture.importedNovel.sourceHash);
  assert.equal(result.sourceByteLength, Buffer.byteLength(fixture.rawText, 'utf8'));
  assert.equal(result.sourceEncoding, 'utf-8');
  assert.equal(result.reviewStatus, 'not_required');
});

test('allows a non-empty raw block to map to an empty canonical range', () => {
  const fixture = createFixture([
    { text: '\uFEFF', blockId: uuid(10) },
    { text: '正文\n', blockId: uuid(11) },
  ]);

  const result = buildDocumentBlockIndexV1(fixture.input);
  assert.equal(result.blocks[0].canonicalText, '');
  assert.deepEqual(result.blocks[0].canonicalRange, {
    textRevisionId: CANONICAL_REVISION_ID,
    textLayer: 'canonical',
    offsetUnit: 'utf8-byte',
    startByte: 0,
    endByte: 0,
  });
  assert.equal(result.blocks[1].canonicalRange.startByte, 0);
  assert.equal(result.blocks.map(block => block.canonicalText).join(''), '正文\n');
});

test('preserves fresh opaque IDs and delegates optional reimport alignment', () => {
  const previousFixture = createFixture([
    { text: '甲\n', blockId: uuid(20) },
    { text: '乙\n', blockId: uuid(21) },
  ]);
  const previous = buildDocumentBlockIndexV1(previousFixture.input);
  const currentFixture = createFixture([
    { text: '甲\n', blockId: uuid(30) },
    { text: '乙\n', blockId: uuid(31) },
  ], {
    sourceAssetId: uuid(703),
    canonicalRevisionId: uuid(704),
    rawRevisionId: uuid(705),
  });

  const current = buildDocumentBlockIndexV1({
    ...currentFixture.input,
    previousIndex: previous,
  });
  assert.deepEqual(
    current.blocks.map(block => block.blockId),
    [uuid(20), uuid(21)],
  );
  assert.equal(new Set(current.blocks.map(block => block.blockId)).size, 2);
});

test('rejects incomplete ImportedNovel input through the existing contract parser', () => {
  const fixture = createFixture([{ text: '正文\n', blockId: uuid(40) }]);

  assert.throws(
    () => buildDocumentBlockIndexV1({
      ...fixture.input,
      importedNovel: {
        sourceAssetId: SOURCE_ASSET_ID,
        orderedBlocks: fixture.importedNovel.orderedBlocks,
      },
    }),
    error => isStructureError(error, 'block_index_input_invalid'),
  );
});

test('rejects input and output revision mismatches independently', () => {
  const fixture = createFixture([{ text: '正文\n', blockId: uuid(50) }]);
  const otherRaw = canonicalizeRawTextV1({
    rawTextRevision: revision(fixture.rawText, uuid(706), 'raw'),
    rawTextParts: [fixture.rawText],
    canonicalTextRevisionId: CANONICAL_REVISION_ID,
  });
  const otherOutput = canonicalizeRawTextV1({
    rawTextRevision: fixture.importedNovel.rawTextRevision,
    rawTextParts: [fixture.rawText],
    canonicalTextRevisionId: uuid(707),
  });

  assert.throws(
    () => buildDocumentBlockIndexV1({
      ...fixture.input,
      rawToCanonicalRangeMap: otherRaw.rangeMap,
    }),
    error => isStructureError(error, 'range_map_input_revision_mismatch'),
  );
  assert.throws(
    () => buildDocumentBlockIndexV1({
      ...fixture.input,
      rawToCanonicalRangeMap: otherOutput.rangeMap,
    }),
    error => isStructureError(error, 'range_map_output_revision_mismatch'),
  );
});

test('rejects canonical content that does not match its revision hash', () => {
  const fixture = createFixture([{ text: '中', blockId: uuid(60) }]);

  assert.throws(
    () => buildDocumentBlockIndexV1({
      ...fixture.input,
      canonicalText: '文',
    }),
    error => isStructureError(error, 'canonical_revision_content_mismatch'),
  );
});

test('rejects locator provenance, duplicate projection, and source overflow before mapping', () => {
  const cases = [
    (importedNovel) => {
      importedNovel.orderedBlocks[0].sourceLocator.sourceAssetId = uuid(799);
    },
    (importedNovel) => {
      importedNovel.orderedBlocks[1].sourceLocator.sourceByteRange
        = importedNovel.orderedBlocks[0].sourceLocator.sourceByteRange;
    },
    (importedNovel) => {
      importedNovel.orderedBlocks[1].sourceLocator.sourceByteRange.endByte
        = importedNovel.sourceByteLength + 1;
    },
  ];

  for (const mutate of cases) {
    const fixture = createFixture([
      { text: '甲', blockId: uuid(70) },
      { text: '乙', blockId: uuid(71) },
    ]);
    const importedNovel = structuredClone(fixture.importedNovel);
    mutate(importedNovel);
    assert.throws(
      () => buildDocumentBlockIndexV1({ ...fixture.input, importedNovel }),
      error => isStructureError(error, 'block_index_input_invalid'),
    );
  }
});

test('rejects a mapped canonical boundary inside a multi-byte scalar', () => {
  const fixture = createFixture([
    { text: 'a', blockId: uuid(80) },
    { text: 'bc', blockId: uuid(81) },
  ]);
  const canonicalText = '中';
  const canonicalRevision = revision(
    canonicalText,
    CANONICAL_REVISION_ID,
    'canonical',
  );
  const firstHash = sha256('segment-one');
  const secondHash = sha256('segment-two');
  const rangeMap = {
    documentType: 'text-range-map',
    schemaVersion: 1,
    mapVersion: 'm1-text-range-map-v1',
    processorId: 'synthetic-invalid-boundary',
    processorVersion: '1.0.0',
    inputRevision: fixture.importedNovel.rawTextRevision,
    outputRevision: canonicalRevision,
    segments: [
      {
        segmentIndex: 0,
        operation: 'identity',
        inputRange: textRange(fixture.importedNovel.rawTextRevision, 0, 1),
        outputRange: textRange(canonicalRevision, 0, 1),
        ruleId: 'synthetic.identity',
        ruleVersion: '1.0.0',
        beforeContentHash: firstHash,
        afterContentHash: firstHash,
      },
      {
        segmentIndex: 1,
        operation: 'identity',
        inputRange: textRange(fixture.importedNovel.rawTextRevision, 1, 3),
        outputRange: textRange(canonicalRevision, 1, 3),
        ruleId: 'synthetic.identity',
        ruleVersion: '1.0.0',
        beforeContentHash: secondHash,
        afterContentHash: secondHash,
      },
    ],
  };

  assert.throws(
    () => buildDocumentBlockIndexV1({
      ...fixture.input,
      canonicalText,
      canonicalTextRevision: canonicalRevision,
      rawToCanonicalRangeMap: rangeMap,
    }),
    error => isStructureError(error, 'canonical_block_boundary_invalid'),
  );
});

test('wraps an unmappable raw cursor as a typed block-index error', () => {
  const fixture = createFixture([
    { text: 'a', blockId: uuid(82) },
    { text: 'b', blockId: uuid(83) },
  ]);
  const canonicalText = '中';
  const canonicalRevision = revision(
    canonicalText,
    CANONICAL_REVISION_ID,
    'canonical',
  );
  const rangeMap = {
    documentType: 'text-range-map',
    schemaVersion: 1,
    mapVersion: 'm1-text-range-map-v1',
    processorId: 'synthetic-unmappable-cursor',
    processorVersion: '1.0.0',
    inputRevision: fixture.importedNovel.rawTextRevision,
    outputRevision: canonicalRevision,
    segments: [{
      segmentIndex: 0,
      operation: 'replace',
      inputRange: textRange(fixture.importedNovel.rawTextRevision, 0, 2),
      outputRange: textRange(canonicalRevision, 0, 3),
      ruleId: 'synthetic.replace',
      ruleVersion: '1.0.0',
      beforeContentHash: sha256('ab'),
      afterContentHash: sha256(canonicalText),
    }],
  };

  assert.throws(
    () => buildDocumentBlockIndexV1({
      ...fixture.input,
      canonicalText,
      canonicalTextRevision: canonicalRevision,
      rawToCanonicalRangeMap: rangeMap,
    }),
    error => isStructureError(error, 'canonical_block_mapping_failed'),
  );
});

function createFixture(rows, options = {}) {
  const sourceAssetId = options.sourceAssetId ?? SOURCE_ASSET_ID;
  const rawRevisionId = options.rawRevisionId ?? RAW_REVISION_ID;
  const canonicalRevisionId
    = options.canonicalRevisionId ?? CANONICAL_REVISION_ID;
  const rawText = rows.map(row => row.text).join('');
  const rawTextRevision = revision(rawText, rawRevisionId, 'raw');
  const canonical = canonicalizeRawTextV1({
    rawTextRevision,
    rawTextParts: rows.map(row => row.text),
    canonicalTextRevisionId: canonicalRevisionId,
  });
  const sourceHash = sha256(rawText);
  let byteCursor = 0;
  const orderedBlocks = rows.map((row, index) => {
    const startByte = byteCursor;
    byteCursor += Buffer.byteLength(row.text, 'utf8');
    return {
      blockId: row.blockId,
      kind: row.kind ?? 'paragraph',
      rawText: row.text,
      contentHash: sha256(row.text),
      sourceLocator: {
        sourceAssetId,
        sourceContentHash: sourceHash,
        sourceEncoding: 'utf-8',
        sourceByteRange: {
          offsetUnit: 'source-byte',
          startByte,
          endByte: byteCursor,
        },
        rawTextRange: textRange(rawTextRevision, startByte, byteCursor),
        lineRange: {
          lineBase: 1,
          startLine: index + 1,
          endLineExclusive: index + 2,
        },
      },
    };
  });
  const importedNovel = {
    documentType: 'imported-novel',
    schemaVersion: 1,
    sourceAssetId,
    sourceHash,
    sourceByteLength: Buffer.byteLength(rawText, 'utf8'),
    sourceFormat: 'txt',
    encodingDecision: {
      sourceContentHash: sourceHash,
      sourceEncoding: 'utf-8',
      method: 'strict-utf8',
    },
    adapterId: 'synthetic-txt-adapter',
    adapterVersion: '1.0.0',
    processorId: 'synthetic-txt-extractor',
    processorVersion: '1.0.0',
    alignmentPolicyVersion: 'm1-block-alignment-v1',
    rawTextRevision,
    metadata: {},
    orderedBlocks,
    structuralHints: [],
    warnings: [],
    reviewStatus: 'not_required',
  };
  return {
    rawText,
    importedNovel,
    input: {
      importedNovel,
      canonicalText: canonical.canonicalText,
      canonicalTextRevision: canonical.canonicalTextRevision,
      rawToCanonicalRangeMap: canonical.rangeMap,
    },
  };
}

function revision(text, textRevisionId, textLayer) {
  return {
    textRevisionId,
    textLayer,
    contentHash: sha256(text),
    byteLength: Buffer.byteLength(text, 'utf8'),
  };
}

function textRange(revisionRef, startByte, endByte) {
  return {
    textRevisionId: revisionRef.textRevisionId,
    textLayer: revisionRef.textLayer,
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function isStructureError(error, detailReason) {
  return error instanceof DocumentBlockIndexValidationError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}

function uuid(value) {
  return `00000000-0000-4000-8000-${value.toString(16).padStart(12, '0')}`;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}
