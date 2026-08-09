import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  NovelSourceAdapterError,
  TxtSourceAdapter,
} from '../dist/index.js';

const SOURCE_ASSET_ID = '52321d38-e91c-4180-b9e0-5a1b379ad17a';

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function idFactory() {
  let index = 0;
  return () => `00000000-0000-4000-8000-${String(index++).padStart(12, '0')}`;
}

function source(bytes, options = {}) {
  const snapshot = Uint8Array.from(bytes);
  const chunks = options.chunks ?? [snapshot];
  return {
    sourceAssetId: SOURCE_ASSET_ID,
    sourceContentHash: options.hash ?? sha256(snapshot),
    sourceByteLength: options.byteLength ?? snapshot.byteLength,
    mediaType: options.mediaType ?? 'text/plain',
    fileExtension: options.fileExtension ?? '.txt',
    openByteStream() {
      return (async function* () {
        for (const chunk of chunks)
          yield Uint8Array.from(chunk);
      })();
    },
  };
}

function userEncoding(input, sourceEncoding) {
  return {
    sourceContentHash: input.sourceContentHash,
    sourceEncoding,
  };
}

function utf16Be(text) {
  const littleEndian = Buffer.from(text, 'utf16le');
  for (let index = 0; index < littleEndian.length; index += 2) {
    const byte = littleEndian[index];
    littleEndian[index] = littleEndian[index + 1];
    littleEndian[index + 1] = byte;
  }
  return littleEndian;
}

test('extracts UTF-8 BOM input into source-backed raw line blocks', async () => {
  const bytes = Buffer.from('\uFEFF前言\r\n正文\n');
  const input = source(bytes, { chunks: [...bytes].map(byte => [byte]) });
  const adapter = new TxtSourceAdapter();

  const result = await adapter.extract(input, { createOpaqueId: idFactory() });

  assert.equal(result.encodingDecision.method, 'bom');
  assert.deepEqual(result.orderedBlocks.map(block => block.rawText), [
    '\uFEFF前言\r\n',
    '正文\n',
  ]);
  assert.deepEqual(result.orderedBlocks.map(block => block.sourceLocator.sourceByteRange), [
    { offsetUnit: 'source-byte', startByte: 0, endByte: 11 },
    { offsetUnit: 'source-byte', startByte: 11, endByte: 18 },
  ]);
  assert.deepEqual(result.orderedBlocks.map(block => block.sourceLocator.lineRange), [
    { lineBase: 1, startLine: 1, endLineExclusive: 2 },
    { lineBase: 1, startLine: 2, endLineExclusive: 3 },
  ]);
});

test('matches the frozen synthetic fixture raw blocks and exact locators', async () => {
  const [bytes, expectedJson] = await Promise.all([
    readFile(new URL('./fixtures/input/synthetic-comprehensive-bom-crlf.txt', import.meta.url)),
    readFile(new URL('./fixtures/expected/synthetic-comprehensive-bom-crlf.json', import.meta.url), 'utf8'),
  ]);
  const expected = JSON.parse(expectedJson).importedNovel;
  const opaqueIds = [
    expected.rawTextRevision.textRevisionId,
    ...expected.orderedBlocks.map(block => block.blockId),
  ];
  let idIndex = 0;
  const result = await new TxtSourceAdapter().extract(source(bytes), {
    createOpaqueId: () => opaqueIds[idIndex++],
  });

  assert.deepEqual(result.orderedBlocks, expected.orderedBlocks);
  assert.deepEqual(result.rawTextRevision, expected.rawTextRevision);
  assert.equal(result.sourceHash, expected.sourceHash);
  assert.equal(result.sourceByteLength, expected.sourceByteLength);
});

test('returns a typed blocking error for empty input', async () => {
  const validation = await new TxtSourceAdapter().validate(source(new Uint8Array()));
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.code, 'NOVEL_IMPORT_INVALID_SOURCE');
  assert.equal(validation.errors[0]?.detailReason, 'empty_source');
});

