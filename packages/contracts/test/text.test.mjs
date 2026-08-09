import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  mapTextRangeToSingleV1,
  mapTextRangeV1,
  parseTextRangeMapV1,
  parseTextRangeV1,
  TEXT_RANGE_MAP_SCHEMA_VERSION,
  TEXT_RANGE_MAP_VERSION,
  TEXT_RANGE_MAPPING_SCHEMA_VERSION,
  TEXT_REFERENCE_SCHEMA,
  TextRangeMappingReviewRequiredError,
  TextReferenceValidationError,
} from '../dist/index.js';

const INPUT_REVISION_ID = '11111111-1111-4111-8111-111111111111';
const OUTPUT_REVISION_ID = '22222222-2222-4222-8222-222222222222';
const THIRD_REVISION_ID = '33333333-3333-4333-8333-333333333333';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);

const documentedSchema = JSON.parse(
  await readFile(
    new URL('../../../docs/schemas/text-reference.schema.json', import.meta.url),
    'utf8',
  ),
);

function revision(textRevisionId, textLayer, byteLength, contentHash = HASH_A) {
  return { textRevisionId, textLayer, contentHash, byteLength };
}

function range(textRevisionId, textLayer, startByte, endByte) {
  return {
    textRevisionId,
    textLayer,
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function identityMap(overrides = {}) {
  return {
    documentType: 'text-range-map',
    schemaVersion: TEXT_RANGE_MAP_SCHEMA_VERSION,
    mapVersion: TEXT_RANGE_MAP_VERSION,
    processorId: 'test.canonicalizer',
    processorVersion: '1.0.0',
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 11),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 11),
    segments: [{
      segmentIndex: 0,
      operation: 'identity',
      inputRange: range(INPUT_REVISION_ID, 'raw', 0, 11),
      outputRange: range(OUTPUT_REVISION_ID, 'canonical', 0, 11),
      ruleId: 'identity',
      ruleVersion: '1',
      beforeContentHash: HASH_A,
      afterContentHash: HASH_A,
    }],
    ...overrides,
  };
}

function mappingRequest(direction, mappedRange, cursorBias) {
  return {
    schemaVersion: TEXT_RANGE_MAPPING_SCHEMA_VERSION,
    mapVersion: TEXT_RANGE_MAP_VERSION,
    direction,
    range: mappedRange,
    ...(cursorBias === undefined ? {} : { cursorBias }),
  };
}

test('keeps the documented text schema equal to the runtime schema', () => {
  assert.deepEqual(documentedSchema, TEXT_REFERENCE_SCHEMA);
});

test('validates the documented schema with the same version boundary', () => {
  const ajv = new Ajv2020({ allErrors: true });
  const validate = ajv.compile(documentedSchema);
  const valid = identityMap();

  assert.equal(validate(valid), true);
  assert.equal(validate({ ...valid, schemaVersion: 2 }), false);
  assert.equal(validate({ ...valid, mapVersion: 'm1-text-range-map-v2' }), false);
});

test('accepts identity and empty-revision boundary maps', () => {
  const valid = identityMap({ futureField: { retained: true } });
  assert.equal(parseTextRangeMapV1(valid), valid);

  const emptyMap = identityMap({
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 0),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 0),
    segments: [],
  });
  assert.equal(parseTextRangeMapV1(emptyMap), emptyMap);
});

test('enforces safe ordered revision-aware UTF-8 byte ranges', () => {
  const text = 'A中😀é';
  const bytes = new TextEncoder().encode(text);
  assert.equal(bytes.byteLength, 11);
  const context = {
    revision: revision(INPUT_REVISION_ID, 'raw', bytes.byteLength),
    utf8Bytes: bytes,
  };

  assert.deepEqual(
    parseTextRangeV1(range(INPUT_REVISION_ID, 'raw', 1, 4), context),
    range(INPUT_REVISION_ID, 'raw', 1, 4),
  );
  assert.deepEqual(
    parseTextRangeV1(range(INPUT_REVISION_ID, 'raw', 4, 4), context),
    range(INPUT_REVISION_ID, 'raw', 4, 4),
  );

  const invalid = [
    range(INPUT_REVISION_ID, 'raw', 5, 4),
    range(INPUT_REVISION_ID, 'raw', 0, 12),
    range(OUTPUT_REVISION_ID, 'raw', 0, 1),
    range(INPUT_REVISION_ID, 'canonical', 0, 1),
    range(INPUT_REVISION_ID, 'raw', 2, 4),
    { ...range(INPUT_REVISION_ID, 'raw', 0, 1), startByte: Number.MAX_SAFE_INTEGER + 1 },
    { ...range(INPUT_REVISION_ID, 'raw', 0, 1), offsetUnit: 'utf16-code-unit' },
    { ...range(INPUT_REVISION_ID, 'raw', 0, 1), futureField: true },
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseTextRangeV1(value, context),
      TextReferenceValidationError,
    );
  }
});

