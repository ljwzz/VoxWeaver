import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  canonicalizeRawTextV1,
  CHAPTER_CONFIDENCE_FORMULA_VERSION,
  ChapterCandidateDetectionError,
  detectChapterCandidatesV1,
  parseChapterHeadingV1,
} from '../dist/index.js';

test('parses every approved numbered, special, and English full-line grammar', () => {
  const numberedCases = [
    ['第0章', 'chapter', '0', '第0章'],
    ['第十一回：归来', 'hui', '11', '归来'],
    ['第１２节—小节', 'section', '12', '小节'],
    ['第二卷 新途', 'volume', '2', '新途'],
    ['第三章　全角空格', 'chapter', '3', '全角空格'],
    ['第一亿零三万零五章：大数', 'chapter', '100030005', '大数'],
    ['cHaPtEr 0007: Arrival', 'english-chapter', '7', 'Arrival'],
    ['Chapter　8. Return', 'english-chapter', '8', 'Return'],
  ];
  for (const [raw, kind, number, normalizedTitle] of numberedCases) {
    const parsed = parseChapterHeadingV1(`  ${raw}\n`);
    assert.equal(parsed.kind, kind, raw);
    assert.equal(parsed.ordinal.normalizedDecimal, number, raw);
    assert.equal(parsed.normalizedTitle, normalizedTitle, raw);
  }

  for (const special of ['序章', '楔子', '前言', '引子', '终章', '尾声', '番外', '后记']) {
    const parsed = parseChapterHeadingV1(special);
    assert.equal(parsed.kind, 'special');
    assert.equal(parsed.normalizedTitle, special);
    assert.equal(parsed.specialName, special);
  }
  assert.equal(parseChapterHeadingV1('番外：雪夜').normalizedTitle, '番外：雪夜');
});

test('requires a full-line suffix separator and rejects malformed headings', () => {
  for (const raw of [
    '正文说第九章并非标题',
    '第九章并非标题',
    '第1章标题',
    '第1.5章 标题',
    'Chapter 1Arrival',
    '第九章\n正文',
  ]) {
    assert.equal(parseChapterHeadingV1(raw), null, raw);
  }
});

test('emits volume and chapter candidates in source order without renumbering', () => {
  const index = createIndex([
    ['第一卷 风起\n', 'heading'],
    ['第一章 起步\n', 'heading'],
    ['第三章 缺号保留\n', 'heading'],
    ['第三章 重复编号\n', 'heading'],
    ['第二卷 新途\n', 'heading'],
    ['第一章 重启\n', 'heading'],
  ]);
  const candidates = detectChapterCandidatesV1(index, {
    candidateIdFactory: sequentialIdFactory(1_000),
  });

  assert.deepEqual(
    candidates.map(candidate => candidate.rawTitle),
    [
      '第一卷 风起',
      '第一章 起步',
      '第三章 缺号保留',
      '第三章 重复编号',
      '第二卷 新途',
      '第一章 重启',
    ],
  );
  assert.deepEqual(
    candidates.map(candidate => candidate.headingRange.startByte),
    [...candidates]
      .map(candidate => candidate.headingRange.startByte)
      .sort((left, right) => left - right),
  );
  assert.equal(candidates.filter(isVolumeCandidate).length, 2);
  assert.ok(candidates.filter(isVolumeCandidate).every(candidate =>
    candidate.evidence.includes('structural-role:volume-marker')));
  assert.deepEqual(
    candidates
      .filter(candidate => !isVolumeCandidate(candidate))
      .map(candidate => candidate.evidence.find(item => item.startsWith('ordinal:'))),
    ['ordinal:1', 'ordinal:3', 'ordinal:3', 'ordinal:1'],
  );
});

test('marks directory entries and structurally weak full-line matches pending', () => {
  const index = createIndex([
    ['目录\n', 'heading'],
    ['第一章 起点\n', 'heading'],
    ['---\n', 'separator'],
    ['第一章 起点\n', 'heading'],
    ['第二章：弱结构\n', 'paragraph'],
  ]);
  const candidates = detectChapterCandidatesV1(index, {
    candidateIdFactory: sequentialIdFactory(1_100),
  });

  assert.equal(candidates.length, 3);
  assert.equal(candidates[0].reviewStatus, 'pending');
  assert.ok(candidates[0].evidence.includes(
    'directory-context:after-marker-before-explicit-boundary',
  ));
  assert.equal(candidates[0].ruleConfidence, 0.5);
  assert.equal(candidates[1].reviewStatus, 'not_required');
  assert.equal(candidates[1].ruleConfidence, 1);
  assert.equal(candidates[2].reviewStatus, 'pending');
  assert.equal(candidates[2].ruleConfidence, 0.8);
  assert.ok(candidates.every(candidate =>
    candidate.confidenceSource.startsWith(CHAPTER_CONFIDENCE_FORMULA_VERSION)));
});