test('rejects opaque EPUB without parsing a container', async () => {
  let opens = 0;
  const [bytes, expectedJson] = await Promise.all([
    readFile(new URL('./fixtures/input/unsupported.epub', import.meta.url)),
    readFile(new URL('./fixtures/expected/unsupported-epub-opaque.json', import.meta.url), 'utf8'),
  ]);
  const expected = JSON.parse(expectedJson).result;
  const input = source(bytes, { fileExtension: '.epub', mediaType: 'application/epub+zip' });
  const originalOpen = input.openByteStream;
  input.openByteStream = () => {
    opens += 1;
    return originalOpen();
  };

  const validation = await new TxtSourceAdapter().validate(input);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.code, expected.errorCode);
  assert.equal(validation.errors[0]?.detailReason, expected.detailReason);
  assert.equal(opens, 1);
});

test('exposes typed extraction failures', async () => {
  await assert.rejects(
    new TxtSourceAdapter().extract(source(new Uint8Array())),
    error => error instanceof NovelSourceAdapterError
      && error.detailReason === 'empty_source',
  );
});

test('auto-confirms strict UTF-8 with valid content despite a wrong extension', async () => {
  const input = source(Buffer.from('正文\n'), {
    fileExtension: '.bin',
    mediaType: 'application/octet-stream',
  });
  const adapter = new TxtSourceAdapter();

  const probe = await adapter.probe(input);
  const validation = await adapter.validate(input);

  assert.equal(probe.format, 'txt');
  assert.equal(probe.reasons.includes('strict-utf8'), true);
  assert.deepEqual(validation.encodingDecision, {
    sourceContentHash: input.sourceContentHash,
    sourceEncoding: 'utf-8',
    method: 'strict-utf8',
  });
});

test('does not classify valid strict UTF-8 as EPUB from a lone extension', async () => {
  const input = source(Buffer.from('正文\n'), {
    fileExtension: '.epub',
    mediaType: 'application/octet-stream',
  });
  const adapter = new TxtSourceAdapter();

  const probe = await adapter.probe(input);
  const validation = await adapter.validate(input);

  assert.equal(probe.format, 'txt');
  assert.equal(probe.reasons.includes('epub-extension'), true);
  assert.equal(probe.reasons.includes('strict-utf8'), true);
  assert.equal(validation.valid, true);
  assert.equal(validation.encodingDecision?.method, 'strict-utf8');
});

test('rejects a bare ZIP signature without trying TXT encoding selection', async () => {
  const input = source(Uint8Array.of(0x50, 0x4B, 0x03, 0x04, 0x41, 0x42), {
    fileExtension: '.bin',
    mediaType: 'application/octet-stream',
  });
  const adapter = new TxtSourceAdapter();

  const probe = await adapter.probe(input);
  const validation = await adapter.validate(input);

  assert.equal(probe.format, 'unknown');
  assert.equal(probe.reasons.includes('zip-signature'), true);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.code, 'NOVEL_IMPORT_UNSUPPORTED_FORMAT');
  assert.equal(validation.errors[0]?.detailReason, 'format_not_enabled');
});

test('requires an explicit encoding when strict UTF-8 fails without a BOM', async () => {
  const [bytes, expectedJson] = await Promise.all([
    readFile(new URL('./fixtures/input/invalid-utf8.txt', import.meta.url)),
    readFile(new URL('./fixtures/expected/invalid-utf8-byte-sequence.json', import.meta.url), 'utf8'),
  ]);
  const expected = JSON.parse(expectedJson).result;
  const validation = await new TxtSourceAdapter().validate(
    source(bytes),
  );
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.code, expected.errorCode);
  assert.equal(validation.errors[0]?.detailReason, expected.detailReason);
});

