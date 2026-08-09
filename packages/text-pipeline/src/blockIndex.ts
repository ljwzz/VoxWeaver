/// <reference types="node" />

import type {
  ImportedNovelV1,
  TextRangeMapV1,
  TextRangeV1,
  TextRevisionRefV1,
} from '@voxweaver/contracts';
import type {
  CanonicalDocumentBlockV1,
  DocumentBlockIndexV1,
} from '@voxweaver/novel-domain';

import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';

import {
  BLOCK_ALIGNMENT_POLICY_VERSION,
  mapTextRangeToSingleV1,
  parseImportedNovelV1,
  parseTextRangeMapV1,
  parseTextRevisionRefV1,
  TEXT_RANGE_MAP_VERSION,
  TEXT_RANGE_MAPPING_SCHEMA_VERSION,
} from '@voxweaver/contracts';
import {
  alignDocumentBlockIndexV1,
  DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION,
  DocumentBlockIndexValidationError,
  validateDocumentBlockIndexV1,
} from '@voxweaver/novel-domain';

export interface BuildDocumentBlockIndexInputV1 {
  readonly importedNovel: ImportedNovelV1;
  readonly canonicalText: string;
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly rawToCanonicalRangeMap: TextRangeMapV1;
  readonly previousIndex?: DocumentBlockIndexV1;
}

export function buildDocumentBlockIndexV1(
  input: BuildDocumentBlockIndexInputV1,
): DocumentBlockIndexV1 {
  const validated = validateInput(input);
  const canonicalBytes = Buffer.from(input.canonicalText, 'utf8');
  const blocks: CanonicalDocumentBlockV1[] = [];
  let canonicalCursor = 0;

  for (const rawBlock of validated.importedNovel.orderedBlocks) {
    const rawRange = rawBlock.sourceLocator.rawTextRange;
    const startRange = mapRawCursor(
      validated.rangeMap,
      { ...rawRange, endByte: rawRange.startByte },
      'after',
    );
    const endRange = mapRawCursor(
      validated.rangeMap,
      { ...rawRange, startByte: rawRange.endByte },
      'before',
    );
    const startByte = startRange.startByte;
    const endByte = endRange.endByte;
    if (
      startByte !== canonicalCursor
      || endByte < startByte
      || endByte > canonicalBytes.byteLength
      || !isUtf8ScalarBoundary(canonicalBytes, startByte)
      || !isUtf8ScalarBoundary(canonicalBytes, endByte)
    ) {
      invalid(
        'canonical_block_boundary_invalid',
        'Mapped block boundaries must be contiguous UTF-8 scalar boundaries',
      );
    }

    const blockBytes = canonicalBytes.subarray(startByte, endByte);
    const canonicalText = blockBytes.toString('utf8');
    if (!Buffer.from(canonicalText, 'utf8').equals(blockBytes)) {
      invalid(
        'canonical_block_utf8_invalid',
        'Mapped canonical block bytes must be valid exact UTF-8',
      );
    }
    blocks.push({
      blockId: rawBlock.blockId,
      kind: rawBlock.kind,
      canonicalText,
      canonicalRange: {
        textRevisionId: validated.canonicalRevision.textRevisionId,
        textLayer: 'canonical',
        offsetUnit: 'utf8-byte',
        startByte,
        endByte,
      },
      contentHash: sha256Bytes(blockBytes),
      sourceLocator: rawBlock.sourceLocator,
    });
    canonicalCursor = endByte;
  }

  if (canonicalCursor !== canonicalBytes.byteLength) {
    invalid(
      'canonical_coverage_invalid',
      'Mapped document blocks must cover the complete canonical artifact',
    );
  }
  const index = validateDocumentBlockIndexV1({
    documentType: 'document-block-index',
    schemaVersion: DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION,
    alignmentPolicyVersion: BLOCK_ALIGNMENT_POLICY_VERSION,
    sourceAssetId: validated.importedNovel.sourceAssetId,
    sourceContentHash: validated.importedNovel.sourceHash,
    sourceByteLength: validated.importedNovel.sourceByteLength,
    sourceEncoding: validated.importedNovel.encodingDecision.sourceEncoding,
    rawTextRevision: validated.importedNovel.rawTextRevision,
    canonicalTextRevision: {
      ...validated.canonicalRevision,
      textLayer: 'canonical',
    },
    blocks,
    issues: [],
    reviewStatus: 'not_required',
  });
  const alignment = alignDocumentBlockIndexV1(index, input.previousIndex);
  return validateDocumentBlockIndexV1({
    ...index,
    blocks: alignment.blocks,
    issues: alignment.issues,
    reviewStatus: alignment.reviewStatus,
  });
}

