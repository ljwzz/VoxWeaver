import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import Ajv2020 from 'ajv/dist/2020.js';

import {
  BLOCK_ALIGNMENT_POLICY_VERSION,
  getTxtExactLocatorKeyV1,
  NOVEL_IMPORT_SCHEMA,
  NOVEL_IMPORT_SCHEMA_VERSION,
  NovelImportValidationError,
  parseChapterIndexV1,
  parseImportedNovelV1,
  parseNovelImportDocumentV1,
} from '../dist/index.js';

const SOURCE_ASSET_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SOURCE_ASSET_ID = '22222222-2222-4222-8222-222222222222';
const RAW_REVISION_ID = '33333333-3333-4333-8333-333333333333';
const CANONICAL_REVISION_ID = '44444444-4444-4444-8444-444444444444';
const BLOCK_ID = '55555555-5555-4555-8555-555555555555';
const BLOCK_ID_2 = '66666666-6666-4666-8666-666666666666';
const CANDIDATE_ID = '77777777-7777-4777-8777-777777777777';
const CHAPTER_ID = '88888888-8888-4888-8888-888888888888';
const ISSUE_ID = '99999999-9999-4999-8999-999999999999';
const HASH_A = 'a'.repeat(64);
const HASH_B = 'b'.repeat(64);
const RAW_TEXT = '正文';
const RAW_HASH = sha256Utf8(RAW_TEXT);
const RAW_BYTE_LENGTH = 6;
const importedNovelValidationContext = { sha256Utf8, sha256Utf8Parts };

const documentedTextSchema = JSON.parse(
  await readFile(
    new URL('../../../docs/schemas/text-reference.schema.json', import.meta.url),
    'utf8',
  ),
);
const documentedNovelImportSchema = JSON.parse(
  await readFile(
    new URL('../../../docs/schemas/novel-import.schema.json', import.meta.url),
    'utf8',
  ),
);

function textRevision(textRevisionId, textLayer, byteLength, contentHash = HASH_A) {
  return { textRevisionId, textLayer, contentHash, byteLength };
}

function textRange(textRevisionId, textLayer, startByte, endByte) {
  return {
    textRevisionId,
    textLayer,
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function sourceLocator(overrides = {}) {
  return {
    sourceAssetId: SOURCE_ASSET_ID,
    sourceContentHash: RAW_HASH,
    sourceEncoding: 'utf-8',
    sourceByteRange: {
      offsetUnit: 'source-byte',
      startByte: 0,
      endByte: RAW_BYTE_LENGTH,
    },
    rawTextRange: textRange(RAW_REVISION_ID, 'raw', 0, RAW_BYTE_LENGTH),
    lineRange: {
      lineBase: 1,
      startLine: 1,
      endLineExclusive: 2,
    },
    ...overrides,
  };
}

function documentBlock(overrides = {}) {
  return {
    blockId: BLOCK_ID,
    kind: 'paragraph',
    rawText: RAW_TEXT,
    sourceLocator: sourceLocator(),
    contentHash: RAW_HASH,
    ...overrides,
  };
}

function importedNovel(overrides = {}) {
  return {
    documentType: 'imported-novel',
    schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
    sourceAssetId: SOURCE_ASSET_ID,
    sourceHash: RAW_HASH,
    sourceByteLength: RAW_BYTE_LENGTH,
    sourceFormat: 'txt',
    encodingDecision: {
      sourceContentHash: RAW_HASH,
      sourceEncoding: 'utf-8',
      method: 'strict-utf8',
    },
    adapterId: 'txt-source-adapter',
    adapterVersion: '1.0.0',
    processorId: 'novel-import',
    processorVersion: '1.0.0',
    alignmentPolicyVersion: BLOCK_ALIGNMENT_POLICY_VERSION,
    rawTextRevision: textRevision(
      RAW_REVISION_ID,
      'raw',
      RAW_BYTE_LENGTH,
      RAW_HASH,
    ),
    metadata: {},
    orderedBlocks: [documentBlock()],
    structuralHints: [],
    warnings: [],
    reviewStatus: 'not_required',
    ...overrides,
  };
}

function candidate(overrides = {}) {
  return {
    chapterCandidateId: CANDIDATE_ID,
    headingRange: textRange(CANONICAL_REVISION_ID, 'canonical', 0, 3),
    lineRange: { lineBase: 1, startLine: 1, endLineExclusive: 2 },
    rawTitle: '第一章',
    normalizedTitle: '第一章',
    ruleId: 'zh-chapter-heading',
    ruleVersion: '1',
    ruleConfidence: 1,
    confidenceSource: 'deterministic-rule',
    evidence: ['matched Chinese chapter heading rule'],
    contextBefore: [],
    contextAfter: ['正文'],
    reviewStatus: 'not_required',
    ...overrides,
  };
}

function entry(overrides = {}) {
  return {
    chapterId: CHAPTER_ID,
    order: 0,
    chapterNumber: '1',
    title: '第一章',
    rawHeading: '第一章',
    headingRange: textRange(CANONICAL_REVISION_ID, 'canonical', 0, 3),
    contentRange: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 20),
    sourceLineRange: { lineBase: 1, startLine: 1, endLineExclusive: 4 },
    confidence: 1,
    detectedBy: 'rule:zh-chapter-heading@1',
    reviewStatus: 'not_required',
    ...overrides,
  };
}

function chapterIndex(overrides = {}) {
  return {
    documentType: 'chapter-index',
    schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
    sourceAssetId: SOURCE_ASSET_ID,
    sourceHash: HASH_A,
    processorId: 'chapter-index',
    processorVersion: '1.0.0',
    textRevision: textRevision(CANONICAL_REVISION_ID, 'canonical', 20),
    candidates: [candidate()],
    entries: [entry()],
    coverageReport: {
      textRevisionId: CANONICAL_REVISION_ID,
      textLayer: 'canonical',
      totalByteLength: 20,
      classifiedByteLength: 20,
      unclassifiedByteLength: 0,
      complete: true,
      segments: [{
        classification: 'chapter',
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 0, 20),
        chapterId: CHAPTER_ID,
      }],
      unclassifiedRanges: [],
    },
    issues: [],
    reviewStatus: 'not_required',
    ...overrides,
  };
}

