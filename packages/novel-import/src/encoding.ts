import type {
  NovelImportEncodingProbeDto,
  NovelImportProbeDto,
  TxtEncodingDecisionMethod,
  TxtSourceEncoding,
  UserSelectedTxtSourceEncoding,
} from '@voxweaver/contracts';

import type { ProjectSourceAsset } from './sourceAsset.ts';
import { Buffer } from 'node:buffer';

import { TextDecoder } from 'node:util';

import iconvLite from 'iconv-lite';
import { invalidSource, NovelImportError } from './errors.ts';
import {
  verifyProjectSourceAsset,
} from './sourceAsset.ts';

export const USER_SELECTED_TXT_SOURCE_ENCODINGS = [
  'gbk',
  'gb18030',
  'big5',
  'utf-16le',
  'utf-16be',
] as const satisfies readonly UserSelectedTxtSourceEncoding[];

const INVALID_ICONV_SEQUENCE_MARKER = '\uDC00';

type BomEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be';

export interface ManualTxtEncodingSelection {
  readonly sourceEncoding: UserSelectedTxtSourceEncoding;
  readonly sourceHash: string;
}

export interface DecodedProjectSourceAsset {
  readonly source: ProjectSourceAsset['source'];
  readonly sourceHash: string;
  readonly encoding: TxtSourceEncoding;
  readonly encodingMethod: TxtEncodingDecisionMethod;
  readonly text: string;
  readonly textBytes: Uint8Array;
}

export function probeSourceAsset(asset: ProjectSourceAsset): NovelImportProbeDto {
  verifyProjectSourceAsset(asset);
  const sourceHash = asset.source.sha256;
  if (asset.bytes.byteLength === 0) {
    return createProbe(asset, rejected(
      sourceHash,
      'empty',
      'TXT 源文件为空。',
    ));
  }

  const bom = detectBom(asset.bytes);
  if (bom === 'utf-32le' || bom === 'utf-32be') {
    return createProbe(asset, rejected(
      sourceHash,
      'utf-32',
      '不支持 UTF-32 TXT。',
    ));
  }

  if (bom !== undefined) {
    try {
      const text = decodeUnicode(asset.bytes, bom);
      const issue = validateDecodedText(text);
      if (issue !== undefined)
        return createProbe(asset, rejected(sourceHash, issue.reason, issue.message));
      return createProbe(asset, {
        status: 'confirmed',
        encoding: bom,
        method: 'bom',
        sourceHash,
      });
    } catch {
      return createProbe(asset, rejected(
        sourceHash,
        'decode-failed',
        `TXT 无法按 ${bom} BOM 严格解码。`,
      ));
    }
  }

  try {
    const text = decodeUnicode(asset.bytes, 'utf-8');
    const issue = validateDecodedText(text);
    if (issue?.reason === 'binary-nul' && isPlausibleBomlessUtf16(asset.bytes)) {
      return createProbe(asset, selectionRequired(sourceHash));
    }
    if (issue !== undefined)
      return createProbe(asset, rejected(sourceHash, issue.reason, issue.message));
    return createProbe(asset, {
      status: 'confirmed',
      encoding: 'utf-8',
      method: 'strict-utf8',
      sourceHash,
    });
  } catch {
    return createProbe(asset, selectionRequired(sourceHash));
  }
}

export function decodeSourceAsset(
  asset: ProjectSourceAsset,
  selection?: ManualTxtEncodingSelection,
): DecodedProjectSourceAsset {
  const probe = probeSourceAsset(asset);
  const decision = probe.encoding;
  if (decision.status === 'rejected')
    throw errorFromRejectedProbe(decision);

  let encoding: TxtSourceEncoding;
  let encodingMethod: TxtEncodingDecisionMethod;
  if (decision.status === 'confirmed') {
    if (selection !== undefined) {
      throw invalidSource(
        'encoding_selection_not_allowed',
        '已由 BOM 或严格 UTF-8 确认编码，不允许手动覆盖。',
      );
    }
    encoding = decision.encoding;
    encodingMethod = decision.method;
  } else {
    if (selection === undefined) {
      throw new NovelImportError(
        'NOVEL_IMPORT_ENCODING_REQUIRED',
        'encoding_selection_incomplete',
        decision.message,
        false,
        { allowedEncodings: decision.allowedEncodings },
      );
    }
    if (selection.sourceHash !== decision.sourceHash) {
      throw invalidSource(
        'encoding_selection_source_mismatch',
        '手动编码选择未绑定到当前 SourceAsset SHA-256。',
      );
    }
    if (!(USER_SELECTED_TXT_SOURCE_ENCODINGS as readonly string[]).includes(selection.sourceEncoding)) {
      throw invalidSource(
        'unsupported_encoding',
        '手动编码不在允许列表中。',
      );
    }
    encoding = selection.sourceEncoding;
    encodingMethod = 'user';
  }

  let text: string;
  try {
    text = encoding === 'gbk' || encoding === 'gb18030' || encoding === 'big5'
      ? decodeLegacy(asset.bytes, encoding)
      : decodeUnicode(asset.bytes, encoding);
  } catch (error) {
    if (error instanceof NovelImportError)
      throw error;
    throw invalidSource(
      'decode_failed',
      `TXT 无法按 ${encoding} 严格解码。`,
      { sourceEncoding: encoding },
    );
  }

  const issue = validateDecodedText(text);
  if (issue !== undefined)
    throw invalidSource(issue.internalReason, issue.message);

  return {
    source: asset.source,
    sourceHash: asset.source.sha256,
    encoding,
    encodingMethod,
    text,
    textBytes: Uint8Array.from(Buffer.from(text, 'utf8')),
  };
}

