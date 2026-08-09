/// <reference types="node" />

import type {
  DocumentBlockKindV1,
  DocumentBlockV1,
  ImportedNovelV1,
  ImportIssueV1,
  SourceByteRangeV1,
  TxtEncodingDecisionV1,
  TxtSourceEncoding,
} from '@voxweaver/contracts';
import type {
  NovelSourceAdapter,
  NovelSourceAsset,
  NovelSourceDiagnostic,
  NovelSourceExtractContext,
  NovelSourceProbeResult,
  NovelSourceValidationContext,
  NovelSourceValidationResult,
  NovelSourceWarning,
  TxtUserEncodingSelection,
} from './novelSourceAdapter.js';

import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import { TextDecoder } from 'node:util';

import {
  BLOCK_ALIGNMENT_POLICY_VERSION,
  NOVEL_IMPORT_SCHEMA_VERSION,
  parseImportedNovelV1,
  TXT_SOURCE_ENCODINGS,
} from '@voxweaver/contracts';
import {
  NovelSourceAdapterError,
} from './novelSourceAdapter.js';

export const TXT_SOURCE_ADAPTER_ID = 'txt-source-adapter' as const;
export const TXT_SOURCE_ADAPTER_VERSION = 'm1-txt-source-adapter-v1' as const;
export const TXT_IMPORT_PROCESSOR_ID = 'novel-import' as const;
export const TXT_IMPORT_PROCESSOR_VERSION = 'm1-txt-extract-v1' as const;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const USER_ENCODINGS = new Set<TxtSourceEncoding>([
  'gbk',
  'gb18030',
  'big5',
  'utf-16le',
  'utf-16be',
]);

export interface TxtDecoderLike {
  decode: (
    input?: Uint8Array | null,
    options?: { readonly stream?: boolean },
  ) => string;
}

export type TxtDecoderFactory = (
  encoding: TxtSourceEncoding,
  options: { readonly fatal: true; readonly ignoreBOM: true },
) => TxtDecoderLike;

export interface TxtSourceAdapterOptions {
  readonly decoderFactory?: TxtDecoderFactory;
  readonly createOpaqueId?: () => string;
}

export interface TxtDecoderCapabilityProbe {
  readonly available: boolean;
  readonly supportedEncodings: readonly TxtSourceEncoding[];
  readonly missingEncodings: readonly TxtSourceEncoding[];
}

interface SourceAnalysis {
  readonly prefix: Uint8Array;
  readonly strictUtf8: boolean;
  readonly containsNul: boolean;
}

interface DecodeResult {
  readonly containsReplacementCharacter: boolean;
  readonly hasDecodedContent: boolean;
}

interface SourcePart {
  startByte: number;
  readonly endByte: number;
  bytes: Uint8Array;
}

type BomEncoding = 'utf-8' | 'utf-16le' | 'utf-16be' | 'utf-32le' | 'utf-32be';

const defaultDecoderFactory: TxtDecoderFactory = (encoding, options) => (
  new TextDecoder(encoding, options)
);

export function probeTxtDecoderCapabilities(
  decoderFactory: TxtDecoderFactory = defaultDecoderFactory,
): TxtDecoderCapabilityProbe {
  const supportedEncodings: TxtSourceEncoding[] = [];
  const missingEncodings: TxtSourceEncoding[] = [];

  for (const encoding of TXT_SOURCE_ENCODINGS) {
    try {
      const decoder = decoderFactory(encoding, { fatal: true, ignoreBOM: true });
      decoder.decode(new Uint8Array(), { stream: true });
      decoder.decode();
      supportedEncodings.push(encoding);
    } catch {
      missingEncodings.push(encoding);
    }
  }

  return {
    available: missingEncodings.length === 0,
    supportedEncodings,
    missingEncodings,
  };
}

export class TxtSourceAdapter implements NovelSourceAdapter {
  readonly adapterId = TXT_SOURCE_ADAPTER_ID;
  readonly adapterVersion = TXT_SOURCE_ADAPTER_VERSION;

  private readonly decoderFactory: TxtDecoderFactory;
  private readonly createOpaqueId: () => string;

  constructor(options: TxtSourceAdapterOptions = {}) {
    this.decoderFactory = options.decoderFactory ?? defaultDecoderFactory;
    this.createOpaqueId = options.createOpaqueId ?? randomUUID;
  }

