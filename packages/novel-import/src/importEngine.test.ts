import type { ProjectSourceAsset } from './index.ts';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { test } from 'node:test';

import iconvLite from 'iconv-lite';
import {
  createNovelImportProcessorFingerprint,
  importSourceAsset,
  sha256Bytes,
} from './index.ts';

const SOURCE_ASSET_ID = '33333333-3333-4333-8333-333333333333';

test('import creates deterministic UTF-8 text, processor fingerprint, and chapter review data', () => {
  const text = '书名\r\n作者\u00A0甲\r\n\r\n　第一章　启程  \r\n内容甲😀\r\nChapter II - Return\n内容乙';
  const source = createAsset(Buffer.from(text, 'utf8'));

  const imported = importSourceAsset(source);
  const repeated = importSourceAsset(source);

  assert.equal(imported.artifactType, 'novel-import');
  assert.equal(imported.schemaVersion, 1);
  assert.equal(imported.sourceEncoding, 'utf-8');
  assert.equal(imported.encodingMethod, 'strict-utf8');
  assert.equal(imported.utf8Text.text, text);
  assert.deepEqual(Buffer.from(imported.utf8Text.bytes), Buffer.from(text, 'utf8'));
  assert.equal(imported.utf8Text.byteLength, Buffer.byteLength(text, 'utf8'));
  assert.equal(imported.utf8Text.sha256, sha256Bytes(Buffer.from(text, 'utf8')));
  assert.equal(imported.processorFingerprint, repeated.processorFingerprint);
  assert.deepEqual(imported.candidates, repeated.candidates);
  assert.deepEqual(imported.chapters, repeated.chapters);

  assert.equal(imported.candidates.length, 2);
  assert.deepEqual(
    imported.candidates.map(candidate => candidate.normalizedTitle),
    ['第一章 启程', 'Chapter II - Return'],
  );
  for (const candidate of imported.candidates) {
    const rawBytes = imported.utf8Text.bytes.subarray(
      candidate.headingRange.startByte,
      candidate.headingRange.endByte,
    );
    assert.equal(Buffer.from(rawBytes).toString('utf8'), candidate.rawTitle);
  }

  assert.equal(imported.chapters.length, 2);
  assert.equal(imported.chapters[0]?.order, 1);
  assert.equal(imported.chapters[1]?.order, 2);
  const firstContent = imported.chapters[0]!.contentRange;
  assert.equal(
    Buffer.from(imported.utf8Text.bytes.subarray(firstContent.startByte, firstContent.endByte)).toString('utf8'),
    '内容甲😀\r\n',
  );

  assert.equal(imported.coverage.complete, true);
  assert.equal(imported.coverage.classifiedByteLength, imported.utf8Text.byteLength);
  assert.equal(imported.coverage.unclassifiedByteLength, 0);
  assert.deepEqual(
    imported.coverage.segments.map(segment => segment.classification),
    ['front-matter', 'chapter', 'chapter'],
  );
  assert.deepEqual(imported.coverage.uncoveredRanges, []);

  assert.ok(imported.normalizationProposals.length >= 6);
  const nonBreakingSpace = imported.normalizationProposals.find(
    proposal => proposal.beforeText === '\u00A0',
  );
  assert.equal(nonBreakingSpace?.afterText, ' ');
  for (const proposal of imported.normalizationProposals) {
    assert.equal(
      Buffer.from(imported.utf8Text.bytes.subarray(
        proposal.range.startByte,
        proposal.range.endByte,
      )).toString('utf8'),
      proposal.beforeText,
    );
  }
});

test('documents without chapter headings remain explicitly uncovered', () => {
  const text = '只有正文\n没有可确认的章节标题';
  const imported = importSourceAsset(createAsset(Buffer.from(text, 'utf8')));

  assert.deepEqual(imported.candidates, []);
  assert.deepEqual(imported.chapters, []);
  assert.equal(imported.coverage.complete, false);
  assert.equal(imported.coverage.classifiedByteLength, 0);
  assert.equal(imported.coverage.unclassifiedByteLength, imported.utf8Text.byteLength);
  assert.deepEqual(imported.coverage.segments, [{
    classification: 'unknown',
    range: {
      offsetUnit: 'utf8-byte',
      startByte: 0,
      endByte: imported.utf8Text.byteLength,
    },
  }]);
  assert.deepEqual(imported.coverage.uncoveredRanges, [
    {
      offsetUnit: 'utf8-byte',
      startByte: 0,
      endByte: imported.utf8Text.byteLength,
    },
  ]);
});

test('legacy import persists decoded content as canonical UTF-8 bytes', () => {
  const text = '第一章 开始\n正文内容';
  const source = createAsset(iconvLite.encode(text, 'gbk'));
  const imported = importSourceAsset(source, {
    sourceEncoding: 'gbk',
    sourceHash: source.source.sha256,
  });

  assert.equal(imported.sourceEncoding, 'gbk');
  assert.equal(imported.encodingMethod, 'user');
  assert.equal(imported.utf8Text.text, text);
  assert.deepEqual(Buffer.from(imported.utf8Text.bytes), Buffer.from(text, 'utf8'));
  assert.notDeepEqual(Buffer.from(imported.utf8Text.bytes), Buffer.from(source.bytes));
});

test('processor fingerprint is stable and includes source hash and selected encoding', () => {
  const first = createNovelImportProcessorFingerprint('1'.repeat(64), 'utf-8');
  const repeated = createNovelImportProcessorFingerprint('1'.repeat(64), 'utf-8');
  const differentHash = createNovelImportProcessorFingerprint('2'.repeat(64), 'utf-8');
  const differentEncoding = createNovelImportProcessorFingerprint('1'.repeat(64), 'gbk');

  assert.match(first, /^[0-9a-f]{64}$/u);
  assert.equal(first, repeated);
  assert.notEqual(first, differentHash);
  assert.notEqual(first, differentEncoding);
});

function createAsset(bytes: Uint8Array): ProjectSourceAsset {
  const copiedBytes = Uint8Array.from(bytes);
  return {
    source: {
      sourceAssetId: SOURCE_ASSET_ID,
      originalName: 'novel.txt',
      byteLength: copiedBytes.byteLength,
      sha256: sha256Bytes(copiedBytes),
    },
    bytes: copiedBytes,
  };
}
