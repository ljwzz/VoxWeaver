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
  parseSceneIndexV1,
} from '../dist/index.js';
import { parseProcessingSegmentIndexV1 } from '../dist/novelImport.js';

const SOURCE_ASSET_ID = '11111111-1111-4111-8111-111111111111';
const OTHER_SOURCE_ASSET_ID = '22222222-2222-4222-8222-222222222222';
const RAW_REVISION_ID = '33333333-3333-4333-8333-333333333333';
const CANONICAL_REVISION_ID = '44444444-4444-4444-8444-444444444444';
const BLOCK_ID = '55555555-5555-4555-8555-555555555555';
const BLOCK_ID_2 = '66666666-6666-4666-8666-666666666666';
const CANDIDATE_ID = '77777777-7777-4777-8777-777777777777';
const CHAPTER_ID = '88888888-8888-4888-8888-888888888888';
const ISSUE_ID = '99999999-9999-4999-8999-999999999999';
const SCENE_BOUNDARY_CANDIDATE_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const SCENE_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const SCENE_ID_2 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const PROCESSING_SEGMENT_ID = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const PROCESSING_SEGMENT_ID_2 = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
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

function sceneBoundaryCandidate(overrides = {}) {
  return {
    sceneBoundaryCandidateId: SCENE_BOUNDARY_CANDIDATE_ID,
    chapterId: CHAPTER_ID,
    blockId: BLOCK_ID,
    reasons: ['explicit_separator'],
    evidenceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 6),
    proposedBoundary: textRange(CANONICAL_REVISION_ID, 'canonical', 6, 6),
    appliedBoundary: textRange(CANONICAL_REVISION_ID, 'canonical', 6, 6),
    sourceLocator: sourceLocator(),
    ruleId: 'm2.scene-boundary.explicit-separator',
    ruleVersion: '1',
    evidence: ['full-block explicit separator'],
    reviewStatus: 'not_required',
    ...overrides,
  };
}

function sceneIndex(overrides = {}) {
  const boundary = sceneBoundaryCandidate();
  return {
    documentType: 'scene-index',
    schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
    sourceAssetId: SOURCE_ASSET_ID,
    sourceHash: RAW_HASH,
    processorId: 'scene-detector',
    processorVersion: '1.0.0',
    textRevision: textRevision(CANONICAL_REVISION_ID, 'canonical', 20),
    candidates: [boundary],
    scenes: [
      {
        sceneId: SCENE_ID,
        chapterId: CHAPTER_ID,
        order: 0,
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 6),
        blockReferences: [{
          blockId: BLOCK_ID,
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 6),
          sourceLocator: sourceLocator(),
        }],
      },
      {
        sceneId: SCENE_ID_2,
        chapterId: CHAPTER_ID,
        order: 1,
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 6, 20),
        startBoundaryCandidateId: boundary.sceneBoundaryCandidateId,
        blockReferences: [{
          blockId: BLOCK_ID,
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 6, 20),
          sourceLocator: sourceLocator(),
        }],
      },
    ],
    issues: [],
    reviewStatus: 'not_required',
    ...overrides,
  };
}

function twoChapterSceneIndex(overrides = {}) {
  return sceneIndex({
    candidates: [],
    scenes: [
      {
        sceneId: SCENE_ID,
        chapterId: CHAPTER_ID,
        order: 0,
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 10),
        blockReferences: [{
          blockId: BLOCK_ID,
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 10),
          sourceLocator: sourceLocator(),
        }],
      },
      {
        sceneId: SCENE_ID_2,
        chapterId: OTHER_SOURCE_ASSET_ID,
        order: 0,
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 10, 20),
        blockReferences: [{
          blockId: BLOCK_ID_2,
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 10, 20),
          sourceLocator: sourceLocator(),
        }],
      },
    ],
    issues: [],
    reviewStatus: 'not_required',
    ...overrides,
  });
}

function processingSegmentIndex(overrides = {}) {
  const firstText = '甲ab';
  const secondText = '乙cd';
  return {
    documentType: 'processing-segment-index',
    schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
    sourceAssetId: SOURCE_ASSET_ID,
    sourceHash: RAW_HASH,
    processorId: 'processing-segmenter',
    processorVersion: '1.0.0',
    textRevision: textRevision(CANONICAL_REVISION_ID, 'canonical', 20),
    configuration: {
      maxSegmentBytes: 5,
      contextBeforeBytes: 3,
      contextAfterBytes: 3,
      boundaryPolicyVersion: 'm2-processing-segment-boundary-v1',
    },
    segments: [
      {
        processingSegmentId: PROCESSING_SEGMENT_ID,
        chapterId: CHAPTER_ID,
        sceneId: SCENE_ID,
        order: 0,
        sourceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 8),
        text: firstText,
        contentHash: sha256Utf8(firstText),
        blockReferences: [{
          blockId: BLOCK_ID,
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 8),
          sourceLocator: sourceLocator(),
        }],
        contextAfter: {
          sourceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 8, 11),
          text: '丙',
          contentHash: sha256Utf8('丙'),
        },
      },
      {
        processingSegmentId: PROCESSING_SEGMENT_ID_2,
        chapterId: CHAPTER_ID,
        sceneId: SCENE_ID,
        order: 1,
        sourceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 8, 13),
        text: secondText,
        contentHash: sha256Utf8(secondText),
        blockReferences: [{
          blockId: BLOCK_ID,
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 8, 13),
          sourceLocator: sourceLocator(),
        }],
        contextBefore: {
          sourceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 5, 8),
          text: '丁',
          contentHash: sha256Utf8('丁'),
        },
      },
    ],
    ...overrides,
  };
}

