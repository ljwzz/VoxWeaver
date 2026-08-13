import type { TaskSummaryDto } from './workspace.ts';

export const NOVEL_IMPORT_PROCESSOR_ID = 'voxweaver.txt-import' as const;
export const NOVEL_IMPORT_PROCESSOR_VERSION = '1' as const;
export const NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES = 256 * 1024;

export const TXT_SOURCE_ENCODINGS = [
  'utf-8',
  'gbk',
  'gb18030',
  'big5',
  'utf-16le',
  'utf-16be',
] as const;

export type TxtSourceEncoding = typeof TXT_SOURCE_ENCODINGS[number];
export type UserSelectedTxtSourceEncoding = Exclude<TxtSourceEncoding, 'utf-8'>;
export type TxtEncodingDecisionMethod = 'bom' | 'strict-utf8' | 'user';

export interface SourceAssetProbeDto {
  readonly sourceAssetId: string;
  readonly originalName: string;
  readonly byteLength: number;
  readonly sha256: string;
}

export type NovelImportEncodingProbeDto
  = | {
    readonly status: 'confirmed';
    readonly encoding: 'utf-8' | 'utf-16le' | 'utf-16be';
    readonly method: 'bom' | 'strict-utf8';
    readonly sourceHash: string;
  }
  | {
    readonly status: 'selection-required';
    readonly allowedEncodings: readonly UserSelectedTxtSourceEncoding[];
    readonly sourceHash: string;
    readonly message: string;
  }
  | {
    readonly status: 'rejected';
    readonly sourceHash: string;
    readonly message: string;
    readonly reason: 'empty' | 'binary-nul' | 'utf-32' | 'decode-failed';
  };

export interface NovelImportProbeDto {
  readonly source: SourceAssetProbeDto;
  readonly format: 'txt';
  readonly encoding: NovelImportEncodingProbeDto;
  readonly activeTask?: TaskSummaryDto;
  readonly latestReviewRevisionId?: string;
}

export interface StartNovelImportInput {
  readonly sourceEncoding?: UserSelectedTxtSourceEncoding;
}

export interface Utf8TextRangeDto {
  readonly offsetUnit: 'utf8-byte';
  readonly startByte: number;
  readonly endByte: number;
}

export interface ChapterCandidateDto {
  readonly candidateId: string;
  readonly rawTitle: string;
  readonly normalizedTitle: string;
  readonly headingRange: Utf8TextRangeDto;
  readonly confidence: number;
  readonly evidence: readonly string[];
  readonly reviewStatus: 'pending' | 'approved' | 'rejected';
}

export interface ChapterDto {
  readonly chapterId: string;
  readonly order: number;
  readonly title: string;
  readonly headingRange: Utf8TextRangeDto;
  readonly contentRange: Utf8TextRangeDto;
  readonly reviewStatus: 'pending' | 'approved' | 'rejected';
}

export type CoverageClassification = 'front-matter' | 'chapter' | 'appendix' | 'noise' | 'unknown';

export interface CoverageSegmentDto {
  readonly classification: CoverageClassification;
  readonly range: Utf8TextRangeDto;
  readonly chapterId?: string;
}

export interface CoverageReportDto {
  readonly totalByteLength: number;
  readonly classifiedByteLength: number;
  readonly unclassifiedByteLength: number;
  readonly complete: boolean;
  readonly segments: readonly CoverageSegmentDto[];
  readonly uncoveredRanges: readonly Utf8TextRangeDto[];
}

export interface NormalizationProposalDto {
  readonly proposalId: string;
  readonly range: Utf8TextRangeDto;
  readonly beforeText: string;
  readonly afterText: string;
  readonly reason: string;
  readonly decision: 'pending' | 'approved' | 'rejected';
}

export interface TextDiffHunkDto {
  readonly operation: 'delete' | 'insert' | 'replace';
  readonly range: Utf8TextRangeDto;
  readonly beforeText: string;
  readonly afterText: string;
}

export interface NovelImportRevisionHistoryDto {
  readonly revisionId: string;
  readonly baselineRevision: number;
  readonly sourceHash: string;
  readonly encoding: TxtSourceEncoding;
  readonly processorVersion: string;
  readonly reviewStatus: 'pending' | 'approved';
  readonly active: boolean;
  readonly createdAt: string;
}

export interface NovelImportReviewSnapshotDto {
  readonly revisionId: string;
  readonly baselineRevision: number;
  readonly source: SourceAssetProbeDto;
  readonly encoding: TxtSourceEncoding;
  readonly encodingMethod: TxtEncodingDecisionMethod;
  readonly textByteLength: number;
  readonly candidates: readonly ChapterCandidateDto[];
  readonly chapters: readonly ChapterDto[];
  readonly coverage: CoverageReportDto;
  readonly normalizationProposals: readonly NormalizationProposalDto[];
  readonly diff: readonly TextDiffHunkDto[];
  readonly revisionHistory: readonly NovelImportRevisionHistoryDto[];
  readonly reviewStatus: 'pending' | 'approved';
  readonly createdAt: string;
}

export interface TextSliceRequest {
  readonly revisionId: string;
  readonly startByte: number;
  readonly endByte: number;
}

export interface TextSliceDto {
  readonly revisionId: string;
  readonly range: Utf8TextRangeDto;
  readonly text: string;
  readonly totalByteLength: number;
}

interface NovelImportReviewCommandBase {
  readonly baselineRevision: number;
}

export type NovelImportReviewCommandInput
  = | (NovelImportReviewCommandBase & {
    readonly commandType: 'adjust-chapter-boundary';
    readonly chapterId: string;
    readonly headingRange: Utf8TextRangeDto;
    readonly contentRange: Utf8TextRangeDto;
  })
  | (NovelImportReviewCommandBase & {
    readonly commandType: 'classify-uncovered-range';
    readonly range: Utf8TextRangeDto;
    readonly classification: Exclude<CoverageClassification, 'chapter'>;
  })
  | (NovelImportReviewCommandBase & {
    readonly commandType: 'decide-normalization-proposal';
    readonly proposalId: string;
    readonly decision: 'approved' | 'rejected';
  })
  | (NovelImportReviewCommandBase & {
    readonly commandType: 'rerun-selection';
    readonly chapterIds: readonly string[];
  })
  | (NovelImportReviewCommandBase & {
    readonly commandType: 'confirm-review';
  });

export interface StaleImpactItemDto {
  readonly artifactType: string;
  readonly artifactId: string;
  readonly reason: string;
}

export interface StalePreviewDto {
  readonly baselineRevision: number;
  readonly commandType: NovelImportReviewCommandInput['commandType'];
  readonly affected: readonly StaleImpactItemDto[];
  readonly requiresConfirmation: boolean;
}

export type NovelImportEventDto
  = {
    readonly eventType: 'task-progress';
    readonly sequence: number;
    readonly occurredAt: string;
    readonly task: TaskSummaryDto;
  }
  | {
    readonly eventType: 'task-completed' | 'task-failed' | 'task-canceled' | 'task-retry-scheduled';
    readonly sequence: number;
    readonly occurredAt: string;
    readonly task: TaskSummaryDto;
  };

export type NovelImportEventListener = (event: NovelImportEventDto) => void;
