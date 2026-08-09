import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import {
  buildChapterIndexV1,
  ChapterSlicingError,
  detectChapterCandidatesV1,
  restoreCanonicalTextFromCoverageV1,
  sliceChapterCoverageV1,
  sliceChapterIndexV1,
} from '../dist/index.js';

test('slices exact UTF-8 heading/content bytes and restores all coverage losslessly', () => {
  const text = '前言\n😀e\u0301。\n第一章 起步\n中文。\n尾声\n完成。\n';
  const index = createIndex([
    ['前言\n', 'heading'],
    ['😀e\u0301。\n', 'paragraph'],
    ['第一章 起步\n', 'heading'],
    ['中文。\n', 'paragraph'],
    ['尾声\n', 'heading'],
    ['完成。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);
  const input = { chapterIndex, canonicalText: text };

  const slices = sliceChapterIndexV1(input);
  assert.deepEqual(slices.map(slice => slice.headingText), ['前言\n', '第一章 起步\n', '尾声\n']);
  assert.deepEqual(slices.map(slice => slice.contentText), ['😀e\u0301。\n', '中文。\n', '完成。\n']);
  assert.deepEqual(slices.map(slice => slice.completeText), [
    '前言\n😀e\u0301。\n',
    '第一章 起步\n中文。\n',
    '尾声\n完成。\n',
  ]);

  const coverage = sliceChapterCoverageV1(input);
  assert.equal(coverage.map(slice => slice.text).join(''), text);
  assert.equal(restoreCanonicalTextFromCoverageV1(input), text);
});

test('restores classified front matter, unknown volume, chapter, and appendix slices', () => {
  const specs = [
    ['版权\n', 'paragraph'],
    ['第一卷 上\n', 'heading'],
    ['第一章 一\n', 'heading'],
    ['正文。\n', 'paragraph'],
    ['附录：表\n', 'heading'],
    ['表格。\n', 'paragraph'],
  ];
  const index = createIndex(specs);
  const canonicalText = specs.map(([text]) => text).join('');
  const chapterIndex = build(index);
  const coverage = sliceChapterCoverageV1({ chapterIndex, canonicalText });

  assert.deepEqual(
    coverage.map(slice => slice.classification),
    ['front_matter', 'unknown', 'chapter', 'appendix'],
  );
  assert.equal(coverage.map(slice => slice.text).join(''), canonicalText);
});

test('rejects canonical text length and hash mismatches with typed errors', () => {
  const index = createIndex([
    ['第一章 一\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);
  const canonicalText = index.blocks.map(block => block.canonicalText).join('');

  assert.throws(
    () => sliceChapterIndexV1({ chapterIndex, canonicalText: `${canonicalText}x` }),
    error => isSlicingError(error, 'canonical_text_length_mismatch'),
  );
  assert.throws(
    () => sliceChapterIndexV1({
      chapterIndex,
      canonicalText: canonicalText.replace('正文', '正丈'),
    }),
    error => isSlicingError(error, 'canonical_text_hash_mismatch'),
  );
});

test('rejects a byte cursor inside a multi-byte scalar instead of using JS indexes', () => {
  const index = createIndex([
    ['第一章 一\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);
  const canonicalText = index.blocks.map(block => block.canonicalText).join('');
  const entry = chapterIndex.entries[0];
  const invalidEntry = {
    ...entry,
    headingRange: { ...entry.headingRange, endByte: 1 },
    contentRange: { ...entry.contentRange, startByte: 1 },
  };
  const invalidCandidate = {
    ...chapterIndex.candidates[0],
    headingRange: invalidEntry.headingRange,
  };
  const invalidIndex = {
    ...chapterIndex,
    candidates: [invalidCandidate, ...chapterIndex.candidates.slice(1)],
    entries: [invalidEntry],
  };

  assert.throws(
    () => sliceChapterIndexV1({ chapterIndex: invalidIndex, canonicalText }),
    error => isSlicingError(error, 'chapter_slice_utf8_boundary_invalid'),
  );
});

test('wraps invalid ChapterIndex input before reading slices', () => {
  const index = createIndex([
    ['第一章 一\n', 'heading'],
    ['正文。\n', 'paragraph'],
  ]);
  const chapterIndex = build(index);
  const canonicalText = index.blocks.map(block => block.canonicalText).join('');
  assert.throws(
    () => sliceChapterIndexV1({
      chapterIndex: { ...chapterIndex, textRevision: { ...chapterIndex.textRevision, textLayer: 'raw' } },
      canonicalText,
    }),
    error => isSlicingError(error, 'chapter_slice_index_invalid'),
  );
});

function build(index) {
  return buildChapterIndexV1({
    blockIndex: index,
    candidates: detectChapterCandidatesV1(index, {
      candidateIdFactory: sequentialIdFactory(1_000),
    }),
    options: {
      chapterIdFactory: sequentialIdFactory(2_000),
      volumeIdFactory: sequentialIdFactory(3_000),
      issueIdFactory: sequentialIdFactory(4_000),
    },
  });
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
  const blocks = blockSpecs.map(([canonicalText, kind], position) => {
    const startByte = byteCursor;
    byteCursor += Buffer.byteLength(canonicalText, 'utf8');
    const startLine = lineCursor;
    lineCursor += Math.max(1, [...canonicalText]
      .filter(character => character === '\n').length);
    return {
      blockId: uuid(9_100 + position),
      kind,
      canonicalText,
      canonicalRange: range(canonicalRevisionId, 'canonical', startByte, byteCursor),
      contentHash: sha256(canonicalText),
      sourceLocator: {
        sourceAssetId,
        sourceContentHash: hash,
        sourceEncoding: 'utf-8',
        sourceByteRange: { offsetUnit: 'source-byte', startByte, endByte: byteCursor },
        rawTextRange: range(rawRevisionId, 'raw', startByte, byteCursor),
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

function revision(textRevisionId, textLayer, text) {
  return {
    textRevisionId,
    textLayer,
    contentHash: sha256(text),
    byteLength: Buffer.byteLength(text, 'utf8'),
  };
}

function range(textRevisionId, textLayer, startByte, endByte) {
  return { textRevisionId, textLayer, offsetUnit: 'utf8-byte', startByte, endByte };
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

function isSlicingError(error, detailReason) {
  return error instanceof ChapterSlicingError
    && error.code === 'NOVEL_IMPORT_STRUCTURE_INVALID'
    && error.detailReason === detailReason;
}
