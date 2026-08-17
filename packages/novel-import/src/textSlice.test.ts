import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { test } from 'node:test';

import { NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES } from '@voxweaver/contracts';

import {
  NovelImportError,
  readUtf8TextSlice,
} from './index.ts';

test('readUtf8TextSlice reads an exact multibyte UTF-8 byte range', () => {
  const bytes = Buffer.from('甲😀乙', 'utf8');
  const result = readUtf8TextSlice({
    revisionId: 'revision-1',
    textBytes: bytes,
    startByte: Buffer.byteLength('甲', 'utf8'),
    endByte: Buffer.byteLength('甲😀', 'utf8'),
  });

  assert.deepEqual(result, {
    revisionId: 'revision-1',
    range: { offsetUnit: 'utf8-byte', startByte: 3, endByte: 7 },
    text: '😀',
    done: true,
  });
});

test('readUtf8TextSlice rejects ranges that split a UTF-8 character', () => {
  const bytes = Buffer.from('甲😀乙', 'utf8');
  assert.throws(
    () => readUtf8TextSlice({
      revisionId: 'revision-1',
      textBytes: bytes,
      startByte: 4,
      endByte: 7,
    }),
    hasReason('text_slice_utf8_boundary'),
  );
  assert.throws(
    () => readUtf8TextSlice({
      revisionId: 'revision-1',
      textBytes: bytes,
      startByte: 3,
      endByte: 6,
    }),
    hasReason('text_slice_utf8_boundary'),
  );
});

test('readUtf8TextSlice returns safe sequential chunks capped at 256 KiB', () => {
  const maximum = Buffer.alloc(NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES, 0x61);
  const accepted = readUtf8TextSlice({
    revisionId: 'revision-1',
    textBytes: maximum,
    startByte: 0,
    endByte: maximum.byteLength,
  });
  assert.equal(accepted.text.length, NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES);
  assert.equal(accepted.done, true);

  const bytes = Buffer.from(`${'a'.repeat(NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES - 1)}😀b`, 'utf8');
  const first = readUtf8TextSlice({
    revisionId: 'revision-1',
    textBytes: bytes,
    startByte: 0,
    endByte: bytes.byteLength,
  });
  assert.equal(first.range.endByte, NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES - 1);
  assert.equal(first.done, false);
  assert.doesNotMatch(first.text, /�/u);

  const second = readUtf8TextSlice({
    revisionId: 'revision-1',
    textBytes: bytes,
    startByte: first.range.endByte,
    endByte: bytes.byteLength,
  });
  assert.equal(second.text, '😀b');
  assert.equal(second.done, true);
});

test('readUtf8TextSlice validates ranges and UTF-8 content', () => {
  const bytes = Buffer.from('正文', 'utf8');
  const invalidRanges: readonly (readonly [number, number])[] = [
    [-1, 0],
    [2, 1],
    [0, bytes.byteLength + 1],
  ];
  for (const [startByte, endByte] of invalidRanges) {
    assert.throws(
      () => readUtf8TextSlice({
        revisionId: 'revision-1',
        textBytes: bytes,
        startByte,
        endByte,
      }),
      hasReason('text_slice_invalid_range'),
    );
  }

  assert.throws(
    () => readUtf8TextSlice({
      revisionId: 'revision-1',
      textBytes: Buffer.from([0xFF]),
      startByte: 0,
      endByte: 1,
    }),
    hasReason('invalid_utf8_text'),
  );
});

test('readUtf8TextSlice allows empty boundary slices and preserves a U+FEFF byte sequence', () => {
  const bytes = Buffer.from('\uFEFFA', 'utf8');
  assert.equal(readUtf8TextSlice({
    revisionId: 'revision-1',
    textBytes: bytes,
    startByte: 0,
    endByte: 0,
  }).text, '');
  assert.equal(readUtf8TextSlice({
    revisionId: 'revision-1',
    textBytes: bytes,
    startByte: 0,
    endByte: bytes.byteLength,
  }).text, '\uFEFFA');
});

function hasReason(reason: NovelImportError['reason']): (error: unknown) => boolean {
  return error => error instanceof NovelImportError && error.reason === reason;
}