test('keeps the documented novel schema equal to the runtime schema', () => {
  assert.deepEqual(documentedNovelImportSchema, NOVEL_IMPORT_SCHEMA);
});

test('validates both documented aggregate variants with the shared text schema', () => {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(documentedTextSchema);
  const validate = ajv.compile(documentedNovelImportSchema);

  assert.equal(validate(importedNovel()), true);
  assert.equal(validate(chapterIndex()), true);
  assert.equal(validate({ ...importedNovel(), schemaVersion: 2 }), false);
  assert.equal(validate({ ...importedNovel(), documentType: 'chapter-index' }), false);
});

test('accepts minimal ImportedNovel and explicit aggregate extensions', () => {
  const value = importedNovel({ futureField: { retained: true } });
  assert.equal(parseImportedNovelV1(value, importedNovelValidationContext), value);
  assert.equal(
    parseNovelImportDocumentV1(value, importedNovelValidationContext),
    value,
  );
  assert.throws(
    () => parseNovelImportDocumentV1(value),
    NovelImportValidationError,
  );
});

test('hashes the raw revision from lazy ordered block parts without concatenation', () => {
  const aggregateText = 'ab';
  const aggregateHash = sha256Utf8(aggregateText);
  const singleTextCalls = [];
  let partsArgument;
  const validationContext = {
    sha256Utf8(text) {
      singleTextCalls.push(text);
      return sha256Utf8(text);
    },
    sha256Utf8Parts(parts) {
      partsArgument = parts;
      return sha256Utf8Parts(parts);
    },
  };
  const value = importedNovel({
    sourceHash: aggregateHash,
    sourceByteLength: 2,
    encodingDecision: {
      sourceContentHash: aggregateHash,
      sourceEncoding: 'utf-8',
      method: 'strict-utf8',
    },
    rawTextRevision: textRevision(RAW_REVISION_ID, 'raw', 2, aggregateHash),
    orderedBlocks: [
      documentBlock({
        rawText: 'a',
        contentHash: sha256Utf8('a'),
        sourceLocator: sourceLocator({
          sourceContentHash: aggregateHash,
          sourceByteRange: {
            offsetUnit: 'source-byte',
            startByte: 0,
            endByte: 1,
          },
          rawTextRange: textRange(RAW_REVISION_ID, 'raw', 0, 1),
        }),
      }),
      documentBlock({
        blockId: BLOCK_ID_2,
        rawText: 'b',
        contentHash: sha256Utf8('b'),
        sourceLocator: sourceLocator({
          sourceContentHash: aggregateHash,
          sourceByteRange: {
            offsetUnit: 'source-byte',
            startByte: 1,
            endByte: 2,
          },
          rawTextRange: textRange(RAW_REVISION_ID, 'raw', 1, 2),
        }),
      }),
    ],
  });

  assert.equal(parseImportedNovelV1(value, validationContext), value);
  assert.deepEqual(singleTextCalls, ['a', 'b']);
  assert.equal(Array.isArray(partsArgument), false);
  assert.equal(typeof partsArgument[Symbol.iterator], 'function');
});

