import type {
  SourceAssetManifest,
  SourceTextPreviewDto,
  SourceTextPreviewRequest,
  TxtSourceEncoding,
} from '@voxweaver/contracts';

import {
  NOVEL_IMPORT_SOURCE_PREVIEW_MAX_BYTES,
  NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES,
} from '@voxweaver/contracts';
import { decodeSourceBytes } from './encoding.ts';
import { invalidSlice, invalidSource } from './errors.ts';
import { readProjectSourceAssetWindow } from './sourceAsset.ts';
import { normalizeImportedText } from './textNormalization.ts';

const SOURCE_PREVIEW_BOUNDARY_LOOKAHEAD_BYTES = 4;

export async function readProjectSourcePreview(
  rootPath: string,
  manifest: SourceAssetManifest,
  input: SourceTextPreviewRequest,
): Promise<SourceTextPreviewDto> {
  validatePreviewRequest(manifest, input);
  const window = await readProjectSourceAssetWindow(
    rootPath,
    manifest,
    input.startByte,
    NOVEL_IMPORT_SOURCE_PREVIEW_MAX_BYTES + SOURCE_PREVIEW_BOUNDARY_LOOKAHEAD_BYTES,
    SOURCE_PREVIEW_BOUNDARY_LOOKAHEAD_BYTES,
  );
  const relativeStart = input.startByte - window.startByte;
  const availableBytes = window.bytes.subarray(relativeStart);
  const maximumLength = Math.min(
    NOVEL_IMPORT_SOURCE_PREVIEW_MAX_BYTES,
    window.totalByteLength - input.startByte,
  );
  if (maximumLength === 0) {
    return {
      sourceHash: input.sourceHash,
      sourceEncoding: input.sourceEncoding,
      startByte: input.startByte,
      endByte: input.startByte,
      text: '',
      completeLineCount: 0,
      done: true,
    };
  }

  const lineEnd = findRequestedLineEnd(
    availableBytes,
    input.sourceEncoding,
    input.startByte,
    maximumLength,
    input.targetLineCount,
  );
  const candidateLength = lineEnd
    ?? avoidSplitCrLf(
      availableBytes,
      input.sourceEncoding,
      input.startByte,
      maximumLength,
    );
  const decoded = decodeSafePrefix(
    availableBytes,
    candidateLength,
    input.sourceEncoding,
    input.startByte === 0,
  );
  const text = normalizeImportedText(decoded.text);
  if (text.includes('\0')) {
    throw invalidSource(
      'binary_nul',
      'TXT 解码结果包含 NUL，按二进制内容拒绝。',
    );
  }

  const endByte = input.startByte + decoded.length;
  return {
    sourceHash: input.sourceHash,
    sourceEncoding: input.sourceEncoding,
    startByte: input.startByte,
    endByte,
    text,
    completeLineCount: countCompleteLines(text),
    done: endByte === window.totalByteLength,
  };
}

function validatePreviewRequest(
  manifest: SourceAssetManifest,
  input: SourceTextPreviewRequest,
): void {
  if (input.sourceHash !== manifest.sha256) {
    throw invalidSource(
      'encoding_selection_source_mismatch',
      '正文预览未绑定到当前 SourceAsset SHA-256。',
    );
  }
  if (!Number.isSafeInteger(input.startByte)
    || input.startByte < 0
    || input.startByte > manifest.byteLength) {
    throw invalidSlice(
      'source_preview_invalid_range',
      '正文预览起始字节无效。',
    );
  }
  if (!Number.isSafeInteger(input.targetLineCount)
    || input.targetLineCount < 1
    || input.targetLineCount > NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES) {
    throw invalidSlice(
      'source_preview_too_large',
      `单次正文预览不得超过 ${NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES} 行。`,
    );
  }
  if ((input.sourceEncoding === 'utf-16le' || input.sourceEncoding === 'utf-16be')
    && input.startByte % 2 !== 0) {
    throw invalidSlice(
      'source_preview_invalid_range',
      'UTF-16 正文预览必须从代码单元边界开始。',
    );
  }
}