test('accepts ordered insert anchors followed by identity bytes', () => {
  const map = identityMap({
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 3),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 4, HASH_B),
    segments: [
      {
        segmentIndex: 0,
        operation: 'insert',
        inputRange: range(INPUT_REVISION_ID, 'raw', 0, 0),
        outputRange: range(OUTPUT_REVISION_ID, 'canonical', 0, 1),
        ruleId: 'leading-insert',
        ruleVersion: '1',
        beforeContentHash: HASH_A,
        afterContentHash: HASH_B,
      },
      {
        segmentIndex: 1,
        operation: 'identity',
        inputRange: range(INPUT_REVISION_ID, 'raw', 0, 3),
        outputRange: range(OUTPUT_REVISION_ID, 'canonical', 1, 4),
        ruleId: 'identity',
        ruleVersion: '1',
        beforeContentHash: HASH_A,
        afterContentHash: HASH_A,
      },
    ],
  });

  assert.equal(parseTextRangeMapV1(map), map);
});

test('rejects malformed operations, gaps, revisions, and segment order', () => {
  const base = identityMap();
  const segment = base.segments[0];
  const invalidMaps = [
    identityMap({
      inputRevision: revision(INPUT_REVISION_ID, 'raw', 0),
      outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 0),
      segments: [{
        ...segment,
        operation: 'insert',
        inputRange: range(INPUT_REVISION_ID, 'raw', 0, 0),
        outputRange: range(OUTPUT_REVISION_ID, 'canonical', 0, 0),
      }],
    }),
    identityMap({
      segments: [{ ...segment, segmentIndex: 1 }],
    }),
    identityMap({
      segments: [{
        ...segment,
        inputRange: range(INPUT_REVISION_ID, 'raw', 1, 11),
      }],
    }),
    identityMap({
      segments: [{ ...segment, afterContentHash: HASH_B }],
    }),
    identityMap({
      outputRevision: revision(OUTPUT_REVISION_ID, 'normalized', 11),
      segments: [{
        ...segment,
        outputRange: range(OUTPUT_REVISION_ID, 'normalized', 0, 11),
      }],
    }),
    identityMap({
      segments: [{
        ...segment,
        inputRange: range(OUTPUT_REVISION_ID, 'raw', 0, 11),
      }],
    }),
  ];

  for (const value of invalidMaps) {
    assert.throws(
      () => parseTextRangeMapV1(value),
      TextReferenceValidationError,
    );
  }
});