  async probe(source: NovelSourceAsset): Promise<NovelSourceProbeResult> {
    const analysis = await analyzeSource(source, this.decoderFactory);
    return buildProbe(source, analysis);
  }

  async validate(
    source: NovelSourceAsset,
    context: NovelSourceValidationContext = {},
  ): Promise<NovelSourceValidationResult> {
    let probe: NovelSourceProbeResult;
    let analysis: SourceAnalysis;
    try {
      analysis = await analyzeSource(source, this.decoderFactory);
      probe = buildProbe(source, analysis);
    } catch (error) {
      const diagnostic = errorToDiagnostic(error);
      return invalidValidation(unknownProbe(), diagnostic);
    }

    if (probe.format === 'epub' || probe.reasons.includes('zip-signature')) {
      return invalidValidation(probe, diagnostic(
        'NOVEL_IMPORT_UNSUPPORTED_FORMAT',
        'format_not_enabled',
        'EPUB is outside the MVP TXT adapter scope',
      ));
    }

    const capabilities = probeTxtDecoderCapabilities(this.decoderFactory);
    if (!capabilities.available) {
      return invalidValidation(probe, diagnostic(
        'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
        'txt_decoder_unavailable',
        `Required TXT decoders are unavailable: ${capabilities.missingEncodings.join(', ')}`,
      ));
    }

    if (source.sourceByteLength === 0) {
      return invalidValidation(probe, diagnostic(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'empty_source',
        'TXT source is empty',
      ));
    }

    const bom = detectBom(analysis.prefix);
    if (bom === 'utf-32le' || bom === 'utf-32be') {
      return invalidValidation(probe, diagnostic(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'unsupported_utf32_bom',
        'UTF-32 BOM is not supported by the TXT import contract',
      ));
    }

    const selectionError = validateUserEncodingSelection(
      context.userEncoding,
      source.sourceContentHash,
    );
    if (selectionError !== undefined)
      return invalidValidation(probe, selectionError);

    if (
      analysis.containsNul
      && bom === undefined
      && context.userEncoding?.sourceEncoding !== 'utf-16le'
      && context.userEncoding?.sourceEncoding !== 'utf-16be'
    ) {
      return invalidValidation(probe, diagnostic(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'binary_nul_byte',
        'TXT source contains NUL bytes without an explicit UTF-16 decision',
      ));
    }

    const encodingDecision = decideEncoding(
      source.sourceContentHash,
      analysis.strictUtf8,
      bom,
      context.userEncoding,
    );
    if (encodingDecision instanceof NovelSourceAdapterError)
      return invalidValidation(probe, errorToDiagnostic(encodingDecision));

    let decoded: DecodeResult;
    try {
      decoded = await decodeSource(
        source,
        encodingDecision.sourceEncoding,
        this.decoderFactory,
      );
    } catch (error) {
      return invalidValidation(probe, errorToDiagnostic(error));
    }

    if (!decoded.hasDecodedContent) {
      return invalidValidation(probe, diagnostic(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'empty_source',
        'TXT source contains no text after its BOM',
        encodingDecision.sourceEncoding,
      ));
    }

    const warnings: NovelSourceWarning[] = decoded.containsReplacementCharacter
      ? [{
          code: 'source_contains_replacement_character',
          message: 'Source text contains a literal U+FFFD replacement character',
          sourceEncoding: encodingDecision.sourceEncoding,
        }]
      : [];

    return {
      valid: true,
      probe,
      encodingDecision,
      errors: [],
      warnings,
    };
  }