function findRequestedLineEnd(
  bytes: Uint8Array,
  encoding: TxtSourceEncoding,
  absoluteStart: number,
  maximumLength: number,
  targetLineCount: number,
): number | undefined {
  return encoding === 'utf-16le' || encoding === 'utf-16be'
    ? findUtf16LineEnd(bytes, encoding, absoluteStart, maximumLength, targetLineCount)
    : findSingleByteNewlineEnd(bytes, maximumLength, targetLineCount);
}

function findSingleByteNewlineEnd(
  bytes: Uint8Array,
  maximumLength: number,
  targetLineCount: number,
): number | undefined {
  let lineCount = 0;
  let index = 0;
  while (index < maximumLength) {
    const byte = bytes[index];
    if (byte === 0x0D) {
      const hasLf = bytes[index + 1] === 0x0A;
      if (hasLf && index + 2 > maximumLength)
        return undefined;
      index += hasLf ? 2 : 1;
      lineCount += 1;
    } else if (byte === 0x0A) {
      index += 1;
      lineCount += 1;
    } else {
      index += 1;
    }
    if (lineCount === targetLineCount)
      return index;
  }
  return undefined;
}

function findUtf16LineEnd(
  bytes: Uint8Array,
  encoding: 'utf-16be' | 'utf-16le',
  absoluteStart: number,
  maximumLength: number,
  targetLineCount: number,
): number | undefined {
  if (absoluteStart % 2 !== 0)
    return undefined;
  let lineCount = 0;
  let index = 0;
  while (index + 1 < maximumLength) {
    const unit = readUtf16CodeUnit(bytes, index, encoding);
    if (unit === 0x000D) {
      const nextIsLf = readUtf16CodeUnit(bytes, index + 2, encoding) === 0x000A;
      if (nextIsLf && index + 4 > maximumLength)
        return undefined;
      index += nextIsLf ? 4 : 2;
      lineCount += 1;
    } else if (unit === 0x000A) {
      index += 2;
      lineCount += 1;
    } else {
      index += 2;
    }
    if (lineCount === targetLineCount)
      return index;
  }
  return undefined;
}

function readUtf16CodeUnit(
  bytes: Uint8Array,
  index: number,
  encoding: 'utf-16be' | 'utf-16le',
): number | undefined {
  const first = bytes[index];
  const second = bytes[index + 1];
  if (first === undefined || second === undefined)
    return undefined;
  return encoding === 'utf-16le'
    ? first | (second << 8)
    : (first << 8) | second;
}

function avoidSplitCrLf(
  bytes: Uint8Array,
  encoding: TxtSourceEncoding,
  absoluteStart: number,
  maximumLength: number,
): number {
  if (encoding === 'utf-16le' || encoding === 'utf-16be') {
    let length = maximumLength - ((absoluteStart + maximumLength) % 2);
    if (length >= 2
      && readUtf16CodeUnit(bytes, length - 2, encoding) === 0x000D
      && readUtf16CodeUnit(bytes, length, encoding) === 0x000A) {
      length -= 2;
    }
    return length;
  }
  return maximumLength > 0
    && bytes[maximumLength - 1] === 0x0D
    && bytes[maximumLength] === 0x0A
    ? maximumLength - 1
    : maximumLength;
}

function decodeSafePrefix(
  bytes: Uint8Array,
  candidateLength: number,
  encoding: TxtSourceEncoding,
  stripBom: boolean,
): { readonly length: number; readonly text: string } {
  let firstError: unknown;
  for (let removed = 0; removed <= SOURCE_PREVIEW_BOUNDARY_LOOKAHEAD_BYTES; removed += 1) {
    const length = candidateLength - removed;
    if (length <= 0)
      continue;
    if ((encoding === 'utf-16le' || encoding === 'utf-16be') && length % 2 !== 0)
      continue;
    try {
      return {
        length,
        text: decodeSourceBytes(bytes.subarray(0, length), encoding, stripBom),
      };
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError ?? invalidSlice(
    'source_preview_invalid_range',
    '正文预览无法在字符边界结束。',
  );
}

function countCompleteLines(text: string): number {
  let count = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === '\r') {
      if (text[index + 1] === '\n')
        index += 1;
      count += 1;
    } else if (text[index] === '\n') {
      count += 1;
    }
  }
  return count;
}