test('maps prefix, middle, and suffix insert anchor groups with explicit bias', () => {
  const map = identityMap({
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 4),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 8, HASH_B),
    segments: [
      mappingSegment(0, 'insert', 0, 0, 0, 1),
      mappingSegment(1, 'insert', 0, 0, 1, 2),
      mappingSegment(2, 'identity', 0, 2, 2, 4),
      mappingSegment(3, 'insert', 2, 2, 4, 5),
      mappingSegment(4, 'identity', 2, 4, 5, 7),
      mappingSegment(5, 'insert', 4, 4, 7, 8),
    ],
  });

  const cursorCases = [
    [0, 'before', 0],
    [0, 'after', 2],
    [2, 'before', 4],
    [2, 'after', 5],
    [4, 'before', 7],
    [4, 'after', 8],
  ];
  for (const [sourceByte, bias, targetByte] of cursorCases) {
    assert.deepEqual(
      mapTextRangeToSingleV1(
        map,
        mappingRequest(
          'input-to-output',
          range(INPUT_REVISION_ID, 'raw', sourceByte, sourceByte),
          bias,
        ),
      ),
      range(OUTPUT_REVISION_ID, 'canonical', targetByte, targetByte),
    );
  }

  const full = mapTextRangeV1(
    map,
    mappingRequest(
      'input-to-output',
      range(INPUT_REVISION_ID, 'raw', 0, 4),
    ),
  );
  assert.deepEqual(
    full.mappedFragments.map(fragment => fragment.targetRange),
    [
      range(OUTPUT_REVISION_ID, 'canonical', 2, 4),
      range(OUTPUT_REVISION_ID, 'canonical', 5, 7),
    ],
  );
  assert.throws(
    () => mapTextRangeToSingleV1(
      map,
      mappingRequest(
        'input-to-output',
        range(INPUT_REVISION_ID, 'raw', 0, 4),
      ),
    ),
    TextRangeMappingReviewRequiredError,
  );
});

test('maps delete anchors in reverse and reports delete/insert gaps', () => {
  const deleteMap = identityMap({
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 8),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 6, HASH_B),
    segments: [
      mappingSegment(0, 'identity', 0, 2, 0, 2),
      mappingSegment(1, 'delete', 2, 3, 2, 2),
      mappingSegment(2, 'delete', 3, 4, 2, 2),
      mappingSegment(3, 'identity', 4, 8, 2, 6),
    ],
  });

  assert.deepEqual(
    mapTextRangeToSingleV1(
      deleteMap,
      mappingRequest(
        'output-to-input',
        range(OUTPUT_REVISION_ID, 'canonical', 2, 2),
        'before',
      ),
    ),
    range(INPUT_REVISION_ID, 'raw', 2, 2),
  );
  assert.deepEqual(
    mapTextRangeToSingleV1(
      deleteMap,
      mappingRequest(
        'output-to-input',
        range(OUTPUT_REVISION_ID, 'canonical', 2, 2),
        'after',
      ),
    ),
    range(INPUT_REVISION_ID, 'raw', 4, 4),
  );

  const deleted = mapTextRangeV1(
    deleteMap,
    mappingRequest(
      'input-to-output',
      range(INPUT_REVISION_ID, 'raw', 2, 4),
    ),
  );
  assert.equal(deleted.mappedFragments.length, 0);
  assert.deepEqual(
    deleted.unmappableFragments.map(fragment => fragment.operation),
    ['delete', 'delete'],
  );
  assert.ok(
    deleted.unmappableFragments.every(
      fragment => fragment.targetRange.startByte === fragment.targetRange.endByte,
    ),
  );

  const insertMap = identityMap({
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 4),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 8, HASH_B),
    segments: [
      mappingSegment(0, 'insert', 0, 0, 0, 1),
      mappingSegment(1, 'insert', 0, 0, 1, 2),
      mappingSegment(2, 'identity', 0, 4, 2, 6),
      mappingSegment(3, 'insert', 4, 4, 6, 8),
    ],
  });
  const inserted = mapTextRangeV1(
    insertMap,
    mappingRequest(
      'output-to-input',
      range(OUTPUT_REVISION_ID, 'canonical', 0, 2),
    ),
  );
  assert.deepEqual(
    inserted.unmappableFragments.map(fragment => fragment.operation),
    ['insert', 'insert'],
  );
});

test('maps only complete replace segments and rejects partial replace', () => {
  const map = identityMap({
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 6),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 8, HASH_B),
    segments: [
      mappingSegment(0, 'identity', 0, 2, 0, 2),
      mappingSegment(1, 'replace', 2, 4, 2, 6),
      mappingSegment(2, 'identity', 4, 6, 6, 8),
    ],
  });

  assert.deepEqual(
    mapTextRangeToSingleV1(
      map,
      mappingRequest(
        'input-to-output',
        range(INPUT_REVISION_ID, 'raw', 2, 4),
      ),
    ),
    range(OUTPUT_REVISION_ID, 'canonical', 2, 6),
  );

  const partial = mapTextRangeV1(
    map,
    mappingRequest(
      'input-to-output',
      range(INPUT_REVISION_ID, 'raw', 3, 4),
    ),
  );
  assert.equal(partial.mappedFragments.length, 0);
  assert.equal(partial.unmappableFragments[0].operation, 'replace');
  assert.equal(partial.unmappableFragments[0].reason, 'range_unmappable');
  assert.throws(
    () => mapTextRangeToSingleV1(
      map,
      mappingRequest(
        'output-to-input',
        range(OUTPUT_REVISION_ID, 'canonical', 3, 5),
      ),
    ),
    TextRangeMappingReviewRequiredError,
  );
});