  async extract(
    source: NovelSourceAsset,
    context: NovelSourceExtractContext = {},
  ): Promise<ImportedNovelV1> {
    const validation = await this.validate(source, context);
    if (!validation.valid || validation.encodingDecision === undefined) {
      throw new NovelSourceAdapterError(
        validation.errors[0] ?? diagnostic(
          'NOVEL_IMPORT_INVALID_SOURCE',
          'source_validation_failed',
          'TXT source validation failed',
        ),
      );
    }

    const createId = context.createOpaqueId ?? this.createOpaqueId;
    const rawTextRevisionId = createCheckedId(createId);
    const orderedBlocks: DocumentBlockV1[] = [];
    const warnings: ImportIssueV1[] = [];
    const rawRevisionHash = createHash('sha256');
    let rawByteLength = 0;
    let lineNumber = 1;

    await splitSourceLines(
      source,
      validation.encodingDecision.sourceEncoding,
      this.decoderFactory,
      (rawText, sourceByteRange) => {
        const rawTextBytes = Buffer.from(rawText, 'utf8');
        const rawTextStart = rawByteLength;
        rawByteLength += rawTextBytes.byteLength;
        rawRevisionHash.update(rawTextBytes);
        const sourceLocator = {
          sourceAssetId: source.sourceAssetId,
          sourceContentHash: source.sourceContentHash,
          sourceEncoding: validation.encodingDecision!.sourceEncoding,
          sourceByteRange,
          rawTextRange: {
            textRevisionId: rawTextRevisionId,
            textLayer: 'raw' as const,
            offsetUnit: 'utf8-byte' as const,
            startByte: rawTextStart,
            endByte: rawByteLength,
          },
          lineRange: {
            lineBase: 1 as const,
            startLine: lineNumber,
            endLineExclusive: lineNumber + 1,
          },
        };
        lineNumber += 1;
        const block: DocumentBlockV1 = {
          blockId: createCheckedId(createId),
          kind: classifyRawBlock(rawText),
          rawText,
          sourceLocator,
          contentHash: sha256Utf8(rawText),
        };
        orderedBlocks.push(block);

        if (rawText.includes('\uFFFD')) {
          warnings.push({
            issueId: createCheckedId(createId),
            code: 'source_contains_replacement_character',
            severity: 'warning',
            reviewStatus: 'pending',
            message: 'Source text contains a literal U+FFFD replacement character',
            sourceLocator,
            sourceEncoding: validation.encodingDecision!.sourceEncoding,
            sourceByteRange,
          });
        }
      },
    );

    const importedNovel: ImportedNovelV1 = {
      documentType: 'imported-novel',
      schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
      sourceAssetId: source.sourceAssetId,
      sourceHash: source.sourceContentHash,
      sourceByteLength: source.sourceByteLength,
      sourceFormat: 'txt',
      encodingDecision: validation.encodingDecision,
      adapterId: this.adapterId,
      adapterVersion: this.adapterVersion,
      processorId: TXT_IMPORT_PROCESSOR_ID,
      processorVersion: TXT_IMPORT_PROCESSOR_VERSION,
      alignmentPolicyVersion: BLOCK_ALIGNMENT_POLICY_VERSION,
      rawTextRevision: {
        textRevisionId: rawTextRevisionId,
        textLayer: 'raw',
        contentHash: rawRevisionHash.digest('hex'),
        byteLength: rawByteLength,
      },
      metadata: {},
      orderedBlocks,
      structuralHints: [],
      warnings,
      reviewStatus: warnings.length === 0 ? 'not_required' : 'pending',
    };

    return parseImportedNovelV1(importedNovel, {
      sha256Utf8,
      sha256Utf8Parts,
    });
  }
}

async function analyzeSource(
  source: NovelSourceAsset,
  decoderFactory: TxtDecoderFactory,
): Promise<SourceAnalysis> {
  let decoder: TxtDecoderLike;
  try {
    decoder = decoderFactory('utf-8', { fatal: true, ignoreBOM: true });
  } catch {
    throw new NovelSourceAdapterError(diagnostic(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'txt_decoder_unavailable',
      'The strict UTF-8 decoder is unavailable',
    ));
  }

  const prefix: number[] = [];
  let strictUtf8 = true;
  let containsNul = false;
  await readSource(source, (chunk) => {
    for (const byte of chunk) {
      if (prefix.length < 4)
        prefix.push(byte);
      if (byte === 0)
        containsNul = true;
    }
    if (!strictUtf8)
      return;
    try {
      decoder.decode(chunk, { stream: true });
    } catch {
      strictUtf8 = false;
    }
  });

  if (strictUtf8) {
    try {
      decoder.decode();
    } catch {
      strictUtf8 = false;
    }
  }

  return { prefix: Uint8Array.from(prefix), strictUtf8, containsNul };
}

