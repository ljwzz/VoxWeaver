import type { SourceAssetProbeDto } from '@voxweaver/contracts';

import type { ProjectSourceAsset } from './index.ts';
import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';

import { test } from 'node:test';

import iconvLite from 'iconv-lite';
import {
  decodeSourceAsset,
  NovelImportError,
  probeSourceAsset,
  sha256Bytes,
  USER_SELECTED_TXT_SOURCE_ENCODINGS,
} from './index.ts';

const SOURCE_ASSET_ID = '11111111-1111-4111-8111-111111111111';

test('probe confirms strict UTF-8 and prioritizes it over manual encodings', () => {
  const source = createAsset(Buffer.from('第一章 开始\n正文😀', 'utf8'));
  const probe = probeSourceAsset(source);

  assert.deepEqual(probe.encoding, {
    status: 'confirmed',
    encoding: 'utf-8',
    method: 'strict-utf8',
    sourceHash: source.source.sha256,
  });
  assert.throws(
    () => decodeSourceAsset(source, {
      sourceEncoding: 'gb18030',
      sourceHash: source.source.sha256,
    }),
    hasReason('encoding_selection_not_allowed'),
  );
});

test('probe and decode support UTF-8, UTF-16LE, and UTF-16BE BOMs', () => {
  const text = '第一章 开始\n正文😀';
  const cases = [
    {
      encoding: 'utf-8' as const,
      bytes: Buffer.concat([Buffer.from([0xEF, 0xBB, 0xBF]), Buffer.from(text, 'utf8')]),
    },
    {
      encoding: 'utf-16le' as const,
      bytes: Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from(text, 'utf16le')]),
    },
    {
      encoding: 'utf-16be' as const,
      bytes: Buffer.concat([Buffer.from([0xFE, 0xFF]), encodeUtf16Be(text)]),
    },
  ];

  for (const item of cases) {
    const source = createAsset(item.bytes);
    const probe = probeSourceAsset(source);
    assert.equal(probe.encoding.status, 'confirmed');
    if (probe.encoding.status !== 'confirmed')
      assert.fail('expected confirmed BOM probe');
    assert.equal(probe.encoding.encoding, item.encoding);
    assert.equal(probe.encoding.method, 'bom');

    const decoded = decodeSourceAsset(source);
    assert.equal(decoded.encoding, item.encoding);
    assert.equal(decoded.encodingMethod, 'bom');
    assert.equal(decoded.text, text);
    assert.deepEqual(Buffer.from(decoded.textBytes), Buffer.from(text, 'utf8'));
  }
});

test('probe rejects UTF-32, empty input, BOM-only input, NUL, and broken BOM payloads', () => {
  const cases = [
    { bytes: Buffer.alloc(0), reason: 'empty' },
    { bytes: Buffer.from([0xEF, 0xBB, 0xBF]), reason: 'empty' },
    { bytes: Buffer.from([0x00, 0x00, 0xFE, 0xFF, 0x00]), reason: 'utf-32' },
    { bytes: Buffer.from([0xFF, 0xFE, 0x00, 0x00, 0x61]), reason: 'utf-32' },
    { bytes: Buffer.from('a\0b', 'utf8'), reason: 'binary-nul' },
    { bytes: Buffer.from([0xFF, 0xFE, 0x61]), reason: 'decode-failed' },
  ];

  for (const item of cases) {
    const probe = probeSourceAsset(createAsset(item.bytes));
    assert.equal(probe.encoding.status, 'rejected');
    if (probe.encoding.status !== 'rejected')
      assert.fail('expected rejected probe');
    assert.equal(probe.encoding.reason, item.reason);
  }
});

test('non-UTF-8 input requires a hash-bound manual encoding selection', () => {
  const bytes = iconvLite.encode('第一章 开始\n正文', 'gbk');
  const source = createAsset(bytes);
  const probe = probeSourceAsset(source);

  assert.equal(probe.encoding.status, 'selection-required');
  if (probe.encoding.status !== 'selection-required')
    assert.fail('expected manual encoding selection');
  assert.deepEqual(probe.encoding.allowedEncodings, USER_SELECTED_TXT_SOURCE_ENCODINGS);
  assert.throws(
    () => decodeSourceAsset(source),
    hasCodeAndReason('NOVEL_IMPORT_ENCODING_REQUIRED', 'encoding_selection_incomplete'),
  );
  assert.throws(
    () => decodeSourceAsset(source, {
      sourceEncoding: 'gbk',
      sourceHash: '0'.repeat(64),
    }),
    hasReason('encoding_selection_source_mismatch'),
  );
});