test('merges only adjacent identity segments and preserves gaps across maps', () => {
  const identityOnly = identityMap({
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 4),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 4),
    segments: [
      mappingSegment(0, 'identity', 0, 2, 0, 2),
      mappingSegment(1, 'identity', 2, 4, 2, 4),
    ],
  });
  const merged = mapTextRangeV1(
    identityOnly,
    mappingRequest(
      'input-to-output',
      range(INPUT_REVISION_ID, 'raw', 0, 4),
    ),
  );
  assert.equal(merged.mappedFragments.length, 1);
  assert.deepEqual(merged.mappedFragments[0].segmentIndexes, [0, 1]);

  const firstMap = identityMap({
    inputRevision: revision(INPUT_REVISION_ID, 'raw', 8),
    outputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 6, HASH_B),
    segments: [
      mappingSegment(0, 'identity', 0, 2, 0, 2),
      mappingSegment(1, 'delete', 2, 4, 2, 2),
      mappingSegment(2, 'identity', 4, 8, 2, 6),
    ],
  });
  const firstResult = mapTextRangeV1(
    firstMap,
    mappingRequest(
      'input-to-output',
      range(INPUT_REVISION_ID, 'raw', 0, 8),
    ),
  );
  assert.equal(firstResult.mappedFragments.length, 2);
  assert.equal(firstResult.unmappableFragments.length, 1);

  const secondMap = identityMap({
    inputRevision: revision(OUTPUT_REVISION_ID, 'canonical', 6, HASH_B),
    outputRevision: revision(THIRD_REVISION_ID, 'normalized', 6, HASH_B),
    segments: [{
      ...mappingSegment(0, 'identity', 0, 6, 0, 6),
      inputRange: range(OUTPUT_REVISION_ID, 'canonical', 0, 6),
      outputRange: range(THIRD_REVISION_ID, 'normalized', 0, 6),
    }],
  });
  const finalRanges = firstResult.mappedFragments.map(fragment => (
    mapTextRangeToSingleV1(
      secondMap,
      mappingRequest('input-to-output', fragment.targetRange),
    )
  ));
  assert.deepEqual(finalRanges, [
    range(THIRD_REVISION_ID, 'normalized', 0, 2),
    range(THIRD_REVISION_ID, 'normalized', 2, 6),
  ]);
  assert.equal(finalRanges.length, 2, 'must not envelope ranges across a prior gap');
});

test('requires explicit cursor bias and fixed non-empty endpoint bias', () => {
  const map = identityMap();
  assert.throws(
    () => mapTextRangeV1(
      map,
      mappingRequest(
        'input-to-output',
        range(INPUT_REVISION_ID, 'raw', 0, 0),
      ),
    ),
    TextReferenceValidationError,
  );
  assert.throws(
    () => mapTextRangeV1(
      map,
      mappingRequest(
        'input-to-output',
        range(INPUT_REVISION_ID, 'raw', 0, 1),
        'after',
      ),
    ),
    TextReferenceValidationError,
  );
});

function mappingSegment(
  segmentIndex,
  operation,
  inputStart,
  inputEnd,
  outputStart,
  outputEnd,
) {
  return {
    segmentIndex,
    operation,
    inputRange: range(INPUT_REVISION_ID, 'raw', inputStart, inputEnd),
    outputRange: range(OUTPUT_REVISION_ID, 'canonical', outputStart, outputEnd),
    ruleId: `test-${operation}`,
    ruleVersion: '1',
    beforeContentHash: HASH_A,
    afterContentHash: operation === 'identity' ? HASH_A : HASH_B,
  };
}