async function decodeSource(
  source: NovelSourceAsset,
  encoding: TxtSourceEncoding,
  decoderFactory: TxtDecoderFactory,
): Promise<DecodeResult> {
  let decoder: TxtDecoderLike;
  try {
    decoder = decoderFactory(encoding, { fatal: true, ignoreBOM: true });
  } catch {
    throw new NovelSourceAdapterError(diagnostic(
      'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      'txt_decoder_unavailable',
      `TXT decoder ${encoding} is unavailable`,
      encoding,
    ));
  }

  let containsReplacementCharacter = false;
  let hasDecodedContent = false;
  let atStart = true;
  let lastChunkRange: SourceByteRangeV1 | undefined;
  const observe = (text: string) => {
    if (text.includes('\uFFFD'))
      containsReplacementCharacter = true;
    if (atStart) {
      const withoutLeadingBom = text.startsWith('\uFEFF') ? text.slice(1) : text;
      if (withoutLeadingBom.length > 0)
        hasDecodedContent = true;
      if (text.length > 0)
        atStart = false;
      return;
    }
    if (text.length > 0)
      hasDecodedContent = true;
  };

  await readSource(source, (chunk, startByte, endByte) => {
    lastChunkRange = sourceRange(startByte, endByte);
    try {
      observe(decoder.decode(chunk, { stream: true }));
    } catch {
      throw new NovelSourceAdapterError(diagnostic(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'encoding_decode_failed',
        `TXT source cannot be decoded as ${encoding}`,
        encoding,
        lastChunkRange,
      ));
    }
  });

  try {
    observe(decoder.decode());
  } catch {
    throw new NovelSourceAdapterError(diagnostic(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'encoding_decode_failed',
      `TXT source ends with an incomplete ${encoding} sequence`,
      encoding,
      lastChunkRange ?? sourceRange(0, source.sourceByteLength),
    ));
  }

  return { containsReplacementCharacter, hasDecodedContent };
}

async function splitSourceLines(
  source: NovelSourceAsset,
  encoding: TxtSourceEncoding,
  decoderFactory: TxtDecoderFactory,
  onLine: (rawText: string, sourceByteRange: SourceByteRangeV1) => void,
): Promise<void> {
  const splitter = new SourceLineSplitter(encoding, (bytes, startByte, endByte) => {
    let decoder: TxtDecoderLike;
    try {
      decoder = decoderFactory(encoding, { fatal: true, ignoreBOM: true });
      const rawText = decoder.decode(bytes, { stream: true }) + decoder.decode();
      onLine(rawText, sourceRange(startByte, endByte));
    } catch (error) {
      if (error instanceof NovelSourceAdapterError)
        throw error;
      throw new NovelSourceAdapterError(diagnostic(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'encoding_decode_failed',
        `TXT line cannot be decoded as ${encoding}`,
        encoding,
        sourceRange(startByte, endByte),
      ));
    }
  });

  await readSource(source, (chunk, startByte) => splitter.push(chunk, startByte));
  splitter.finish(source.sourceByteLength);
}

class SourceLineSplitter {
  private readonly width: 1 | 2;
  private readonly littleEndian: boolean;
  private readonly onLine: (
    bytes: Uint8Array,
    startByte: number,
    endByte: number,
  ) => void;

  private parts: SourcePart[] = [];
  private partIndex = 0;
  private lineStartByte = 0;
  private pendingCrEndByte: number | undefined;
  private pendingUnitFirstByte: number | undefined;

  constructor(
    encoding: TxtSourceEncoding,
    onLine: (bytes: Uint8Array, startByte: number, endByte: number) => void,
  ) {
    this.width = encoding === 'utf-16le' || encoding === 'utf-16be' ? 2 : 1;
    this.littleEndian = encoding === 'utf-16le';
    this.onLine = onLine;
  }

  push(chunk: Uint8Array, startByte: number): void {
    if (chunk.byteLength === 0)
      return;
    this.parts.push({
      startByte,
      endByte: startByte + chunk.byteLength,
      bytes: chunk,
    });

    for (let index = 0; index < chunk.byteLength; index += 1) {
      const byte = chunk[index]!;
      const endByte = startByte + index + 1;
      if (this.width === 1) {
        this.processUnit(byte, endByte);
        continue;
      }
      if (this.pendingUnitFirstByte === undefined) {
        this.pendingUnitFirstByte = byte;
        continue;
      }
      const unit = this.littleEndian
        ? this.pendingUnitFirstByte | (byte << 8)
        : (this.pendingUnitFirstByte << 8) | byte;
      this.pendingUnitFirstByte = undefined;
      this.processUnit(unit, endByte);
    }
  }