function decodeUnicode(
  bytes: Uint8Array,
  encoding: 'utf-8' | 'utf-16le' | 'utf-16be',
): string {
  return new TextDecoder(encoding, {
    fatal: true,
    ignoreBOM: false,
  }).decode(bytes);
}

function decodeLegacy(
  bytes: Uint8Array,
  encoding: 'gbk' | 'gb18030' | 'big5',
): string {
  if (!iconvLite.encodingExists(encoding)) {
    throw invalidSource(
      'unsupported_encoding',
      `iconv-lite 不支持 ${encoding}。`,
    );
  }

  const decoder = iconvLite.getDecoder(encoding) as ReturnType<typeof iconvLite.getDecoder> & {
    defaultCharUnicode?: string;
  };
  if (typeof decoder.defaultCharUnicode !== 'string') {
    throw invalidSource(
      'unsupported_encoding',
      `iconv-lite ${encoding} 解码器缺少严格错误标记能力。`,
    );
  }
  decoder.defaultCharUnicode = INVALID_ICONV_SEQUENCE_MARKER;
  const text = decoder.write(Buffer.from(bytes)) + (decoder.end() ?? '');
  if (containsUnpairedSurrogate(text)) {
    throw invalidSource(
      'decode_failed',
      `TXT 包含无效或不完整的 ${encoding} 字节序列。`,
      { sourceEncoding: encoding },
    );
  }
  return text;
}

function containsUnpairedSurrogate(text: string): boolean {
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit >= 0xD800 && codeUnit <= 0xDBFF) {
      const nextCodeUnit = text.charCodeAt(index + 1);
      if (nextCodeUnit < 0xDC00 || nextCodeUnit > 0xDFFF)
        return true;
      index += 1;
    } else if (codeUnit >= 0xDC00 && codeUnit <= 0xDFFF) {
      return true;
    }
  }
  return false;
}

function detectBom(bytes: Uint8Array): BomEncoding | undefined {
  if (hasPrefix(bytes, [0x00, 0x00, 0xFE, 0xFF]))
    return 'utf-32be';
  if (hasPrefix(bytes, [0xFF, 0xFE, 0x00, 0x00]))
    return 'utf-32le';
  if (hasPrefix(bytes, [0xEF, 0xBB, 0xBF]))
    return 'utf-8';
  if (hasPrefix(bytes, [0xFF, 0xFE]))
    return 'utf-16le';
  if (hasPrefix(bytes, [0xFE, 0xFF]))
    return 'utf-16be';
  return undefined;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.length <= bytes.length
    && prefix.every((byte, index) => bytes[index] === byte);
}

function isPlausibleBomlessUtf16(bytes: Uint8Array): boolean {
  if (bytes.byteLength === 0 || bytes.byteLength % 2 !== 0)
    return false;
  let nulAtEvenOffset = false;
  let nulAtOddOffset = false;
  for (let index = 0; index < bytes.byteLength; index += 1) {
    if (bytes[index] !== 0)
      continue;
    if (index % 2 === 0)
      nulAtEvenOffset = true;
    else
      nulAtOddOffset = true;
  }
  if (nulAtEvenOffset === nulAtOddOffset)
    return false;

  const encoding = nulAtOddOffset ? 'utf-16le' : 'utf-16be';
  try {
    return validateDecodedText(decodeUnicode(bytes, encoding)) === undefined;
  } catch {
    return false;
  }
}

function createProbe(
  asset: ProjectSourceAsset,
  encoding: NovelImportEncodingProbeDto,
): NovelImportProbeDto {
  return {
    source: asset.source,
    format: 'txt',
    encoding,
  };
}

function rejected(
  sourceHash: string,
  reason: Extract<NovelImportEncodingProbeDto, { status: 'rejected' }>['reason'],
  message: string,
): NovelImportEncodingProbeDto {
  return { status: 'rejected', sourceHash, reason, message };
}

function selectionRequired(sourceHash: string): NovelImportEncodingProbeDto {
  return {
    status: 'selection-required',
    allowedEncodings: USER_SELECTED_TXT_SOURCE_ENCODINGS,
    sourceHash,
    message: 'TXT 不是严格 UTF-8，请为当前源文件明确选择编码。',
  };
}

function validateDecodedText(text: string): {
  readonly reason: Extract<NovelImportEncodingProbeDto, { status: 'rejected' }>['reason'];
  readonly internalReason: 'binary_nul' | 'empty_source';
  readonly message: string;
} | undefined {
  if (text.length === 0) {
    return {
      reason: 'empty',
      internalReason: 'empty_source',
      message: 'TXT 解码后没有文本内容。',
    };
  }
  if (text.includes('\0')) {
    return {
      reason: 'binary-nul',
      internalReason: 'binary_nul',
      message: 'TXT 解码结果包含 NUL，按二进制内容拒绝。',
    };
  }
  return undefined;
}

function errorFromRejectedProbe(
  probe: Extract<NovelImportEncodingProbeDto, { status: 'rejected' }>,
): NovelImportError {
  const reason = probe.reason === 'utf-32'
    ? 'utf32_not_supported'
    : probe.reason === 'binary-nul'
      ? 'binary_nul'
      : probe.reason === 'empty'
        ? 'empty_source'
        : 'decode_failed';
  return invalidSource(reason, probe.message);
}
