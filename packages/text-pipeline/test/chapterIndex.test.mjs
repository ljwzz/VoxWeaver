import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  buildChapterIndexV1,
  canonicalizeRawTextV1,
  ChapterIndexBuildError,
  detectChapterCandidatesV1,
} from '../dist/index.js';

test('keeps a zero-chapter document fully classified as non-chapter', () => {
  const index = createIndex([
    ['普通正文。\n', 'paragraph'],
    ['---\n', 'separator'],
  ]);
  const chapterIndex = build(index);

  assert.equal(chapterIndex.entries.length, 0);
  assert.equal(chapterIndex.coverageReport.complete, true);
  assert.equal(chapterIndex.coverageReport.classifiedByteLength, index.canonicalTextRevision.byteLength);
  assert.equal(chapterIndex.coverageReport.unclassifiedByteLength, 0);
  assert.ok(chapterIndex.coverageReport.segments.every(segment =>
    segment.classification !== 'chapter'));
  assert.ok(chapterIndex.issues.some(issue => issue.code === 'no_chapters_detected'));
});

test('builds source-order entries and classifies front matter, volume, and appendix gaps', () => {
  const index = createIndex([
    ['版权信息\n', 'paragraph'],
    ['前言\n', 'heading'],
    ['引导文字。\n', 'paragraph'],
    ['第一卷 风起\n', 'heading'],
    ['第一章 起步\n', 'heading'],
    ['正文😀e\u0301。\n', 'paragraph'],
    ['附录：资料\n', 'heading'],
    ['资料正文。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);

  assert.deepEqual(chapterIndex.entries.map(entry => entry.rawHeading), ['前言', '第一章 起步']);
  assert.deepEqual(chapterIndex.entries.map(entry => entry.order), [0, 1]);
  assert.equal(chapterIndex.entries[0].volumeId, undefined);
  assert.equal(chapterIndex.entries[1].volumeNumber, '1');
  assert.equal(chapterIndex.entries[1].chapterNumber, '1');
  assert.deepEqual(
    chapterIndex.coverageReport.segments.map(segment => segment.classification),
    ['front_matter', 'chapter', 'unknown', 'chapter', 'appendix'],
  );
  assert.equal(
    chapterIndex.coverageReport.segments[2].range.startByte,
    index.blocks[3].canonicalRange.startByte,
  );
  assert.equal(
    chapterIndex.entries[0].contentRange.endByte,
    index.blocks[3].canonicalRange.startByte,
  );
  assert.equal(
    chapterIndex.entries[1].contentRange.endByte,
    index.blocks[6].canonicalRange.startByte,
  );
});

test('retains directory candidates as pending evidence and uses body source order', () => {
  const index = createIndex([
    ['目录\n', 'heading'],
    ['第一章 起点\n', 'heading'],
    ['---\n', 'separator'],
    ['第一章 起点\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);

  assert.deepEqual(chapterIndex.entries.map(entry => entry.headingRange.startByte), [
    index.blocks[3].canonicalRange.startByte,
  ]);
  assert.equal(chapterIndex.entries[0].rawHeading, '第一章 起点');
  assert.ok(chapterIndex.issues.some(issue =>
    issue.code === 'chapter_directory_candidate_conflict'));
  assert.equal(chapterIndex.coverageReport.segments[0].classification, 'unknown');
});

test('keeps volume-local resets and reports duplicate, missing, and decreasing numbers', () => {
  const index = createIndex([
    ['第一卷 上\n', 'heading'],
    ['第一章 一\n', 'heading'],
    ['甲。\n', 'paragraph'],
    ['第三章 三\n', 'heading'],
    ['乙。\n', 'paragraph'],
    ['第二章 二\n', 'heading'],
    ['丙。\n', 'paragraph'],
    ['第二章 重复\n', 'heading'],
    ['丁。\n', 'paragraph'],
    ['第二卷 下\n', 'heading'],
    ['第一章 重启\n', 'heading'],
    ['戊。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);

  assert.deepEqual(chapterIndex.entries.map(entry => entry.order), [0, 1, 2, 3, 4]);
  assert.deepEqual(chapterIndex.entries.map(entry => entry.chapterNumber), ['1', '3', '2', '2', '1']);
  assert.notEqual(chapterIndex.entries[0].volumeId, chapterIndex.entries[4].volumeId);
  assert.deepEqual(issueCodes(chapterIndex), [
    'missing_chapter_number',
    'chapter_number_out_of_order',
    'duplicate_chapter_number',
  ]);
});

test('does not carry an accepted volume across an unresolved volume boundary', () => {
  const index = createIndex([
    ['第一卷 上\n', 'heading'],
    ['第一章 一\n', 'heading'],
    ['甲。\n', 'paragraph'],
    ['第二卷 待确认\n', 'paragraph'],
    ['第一章 后续\n', 'heading'],
    ['乙。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);

  assert.equal(chapterIndex.entries[0].volumeNumber, '1');
  assert.equal(chapterIndex.entries[1].volumeId, undefined);
  assert.ok(chapterIndex.issues.some(issue =>
    issue.code === 'chapter_candidate_review_required'));
});

test('reports duplicate titles and exact repeated chapter bodies without deleting entries', () => {
  const index = createIndex([
    ['第一章 同名\n', 'heading'],
    ['重复正文。\n', 'paragraph'],
    ['第二章 同名\n', 'heading'],
    ['重复正文。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);

  assert.equal(chapterIndex.entries.length, 2);
  assert.ok(chapterIndex.issues.some(issue => issue.code === 'duplicate_chapter_title'));
  assert.ok(chapterIndex.issues.some(issue => issue.code === 'duplicate_chapter_content'));
});

test('keeps duplicate and overlapping candidates out of formal entries', () => {
  const index = createIndex([
    ['第一章 起点\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  const [candidate] = detect(index);
  const duplicate = { ...candidate, chapterCandidateId: uuid(1_999) };
  const chapterIndex = buildChapterIndexV1({
    blockIndex: index,
    candidates: [candidate, duplicate],
    options: factories(),
  });

  assert.equal(chapterIndex.entries.length, 0);
  assert.ok(chapterIndex.issues.some(issue => issue.code === 'duplicate_chapter_candidate'));

  const overlap = {
    ...candidate,
    chapterCandidateId: uuid(1_998),
    headingRange: { ...candidate.headingRange, endByte: candidate.headingRange.endByte - 1 },
  };
  const overlapped = buildChapterIndexV1({
    blockIndex: index,
    candidates: [candidate, overlap],
    options: factories(30_000),
  });
  assert.equal(overlapped.entries.length, 0);
  assert.ok(overlapped.issues.some(issue => issue.code === 'overlapping_chapter_candidates'));
});

test('rejects candidate revision errors, out-of-range offsets, and non-scalar byte cursors', () => {
  const index = createIndex([
    ['第一章 起点\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  const [candidate] = detect(index);
  const cases = [
    {
      reason: 'chapter_candidate_invalid',
      candidate: {
        ...candidate,
        headingRange: { ...candidate.headingRange, textRevisionId: uuid(99_999) },
      },
    },
    {
      reason: 'chapter_candidate_invalid',
      candidate: {
        ...candidate,
        headingRange: {
          ...candidate.headingRange,
          endByte: index.canonicalTextRevision.byteLength + 1,
        },
      },
    },
    {
      reason: 'chapter_candidate_utf8_boundary_invalid',
      candidate: {
        ...candidate,
        headingRange: { ...candidate.headingRange, startByte: 1 },
      },
    },
  ];
  for (const item of cases) {
    assert.throws(
      () => buildChapterIndexV1({
        blockIndex: index,
        candidates: [item.candidate],
        options: factories(40_000),
      }),
      error => isBuildError(error, item.reason),
    );
  }
});

test('binds accepted full-line candidate titles to their exact canonical block', () => {
  const index = createIndex([
    ['第一章 起点\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  const [candidate] = detect(index);
  assert.throws(
    () => buildChapterIndexV1({
      blockIndex: index,
      candidates: [{ ...candidate, rawTitle: '第二章 起点' }],
      options: factories(45_000),
    }),
    error => isBuildError(error, 'chapter_candidate_text_mismatch'),
  );
  assert.throws(
    () => buildChapterIndexV1({
      blockIndex: index,
      candidates: [{ ...candidate, normalizedTitle: '被篡改标题' }],
      options: factories(46_000),
    }),
    error => isBuildError(error, 'chapter_candidate_normalized_title_mismatch'),
  );
});

test('wraps an invalid canonical block index before candidate processing', () => {
  const index = createIndex([
    ['第一章 起点\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  assert.throws(
    () => buildChapterIndexV1({
      blockIndex: {
        ...index,
        canonicalTextRevision: {
          ...index.canonicalTextRevision,
          byteLength: index.canonicalTextRevision.byteLength + 1,
        },
      },
      candidates: [],
      options: factories(),
    }),
    error => isBuildError(error, 'chapter_index_block_index_invalid'),
  );
});

test('validates invalid, throwing, and duplicate opaque ID factories', () => {
  const index = createIndex([
    ['第一章 一\n', 'heading'],
    ['甲。\n', 'paragraph'],
    ['第二章 二\n', 'heading'],
    ['乙。\n', 'paragraph'],
  ]);
  const candidates = detect(index);
  assert.throws(
    () => buildChapterIndexV1({
      blockIndex: index,
      candidates,
      options: { ...factories(), chapterIdFactory: 'invalid' },
    }),
    error => isBuildError(error, 'chapter_id_factory_invalid'),
  );
  assert.throws(
    () => buildChapterIndexV1({
      blockIndex: index,
      candidates,
      options: {
        ...factories(),
        chapterIdFactory: () => {
          throw new Error('synthetic');
        },
      },
    }),
    error => isBuildError(error, 'chapter_id_factory_failed'),
  );
  assert.throws(
    () => buildChapterIndexV1({
      blockIndex: index,
      candidates,
      options: { ...factories(), chapterIdFactory: () => uuid(55_555) },
    }),
    error => isBuildError(error, 'chapter_id_duplicate'),
  );

  const volumeIndex = createIndex([
    ['第一卷 上\n', 'heading'],
    ['第一章 一\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  const volumeCandidates = detect(volumeIndex);
  assert.throws(
    () => buildChapterIndexV1({
      blockIndex: volumeIndex,
      candidates: volumeCandidates,
      options: {
        ...factories(),
        volumeIdFactory: () => {
          throw new Error('synthetic');
        },
      },
    }),
    error => isBuildError(error, 'volume_id_factory_failed'),
  );

  const noChapters = createIndex([['正文。\n', 'paragraph']]);
  assert.throws(
    () => buildChapterIndexV1({
      blockIndex: noChapters,
      candidates: [],
      options: {
        ...factories(),
        issueIdFactory: () => {
          throw new Error('synthetic');
        },
      },
    }),
    error => isBuildError(error, 'issue_id_factory_failed'),
  );
});

test('emits short or long issues only when an explicit caller policy is supplied', () => {
  const index = createIndex([
    ['第一章 一\n', 'heading'],
    ['短。\n', 'paragraph'],
  ]);
  const withoutPolicy = build(index);
  assert.ok(!issueCodes(withoutPolicy).some(code => code.includes('policy')));

  const withPolicy = build(index, {
    contentLengthPolicy: { minimumByteLength: 100 },
  });
  assert.ok(withPolicy.issues.some(issue =>
    issue.code === 'chapter_content_below_policy_minimum'));
  const maximumPolicy = build(index, {
    contentLengthPolicy: { maximumByteLength: 1 },
  });
  assert.ok(maximumPolicy.issues.some(issue =>
    issue.code === 'chapter_content_above_policy_maximum'));
  assert.throws(
    () => build(index, {
      contentLengthPolicy: { minimumByteLength: 5, maximumByteLength: 4 },
    }),
    error => isBuildError(error, 'chapter_content_length_policy_invalid'),
  );
  assert.throws(
    () => build(index, { contentLengthPolicy: 'invalid' }),
    error => isBuildError(error, 'chapter_content_length_policy_invalid'),
  );
});

test('builds the M1-03 synthetic fixture in source order without consuming volume markers', async () => {
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
  const index = syntheticIndex(importedNovel, canonical);
  const chapterIndex = build(index, {}, 70_000);

  assert.deepEqual(
    chapterIndex.entries.map(entry => entry.rawHeading),
    expected.chapterIndex.entries.map(entry => entry.rawHeading),
  );
  assert.equal(chapterIndex.coverageReport.complete, true);
  assert.deepEqual(
    chapterIndex.coverageReport.segments
      .filter(segment => segment.classification === 'unknown')
      .map(segment => [segment.range.startByte, segment.range.endByte]),
    [[30, 47], [178, 195]],
  );
});

function build(index, extraOptions = {}, start = 10_000) {
  return buildChapterIndexV1({
    blockIndex: index,
    candidates: detect(index, start),
    options: { ...factories(start + 1_000), ...extraOptions },
  });
}

function detect(index, start = 1_000) {
  return detectChapterCandidatesV1(index, {
    candidateIdFactory: sequentialIdFactory(start),
  });
}

function factories(start = 20_000) {
  return {
    chapterIdFactory: sequentialIdFactory(start),
    volumeIdFactory: sequentialIdFactory(start + 1_000),
    issueIdFactory: sequentialIdFactory(start + 2_000),
  };
}

function createIndex(blockSpecs) {
  const sourceAssetId = uuid(9_000);
  const rawRevisionId = uuid(9_001);
  const canonicalRevisionId = uuid(9_002);
  const text = blockSpecs.map(([value]) => value).join('');
  const hash = sha256(text);
  const byteLength = Buffer.byteLength(text, 'utf8');
  let byteCursor = 0;
  let lineCursor = 1;
  const blocks = blockSpecs.map(([canonicalText, kind], blockIndex) => {
    const startByte = byteCursor;
    byteCursor += Buffer.byteLength(canonicalText, 'utf8');
    const startLine = lineCursor;
    lineCursor += Math.max(1, [...canonicalText]
      .filter(character => character === '\n').length);
    return {
      blockId: uuid(9_100 + blockIndex),
      kind,
      canonicalText,
      canonicalRange: textRange(canonicalRevisionId, 'canonical', startByte, byteCursor),
      contentHash: sha256(canonicalText),
      sourceLocator: {
        sourceAssetId,
        sourceContentHash: hash,
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
    sourceContentHash: hash,
    sourceByteLength: byteLength,
    sourceEncoding: 'utf-8',
    rawTextRevision: revision(rawRevisionId, 'raw', text),
    canonicalTextRevision: revision(canonicalRevisionId, 'canonical', text),
    blocks,
    issues: [],
    reviewStatus: 'not_required',
  };
}

function syntheticIndex(importedNovel, canonical) {
  let cursor = 0;
  const blocks = importedNovel.orderedBlocks.map((block, position) => {
    let text = block.rawText;
    if (position === 0 && text.startsWith('\uFEFF'))
      text = text.slice(1);
    text = text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
    const startByte = cursor;
    cursor += Buffer.byteLength(text, 'utf8');
    return {
      blockId: block.blockId,
      kind: block.kind,
      canonicalText: text,
      canonicalRange: textRange(
        canonical.canonicalTextRevision.textRevisionId,
        'canonical',
        startByte,
        cursor,
      ),
      contentHash: sha256(text),
      sourceLocator: block.sourceLocator,
    };
  });
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

function issueCodes(index) {
  return index.issues.map(issue => issue.code);
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

function sha256(text) {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function isBuildError(error, detailReason) {
  return error instanceof ChapterIndexBuildError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