  finish(totalByteLength: number): void {
    if (this.pendingUnitFirstByte !== undefined) {
      throw new NovelSourceAdapterError(diagnostic(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'encoding_decode_failed',
        'UTF-16 source ends with an incomplete code unit',
        undefined,
        sourceRange(Math.max(0, totalByteLength - 1), totalByteLength),
      ));
    }
    if (this.pendingCrEndByte !== undefined) {
      this.emit(this.pendingCrEndByte);
      this.pendingCrEndByte = undefined;
    }
    if (this.lineStartByte < totalByteLength)
      this.emit(totalByteLength);
  }

  private processUnit(unit: number, endByte: number): void {
    if (this.pendingCrEndByte !== undefined) {
      const crEndByte = this.pendingCrEndByte;
      this.pendingCrEndByte = undefined;
      if (unit === 0x0A) {
        this.emit(endByte);
        return;
      }
      this.emit(crEndByte);
    }

    if (unit === 0x0D) {
      this.pendingCrEndByte = endByte;
    } else if (unit === 0x0A) {
      this.emit(endByte);
    }
  }

  private emit(endByte: number): void {
    const bytes = this.takeThrough(endByte);
    this.onLine(bytes, this.lineStartByte, endByte);
    this.lineStartByte = endByte;
  }

  private takeThrough(endByte: number): Uint8Array {
    const pieces: Uint8Array[] = [];
    let byteLength = 0;
    while (this.partIndex < this.parts.length) {
      const part = this.parts[this.partIndex]!;
      if (part.startByte >= endByte)
        break;
      const takeLength = Math.min(part.endByte, endByte) - part.startByte;
      const piece = part.bytes.subarray(0, takeLength);
      pieces.push(piece);
      byteLength += piece.byteLength;
      if (part.endByte <= endByte) {
        this.partIndex += 1;
      } else {
        part.bytes = part.bytes.subarray(takeLength);
        part.startByte = endByte;
        break;
      }
    }
    const lineBytes = Buffer.concat(pieces, byteLength);
    if (this.partIndex > 0) {
      this.parts = this.parts.slice(this.partIndex);
      this.partIndex = 0;
    }
    return lineBytes;
  }
}

async function readSource(
  source: NovelSourceAsset,
  onChunk: (
    chunk: Uint8Array,
    startByte: number,
    endByte: number,
  ) => void,
): Promise<void> {
  validateSourceDescriptor(source);
  const hash = createHash('sha256');
  let byteLength = 0;
  let processingError: unknown;
  let stream: AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
  try {
    stream = source.openByteStream();
  } catch (error) {
    throw sourceStreamError(error);
  }

  try {
    for await (const candidate of stream) {
      if (!(candidate instanceof Uint8Array)) {
        if (processingError === undefined) {
          processingError = new NovelSourceAdapterError(diagnostic(
            'NOVEL_IMPORT_INVALID_SOURCE',
            'source_chunk_invalid',
            'Source stream chunks must be Uint8Array values',
          ));
        }
        continue;
      }
      const chunk = Uint8Array.from(candidate);
      const startByte = byteLength;
      byteLength += chunk.byteLength;
      if (!Number.isSafeInteger(byteLength)) {
        throw new NovelSourceAdapterError(diagnostic(
          'NOVEL_IMPORT_INVALID_SOURCE',
          'source_byte_length_unsafe',
          'Source stream byte length exceeds the safe integer range',
        ));
      }
      if (byteLength > source.sourceByteLength) {
        throw new NovelSourceAdapterError(diagnostic(
          'NOVEL_IMPORT_INVALID_SOURCE',
          'source_byte_length_mismatch',
          'Source stream byte length exceeds its immutable descriptor',
        ));
      }
      hash.update(chunk);
      if (processingError === undefined) {
        try {
          onChunk(chunk, startByte, byteLength);
        } catch (error) {
          processingError = error;
        }
      }
    }
  } catch (error) {
    if (error instanceof NovelSourceAdapterError)
      throw error;
    throw sourceStreamError(error);
  }

  const actualHash = hash.digest('hex');
  if (byteLength !== source.sourceByteLength) {
    throw new NovelSourceAdapterError(diagnostic(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'source_byte_length_mismatch',
      'Source stream byte length does not match its immutable descriptor',
    ));
  }
  if (actualHash !== source.sourceContentHash) {
    throw new NovelSourceAdapterError(diagnostic(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'source_content_hash_mismatch',
      'Source stream hash does not match its immutable descriptor',
    ));
  }
  if (processingError !== undefined)
    throw processingError;
}