test('manual decoding supports GBK, GB18030, Big5, and BOM-less UTF-16', () => {
  const cases = [
    {
      encoding: 'gbk' as const,
      text: '第一章 开始\n简体正文',
      bytes: iconvLite.encode('第一章 开始\n简体正文', 'gbk'),
    },
    {
      encoding: 'gb18030' as const,
      text: '第一章 开始\n扩展字符𠀀',
      bytes: iconvLite.encode('第一章 开始\n扩展字符𠀀', 'gb18030'),
    },
    {
      encoding: 'big5' as const,
      text: '第一章 開始\n繁體正文',
      bytes: iconvLite.encode('第一章 開始\n繁體正文', 'big5'),
    },
    {
      encoding: 'utf-16le' as const,
      text: '第一章 开始\n正文',
      bytes: Buffer.from('第一章 开始\n正文', 'utf16le'),
    },
    {
      encoding: 'utf-16be' as const,
      text: '第一章 开始\n正文',
      bytes: encodeUtf16Be('第一章 开始\n正文'),
    },
  ];

  for (const item of cases) {
    const source = createAsset(item.bytes);
    const decoded = decodeSourceAsset(source, {
      sourceEncoding: item.encoding,
      sourceHash: source.source.sha256,
    });
    assert.equal(decoded.text, item.text);
    assert.equal(decoded.encoding, item.encoding);
    assert.equal(decoded.encodingMethod, 'user');
  }
});

test('BOM-less ASCII UTF-16 remains available for an explicit manual decision', () => {
  const cases = [
    {
      encoding: 'utf-16le' as const,
      bytes: Buffer.from('Chapter 1\nText', 'utf16le'),
    },
    {
      encoding: 'utf-16be' as const,
      bytes: encodeUtf16Be('Chapter 1\nText'),
    },
  ];
  for (const item of cases) {
    const source = createAsset(item.bytes);
    assert.equal(probeSourceAsset(source).encoding.status, 'selection-required');
    assert.equal(decodeSourceAsset(source, {
      sourceEncoding: item.encoding,
      sourceHash: source.source.sha256,
    }).text, 'Chapter 1\nText');
  }
});

test('manual decoding rejects incomplete legacy, invalid UTF-16, and decoded NUL data', () => {
  const legacy = createAsset(Buffer.from([0x81]));
  assert.throws(
    () => decodeSourceAsset(legacy, {
      sourceEncoding: 'gbk',
      sourceHash: legacy.source.sha256,
    }),
    hasReason('decode_failed'),
  );

  const oddUtf16 = createAsset(Buffer.from([0xFF, 0x61, 0x00]));
  assert.throws(
    () => decodeSourceAsset(oddUtf16, {
      sourceEncoding: 'utf-16le',
      sourceHash: oddUtf16.source.sha256,
    }),
    hasReason('decode_failed'),
  );

  const nulUtf16 = createAsset(Buffer.from('a\0b', 'utf16le'));
  assert.throws(
    () => decodeSourceAsset(nulUtf16, {
      sourceEncoding: 'utf-16le',
      sourceHash: nulUtf16.source.sha256,
    }),
    hasReason('binary_nul'),
  );
});

test('probe verifies immutable source byte length and SHA-256', () => {
  const valid = createAsset(Buffer.from('正文', 'utf8'));
  assert.throws(
    () => probeSourceAsset({
      ...valid,
      source: { ...valid.source, byteLength: valid.source.byteLength + 1 },
    }),
    hasReason('source_asset_length_mismatch'),
  );
  assert.throws(
    () => probeSourceAsset({
      ...valid,
      source: { ...valid.source, sha256: '0'.repeat(64) },
    }),
    hasReason('source_asset_hash_mismatch'),
  );
});

function createAsset(
  bytes: Uint8Array,
  sourceOverrides: Partial<SourceAssetProbeDto> = {},
): ProjectSourceAsset {
  const copiedBytes = Uint8Array.from(bytes);
  return {
    source: {
      sourceAssetId: SOURCE_ASSET_ID,
      originalName: 'novel.txt',
      byteLength: copiedBytes.byteLength,
      sha256: sha256Bytes(copiedBytes),
      ...sourceOverrides,
    },
    bytes: copiedBytes,
  };
}

function encodeUtf16Be(text: string): Buffer {
  const bytes = Buffer.from(text, 'utf16le');
  for (let index = 0; index < bytes.length; index += 2) {
    const first = bytes[index]!;
    bytes[index] = bytes[index + 1]!;
    bytes[index + 1] = first;
  }
  return bytes;
}

function hasReason(reason: NovelImportError['reason']): (error: unknown) => boolean {
  return error => error instanceof NovelImportError && error.reason === reason;
}

function hasCodeAndReason(
  code: NovelImportError['code'],
  reason: NovelImportError['reason'],
): (error: unknown) => boolean {
  return error => error instanceof NovelImportError
    && error.code === code
    && error.reason === reason;
}
