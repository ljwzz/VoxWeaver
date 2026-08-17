import type { TextSliceDto } from '@voxweaver/contracts';

import { TextDecoder } from 'node:util';

import { NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES } from '@voxweaver/contracts';

import { invalidSlice } from './errors.ts';

export interface ReadUtf8TextSliceInput {
  readonly revisionId: string;
  readonly textBytes: Uint8Array;
  readonly startByte: number;
  readonly endByte: number;
}

export interface DecodeUtf8TextSliceInput {
  readonly revisionId: string;
  readonly sliceBytes: Uint8Array;
  readonly startByte: number;
  readonly endByte: number;
  readonly done: boolean;
}

export function readUtf8TextSlice(input: ReadUtf8TextSliceInput): TextSliceDto {
  const { revisionId, textBytes, startByte, endByte } = input;
  if (typeof revisionId !== 'string'
    || revisionId.length === 0
    || !(textBytes instanceof Uint8Array)
    || !Number.isSafeInteger(startByte)
    || !Number.isSafeInteger(endByte)
    || startByte < 0
    || endByte < startByte
    || endByte > textBytes.byteLength) {
    throw invalidSlice(
      'text_slice_invalid_range',
      '正文 byte range 无效。',
      { startByte, endByte, totalByteLength: textBytes?.byteLength },
    );
  }

  if (!isUtf8Boundary(textBytes, startByte) || !isUtf8Boundary(textBytes, endByte)) {
    throw invalidSlice(
      'text_slice_utf8_boundary',
      '正文 byte range 必须位于 UTF-8 字符边界。',
      { startByte, endByte },
    );
  }

  let actualEndByte = Math.min(endByte, startByte + NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES);
  while (actualEndByte > startByte && !isUtf8Boundary(textBytes, actualEndByte))
    actualEndByte -= 1;

  return decodeUtf8TextSlice({
    revisionId,
    sliceBytes: textBytes.subarray(startByte, actualEndByte),
    startByte,
    endByte: actualEndByte,
    done: actualEndByte === endByte,
  });
}

export function decodeUtf8TextSlice(input: DecodeUtf8TextSliceInput): TextSliceDto {
  const {
    revisionId,
    sliceBytes,
    startByte,
    endByte,
    done,
  } = input;
  if (typeof revisionId !== 'string'
    || revisionId.length === 0
    || !(sliceBytes instanceof Uint8Array)
    || !Number.isSafeInteger(startByte)
    || !Number.isSafeInteger(endByte)
    || startByte < 0
    || endByte < startByte
    || sliceBytes.byteLength !== endByte - startByte
    || typeof done !== 'boolean') {
    throw invalidSlice(
      'text_slice_invalid_range',
      '正文 byte range 无效。',
      { startByte, endByte },
    );
  }

  if (sliceBytes.byteLength > NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES) {
    throw invalidSlice(
      'text_slice_too_large',
      `单次正文读取不得超过 ${NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES} 字节。`,
      { maximumByteLength: NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES },
    );
  }

  let text: string;
  try {
    text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: true,
    }).decode(sliceBytes);
  } catch {
    throw invalidSlice(
      'invalid_utf8_text',
      '正文切片不是有效的 UTF-8。',
      { startByte, endByte },
    );
  }

  return {
    revisionId,
    range: { offsetUnit: 'utf8-byte', startByte, endByte },
    text,
    done,
  };
}

function isUtf8Boundary(bytes: Uint8Array, offset: number): boolean {
  if (offset === 0 || offset === bytes.byteLength)
    return true;
  return (bytes[offset]! & 0xC0) !== 0x80;
}