function buildProbe(
  source: NovelSourceAsset,
  analysis: SourceAnalysis,
): NovelSourceProbeResult {
  const reasons: string[] = [];
  const extension = normalizeExtension(source.fileExtension);
  const mediaType = source.mediaType
    ?.split(';', 1)[0]
    ?.trim()
    .toLowerCase();
  const bom = detectBom(analysis.prefix);
  const zipSignature = hasPrefix(analysis.prefix, [0x50, 0x4B, 0x03, 0x04])
    || hasPrefix(analysis.prefix, [0x50, 0x4B, 0x05, 0x06])
    || hasPrefix(analysis.prefix, [0x50, 0x4B, 0x07, 0x08]);
  const epubExtension = extension === '.epub';
  const epubMediaType = mediaType === 'application/epub+zip';
  const epubEvidenceCount = Number(epubExtension)
    + Number(epubMediaType)
    + Number(zipSignature);

  if (epubExtension)
    reasons.push('epub-extension');
  if (epubMediaType)
    reasons.push('epub-media-type');
  if (zipSignature)
    reasons.push('zip-signature');
  if (epubEvidenceCount >= 2) {
    return {
      format: 'epub',
      confidence: epubEvidenceCount === 3 ? 1 : 0.9,
      reasons,
    };
  }

  if (bom !== undefined)
    reasons.push(`${bom}-bom`);
  if (analysis.strictUtf8)
    reasons.push('strict-utf8');
  if (mediaType === 'text/plain')
    reasons.push('text-plain-media-type');
  if (extension === '.txt')
    reasons.push('txt-extension');
  if (zipSignature)
    return { format: 'unknown', confidence: 0, reasons };

  const contentEvidence = bom !== undefined || (analysis.strictUtf8 && !analysis.containsNul);
  const metadataEvidence = mediaType === 'text/plain' || extension === '.txt';
  if (contentEvidence || metadataEvidence) {
    const confidence = contentEvidence && metadataEvidence
      ? 1
      : contentEvidence
        ? 0.9
        : 0.6;
    return { format: 'txt', confidence, reasons };
  }
  return { format: 'unknown', confidence: 0, reasons };
}

function decideEncoding(
  sourceContentHash: string,
  strictUtf8: boolean,
  bom: BomEncoding | undefined,
  userEncoding: TxtUserEncodingSelection | undefined,
): TxtEncodingDecisionV1 | NovelSourceAdapterError {
  if (bom === 'utf-8' || bom === 'utf-16le' || bom === 'utf-16be') {
    if (
      userEncoding !== undefined
      && userEncoding.sourceEncoding !== bom
    ) {
      return new NovelSourceAdapterError(diagnostic(
        'NOVEL_IMPORT_INVALID_SOURCE',
        'encoding_bom_conflict',
        `Explicit ${userEncoding.sourceEncoding} selection conflicts with ${bom} BOM`,
        bom,
      ));
    }
    return { sourceContentHash, sourceEncoding: bom, method: 'bom' };
  }
  if (userEncoding !== undefined) {
    return {
      sourceContentHash,
      sourceEncoding: userEncoding.sourceEncoding,
      method: 'user',
    };
  }
  if (strictUtf8) {
    return {
      sourceContentHash,
      sourceEncoding: 'utf-8',
      method: 'strict-utf8',
    };
  }
  return new NovelSourceAdapterError(diagnostic(
    'NOVEL_IMPORT_ENCODING_REQUIRED',
    'manual_encoding_required',
    'TXT source is not strict UTF-8 and requires an explicit encoding selection',
  ));
}

function validateUserEncodingSelection(
  selection: TxtUserEncodingSelection | undefined,
  sourceContentHash: string,
): NovelSourceDiagnostic | undefined {
  if (selection === undefined)
    return undefined;
  if (!USER_ENCODINGS.has(selection.sourceEncoding as TxtSourceEncoding)) {
    return diagnostic(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'unsupported_txt_encoding',
      'Explicit TXT encoding is not a supported canonical encoding ID',
    );
  }
  if (selection.sourceContentHash !== sourceContentHash) {
    return diagnostic(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'encoding_selection_source_mismatch',
      'Explicit TXT encoding selection is bound to a different source hash',
      selection.sourceEncoding,
    );
  }
  return undefined;
}