test('keeps the documented novel schema equal to the runtime schema', () => {
  assert.deepEqual(documentedNovelImportSchema, NOVEL_IMPORT_SCHEMA);
});

test('validates all documented aggregate variants with the shared text schema', () => {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(documentedTextSchema);
  const validate = ajv.compile(documentedNovelImportSchema);

  assert.equal(validate(importedNovel()), true);
  assert.equal(validate(chapterIndex()), true);
  assert.equal(validate(sceneIndex()), true);
  assert.equal(validate(processingSegmentIndex()), true);
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

test('accepts one traceable Scene contract and dispatches the aggregate variant', () => {
  const value = sceneIndex({ futureField: { retained: true } });
  assert.equal(parseSceneIndexV1(value), value);
  assert.equal(parseNovelImportDocumentV1(value), value);

  const pending = sceneBoundaryCandidate({
    reasons: ['time_change'],
    proposedBoundary: textRange(CANONICAL_REVISION_ID, 'canonical', 5, 5),
    appliedBoundary: undefined,
    reviewStatus: 'pending',
  });
  const pendingValue = sceneIndex({
    candidates: [pending],
    scenes: [{
      sceneId: SCENE_ID,
      chapterId: CHAPTER_ID,
      order: 0,
      range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 20),
      blockReferences: [{
        blockId: BLOCK_ID,
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 20),
        sourceLocator: sourceLocator(),
      }],
    }],
    issues: [{
      issueId: ISSUE_ID,
      code: 'scene_boundary_review_required',
      severity: 'warning',
      reviewStatus: 'pending',
      message: 'Potential time change requires review',
      chapterId: CHAPTER_ID,
      blockId: BLOCK_ID,
      sceneBoundaryCandidateId: pending.sceneBoundaryCandidateId,
      textRange: pending.evidenceRange,
      sourceLocator: sourceLocator(),
    }],
    reviewStatus: 'pending',
  });
  assert.equal(parseSceneIndexV1(pendingValue), pendingValue);
});

test('rejects invalid Scene UUIDs, cursors, ranges, and source provenance', () => {
  const base = sceneIndex();
  const invalid = [
    sceneIndex({ scenes: [{ ...base.scenes[0], sceneId: 'scene-1' }, base.scenes[1]] }),
    sceneIndex({
      candidates: [sceneBoundaryCandidate({
        proposedBoundary: textRange(CANONICAL_REVISION_ID, 'canonical', 5, 6),
      })],
    }),
    sceneIndex({
      scenes: [{
        ...base.scenes[0],
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 3),
      }, base.scenes[1]],
    }),
    sceneIndex({
      scenes: [{
        ...base.scenes[0],
        blockReferences: [{
          ...base.scenes[0].blockReferences[0],
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 4, 6),
        }],
      }, base.scenes[1]],
    }),
    sceneIndex({
      candidates: [sceneBoundaryCandidate({
        sourceLocator: sourceLocator({ sourceAssetId: OTHER_SOURCE_ASSET_ID }),
      })],
    }),
  ];

  for (const value of invalid)
    assert.throws(() => parseSceneIndexV1(value), NovelImportValidationError);
});

test('requires applied boundaries to map one-to-one to non-first Scenes', () => {
  const base = sceneIndex();
  const invalid = [
    sceneIndex({ scenes: [base.scenes[0]] }),
    sceneIndex({
      scenes: [base.scenes[0], {
        ...base.scenes[1],
        startBoundaryCandidateId: undefined,
      }],
    }),
    sceneIndex({
      scenes: [base.scenes[0], {
        ...base.scenes[1],
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 7, 20),
        blockReferences: [{
          ...base.scenes[1].blockReferences[0],
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 7, 20),
        }],
      }],
    }),
  ];

  for (const value of invalid)
    assert.throws(() => parseSceneIndexV1(value), NovelImportValidationError);
});

test('requires exactly one review issue for each pending semantic boundary', () => {
  const pending = sceneBoundaryCandidate({
    reasons: ['dream_transition'],
    proposedBoundary: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 3),
    appliedBoundary: undefined,
    reviewStatus: 'pending',
  });
  const base = sceneIndex();
  assert.throws(
    () => parseSceneIndexV1(sceneIndex({
      candidates: [pending],
      scenes: [{
        ...base.scenes[0],
        range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 20),
        blockReferences: [{
          ...base.scenes[0].blockReferences[0],
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 3, 20),
        }],
      }],
      issues: [],
      reviewStatus: 'pending',
    })),
    NovelImportValidationError,
  );
});