test('binds every block to exact UTF-8 bytes, hashes, and full raw/source coverage', () => {
  const invalid = [
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          rawTextRange: textRange(RAW_REVISION_ID, 'raw', 0, 5),
        }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({ contentHash: HASH_A })],
    }),
    importedNovel({
      rawTextRevision: textRevision(
        RAW_REVISION_ID,
        'raw',
        RAW_BYTE_LENGTH,
        HASH_A,
      ),
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          sourceByteRange: {
            offsetUnit: 'source-byte',
            startByte: 0,
            endByte: 5,
          },
        }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          rawTextRange: textRange(RAW_REVISION_ID, 'raw', 1, 7),
        }),
      })],
    }),
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseImportedNovelV1(value, importedNovelValidationContext),
      NovelImportValidationError,
    );
  }

  assert.throws(
    () => parseImportedNovelV1(importedNovel(), {
      sha256Utf8: text => sha256Utf8(text).toUpperCase(),
      sha256Utf8Parts,
    }),
    NovelImportValidationError,
  );
});

test('freezes TXT exact-locator equality to encoding and source byte range', () => {
  const locator = sourceLocator();
  const sameProjection = sourceLocator({
    sourceAssetId: OTHER_SOURCE_ASSET_ID,
    sourceContentHash: HASH_B,
    rawTextRange: textRange(RAW_REVISION_ID, 'raw', 2, 4),
    lineRange: { lineBase: 1, startLine: 9, endLineExclusive: 10 },
  });
  const differentEncoding = sourceLocator({ sourceEncoding: 'gbk' });

  assert.equal(
    getTxtExactLocatorKeyV1(locator),
    getTxtExactLocatorKeyV1(sameProjection),
  );
  assert.notEqual(
    getTxtExactLocatorKeyV1(locator),
    getTxtExactLocatorKeyV1(differentEncoding),
  );
});

test('rejects unsupported encodings, unknown enums, and fixed-value extensions', () => {
  const invalid = [
    importedNovel({ sourceFormat: 'epub' }),
    importedNovel({ reviewStatus: 'complete' }),
    importedNovel({ orderedBlocks: [] }),
    importedNovel({ orderedBlocks: [documentBlock({ rawText: '' })] }),
    importedNovel({
      encodingDecision: {
        sourceContentHash: HASH_A,
        sourceEncoding: 'gb2312',
        method: 'user',
      },
    }),
    importedNovel({
      encodingDecision: {
        sourceContentHash: HASH_A,
        sourceEncoding: 'utf-8',
        method: 'user',
      },
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({ futureField: true }),
      })],
    }),
    importedNovel({
      warnings: [{
        issueId: ISSUE_ID,
        code: 'encoding_decode_failed',
        severity: 'error',
        reviewStatus: 'pending',
        message: 'decode failed',
        errorCode: 'NOVEL_IMPORT_UNKNOWN',
      }],
    }),
    importedNovel({
      warnings: [{
        issueId: ISSUE_ID,
        code: 'encoding_decode_failed',
        severity: 'error',
        reviewStatus: 'pending',
        message: 'decode failed',
        errorCode: 'NOVEL_IMPORT_INVALID_SOURCE',
      }],
    }),
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseImportedNovelV1(value, importedNovelValidationContext),
      NovelImportValidationError,
    );
  }
});

test('rejects stale encoding decisions and inconsistent locator provenance', () => {
  const invalid = [
    importedNovel({
      encodingDecision: {
        sourceContentHash: HASH_B,
        sourceEncoding: 'utf-8',
        method: 'strict-utf8',
      },
    }),
    importedNovel({
      rawTextRevision: textRevision(RAW_REVISION_ID, 'canonical', 12),
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({ sourceAssetId: OTHER_SOURCE_ASSET_ID }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({ sourceContentHash: HASH_B }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({ sourceEncoding: 'gbk' }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          sourceByteRange: {
            offsetUnit: 'source-byte',
            startByte: 0,
            endByte: 13,
          },
        }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          rawTextRange: textRange(RAW_REVISION_ID, 'raw', 0, 13),
        }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          sourceByteRange: {
            offsetUnit: 'source-byte',
            startByte: 8,
            endByte: 7,
          },
        }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          sourceByteRange: {
            offsetUnit: 'source-byte',
            startByte: 7,
            endByte: 7,
          },
        }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          rawTextRange: textRange(RAW_REVISION_ID, 'raw', 7, 7),
        }),
      })],
    }),
    importedNovel({
      orderedBlocks: [documentBlock({
        sourceLocator: sourceLocator({
          lineRange: { lineBase: 1, startLine: 2, endLineExclusive: 2 },
        }),
      })],
    }),
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseImportedNovelV1(value, importedNovelValidationContext),
      NovelImportValidationError,
    );
  }
});