test('uses exact canonical UTF-8 byte ranges for inline prose rejections', () => {
  const before = '前😀e\u0301\n';
  const inlineText = '正文😀e\u0301说：“第九章并非标题。”😀\n';
  const index = createIndex([
    [before, 'paragraph'],
    [inlineText, 'paragraph'],
    ['正文提及 Chapter １２ is quoted.\n', 'paragraph'],
    ['第三章 收束\n', 'heading'],
  ]);
  const candidates = detectChapterCandidatesV1(index, {
    candidateIdFactory: sequentialIdFactory(1_200),
  });
  const rejected = candidates.filter(candidate => candidate.reviewStatus === 'rejected');
  assert.deepEqual(rejected.map(candidate => candidate.rawTitle), ['第九章', 'Chapter １２']);

  const chinese = rejected[0];
  const blockStart = Buffer.byteLength(before, 'utf8');
  const expectedStart = blockStart + Buffer.byteLength('正文😀e\u0301说：“', 'utf8');
  assert.deepEqual(
    [chinese.headingRange.startByte, chinese.headingRange.endByte],
    [expectedStart, expectedStart + Buffer.byteLength('第九章', 'utf8')],
  );
  assert.deepEqual(chinese.contextBefore, ['前😀e\u0301']);
  assert.deepEqual(chinese.contextAfter, ['正文提及 Chapter １２ is quoted.', '第三章 收束']);
  assert.equal(chinese.ruleConfidence, 0.15);
  assert.ok(chinese.evidence.includes('match-scope:inline-only'));
});

test('keeps context bounded to the nearest two non-empty blocks', () => {
  const index = createIndex([
    ['甲\n', 'paragraph'],
    ['乙\n', 'paragraph'],
    ['   \n', 'unknown'],
    ['第一章 中\n', 'heading'],
    ['\n', 'unknown'],
    ['丙😀\n', 'paragraph'],
    ['丁e\u0301\n', 'paragraph'],
    ['戊\n', 'paragraph'],
  ]);
  const [candidate] = detectChapterCandidatesV1(index, {
    candidateIdFactory: sequentialIdFactory(1_300),
  });
  assert.deepEqual(candidate.contextBefore, ['甲', '乙']);
  assert.deepEqual(candidate.contextAfter, ['丙😀', '丁e\u0301']);
});

test('rejects invalid indexes and invalid, throwing, or duplicate ID factories', () => {
  const index = createIndex([
    ['第一章 甲\n', 'heading'],
    ['第二章 乙\n', 'heading'],
  ]);
  const invalidIndex = {
    ...index,
    canonicalTextRevision: {
      ...index.canonicalTextRevision,
      byteLength: index.canonicalTextRevision.byteLength + 1,
    },
  };
  assert.throws(
    () => detectChapterCandidatesV1(invalidIndex),
    error => isDetectionError(error, 'chapter_candidate_index_invalid'),
  );
  assert.throws(
    () => detectChapterCandidatesV1(index, { candidateIdFactory: 'invalid' }),
    error => isDetectionError(error, 'chapter_candidate_id_factory_invalid'),
  );
  assert.throws(
    () => detectChapterCandidatesV1(index, {
      candidateIdFactory: () => {
        throw new Error('synthetic failure');
      },
    }),
    error => isDetectionError(error, 'chapter_candidate_id_factory_failed'),
  );
  assert.throws(
    () => detectChapterCandidatesV1(index, {
      candidateIdFactory: () => 'not-a-uuid',
    }),
    error => isDetectionError(error, 'chapter_candidate_id_invalid'),
  );
  assert.throws(
    () => detectChapterCandidatesV1(index, {
      candidateIdFactory: () => uuid(1_400),
    }),
    error => isDetectionError(error, 'chapter_candidate_id_duplicate'),
  );
});

test('matches the M1-03 synthetic accepted titles and preserves its rejection evidence', async () => {
  const expected = JSON.parse(await readFile(new URL(
    '../../novel-import/test/fixtures/expected/synthetic-comprehensive-bom-crlf.json',
    import.meta.url,
  ), 'utf8'));
  const importedNovel = expected.importedNovel;
  const canonical = canonicalizeRawTextV1({
    rawTextRevision: importedNovel.rawTextRevision,
    rawTextParts: importedNovel.orderedBlocks.map(block => block.rawText),
    canonicalTextRevisionId: expected.chapterIndex.textRevision.textRevisionId,
  });
  const index = createSyntheticFixtureIndex(importedNovel, canonical);
  const candidates = detectChapterCandidatesV1(index, {
    candidateIdFactory: sequentialIdFactory(1_500),
  });

  const expectedAccepted = expected.chapterIndex.candidates
    .filter(candidate => candidate.reviewStatus !== 'rejected')
    .map(candidate => candidate.rawTitle);
  const actualAccepted = candidates
    .filter(candidate => candidate.reviewStatus !== 'rejected')
    .filter(candidate => !isVolumeCandidate(candidate))
    .map(candidate => candidate.rawTitle);
  assert.deepEqual(actualAccepted, expectedAccepted);
  assert.deepEqual(
    candidates.filter(isVolumeCandidate).map(candidate => candidate.rawTitle),
    ['第一卷 风起', '第二卷 新途'],
  );

  const inline = candidates.find(candidate => candidate.rawTitle === '第九章');
  const expectedInline = expected.chapterIndex.candidates
    .find(candidate => candidate.reviewStatus === 'rejected');
  assert.equal(inline.reviewStatus, 'rejected');
  assert.deepEqual(inline.headingRange, expectedInline.headingRange);
});

