import type {
  ChapterCandidateDto,
  ChapterDto,
  CoverageReportDto,
  NormalizationProposalDto,
  TxtEncodingDecisionMethod,
  TxtSourceEncoding,
} from '@voxweaver/contracts';

import type { ManualTxtEncodingSelection } from './encoding.ts';
import type { ProjectSourceAsset } from './sourceAsset.ts';

import { Buffer } from 'node:buffer';

import { createHash } from 'node:crypto';
import {
  NOVEL_IMPORT_PROCESSOR_ID,
  NOVEL_IMPORT_PROCESSOR_VERSION,
} from '@voxweaver/contracts';
import {
  decodeSourceAsset,
} from './encoding.ts';
import {
  sha256Bytes,
} from './sourceAsset.ts';
import { analyzeNovelStructure } from './structure.ts';

export interface Utf8NovelTextArtifact {
  readonly encoding: 'utf-8';
  readonly mediaType: 'text/plain;charset=utf-8';
  readonly text: string;
  readonly bytes: Uint8Array;
  readonly byteLength: number;
  readonly sha256: string;
}

export interface ImportedNovelArtifact {
  readonly artifactType: 'novel-import';
  readonly schemaVersion: 1;
  readonly source: ProjectSourceAsset['source'];
  readonly sourceHash: string;
  readonly sourceEncoding: TxtSourceEncoding;
  readonly encodingMethod: TxtEncodingDecisionMethod;
  readonly processorId: typeof NOVEL_IMPORT_PROCESSOR_ID;
  readonly processorVersion: typeof NOVEL_IMPORT_PROCESSOR_VERSION;
  readonly processorFingerprint: string;
  readonly utf8Text: Utf8NovelTextArtifact;
  readonly candidates: readonly ChapterCandidateDto[];
  readonly chapters: readonly ChapterDto[];
  readonly coverage: CoverageReportDto;
  readonly normalizationProposals: readonly NormalizationProposalDto[];
}

export function createNovelImportProcessorFingerprint(
  sourceHash: string,
  sourceEncoding: TxtSourceEncoding,
): string {
  return createHash('sha256')
    .update(JSON.stringify({
      fingerprintSchemaVersion: 1,
      processorId: NOVEL_IMPORT_PROCESSOR_ID,
      processorVersion: NOVEL_IMPORT_PROCESSOR_VERSION,
      sourceHash,
      sourceEncoding,
    }))
    .digest('hex');
}

export function importSourceAsset(
  asset: ProjectSourceAsset,
  selection?: ManualTxtEncodingSelection,
): ImportedNovelArtifact {
  const decoded = decodeSourceAsset(asset, selection);
  const textBytes = Uint8Array.from(decoded.textBytes);
  const structure = analyzeNovelStructure(decoded.text, decoded.sourceHash);
  return {
    artifactType: 'novel-import',
    schemaVersion: 1,
    source: decoded.source,
    sourceHash: decoded.sourceHash,
    sourceEncoding: decoded.encoding,
    encodingMethod: decoded.encodingMethod,
    processorId: NOVEL_IMPORT_PROCESSOR_ID,
    processorVersion: NOVEL_IMPORT_PROCESSOR_VERSION,
    processorFingerprint: createNovelImportProcessorFingerprint(
      decoded.sourceHash,
      decoded.encoding,
    ),
    utf8Text: {
      encoding: 'utf-8',
      mediaType: 'text/plain;charset=utf-8',
      text: decoded.text,
      bytes: textBytes,
      byteLength: textBytes.byteLength,
      sha256: sha256Bytes(textBytes),
    },
    ...structure,
  };
}

export function sha256Utf8(text: string): string {
  return sha256Bytes(Buffer.from(text, 'utf8'));
}