test('rejects missing locators, duplicate IDs, and duplicate locator projections', () => {
  const withoutLocator = documentBlock();
  delete withoutLocator.sourceLocator;
  const secondDistinctBlock = documentBlock({
    blockId: BLOCK_ID_2,
    sourceLocator: sourceLocator({
      sourceByteRange: {
        offsetUnit: 'source-byte',
        startByte: 6,
        endByte: 12,
      },
      rawTextRange: textRange(RAW_REVISION_ID, 'raw', 6, 12),
      lineRange: { lineBase: 1, startLine: 2, endLineExclusive: 3 },
    }),
  });

  const invalid = [
    importedNovel({ orderedBlocks: [withoutLocator] }),
    importedNovel({ orderedBlocks: [documentBlock(), documentBlock()] }),
    importedNovel({
      orderedBlocks: [documentBlock(), documentBlock({ blockId: BLOCK_ID_2 })],
    }),
    importedNovel({
      orderedBlocks: [secondDistinctBlock, documentBlock({
        sourceLocator: sourceLocator({
          sourceByteRange: {
            offsetUnit: 'source-byte',
            startByte: 0,
            endByte: 6,
          },
          rawTextRange: textRange(RAW_REVISION_ID, 'raw', 0, 6),
        }),
      })],
    }),
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseImportedNovelV1(value, importedNovelValidationContext),
      NovelImportValidationError,
    );
  }
});

test('accepts ChapterIndex boundary confidence and empty canonical input', () => {
  const value = chapterIndex({
    candidates: [candidate({ ruleConfidence: 0 })],
    entries: [entry({ confidence: 0 })],
  });
  assert.equal(parseChapterIndexV1(value), value);
  assert.equal(parseNovelImportDocumentV1(value), value);

  const empty = chapterIndex({
    textRevision: textRevision(CANONICAL_REVISION_ID, 'canonical', 0),
    candidates: [],
    entries: [],
    coverageReport: {
      textRevisionId: CANONICAL_REVISION_ID,
      textLayer: 'canonical',
      totalByteLength: 0,
      classifiedByteLength: 0,
      unclassifiedByteLength: 0,
      complete: true,
      segments: [],
      unclassifiedRanges: [],
    },
  });
  assert.equal(parseChapterIndexV1(empty), empty);
});

test('rejects duplicate chapter identities and invalid chapter ranges', () => {
  const invalid = [
    chapterIndex({ candidates: [candidate(), candidate()] }),
    chapterIndex({ entries: [entry(), entry({ order: 1 })] }),
    chapterIndex({
      entries: [entry(), entry({ chapterId: BLOCK_ID_2 })],
    }),
    chapterIndex({
      entries: [entry({
        headingRange: textRange(CANONICAL_REVISION_ID, 'canonical', 0, 4),
        contentRange: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 20),
      })],
    }),
    chapterIndex({
      candidates: [candidate({ ruleVersion: undefined })],
    }),
    chapterIndex({
      candidates: [candidate({ evidence: [] })],
    }),
    chapterIndex({
      candidates: [candidate({ confidenceSource: undefined })],
    }),
    chapterIndex({
      textRevision: textRevision(CANONICAL_REVISION_ID, 'raw', 20),
    }),
  ];

  for (const value of invalid)
    assert.throws(() => parseChapterIndexV1(value), NovelImportValidationError);
});

test('requires complete, count-consistent, non-overlapping coverage', () => {
  const base = chapterIndex().coverageReport;
  const invalidReports = [
    { ...base, classifiedByteLength: 19 },
    { ...base, complete: false },
    {
      ...base,
      segments: [{
        classification: 'chapter',
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 1, 20),
        chapterId: CHAPTER_ID,
      }],
      classifiedByteLength: 19,
      unclassifiedByteLength: 1,
      unclassifiedRanges: [],
      complete: false,
    },
    {
      ...base,
      segments: [{
        classification: 'chapter',
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 0, 20),
        chapterId: OTHER_SOURCE_ASSET_ID,
      }],
    },
    {
      ...base,
      segments: [{
        classification: 'chapter',
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 0, 19),
        chapterId: CHAPTER_ID,
      }],
      classifiedByteLength: 19,
      unclassifiedByteLength: 1,
      unclassifiedRanges: [
        textRange(CANONICAL_REVISION_ID, 'canonical', 19, 20),
      ],
      complete: false,
    },
    {
      ...base,
      segments: [{
        classification: 'unclassified',
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 0, 20),
      }],
    },
    {
      ...base,
      segments: [{
        classification: 'pending_review',
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 0, 20),
      }],
    },
  ];

  for (const coverageReport of invalidReports) {
    assert.throws(
      () => parseChapterIndexV1(chapterIndex({ coverageReport })),
      NovelImportValidationError,
    );
  }
});

function sha256Utf8(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha256Utf8Parts(parts) {
  const hash = createHash('sha256');
  for (const part of parts)
    hash.update(part, 'utf8');
  return hash.digest('hex');
}