function createIndex(blockSpecs) {
  const sourceAssetId = uuid(9_000);
  const rawRevisionId = uuid(9_001);
  const canonicalRevisionId = uuid(9_002);
  const completeText = blockSpecs.map(([text]) => text).join('');
  const completeHash = sha256(completeText);
  const byteLength = Buffer.byteLength(completeText, 'utf8');
  let byteCursor = 0;
  let lineCursor = 1;
  const blocks = blockSpecs.map(([canonicalText, kind], blockIndex) => {
    const blockByteLength = Buffer.byteLength(canonicalText, 'utf8');
    const startByte = byteCursor;
    byteCursor += blockByteLength;
    const startLine = lineCursor;
    const lineCount = Math.max(1, [...canonicalText].filter(character => character === '\n').length);
    lineCursor += lineCount;
    return {
      blockId: uuid(9_100 + blockIndex),
      kind,
      canonicalText,
      canonicalRange: {
        textRevisionId: canonicalRevisionId,
        textLayer: 'canonical',
        offsetUnit: 'utf8-byte',
        startByte,
        endByte: byteCursor,
      },
      contentHash: sha256(canonicalText),
      sourceLocator: {
        sourceAssetId,
        sourceContentHash: completeHash,
        sourceEncoding: 'utf-8',
        sourceByteRange: {
          offsetUnit: 'source-byte',
          startByte,
          endByte: byteCursor,
        },
        rawTextRange: {
          textRevisionId: rawRevisionId,
          textLayer: 'raw',
          offsetUnit: 'utf8-byte',
          startByte,
          endByte: byteCursor,
        },
        lineRange: {
          lineBase: 1,
          startLine,
          endLineExclusive: lineCursor,
        },
      },
    };
  });
  return {
    documentType: 'document-block-index',
    schemaVersion: 1,
    alignmentPolicyVersion: 'm1-block-alignment-v1',
    sourceAssetId,
    sourceContentHash: completeHash,
    sourceByteLength: byteLength,
    sourceEncoding: 'utf-8',
    rawTextRevision: {
      textRevisionId: rawRevisionId,
      textLayer: 'raw',
      contentHash: completeHash,
      byteLength,
    },
    canonicalTextRevision: {
      textRevisionId: canonicalRevisionId,
      textLayer: 'canonical',
      contentHash: completeHash,
      byteLength,
    },
    blocks,
    issues: [],
    reviewStatus: 'not_required',
  };
}

function createSyntheticFixtureIndex(importedNovel, canonical) {
  let canonicalCursor = 0;
  const blocks = importedNovel.orderedBlocks.map((block, blockIndex) => {
    let canonicalText = block.rawText;
    if (blockIndex === 0 && canonicalText.startsWith('\uFEFF'))
      canonicalText = canonicalText.slice(1);
    canonicalText = canonicalText.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const startByte = canonicalCursor;
    canonicalCursor += Buffer.byteLength(canonicalText, 'utf8');
    return {
      blockId: block.blockId,
      kind: block.kind,
      canonicalText,
      canonicalRange: {
        textRevisionId: canonical.canonicalTextRevision.textRevisionId,
        textLayer: 'canonical',
        offsetUnit: 'utf8-byte',
        startByte,
        endByte: canonicalCursor,
      },
      contentHash: sha256(canonicalText),
      sourceLocator: block.sourceLocator,
    };
  });
  assert.equal(blocks.map(block => block.canonicalText).join(''), canonical.canonicalText);
  return {
    documentType: 'document-block-index',
    schemaVersion: 1,
    alignmentPolicyVersion: importedNovel.alignmentPolicyVersion,
    sourceAssetId: importedNovel.sourceAssetId,
    sourceContentHash: importedNovel.sourceHash,
    sourceByteLength: importedNovel.sourceByteLength,
    sourceEncoding: importedNovel.encodingDecision.sourceEncoding,
    rawTextRevision: importedNovel.rawTextRevision,
    canonicalTextRevision: canonical.canonicalTextRevision,
    blocks,
    issues: [],
    reviewStatus: 'not_required',
  };
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

function isVolumeCandidate(candidate) {
  return candidate.ruleId === 'm1.chapter-heading.numbered.volume';
}

function isDetectionError(error, detailReason) {
  return error instanceof ChapterCandidateDetectionError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