test('strictly decodes every approved manually selected encoding', async (t) => {
  const cases = [
    ['gbk', Uint8Array.of(0xD6, 0xD0, 0xCE, 0xC4, 0x0A), '中文\n'],
    ['gb18030', Uint8Array.of(0x81, 0x30, 0x81, 0x30, 0x0A), '\u0080\n'],
    ['big5', Uint8Array.of(0xA4, 0xA4, 0xA4, 0xE5, 0x0A), '中文\n'],
    ['utf-16le', Buffer.from('中文\n', 'utf16le'), '中文\n'],
    ['utf-16be', utf16Be('中文\n'), '中文\n'],
  ];

  for (const [encoding, bytes, expectedText] of cases) {
    await t.test(encoding, async () => {
      const input = source(bytes, {
        chunks: [...bytes].map(byte => Uint8Array.of(byte)),
      });
      const result = await new TxtSourceAdapter().extract(input, {
        createOpaqueId: idFactory(),
        userEncoding: userEncoding(input, encoding),
      });
      assert.equal(result.encodingDecision.method, 'user');
      assert.equal(result.encodingDecision.sourceEncoding, encoding);
      assert.equal(result.orderedBlocks[0].rawText, expectedText);
      assert.deepEqual(result.orderedBlocks[0].sourceLocator.sourceByteRange, {
        offsetUnit: 'source-byte',
        startByte: 0,
        endByte: bytes.byteLength,
      });
      assert.equal(
        result.orderedBlocks[0].sourceLocator.rawTextRange.endByte,
        Buffer.byteLength(expectedText),
      );
    });
  }
});

test('honors a valid manual encoding before strict UTF-8 when no BOM exists', async () => {
  const bytes = Uint8Array.of(0xC2, 0xA2, 0xC2, 0xA3, 0x0A);
  const input = source(bytes, { chunks: [bytes.subarray(0, 1), bytes.subarray(1)] });
  const result = await new TxtSourceAdapter().extract(input, {
    createOpaqueId: idFactory(),
    userEncoding: userEncoding(input, 'gbk'),
  });

  assert.deepEqual(result.encodingDecision, {
    sourceContentHash: input.sourceContentHash,
    sourceEncoding: 'gbk',
    method: 'user',
  });
  assert.equal(result.orderedBlocks[0].rawText, '垄拢\n');
  assert.notEqual(result.orderedBlocks[0].rawText, '¢£\n');
});

test('preserves UTF-16 BOM as U+FEFF in raw text', async (t) => {
  const cases = [
    ['utf-16le', Buffer.concat([Buffer.from([0xFF, 0xFE]), Buffer.from('正文\r\n', 'utf16le')])],
    ['utf-16be', Buffer.concat([Buffer.from([0xFE, 0xFF]), utf16Be('正文\r\n')])],
  ];

  for (const [encoding, bytes] of cases) {
    await t.test(encoding, async () => {
      const input = source(bytes, { chunks: [...bytes].map(byte => [byte]) });
      const result = await new TxtSourceAdapter().extract(input, {
        createOpaqueId: idFactory(),
      });
      assert.deepEqual(result.encodingDecision, {
        sourceContentHash: input.sourceContentHash,
        sourceEncoding: encoding,
        method: 'bom',
      });
      assert.equal(result.orderedBlocks[0].rawText, '\uFEFF正文\r\n');
    });
  }
});

test('rejects UTF-32 BOMs before the shorter UTF-16 signatures', async (t) => {
  for (const bytes of [
    Uint8Array.of(0x00, 0x00, 0xFE, 0xFF, 0x00, 0x00, 0x00, 0x41),
    Uint8Array.of(0xFF, 0xFE, 0x00, 0x00, 0x41, 0x00, 0x00, 0x00),
  ]) {
    await t.test(Buffer.from(bytes).toString('hex'), async () => {
      const validation = await new TxtSourceAdapter().validate(source(bytes));
      assert.equal(validation.valid, false);
      assert.equal(validation.errors[0]?.code, 'NOVEL_IMPORT_INVALID_SOURCE');
      assert.equal(validation.errors[0]?.detailReason, 'unsupported_utf32_bom');
    });
  }
});

