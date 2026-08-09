import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  CANONICAL_RULE_IDS,
  CANONICAL_RULE_VERSION,
  CANONICALIZER_PROCESSOR_ID,
  CANONICALIZER_PROCESSOR_VERSION,
  canonicalizeRawTextV1,
} from '../dist/index.js';

const RAW_REVISION_ID = '11111111-1111-4111-8111-111111111111';
const CANONICAL_REVISION_ID = '22222222-2222-4222-8222-222222222222';

test('applies only the approved deterministic canonical rules', () => {
  const rawText = '\uFEFFA\r\nB\rC\n\u0000D\u000BE\u007FF\uFEFFG';
  const result = canonicalize(rawText);

  assert.equal(result.canonicalText, 'A\nB\nC\nDEF\uFEFFG');
  assert.deepEqual(
    result.rangeMap.segments.map(segment => segment.operation),
    [
      'delete',
      'identity',
      'replace',
      'identity',
      'replace',
      'identity',
      'delete',
      'identity',
      'delete',
      'identity',
      'delete',
      'identity',
    ],
  );
  assert.equal(result.rangeMap.segments[0].ruleId, CANONICAL_RULE_IDS.leadingBom);
  assert.equal(result.rangeMap.segments[2].ruleId, CANONICAL_RULE_IDS.lineEnding);
  assert.equal(result.rangeMap.segments[6].ruleId, CANONICAL_RULE_IDS.controlCharacter);
  assert.ok(
    result.rangeMap.segments.every(
      segment => segment.ruleVersion === CANONICAL_RULE_VERSION,
    ),
  );
  assertTransformIntegrity(rawText, result);
});

test('preserves Unicode composition, C1, whitespace, fullwidth text, and Chinese punctuation', () => {
  const c1Controls = Array.from(
    { length: 0x20 },
    (_, index) => String.fromCodePoint(0x80 + index),
  ).join('');
  const rawText = `e\u0301|é|${c1Controls}|\t|\u00A0|\u3000|１２ＡＢ|中文，。！？；：“”‘’《》——……\uFEFF`;
  const result = canonicalize(rawText);

  assert.equal(result.canonicalText, rawText);
  assert.equal(result.rangeMap.segments.length, 1);
  assert.equal(result.rangeMap.segments[0].operation, 'identity');
  assert.equal(result.rangeMap.segments[0].ruleId, CANONICAL_RULE_IDS.identity);
  assertTransformIntegrity(rawText, result);
});

test('removes exactly one leading BOM and preserves later BOM characters', () => {
  const rawText = '\uFEFF\uFEFF正文\uFEFF';
  const result = canonicalize(rawText);

  assert.equal(result.canonicalText, '\uFEFF正文\uFEFF');
  assert.equal(result.rangeMap.segments[0].operation, 'delete');
  assert.deepEqual(result.rangeMap.segments[0].inputRange, {
    textRevisionId: RAW_REVISION_ID,
    textLayer: 'raw',
    offsetUnit: 'utf8-byte',
    startByte: 0,
    endByte: 3,
  });
  assertTransformIntegrity(rawText, result);
});

test('deletes all forbidden C0 controls and DEL while preserving TAB and LF', () => {
  const forbidden = Array.from(
    { length: 0x20 },
    (_, codePoint) => String.fromCodePoint(codePoint),
  ).filter(character => !['\t', '\n', '\r'].includes(character));
  const rawText = `A${forbidden.join('')}\u007F\t\nB`;
  const result = canonicalize(rawText);

  assert.equal(result.canonicalText, 'A\t\nB');
  assertTransformIntegrity(rawText, result);
});

test('normalizes CRLF and solitary CR across iterable boundaries using UTF-8 byte ranges', () => {
  const rawTextParts = [
    '\uFEFF中\r',
    '\n\uD83D',
    '\uDE00e\u0301\u0000',
    '尾\r',
  ];
  const rawText = rawTextParts.join('');
  const result = canonicalize(rawText, rawTextParts);

  assert.equal(result.canonicalText, '中\n😀e\u0301尾\n');
  assert.deepEqual(
    result.rangeMap.segments.map(segment => [
      segment.operation,
      segment.inputRange.startByte,
      segment.inputRange.endByte,
      segment.outputRange.startByte,
      segment.outputRange.endByte,
    ]),
    [
      ['delete', 0, 3, 0, 0],
      ['identity', 3, 6, 0, 3],
      ['replace', 6, 8, 3, 4],
      ['identity', 8, 15, 4, 11],
      ['delete', 15, 16, 11, 11],
      ['identity', 16, 19, 11, 14],
      ['replace', 19, 20, 14, 15],
    ],
  );
  assertTransformIntegrity(rawText, result);
});

test('is idempotent for already-canonical text', () => {
  const first = canonicalize('\uFEFF甲\r\n乙\u0000e\u0301');
  const secondRawRevisionId = '33333333-3333-4333-8333-333333333333';
  const secondCanonicalRevisionId = '44444444-4444-4444-8444-444444444444';
  const second = canonicalizeRawTextV1({
    rawTextRevision: revision(
      first.canonicalText,
      secondRawRevisionId,
      'raw',
    ),
    rawTextParts: [first.canonicalText],
    canonicalTextRevisionId: secondCanonicalRevisionId,
  });

  assert.equal(second.canonicalText, first.canonicalText);
  assert.ok(second.rangeMap.segments.every(segment => segment.operation === 'identity'));
  assertTransformIntegrity(first.canonicalText, second, secondRawRevisionId);
});