function detectBom(prefix: Uint8Array): BomEncoding | undefined {
  if (hasPrefix(prefix, [0x00, 0x00, 0xFE, 0xFF]))
    return 'utf-32be';
  if (hasPrefix(prefix, [0xFF, 0xFE, 0x00, 0x00]))
    return 'utf-32le';
  if (hasPrefix(prefix, [0xEF, 0xBB, 0xBF]))
    return 'utf-8';
  if (hasPrefix(prefix, [0xFF, 0xFE]))
    return 'utf-16le';
  if (hasPrefix(prefix, [0xFE, 0xFF]))
    return 'utf-16be';
  return undefined;
}

function hasPrefix(bytes: Uint8Array, prefix: readonly number[]): boolean {
  return prefix.length <= bytes.length
    && prefix.every((byte, index) => bytes[index] === byte);
}

function classifyRawBlock(rawText: string): DocumentBlockKindV1 {
  const visible = rawText
    .replace(/^\uFEFF/u, '')
    .replace(/(?:\r\n|\r|\n)$/u, '');
  if (/^\s*$/u.test(visible))
    return 'separator';
  if (
    /^(?:第\S{1,24}[章回节卷部篇集]|序章|楔子|前言|引子|终章|尾声|番外|后记)(?:\s|$)/u.test(visible)
    || /^chapter\s+\S+/iu.test(visible)
  ) {
    return 'heading';
  }
  return 'paragraph';
}

function validateSourceDescriptor(source: NovelSourceAsset): void {
  if (!SHA256_PATTERN.test(source.sourceContentHash)) {
    throw new NovelSourceAdapterError(diagnostic(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'source_content_hash_invalid',
      'Source descriptor must contain a lowercase SHA-256 hash',
    ));
  }
  if (!Number.isSafeInteger(source.sourceByteLength) || source.sourceByteLength < 0) {
    throw new NovelSourceAdapterError(diagnostic(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'source_byte_length_invalid',
      'Source descriptor byte length must be a safe non-negative integer',
    ));
  }
}

function createCheckedId(createId: () => string): string {
  const id = createId();
  if (!UUID_V4_PATTERN.test(id)) {
    throw new NovelSourceAdapterError(diagnostic(
      'NOVEL_IMPORT_INVALID_SOURCE',
      'opaque_id_invalid',
      'Opaque ID factory must return UUID v4 values',
    ));
  }
  return id;
}

function sourceRange(startByte: number, endByte: number): SourceByteRangeV1 {
  return { offsetUnit: 'source-byte', startByte, endByte };
}

function normalizeExtension(extension: string | undefined): string | undefined {
  if (extension === undefined)
    return undefined;
  const normalized = extension.toLowerCase();
  return normalized.startsWith('.') ? normalized : `.${normalized}`;
}

function sha256Utf8(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}

function sha256Utf8Parts(parts: Iterable<string>): string {
  const hash = createHash('sha256');
  for (const part of parts)
    hash.update(part, 'utf8');
  return hash.digest('hex');
}

function diagnostic(
  code: NovelSourceDiagnostic['code'],
  detailReason: string,
  message: string,
  sourceEncoding?: TxtSourceEncoding,
  sourceByteRange?: SourceByteRangeV1,
): NovelSourceDiagnostic {
  return {
    code,
    detailReason,
    message,
    ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
    ...(sourceByteRange === undefined ? {} : { sourceByteRange }),
  };
}

function invalidValidation(
  probe: NovelSourceProbeResult,
  error: NovelSourceDiagnostic,
): NovelSourceValidationResult {
  return { valid: false, probe, errors: [error], warnings: [] };
}

function unknownProbe(): NovelSourceProbeResult {
  return { format: 'unknown', confidence: 0, reasons: [] };
}

function errorToDiagnostic(error: unknown): NovelSourceDiagnostic {
  if (error instanceof NovelSourceAdapterError) {
    return diagnostic(
      error.code,
      error.detailReason,
      error.message,
      error.sourceEncoding,
      error.sourceByteRange,
    );
  }
  return diagnostic(
    'NOVEL_IMPORT_INVALID_SOURCE',
    'source_processing_failed',
    error instanceof Error ? error.message : 'TXT source processing failed',
  );
}

function sourceStreamError(error: unknown): NovelSourceAdapterError {
  return new NovelSourceAdapterError(diagnostic(
    'NOVEL_IMPORT_INVALID_SOURCE',
    'source_stream_failed',
    error instanceof Error ? error.message : 'Source byte stream failed',
  ));
}