test('rejects an explicit encoding that conflicts with a BOM', async () => {
  const input = source(Buffer.from('\uFEFF正文'));
  const validation = await new TxtSourceAdapter().validate(input, {
    userEncoding: userEncoding(input, 'gbk'),
  });
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.detailReason, 'encoding_bom_conflict');
});

test('rejects stale and unknown manual encoding selections before decoding', async (t) => {
  const input = source(Uint8Array.of(0xD6, 0xD0, 0xCE, 0xC4));
  await t.test('stale source hash', async () => {
    const validation = await new TxtSourceAdapter().validate(input, {
      userEncoding: {
        sourceContentHash: '0'.repeat(64),
        sourceEncoding: 'gbk',
      },
    });
    assert.equal(validation.errors[0]?.detailReason, 'encoding_selection_source_mismatch');
  });
  await t.test('unknown runtime ID', async () => {
    const validation = await new TxtSourceAdapter().validate(input, {
      userEncoding: {
        sourceContentHash: input.sourceContentHash,
        sourceEncoding: 'gb2312',
      },
    });
    assert.equal(validation.errors[0]?.detailReason, 'unsupported_txt_encoding');
  });
});

test('reports the source chunk range for strict decoder failures', async () => {
  const bytes = Uint8Array.of(0xEF, 0xBB, 0xBF, 0x41, 0xE4, 0xB8);
  const input = source(bytes, {
    chunks: [bytes.subarray(0, 4), bytes.subarray(4)],
  });
  const validation = await new TxtSourceAdapter().validate(input);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.detailReason, 'encoding_decode_failed');
  assert.equal(validation.errors[0]?.sourceEncoding, 'utf-8');
  assert.deepEqual(validation.errors[0]?.sourceByteRange, {
    offsetUnit: 'source-byte',
    startByte: 4,
    endByte: 6,
  });
});

test('reports an invalid trailing byte for a manually selected encoding', async () => {
  const bytes = Uint8Array.of(0xD6);
  const input = source(bytes);
  const validation = await new TxtSourceAdapter().validate(input, {
    userEncoding: userEncoding(input, 'gbk'),
  });

  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.code, 'NOVEL_IMPORT_INVALID_SOURCE');
  assert.equal(validation.errors[0]?.detailReason, 'encoding_decode_failed');
  assert.equal(validation.errors[0]?.sourceEncoding, 'gbk');
  assert.deepEqual(validation.errors[0]?.sourceByteRange, {
    offsetUnit: 'source-byte',
    startByte: 0,
    endByte: 1,
  });
});

test('preserves a literal U+FFFD and emits a pending review warning', async () => {
  const input = source(Buffer.from('\uFFFD正文\n'));
  const validation = await new TxtSourceAdapter().validate(input);
  const result = await new TxtSourceAdapter().extract(input, {
    createOpaqueId: idFactory(),
  });

  assert.equal(validation.valid, true);
  assert.equal(validation.warnings[0]?.code, 'source_contains_replacement_character');
  assert.equal(result.orderedBlocks[0].rawText, '\uFFFD正文\n');
  assert.equal(result.warnings[0]?.code, 'source_contains_replacement_character');
  assert.equal(result.warnings[0]?.reviewStatus, 'pending');
  assert.equal(result.reviewStatus, 'pending');
});

test('rejects deterministic binary masquerade evidence', async () => {
  const input = source(Uint8Array.of(0x41, 0x00, 0x42, 0x0A));
  const validation = await new TxtSourceAdapter().validate(input);
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.detailReason, 'binary_nul_byte');
});