test('binds candidate evidence and locators to a block in the same Chapter', () => {
  const crossChapterCandidate = sceneBoundaryCandidate({
    chapterId: CHAPTER_ID,
    blockId: BLOCK_ID_2,
    reasons: ['time_change'],
    evidenceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 10, 12),
    proposedBoundary: textRange(CANONICAL_REVISION_ID, 'canonical', 11, 11),
    appliedBoundary: undefined,
    reviewStatus: 'pending',
  });
  const invalidEvidence = sceneBoundaryCandidate({
    evidenceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 2, 6),
    proposedBoundary: textRange(CANONICAL_REVISION_ID, 'canonical', 5, 5),
  });
  const invalidLocator = sceneBoundaryCandidate({
    sourceLocator: sourceLocator({
      lineRange: { lineBase: 1, startLine: 9, endLineExclusive: 10 },
    }),
  });

  const invalid = [
    twoChapterSceneIndex({ candidates: [crossChapterCandidate] }),
    sceneIndex({ candidates: [invalidEvidence] }),
    sceneIndex({ candidates: [invalidLocator] }),
  ];
  for (const value of invalid)
    assert.throws(() => parseSceneIndexV1(value), NovelImportValidationError);
});

test('binds issue block references to the issue Chapter without a candidate', () => {
  const invalid = [
    twoChapterSceneIndex({
      issues: [{
        issueId: ISSUE_ID,
        code: 'scene_block_review_required',
        severity: 'warning',
        reviewStatus: 'pending',
        message: 'Synthetic issue',
        chapterId: CHAPTER_ID,
        blockId: BLOCK_ID_2,
      }],
      reviewStatus: 'pending',
    }),
    sceneIndex({
      issues: [{
        issueId: ISSUE_ID,
        code: 'scene_block_review_required',
        severity: 'warning',
        reviewStatus: 'pending',
        message: 'Synthetic issue',
        chapterId: CHAPTER_ID,
        blockId: BLOCK_ID,
        textRange: textRange(CANONICAL_REVISION_ID, 'canonical', 2, 3),
      }],
      reviewStatus: 'pending',
    }),
    sceneIndex({
      issues: [{
        issueId: ISSUE_ID,
        code: 'scene_block_review_required',
        severity: 'warning',
        reviewStatus: 'pending',
        message: 'Synthetic issue',
        chapterId: CHAPTER_ID,
        blockId: BLOCK_ID,
        sourceLocator: sourceLocator({
          lineRange: { lineBase: 1, startLine: 9, endLineExclusive: 10 },
        }),
      }],
      reviewStatus: 'pending',
    }),
  ];
  for (const value of invalid)
    assert.throws(() => parseSceneIndexV1(value), NovelImportValidationError);
});

test('accepts a byte-bounded ProcessingSegment aggregate and dispatches it', () => {
  const value = processingSegmentIndex({ futureField: { retained: true } });
  assert.equal(parseProcessingSegmentIndexV1(value), value);
  assert.equal(parseNovelImportDocumentV1(value), value);
});

test('rejects invalid ProcessingSegment IDs, ranges, text, limits, and trace', () => {
  const base = processingSegmentIndex();
  const first = base.segments[0];
  const second = base.segments[1];
  const invalid = [
    processingSegmentIndex({
      segments: [{ ...first, processingSegmentId: 'segment-1' }, second],
    }),
    processingSegmentIndex({
      segments: [first, { ...second, processingSegmentId: first.processingSegmentId }],
    }),
    processingSegmentIndex({
      segments: [first, {
        ...second,
        sourceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 9, 13),
      }],
    }),
    processingSegmentIndex({
      segments: [{ ...first, text: '字数不符' }, second],
    }),
    processingSegmentIndex({
      configuration: { ...base.configuration, maxSegmentBytes: 4 },
    }),
    processingSegmentIndex({
      segments: [{
        ...first,
        blockReferences: [{
          ...first.blockReferences[0],
          range: textRange(CANONICAL_REVISION_ID, 'canonical', 4, 8),
        }],
      }, second],
    }),
    processingSegmentIndex({
      segments: [{
        ...first,
        blockReferences: [{
          ...first.blockReferences[0],
          sourceLocator: sourceLocator({ sourceAssetId: OTHER_SOURCE_ASSET_ID }),
        }],
      }, second],
    }),
    processingSegmentIndex({
      segments: [{
        ...first,
        contextAfter: {
          ...first.contextAfter,
          sourceRange: textRange(CANONICAL_REVISION_ID, 'canonical', 9, 12),
        },
      }, second],
    }),
  ];

  for (const value of invalid) {
    assert.throws(
      () => parseProcessingSegmentIndexV1(value),
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