interface ValidatedInput {
  readonly importedNovel: ImportedNovelV1;
  readonly canonicalRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly rangeMap: TextRangeMapV1;
}

function validateInput(
  input: BuildDocumentBlockIndexInputV1,
): ValidatedInput {
  let importedNovel: ImportedNovelV1;
  let canonicalRevision: TextRevisionRefV1;
  let rangeMap: TextRangeMapV1;
  try {
    importedNovel = parseImportedNovelV1(input.importedNovel, {
      sha256Utf8,
      sha256Utf8Parts,
    });
    canonicalRevision = parseTextRevisionRefV1(input.canonicalTextRevision);
    rangeMap = parseTextRangeMapV1(input.rawToCanonicalRangeMap);
  } catch (error) {
    invalid(
      'block_index_input_invalid',
      error instanceof Error ? error.message : 'Block index input is invalid',
    );
  }

  if (canonicalRevision.textLayer !== 'canonical') {
    invalid(
      'canonical_revision_layer_invalid',
      'Block index canonical revision must use the canonical text layer',
    );
  }
  if (!sameRevision(rangeMap.inputRevision, importedNovel.rawTextRevision)) {
    invalid(
      'range_map_input_revision_mismatch',
      'Range map input revision must exactly match ImportedNovel rawTextRevision',
    );
  }
  if (!sameRevision(rangeMap.outputRevision, canonicalRevision)) {
    invalid(
      'range_map_output_revision_mismatch',
      'Range map output revision must exactly match the canonical revision',
    );
  }
  const canonicalBytes = Buffer.from(input.canonicalText, 'utf8');
  if (
    canonicalBytes.byteLength !== canonicalRevision.byteLength
    || sha256Bytes(canonicalBytes) !== canonicalRevision.contentHash
  ) {
    invalid(
      'canonical_revision_content_mismatch',
      'Canonical text must exactly match its revision byteLength and SHA-256',
    );
  }

  return {
    importedNovel,
    canonicalRevision: {
      ...canonicalRevision,
      textLayer: 'canonical',
    },
    rangeMap,
  };
}

function sameRevision(
  left: TextRevisionRefV1,
  right: TextRevisionRefV1,
): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength;
}

function mapRawCursor(
  rangeMap: TextRangeMapV1,
  range: TextRangeV1,
  cursorBias: 'before' | 'after',
): TextRangeV1 {
  try {
    return mapTextRangeToSingleV1(rangeMap, {
      schemaVersion: TEXT_RANGE_MAPPING_SCHEMA_VERSION,
      mapVersion: TEXT_RANGE_MAP_VERSION,
      direction: 'input-to-output',
      range,
      cursorBias,
    });
  } catch (error) {
    invalid(
      'canonical_block_mapping_failed',
      error instanceof Error
        ? error.message
        : 'Raw block cursor cannot be mapped to canonical text',
    );
  }
}

function isUtf8ScalarBoundary(bytes: Uint8Array, offset: number): boolean {
  if (offset === 0 || offset === bytes.byteLength)
    return true;
  const byte = bytes[offset];
  return byte !== undefined && (byte & 0b1100_0000) !== 0b1000_0000;
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

function sha256Bytes(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

function invalid(detailReason: string, message: string): never {
  throw new DocumentBlockIndexValidationError(detailReason, message);
}