test('rejects unavailable required decoder capability without fallback decoding', async () => {
  const decoderFactory = (encoding, options) => {
    if (encoding === 'big5')
      throw new RangeError('missing decoder');
    return new TextDecoder(encoding, options);
  };
  const validation = await new TxtSourceAdapter({ decoderFactory }).validate(
    source(Buffer.from('正文\n')),
  );
  assert.equal(validation.valid, false);
  assert.equal(validation.errors[0]?.code, 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
  assert.equal(validation.errors[0]?.detailReason, 'txt_decoder_unavailable');
});

test('produces identical complete output with the same deterministic UUID factory', async () => {
  const bytes = Buffer.from('第一章 起步\r\n正文\r下一行\n');
  const input = source(bytes, {
    chunks: [bytes.subarray(0, 4), bytes.subarray(4, 13), bytes.subarray(13)],
  });
  const adapter = new TxtSourceAdapter();

  const first = await adapter.extract(input, { createOpaqueId: idFactory() });
  const second = await adapter.extract(input, { createOpaqueId: idFactory() });

  assert.deepEqual(second, first);
  assert.deepEqual(first.orderedBlocks.map(block => block.kind), [
    'heading',
    'paragraph',
    'paragraph',
  ]);
  assert.deepEqual(first.orderedBlocks.map(block => block.sourceLocator.lineRange), [
    { lineBase: 1, startLine: 1, endLineExclusive: 2 },
    { lineBase: 1, startLine: 2, endLineExclusive: 3 },
    { lineBase: 1, startLine: 3, endLineExclusive: 4 },
  ]);
});

test('does not mutate input bytes', async () => {
  const bytes = Buffer.from('\uFEFF正文\r\n');
  const before = Buffer.from(bytes);
  await new TxtSourceAdapter().extract(source(bytes), {
    createOpaqueId: idFactory(),
  });
  assert.deepEqual(bytes, before);
});

test('checks exact stream length and hash on every open', async (t) => {
  const bytes = Buffer.from('正文\n');
  await t.test('length mismatch', async () => {
    const validation = await new TxtSourceAdapter().validate(source(bytes, {
      byteLength: bytes.byteLength + 1,
    }));
    assert.equal(validation.errors[0]?.detailReason, 'source_byte_length_mismatch');
  });
  await t.test('hash mismatch', async () => {
    const validation = await new TxtSourceAdapter().validate(source(bytes, {
      hash: '0'.repeat(64),
    }));
    assert.equal(validation.errors[0]?.detailReason, 'source_content_hash_mismatch');
  });
  await t.test('single-use iterable cannot bypass a later pass', async () => {
    const oneShot = (async function* () {
      yield bytes;
    })();
    const input = {
      ...source(bytes),
      openByteStream: () => oneShot,
    };
    const validation = await new TxtSourceAdapter().validate(input);
    assert.equal(validation.valid, false);
    assert.equal(validation.errors[0]?.detailReason, 'source_byte_length_mismatch');
  });
  await t.test('stops consuming immediately after observed bytes exceed the descriptor', async () => {
    let consumedChunks = 0;
    const input = {
      ...source(Uint8Array.of(0x41), { byteLength: 1 }),
      openByteStream() {
        return (async function* () {
          consumedChunks += 1;
          yield Uint8Array.of(0x41);
          consumedChunks += 1;
          yield Uint8Array.of(0x42);
          consumedChunks += 1;
          yield Uint8Array.of(0x43);
        })();
      },
    };
    const validation = await new TxtSourceAdapter().validate(input);
    assert.equal(validation.errors[0]?.detailReason, 'source_byte_length_mismatch');
    assert.equal(consumedChunks, 2);
  });
  await t.test('maps source stream exceptions to a typed validation diagnostic', async () => {
    const input = {
      ...source(bytes),
      openByteStream() {
        return (async function* () {
          yield bytes.subarray(0, 1);
          throw new Error('synthetic stream failure');
        })();
      },
    };
    const validation = await new TxtSourceAdapter().validate(input);
    assert.equal(validation.valid, false);
    assert.equal(validation.errors[0]?.code, 'NOVEL_IMPORT_INVALID_SOURCE');
    assert.equal(validation.errors[0]?.detailReason, 'source_stream_failed');
    assert.equal(validation.errors[0]?.message, 'synthetic stream failure');
  });
});