test('supports empty and fully deleted inputs with complete legal maps', () => {
  const empty = canonicalize('');
  assert.equal(empty.canonicalText, '');
  assert.deepEqual(empty.rangeMap.segments, []);
  assert.equal(empty.canonicalTextRevision.contentHash, sha256(''));

  const deleted = canonicalize('\uFEFF\u0000\u007F');
  assert.equal(deleted.canonicalText, '');
  assert.ok(deleted.rangeMap.segments.every(segment => segment.operation === 'delete'));
  assertTransformIntegrity('\uFEFF\u0000\u007F', deleted);
});

test('rejects raw parts whose exact UTF-8 byteLength or SHA-256 does not match', () => {
  const validRevision = revision('正文', RAW_REVISION_ID, 'raw');

  assert.throws(
    () => canonicalizeRawTextV1({
      rawTextRevision: { ...validRevision, byteLength: validRevision.byteLength + 1 },
      rawTextParts: ['正文'],
      canonicalTextRevisionId: CANONICAL_REVISION_ID,
    }),
    /do not match the supplied text revision/u,
  );
  assert.throws(
    () => canonicalizeRawTextV1({
      rawTextRevision: { ...validRevision, contentHash: '0'.repeat(64) },
      rawTextParts: ['正文'],
      canonicalTextRevisionId: CANONICAL_REVISION_ID,
    }),
    /do not match the supplied text revision/u,
  );
});

test('rejects non-raw input revisions, invalid output UUIDs, and non-string parts', () => {
  assert.throws(
    () => canonicalizeRawTextV1({
      rawTextRevision: revision('正文', RAW_REVISION_ID, 'canonical'),
      rawTextParts: ['正文'],
      canonicalTextRevisionId: CANONICAL_REVISION_ID,
    }),
    /must use the raw text layer/u,
  );
  assert.throws(
    () => canonicalizeRawTextV1({
      rawTextRevision: revision('正文', RAW_REVISION_ID, 'raw'),
      rawTextParts: ['正文'],
      canonicalTextRevisionId: 'not-a-uuid',
    }),
  );
  assert.throws(
    () => canonicalizeRawTextV1({
      rawTextRevision: revision('正文', RAW_REVISION_ID, 'raw'),
      rawTextParts: /** @type {Iterable<string>} */ ([123]),
      canonicalTextRevisionId: CANONICAL_REVISION_ID,
    }),
    /must contain only strings/u,
  );
});

function canonicalize(rawText, rawTextParts = [rawText]) {
  return canonicalizeRawTextV1({
    rawTextRevision: revision(rawText, RAW_REVISION_ID, 'raw'),
    rawTextParts,
    canonicalTextRevisionId: CANONICAL_REVISION_ID,
  });
}

function revision(text, textRevisionId, textLayer) {
  return {
    textRevisionId,
    textLayer,
    contentHash: sha256(text),
    byteLength: Buffer.byteLength(text, 'utf8'),
  };
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function assertTransformIntegrity(
  rawText,
  result,
  rawRevisionId = RAW_REVISION_ID,
) {
  const rawBytes = Buffer.from(rawText, 'utf8');
  const canonicalBytes = Buffer.from(result.canonicalText, 'utf8');
  const inputPieces = [];
  const outputPieces = [];
  let inputCursor = 0;
  let outputCursor = 0;

  assert.equal(result.canonicalTextRevision.textLayer, 'canonical');
  assert.equal(result.canonicalTextRevision.contentHash, sha256(canonicalBytes));
  assert.equal(result.canonicalTextRevision.byteLength, canonicalBytes.byteLength);
  assert.equal(result.rangeMap.processorId, CANONICALIZER_PROCESSOR_ID);
  assert.equal(result.rangeMap.processorVersion, CANONICALIZER_PROCESSOR_VERSION);
  assert.deepEqual(
    result.rangeMap.inputRevision,
    revision(rawText, rawRevisionId, 'raw'),
  );
  assert.deepEqual(result.rangeMap.outputRevision, result.canonicalTextRevision);

  for (const [segmentIndex, segment] of result.rangeMap.segments.entries()) {
    assert.equal(segment.segmentIndex, segmentIndex);
    assert.equal(segment.inputRange.startByte, inputCursor);
    assert.equal(segment.outputRange.startByte, outputCursor);
    const before = rawBytes.subarray(
      segment.inputRange.startByte,
      segment.inputRange.endByte,
    );
    const after = canonicalBytes.subarray(
      segment.outputRange.startByte,
      segment.outputRange.endByte,
    );
    assert.equal(segment.beforeContentHash, sha256(before));
    assert.equal(segment.afterContentHash, sha256(after));
    inputPieces.push(before);
    outputPieces.push(after);
    inputCursor = segment.inputRange.endByte;
    outputCursor = segment.outputRange.endByte;
  }

  assert.equal(inputCursor, rawBytes.byteLength);
  assert.equal(outputCursor, canonicalBytes.byteLength);
  assert.deepEqual(Buffer.concat(inputPieces), rawBytes);
  assert.deepEqual(Buffer.concat(outputPieces), canonicalBytes);
}
