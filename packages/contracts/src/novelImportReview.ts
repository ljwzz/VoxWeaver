import type { ValidateFunction } from 'ajv';

import type {
  ChapterCandidateV1,
  ChapterIndexEntryV1,
  CoverageClassificationV1,
  CoverageReportV1,
  ImportIssueV1,
  TxtSourceEncoding,
} from './novelImport.js';
import type {
  TextLayerV1,
  TextRangeV1,
  TextRevisionRefV1,
} from './text.js';
import type {
  ArtifactDependencyType,
  ReviewStatus,
} from './workflow.js';

import Ajv2020Module from 'ajv/dist/2020.js';

import {
  NOVEL_IMPORT_SCHEMA,
  NOVEL_IMPORT_SCHEMA_VERSION,
  parseChapterIndexV1,
} from './novelImport.js';
import {
  parseTextRangeV1,
  parseTextRevisionRefV1,
  TEXT_REFERENCE_SCHEMA,
} from './text.js';

const Ajv2020 = Ajv2020Module.default;

export const NOVEL_IMPORT_REVIEW_SCHEMA_VERSION = 1 as const;

export interface NovelImportReviewBaselineV1 {
  readonly artifactId: string;
  readonly artifactRevisionId: string;
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
}

export interface NovelImportReviewQueryV1 {
  readonly documentType: 'novel-import-review-query';
  readonly schemaVersion: typeof NOVEL_IMPORT_REVIEW_SCHEMA_VERSION;
  readonly readOnly: true;
  readonly baselineRevision: NovelImportReviewBaselineV1;
}

export interface NovelImportChangeSelectorV1 {
  readonly blockIds?: readonly string[];
  readonly chapterIds?: readonly string[];
}

interface NovelImportReviewCommandBaseV1 {
  readonly documentType: 'novel-import-review-command';
  readonly schemaVersion: typeof NOVEL_IMPORT_REVIEW_SCHEMA_VERSION;
  readonly baselineRevision: NovelImportReviewBaselineV1;
  readonly requestedBy: string;
}

export interface ClassifyNovelImportRangeCommandV1
  extends NovelImportReviewCommandBaseV1 {
  readonly commandType: 'classify-uncovered-range';
  readonly targetRange: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly classification: Exclude<CoverageClassificationV1, 'chapter'>;
}

export interface AdjustNovelImportChapterBoundaryCommandV1
  extends NovelImportReviewCommandBaseV1 {
  readonly commandType: 'adjust-chapter-boundary';
  readonly chapterId: string;
  readonly headingRange: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly contentRange: TextRangeV1 & { readonly textLayer: 'canonical' };
}

export interface DecideNovelImportNormalizationCommandV1
  extends NovelImportReviewCommandBaseV1 {
  readonly commandType: 'decide-normalization-proposal';
  readonly proposalId: string;
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
}

export interface RerunNovelImportSelectionCommandV1
  extends NovelImportReviewCommandBaseV1 {
  readonly commandType: 'rerun-selection';
  readonly selector: NovelImportChangeSelectorV1;
}

export type NovelImportReviewCommandV1
  = | AdjustNovelImportChapterBoundaryCommandV1
    | ClassifyNovelImportRangeCommandV1
    | DecideNovelImportNormalizationCommandV1
    | RerunNovelImportSelectionCommandV1;

export interface NovelImportSourceSummaryV1 {
  readonly sourceAssetId: string;
  readonly format: 'txt';
  readonly byteLength: number;
  readonly contentHash: string;
  readonly encoding: TxtSourceEncoding;
}

export interface NovelImportAdapterSummaryV1 {
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly selectionMethod: 'explicit' | 'probe';
}

export type NovelImportLayerDiffOperationV1 = 'delete' | 'insert' | 'replace';

export interface NovelImportLayerDiffHunkV1 {
  readonly operation: NovelImportLayerDiffOperationV1;
  readonly fromRange: TextRangeV1;
  readonly toRange: TextRangeV1;
  readonly beforeText: string;
  readonly afterText: string;
}

export interface NovelImportLayerDiffV1 {
  readonly fromRevision: TextRevisionRefV1;
  readonly toRevision: TextRevisionRefV1;
  readonly hunks: readonly NovelImportLayerDiffHunkV1[];
}

export interface TableOfContentsEvidenceV1 {
  readonly evidenceId: string;
  readonly kind: 'candidate-sequence' | 'explicit-toc' | 'structural-hint';
  readonly range: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly rawText: string;
  readonly candidateIds: readonly string[];
  readonly confidence: number;
  readonly reviewStatus: ReviewStatus;
}

export interface UncoveredRangeReviewV1 {
  readonly range: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly suggestedClassification?: Exclude<CoverageClassificationV1, 'chapter'>;
  readonly reviewStatus: ReviewStatus;
}

export interface NovelImportRevisionHistoryEntryV1 {
  readonly artifactId: string;
  readonly artifactRevisionId: string;
  readonly sourceAssetId: string;
  readonly sourceHash: string;
  readonly processorId: string;
  readonly processorVersion: string;
  readonly rawTextRevision: TextRevisionRefV1 & { readonly textLayer: 'raw' };
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly normalizedTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'normalized';
  };
  readonly active: boolean;
}

export interface NovelImportNormalizationProposalV1 {
  readonly proposalId: string;
  readonly canonicalRange: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly operation: 'delete' | 'replace';
  readonly beforeText: string;
  readonly afterText: string;
  readonly contextBefore: readonly string[];
  readonly contextAfter: readonly string[];
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly reason: string;
  readonly evidence: readonly string[];
  readonly confidence: number;
  readonly confidenceSource: string;
  readonly risk: 'high' | 'low' | 'medium';
  readonly proposedBy: string;
  readonly operator?: string;
  readonly reviewStatus: 'approved' | 'not_required' | 'pending' | 'rejected';
  readonly reviewedBy?: string;
  readonly conflictProposalIds: readonly string[];
}

export interface NovelImportReviewSnapshotV1 {
  readonly documentType: 'novel-import-review-snapshot';
  readonly schemaVersion: typeof NOVEL_IMPORT_REVIEW_SCHEMA_VERSION;
  readonly readOnly: boolean;
  readonly baselineRevision: NovelImportReviewBaselineV1;
  readonly source: NovelImportSourceSummaryV1;
  readonly adapter: NovelImportAdapterSummaryV1;
  readonly textRevisions: readonly TextRevisionRefV1[];
  readonly layerDiffs: readonly NovelImportLayerDiffV1[];
  readonly chapterCandidates: readonly ChapterCandidateV1[];
  readonly chapters: readonly ChapterIndexEntryV1[];
  readonly tableOfContentsEvidence: readonly TableOfContentsEvidenceV1[];
  readonly coverage: CoverageReportV1;
  readonly issues: readonly ImportIssueV1[];
  readonly uncoveredRanges: readonly UncoveredRangeReviewV1[];
  readonly revisionHistory: readonly NovelImportRevisionHistoryEntryV1[];
  readonly normalizationProposals: readonly NovelImportNormalizationProposalV1[];
}

export interface NovelImportStalePreviewQueryV1 {
  readonly documentType: 'novel-import-stale-preview-query';
  readonly schemaVersion: typeof NOVEL_IMPORT_REVIEW_SCHEMA_VERSION;
  readonly readOnly: true;
  readonly baselineRevision: NovelImportReviewBaselineV1;
  readonly changeKind:
    | 'boundary-adjustment'
    | 'normalization-decision'
    | 'range-classification'
    | 'selection-rerun';
  readonly changeSelector: NovelImportChangeSelectorV1;
}

export interface NovelImportStaleImpactV1 {
  readonly consumerArtifactId: string;
  readonly consumerRevisionId: string;
  readonly producerArtifactId: string;
  readonly producerRevisionId: string;
  readonly dependencyType: ArtifactDependencyType;
  readonly depth: number;
  readonly selector?: NovelImportChangeSelectorV1;
}

export interface NovelImportStalePreviewV1 {
  readonly documentType: 'novel-import-stale-preview';
  readonly schemaVersion: typeof NOVEL_IMPORT_REVIEW_SCHEMA_VERSION;
  readonly baselineRevision: NovelImportReviewBaselineV1;
  readonly currentArtifactRevisionId: string;
  readonly baselineStatus: 'current' | 'stale';
  readonly canApply: boolean;
  readonly changeSelector: NovelImportChangeSelectorV1;
  readonly impacts: readonly NovelImportStaleImpactV1[];
}

export type NovelImportReviewDocumentV1
  = | NovelImportReviewCommandV1
    | NovelImportReviewQueryV1
    | NovelImportReviewSnapshotV1
    | NovelImportStalePreviewQueryV1
    | NovelImportStalePreviewV1;

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const UUID_V4_PATTERN
  = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const SHA256_PATTERN = '^[0-9a-f]{64}$';
const UUID_V4 = { type: 'string', pattern: UUID_V4_PATTERN } as const;
const SHA256 = { type: 'string', pattern: SHA256_PATTERN } as const;
const NON_EMPTY_STRING = { type: 'string', minLength: 1 } as const;
const SAFE_POSITIVE_INTEGER = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_SAFE_INTEGER,
} as const;
const TEXT_RANGE_V1_REF
  = `${TEXT_REFERENCE_SCHEMA.$id}#/$defs/textRangeV1` as const;
const TEXT_REVISION_REF_V1_REF
  = `${TEXT_REFERENCE_SCHEMA.$id}#/$defs/textRevisionRefV1` as const;
const CHAPTER_CANDIDATE_V1_REF
  = `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/chapterCandidateV1` as const;
const CHAPTER_ENTRY_V1_REF
  = `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/chapterIndexEntryV1` as const;
const COVERAGE_REPORT_V1_REF
  = `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/coverageReportV1` as const;
const IMPORT_ISSUE_V1_REF
  = `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/importIssueV1` as const;

const REVIEW_STATUS_SCHEMA = {
  type: 'string',
  enum: ['not_required', 'pending', 'approved', 'rejected'],
} as const;
const TEXT_REVISION_SCHEMA = { $ref: TEXT_REVISION_REF_V1_REF } as const;
const TEXT_RANGE_SCHEMA = { $ref: TEXT_RANGE_V1_REF } as const;
const BASELINE_REVISION_SCHEMA = {
  type: 'object',
  required: ['artifactId', 'artifactRevisionId', 'canonicalTextRevision'],
  properties: {
    artifactId: UUID_V4,
    artifactRevisionId: UUID_V4,
    canonicalTextRevision: TEXT_REVISION_SCHEMA,
  },
  additionalProperties: false,
} as const;
const CHANGE_SELECTOR_SCHEMA = {
  type: 'object',
  properties: {
    blockIds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: UUID_V4,
    },
    chapterIds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: UUID_V4,
    },
  },
  anyOf: [
    { required: ['blockIds'] },
    { required: ['chapterIds'] },
  ],
  additionalProperties: false,
} as const;
const COMMAND_BASE_PROPERTIES = {
  documentType: { const: 'novel-import-review-command' },
  schemaVersion: {
    type: 'integer',
    const: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
  },
  baselineRevision: { $ref: '#/$defs/baselineRevisionV1' },
  requestedBy: NON_EMPTY_STRING,
} as const;
const COMMAND_BASE_REQUIRED = [
  'documentType',
  'schemaVersion',
  'commandType',
  'baselineRevision',
  'requestedBy',
] as const;

const REVIEW_QUERY_SCHEMA = {
  type: 'object',
  required: [
    'documentType',
    'schemaVersion',
    'readOnly',
    'baselineRevision',
  ],
  properties: {
    documentType: { const: 'novel-import-review-query' },
    schemaVersion: {
      type: 'integer',
      const: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    },
    readOnly: { const: true },
    baselineRevision: { $ref: '#/$defs/baselineRevisionV1' },
  },
  additionalProperties: false,
} as const;

const CLASSIFY_RANGE_COMMAND_SCHEMA = {
  type: 'object',
  required: [...COMMAND_BASE_REQUIRED, 'targetRange', 'classification'],
  properties: {
    ...COMMAND_BASE_PROPERTIES,
    commandType: { const: 'classify-uncovered-range' },
    targetRange: TEXT_RANGE_SCHEMA,
    classification: {
      type: 'string',
      enum: ['front_matter', 'appendix', 'noise', 'unknown'],
    },
  },
  additionalProperties: false,
} as const;

const ADJUST_BOUNDARY_COMMAND_SCHEMA = {
  type: 'object',
  required: [
    ...COMMAND_BASE_REQUIRED,
    'chapterId',
    'headingRange',
    'contentRange',
  ],
  properties: {
    ...COMMAND_BASE_PROPERTIES,
    commandType: { const: 'adjust-chapter-boundary' },
    chapterId: UUID_V4,
    headingRange: TEXT_RANGE_SCHEMA,
    contentRange: TEXT_RANGE_SCHEMA,
  },
  additionalProperties: false,
} as const;

const NORMALIZATION_DECISION_COMMAND_SCHEMA = {
  type: 'object',
  required: [...COMMAND_BASE_REQUIRED, 'proposalId', 'decision'],
  properties: {
    ...COMMAND_BASE_PROPERTIES,
    commandType: { const: 'decide-normalization-proposal' },
    proposalId: UUID_V4,
    decision: {
      type: 'string',
      enum: ['approved', 'rejected'],
    },
    note: NON_EMPTY_STRING,
  },
  additionalProperties: false,
} as const;

const RERUN_SELECTION_COMMAND_SCHEMA = {
  type: 'object',
  required: [...COMMAND_BASE_REQUIRED, 'selector'],
  properties: {
    ...COMMAND_BASE_PROPERTIES,
    commandType: { const: 'rerun-selection' },
    selector: { $ref: '#/$defs/changeSelectorV1' },
  },
  additionalProperties: false,
} as const;

const REVIEW_COMMAND_SCHEMA = {
  oneOf: [
    { $ref: '#/$defs/classifyRangeCommandV1' },
    { $ref: '#/$defs/adjustBoundaryCommandV1' },
    { $ref: '#/$defs/normalizationDecisionCommandV1' },
    { $ref: '#/$defs/rerunSelectionCommandV1' },
  ],
} as const;

const SOURCE_SUMMARY_SCHEMA = {
  type: 'object',
  required: ['sourceAssetId', 'format', 'byteLength', 'contentHash', 'encoding'],
  properties: {
    sourceAssetId: UUID_V4,
    format: { const: 'txt' },
    byteLength: SAFE_POSITIVE_INTEGER,
    contentHash: SHA256,
    encoding: {
      type: 'string',
      enum: ['utf-8', 'gbk', 'gb18030', 'big5', 'utf-16le', 'utf-16be'],
    },
  },
  additionalProperties: false,
} as const;

const ADAPTER_SUMMARY_SCHEMA = {
  type: 'object',
  required: ['adapterId', 'adapterVersion', 'selectionMethod'],
  properties: {
    adapterId: NON_EMPTY_STRING,
    adapterVersion: NON_EMPTY_STRING,
    selectionMethod: {
      type: 'string',
      enum: ['explicit', 'probe'],
    },
  },
  additionalProperties: false,
} as const;

const LAYER_DIFF_HUNK_SCHEMA = {
  type: 'object',
  required: ['operation', 'fromRange', 'toRange', 'beforeText', 'afterText'],
  properties: {
    operation: {
      type: 'string',
      enum: ['delete', 'insert', 'replace'],
    },
    fromRange: TEXT_RANGE_SCHEMA,
    toRange: TEXT_RANGE_SCHEMA,
    beforeText: { type: 'string' },
    afterText: { type: 'string' },
  },
  additionalProperties: false,
} as const;

const LAYER_DIFF_SCHEMA = {
  type: 'object',
  required: ['fromRevision', 'toRevision', 'hunks'],
  properties: {
    fromRevision: TEXT_REVISION_SCHEMA,
    toRevision: TEXT_REVISION_SCHEMA,
    hunks: {
      type: 'array',
      items: { $ref: '#/$defs/layerDiffHunkV1' },
    },
  },
  additionalProperties: false,
} as const;

const TABLE_OF_CONTENTS_EVIDENCE_SCHEMA = {
  type: 'object',
  required: [
    'evidenceId',
    'kind',
    'range',
    'rawText',
    'candidateIds',
    'confidence',
    'reviewStatus',
  ],
  properties: {
    evidenceId: UUID_V4,
    kind: {
      type: 'string',
      enum: ['candidate-sequence', 'explicit-toc', 'structural-hint'],
    },
    range: TEXT_RANGE_SCHEMA,
    rawText: NON_EMPTY_STRING,
    candidateIds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: UUID_V4,
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  additionalProperties: false,
} as const;

const UNCOVERED_RANGE_REVIEW_SCHEMA = {
  type: 'object',
  required: ['range', 'reviewStatus'],
  properties: {
    range: TEXT_RANGE_SCHEMA,
    suggestedClassification: {
      type: 'string',
      enum: ['front_matter', 'appendix', 'noise', 'unknown'],
    },
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  additionalProperties: false,
} as const;

const REVISION_HISTORY_ENTRY_SCHEMA = {
  type: 'object',
  required: [
    'artifactId',
    'artifactRevisionId',
    'sourceAssetId',
    'sourceHash',
    'processorId',
    'processorVersion',
    'rawTextRevision',
    'canonicalTextRevision',
    'normalizedTextRevision',
    'active',
  ],
  properties: {
    artifactId: UUID_V4,
    artifactRevisionId: UUID_V4,
    sourceAssetId: UUID_V4,
    sourceHash: SHA256,
    processorId: NON_EMPTY_STRING,
    processorVersion: NON_EMPTY_STRING,
    rawTextRevision: TEXT_REVISION_SCHEMA,
    canonicalTextRevision: TEXT_REVISION_SCHEMA,
    normalizedTextRevision: TEXT_REVISION_SCHEMA,
    active: { type: 'boolean' },
  },
  additionalProperties: false,
} as const;

const NORMALIZATION_PROPOSAL_SCHEMA = {
  type: 'object',
  required: [
    'proposalId',
    'canonicalRange',
    'operation',
    'beforeText',
    'afterText',
    'contextBefore',
    'contextAfter',
    'ruleId',
    'ruleVersion',
    'reason',
    'evidence',
    'confidence',
    'confidenceSource',
    'risk',
    'proposedBy',
    'reviewStatus',
    'conflictProposalIds',
  ],
  properties: {
    proposalId: UUID_V4,
    canonicalRange: TEXT_RANGE_SCHEMA,
    operation: {
      type: 'string',
      enum: ['delete', 'replace'],
    },
    beforeText: NON_EMPTY_STRING,
    afterText: { type: 'string' },
    contextBefore: {
      type: 'array',
      items: { type: 'string' },
    },
    contextAfter: {
      type: 'array',
      items: { type: 'string' },
    },
    ruleId: NON_EMPTY_STRING,
    ruleVersion: NON_EMPTY_STRING,
    reason: NON_EMPTY_STRING,
    evidence: {
      type: 'array',
      minItems: 1,
      items: NON_EMPTY_STRING,
    },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    confidenceSource: NON_EMPTY_STRING,
    risk: {
      type: 'string',
      enum: ['high', 'low', 'medium'],
    },
    proposedBy: NON_EMPTY_STRING,
    operator: NON_EMPTY_STRING,
    reviewStatus: {
      type: 'string',
      enum: ['approved', 'not_required', 'pending', 'rejected'],
    },
    reviewedBy: NON_EMPTY_STRING,
    conflictProposalIds: {
      type: 'array',
      uniqueItems: true,
      items: UUID_V4,
    },
  },
  additionalProperties: false,
} as const;

const REVIEW_SNAPSHOT_SCHEMA = {
  type: 'object',
  required: [
    'documentType',
    'schemaVersion',
    'readOnly',
    'baselineRevision',
    'source',
    'adapter',
    'textRevisions',
    'layerDiffs',
    'chapterCandidates',
    'chapters',
    'tableOfContentsEvidence',
    'coverage',
    'issues',
    'uncoveredRanges',
    'revisionHistory',
    'normalizationProposals',
  ],
  properties: {
    documentType: { const: 'novel-import-review-snapshot' },
    schemaVersion: {
      type: 'integer',
      const: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    },
    readOnly: { type: 'boolean' },
    baselineRevision: { $ref: '#/$defs/baselineRevisionV1' },
    source: { $ref: '#/$defs/sourceSummaryV1' },
    adapter: { $ref: '#/$defs/adapterSummaryV1' },
    textRevisions: {
      type: 'array',
      minItems: 3,
      maxItems: 3,
      items: TEXT_REVISION_SCHEMA,
    },
    layerDiffs: {
      type: 'array',
      minItems: 2,
      maxItems: 2,
      items: { $ref: '#/$defs/layerDiffV1' },
    },
    chapterCandidates: {
      type: 'array',
      items: { $ref: CHAPTER_CANDIDATE_V1_REF },
    },
    chapters: {
      type: 'array',
      items: { $ref: CHAPTER_ENTRY_V1_REF },
    },
    tableOfContentsEvidence: {
      type: 'array',
      items: { $ref: '#/$defs/tableOfContentsEvidenceV1' },
    },
    coverage: { $ref: COVERAGE_REPORT_V1_REF },
    issues: {
      type: 'array',
      items: { $ref: IMPORT_ISSUE_V1_REF },
    },
    uncoveredRanges: {
      type: 'array',
      items: { $ref: '#/$defs/uncoveredRangeReviewV1' },
    },
    revisionHistory: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/revisionHistoryEntryV1' },
    },
    normalizationProposals: {
      type: 'array',
      items: { $ref: '#/$defs/normalizationProposalV1' },
    },
  },
  additionalProperties: false,
} as const;

const STALE_PREVIEW_QUERY_SCHEMA = {
  type: 'object',
  required: [
    'documentType',
    'schemaVersion',
    'readOnly',
    'baselineRevision',
    'changeKind',
    'changeSelector',
  ],
  properties: {
    documentType: { const: 'novel-import-stale-preview-query' },
    schemaVersion: {
      type: 'integer',
      const: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    },
    readOnly: { const: true },
    baselineRevision: { $ref: '#/$defs/baselineRevisionV1' },
    changeKind: {
      type: 'string',
      enum: [
        'boundary-adjustment',
        'normalization-decision',
        'range-classification',
        'selection-rerun',
      ],
    },
    changeSelector: { $ref: '#/$defs/changeSelectorV1' },
  },
  additionalProperties: false,
} as const;

const STALE_IMPACT_SCHEMA = {
  type: 'object',
  required: [
    'consumerArtifactId',
    'consumerRevisionId',
    'producerArtifactId',
    'producerRevisionId',
    'dependencyType',
    'depth',
  ],
  properties: {
    consumerArtifactId: UUID_V4,
    consumerRevisionId: UUID_V4,
    producerArtifactId: {
      ...UUID_V4,
      description: 'Immediate producer artifact for this dependency edge; depth 1 is the reviewed baseline artifact.',
    },
    producerRevisionId: {
      ...UUID_V4,
      description: 'Immediate producer revision for this dependency edge; depth 1 is the current reviewed producer revision.',
    },
    dependencyType: {
      type: 'string',
      enum: ['content', 'structure', 'voice', 'pronunciation', 'config'],
    },
    depth: SAFE_POSITIVE_INTEGER,
    selector: { $ref: '#/$defs/changeSelectorV1' },
  },
  additionalProperties: false,
} as const;

const STALE_PREVIEW_SCHEMA = {
  type: 'object',
  required: [
    'documentType',
    'schemaVersion',
    'baselineRevision',
    'currentArtifactRevisionId',
    'baselineStatus',
    'canApply',
    'changeSelector',
    'impacts',
  ],
  properties: {
    documentType: { const: 'novel-import-stale-preview' },
    schemaVersion: {
      type: 'integer',
      const: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    },
    baselineRevision: { $ref: '#/$defs/baselineRevisionV1' },
    currentArtifactRevisionId: UUID_V4,
    baselineStatus: {
      type: 'string',
      enum: ['current', 'stale'],
    },
    canApply: { type: 'boolean' },
    changeSelector: { $ref: '#/$defs/changeSelectorV1' },
    impacts: {
      type: 'array',
      description: 'Depth-1 edges start at the reviewed producer. Every deeper edge names a consumer from the immediately preceding depth as its producer.',
      items: { $ref: '#/$defs/staleImpactV1' },
    },
  },
  additionalProperties: false,
} as const;

export const NOVEL_IMPORT_REVIEW_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/novel-import-review.schema.json',
  title: 'VoxWeaver M1 novel import review DTOs',
  oneOf: [
    { $ref: '#/$defs/reviewQueryV1' },
    { $ref: '#/$defs/reviewCommandV1' },
    { $ref: '#/$defs/reviewSnapshotV1' },
    { $ref: '#/$defs/stalePreviewQueryV1' },
    { $ref: '#/$defs/stalePreviewV1' },
  ],
  $defs: {
    baselineRevisionV1: BASELINE_REVISION_SCHEMA,
    changeSelectorV1: CHANGE_SELECTOR_SCHEMA,
    reviewQueryV1: REVIEW_QUERY_SCHEMA,
    classifyRangeCommandV1: CLASSIFY_RANGE_COMMAND_SCHEMA,
    adjustBoundaryCommandV1: ADJUST_BOUNDARY_COMMAND_SCHEMA,
    normalizationDecisionCommandV1: NORMALIZATION_DECISION_COMMAND_SCHEMA,
    rerunSelectionCommandV1: RERUN_SELECTION_COMMAND_SCHEMA,
    reviewCommandV1: REVIEW_COMMAND_SCHEMA,
    sourceSummaryV1: SOURCE_SUMMARY_SCHEMA,
    adapterSummaryV1: ADAPTER_SUMMARY_SCHEMA,
    layerDiffHunkV1: LAYER_DIFF_HUNK_SCHEMA,
    layerDiffV1: LAYER_DIFF_SCHEMA,
    tableOfContentsEvidenceV1: TABLE_OF_CONTENTS_EVIDENCE_SCHEMA,
    uncoveredRangeReviewV1: UNCOVERED_RANGE_REVIEW_SCHEMA,
    revisionHistoryEntryV1: REVISION_HISTORY_ENTRY_SCHEMA,
    normalizationProposalV1: NORMALIZATION_PROPOSAL_SCHEMA,
    reviewSnapshotV1: REVIEW_SNAPSHOT_SCHEMA,
    stalePreviewQueryV1: STALE_PREVIEW_QUERY_SCHEMA,
    staleImpactV1: STALE_IMPACT_SCHEMA,
    stalePreviewV1: STALE_PREVIEW_SCHEMA,
  },
} as const;

const validators = createNovelImportReviewValidators();

export class NovelImportReviewValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_REVIEW_CONTRACT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'NovelImportReviewValidationError';
  }
}

export function parseNovelImportReviewDocumentV1(
  value: unknown,
): NovelImportReviewDocumentV1 {
  validateSchema(value, validators.document, 'Novel import review document');
  const document = value as NovelImportReviewDocumentV1;
  switch (document.documentType) {
    case 'novel-import-review-query':
      return parseNovelImportReviewQueryV1(document);
    case 'novel-import-review-command':
      return parseNovelImportReviewCommandV1(document);
    case 'novel-import-review-snapshot':
      return parseNovelImportReviewSnapshotV1(document);
    case 'novel-import-stale-preview-query':
      return parseNovelImportStalePreviewQueryV1(document);
    case 'novel-import-stale-preview':
      return parseNovelImportStalePreviewV1(document);
  }
}

export function parseNovelImportReviewQueryV1(
  value: unknown,
): NovelImportReviewQueryV1 {
  validateSchema(value, validators.query, 'Novel import review query');
  const query = value as NovelImportReviewQueryV1;
  parseBaselineRevision(query.baselineRevision);
  return query;
}

export function parseNovelImportReviewCommandV1(
  value: unknown,
): NovelImportReviewCommandV1 {
  validateSchema(value, validators.command, 'Novel import review command');
  const command = value as NovelImportReviewCommandV1;
  const baseline = parseBaselineRevision(command.baselineRevision);

  if (command.commandType === 'classify-uncovered-range') {
    const range = parseRange(command.targetRange, baseline.canonicalTextRevision);
    if (range.startByte === range.endByte)
      fail('Classification targetRange must be non-empty');
  } else if (command.commandType === 'adjust-chapter-boundary') {
    const heading = parseRange(command.headingRange, baseline.canonicalTextRevision);
    const content = parseRange(command.contentRange, baseline.canonicalTextRevision);
    if (heading.startByte === heading.endByte)
      fail('Chapter headingRange must be non-empty');
    if (heading.endByte !== content.startByte) {
      fail('Chapter headingRange must end where contentRange starts');
    }
  }
  return command;
}

export function parseNovelImportReviewSnapshotV1(
  value: unknown,
): NovelImportReviewSnapshotV1 {
  validateSchema(value, validators.snapshot, 'Novel import review snapshot');
  const snapshot = value as NovelImportReviewSnapshotV1;
  const baseline = parseBaselineRevision(snapshot.baselineRevision);
  const revisions = indexCurrentTextRevisions(snapshot.textRevisions, baseline);

  assertLayerDiffs(snapshot.layerDiffs, revisions);
  assertChapterProjection(snapshot, revisions.canonical);
  assertTableOfContentsEvidence(snapshot, revisions.canonical);
  assertUncoveredRanges(snapshot, revisions.canonical);
  assertNormalizationProposals(snapshot.normalizationProposals, revisions.canonical);
  assertRevisionHistory(snapshot, revisions);
  return snapshot;
}

export function parseNovelImportStalePreviewQueryV1(
  value: unknown,
): NovelImportStalePreviewQueryV1 {
  validateSchema(value, validators.staleQuery, 'Novel import stale preview query');
  const query = value as NovelImportStalePreviewQueryV1;
  parseBaselineRevision(query.baselineRevision);
  return query;
}

export function parseNovelImportStalePreviewV1(
  value: unknown,
): NovelImportStalePreviewV1 {
  validateSchema(value, validators.stalePreview, 'Novel import stale preview');
  const preview = value as NovelImportStalePreviewV1;
  const baseline = parseBaselineRevision(preview.baselineRevision);
  const baselineIsCurrent
    = baseline.artifactRevisionId === preview.currentArtifactRevisionId;

  if (
    preview.baselineStatus !== (baselineIsCurrent ? 'current' : 'stale')
    || preview.canApply !== baselineIsCurrent
  ) {
    fail('Stale preview status must match the current artifact revision');
  }

  const consumersByDepth = new Map<number, Set<string>>();
  for (const impact of preview.impacts) {
    const consumers = consumersByDepth.get(impact.depth) ?? new Set<string>();
    consumers.add(impactNodeKey(
      impact.consumerArtifactId,
      impact.consumerRevisionId,
    ));
    consumersByDepth.set(impact.depth, consumers);
  }

  for (const impact of preview.impacts) {
    if (impact.depth === 1) {
      if (impact.producerArtifactId !== baseline.artifactId) {
        fail('Direct stale preview impact must reference the baseline artifact');
      }
      if (impact.producerRevisionId !== preview.currentArtifactRevisionId) {
        fail('Direct stale preview impact must reference the current producer revision');
      }
      continue;
    }

    const previousConsumers = consumersByDepth.get(impact.depth - 1);
    if (!previousConsumers?.has(impactNodeKey(
      impact.producerArtifactId,
      impact.producerRevisionId,
    ))) {
      fail('Transitive stale preview impact must continue a prior-depth consumer');
    }
  }
  return preview;
}

function impactNodeKey(artifactId: string, revisionId: string): string {
  return `${artifactId}:${revisionId}`;
}

function parseBaselineRevision(
  baseline: NovelImportReviewBaselineV1,
): NovelImportReviewBaselineV1 {
  const revision = parseRevision(baseline.canonicalTextRevision);
  if (revision.textLayer !== 'canonical')
    fail('Novel import review baseline must use the canonical text layer');
  return baseline;
}

interface IndexedTextRevisions {
  readonly raw: TextRevisionRefV1 & { readonly textLayer: 'raw' };
  readonly canonical: TextRevisionRefV1 & { readonly textLayer: 'canonical' };
  readonly normalized: TextRevisionRefV1 & { readonly textLayer: 'normalized' };
}

function indexCurrentTextRevisions(
  values: readonly TextRevisionRefV1[],
  baseline: NovelImportReviewBaselineV1,
): IndexedTextRevisions {
  const revisions = new Map<TextLayerV1, TextRevisionRefV1>();
  for (const value of values) {
    const revision = parseRevision(value);
    if (revisions.has(revision.textLayer))
      fail(`Review snapshot contains duplicate ${revision.textLayer} revision`);
    revisions.set(revision.textLayer, revision);
  }

  const raw = revisions.get('raw');
  const canonical = revisions.get('canonical');
  const normalized = revisions.get('normalized');
  if (raw === undefined || canonical === undefined || normalized === undefined)
    fail('Review snapshot must contain raw, canonical, and normalized revisions');
  if (!sameRevision(canonical, baseline.canonicalTextRevision))
    fail('Review snapshot canonical revision must match its baseline');
  return {
    raw: { ...raw, textLayer: 'raw' },
    canonical: { ...canonical, textLayer: 'canonical' },
    normalized: { ...normalized, textLayer: 'normalized' },
  };
}

function assertLayerDiffs(
  diffs: readonly NovelImportLayerDiffV1[],
  revisions: IndexedTextRevisions,
): void {
  const expected = new Map<string, readonly [TextRevisionRefV1, TextRevisionRefV1]>([
    ['raw:canonical', [revisions.raw, revisions.canonical]],
    ['canonical:normalized', [revisions.canonical, revisions.normalized]],
  ]);

  for (const diff of diffs) {
    const from = parseRevision(diff.fromRevision);
    const to = parseRevision(diff.toRevision);
    const key = `${from.textLayer}:${to.textLayer}`;
    const pair = expected.get(key);
    if (
      pair === undefined
      || !sameRevision(from, pair[0])
      || !sameRevision(to, pair[1])
    ) {
      fail('Layer diffs must describe raw-to-canonical and canonical-to-normalized');
    }
    expected.delete(key);
    assertDiffHunks(diff, from, to);
  }
  if (expected.size !== 0)
    fail('Review snapshot is missing a required layer diff');
}

function assertDiffHunks(
  diff: NovelImportLayerDiffV1,
  from: TextRevisionRefV1,
  to: TextRevisionRefV1,
): void {
  let previousFromEnd = 0;
  let previousToEnd = 0;
  for (const hunk of diff.hunks) {
    const fromRange = parseRange(hunk.fromRange, from);
    const toRange = parseRange(hunk.toRange, to);
    if (
      fromRange.startByte < previousFromEnd
      || toRange.startByte < previousToEnd
    ) {
      fail('Layer diff hunks must be monotonic and non-overlapping');
    }
    previousFromEnd = fromRange.endByte;
    previousToEnd = toRange.endByte;

    if (
      utf8ByteLength(hunk.beforeText) !== rangeLength(fromRange)
      || utf8ByteLength(hunk.afterText) !== rangeLength(toRange)
    ) {
      fail('Layer diff text must match its UTF-8 byte ranges');
    }
    const fromEmpty = rangeLength(fromRange) === 0;
    const toEmpty = rangeLength(toRange) === 0;
    if (
      (hunk.operation === 'insert' && (!fromEmpty || toEmpty))
      || (hunk.operation === 'delete' && (fromEmpty || !toEmpty))
      || (hunk.operation === 'replace' && (fromEmpty || toEmpty))
    ) {
      fail('Layer diff operation must match its empty and non-empty ranges');
    }
  }
}

function assertChapterProjection(
  snapshot: NovelImportReviewSnapshotV1,
  canonicalRevision: TextRevisionRefV1,
): void {
  const active = snapshot.revisionHistory.find(entry => entry.active);
  if (active === undefined)
    fail('Review snapshot revision history must contain an active revision');

  try {
    parseChapterIndexV1({
      documentType: 'chapter-index',
      schemaVersion: NOVEL_IMPORT_SCHEMA_VERSION,
      sourceAssetId: snapshot.source.sourceAssetId,
      sourceHash: snapshot.source.contentHash,
      processorId: active.processorId,
      processorVersion: active.processorVersion,
      textRevision: canonicalRevision,
      candidates: snapshot.chapterCandidates,
      entries: snapshot.chapters,
      coverageReport: snapshot.coverage,
      issues: snapshot.issues,
      reviewStatus: 'not_required',
    });
  } catch (error) {
    fail(errorMessage(error));
  }
}

function assertTableOfContentsEvidence(
  snapshot: NovelImportReviewSnapshotV1,
  canonicalRevision: TextRevisionRefV1,
): void {
  const candidateIds = new Set(
    snapshot.chapterCandidates.map(candidate => candidate.chapterCandidateId),
  );
  const evidenceIds = new Set<string>();
  for (const evidence of snapshot.tableOfContentsEvidence) {
    if (evidenceIds.has(evidence.evidenceId))
      fail(`Duplicate table-of-contents evidenceId ${evidence.evidenceId}`);
    evidenceIds.add(evidence.evidenceId);
    const range = parseRange(evidence.range, canonicalRevision);
    if (range.startByte === range.endByte)
      fail('Table-of-contents evidence range must be non-empty');
    for (const candidateId of evidence.candidateIds) {
      if (!candidateIds.has(candidateId)) {
        fail('Table-of-contents evidence must reference existing candidates');
      }
    }
  }
}

function assertUncoveredRanges(
  snapshot: NovelImportReviewSnapshotV1,
  canonicalRevision: TextRevisionRefV1,
): void {
  if (snapshot.uncoveredRanges.length !== snapshot.coverage.unclassifiedRanges.length) {
    fail('Uncovered range reviews must project every unclassified coverage range');
  }
  for (const [index, uncovered] of snapshot.uncoveredRanges.entries()) {
    const range = parseRange(uncovered.range, canonicalRevision);
    const coverageRange = snapshot.coverage.unclassifiedRanges[index];
    if (coverageRange === undefined || !sameRange(range, coverageRange)) {
      fail('Uncovered range reviews must preserve coverage range order and identity');
    }
  }
}

function assertNormalizationProposals(
  proposals: readonly NovelImportNormalizationProposalV1[],
  canonicalRevision: TextRevisionRefV1,
): void {
  const proposalsById = new Map<string, NovelImportNormalizationProposalV1>();
  for (const proposal of proposals) {
    if (proposalsById.has(proposal.proposalId))
      fail('Normalization proposals must have unique proposalId values');
    proposalsById.set(proposal.proposalId, proposal);
  }

  for (const proposal of proposals) {
    const range = parseRange(proposal.canonicalRange, canonicalRevision);
    if (
      range.startByte === range.endByte
      || utf8ByteLength(proposal.beforeText) !== rangeLength(range)
    ) {
      fail('Normalization proposal text must match its non-empty canonical range');
    }
    if (
      (proposal.operation === 'delete' && proposal.afterText !== '')
      || (proposal.operation === 'replace' && proposal.afterText === '')
    ) {
      fail('Normalization proposal operation must match afterText');
    }
    assertNormalizationReviewFields(proposal);
    for (const conflictId of proposal.conflictProposalIds) {
      const counterpart = proposalsById.get(conflictId);
      if (conflictId === proposal.proposalId || counterpart === undefined) {
        fail('Normalization conflicts must reference a different existing proposal');
      }
      if (!counterpart.conflictProposalIds.includes(proposal.proposalId))
        fail('Normalization proposal conflicts must be reciprocal');
      if (
        (proposal.reviewStatus === 'approved'
          && counterpart.reviewStatus !== 'rejected')
        || (counterpart.reviewStatus === 'approved'
          && proposal.reviewStatus !== 'rejected')
      ) {
        fail('An approved normalization conflict requires its counterpart to be rejected');
      }
    }
  }
}

function assertNormalizationReviewFields(
  proposal: NovelImportNormalizationProposalV1,
): void {
  const hasReviewer = proposal.reviewedBy !== undefined;
  const hasOperator = proposal.operator !== undefined;
  if (proposal.reviewStatus === 'approved') {
    if (!hasReviewer || !hasOperator) {
      fail('Approved normalization proposal requires reviewedBy and operator');
    }
    return;
  }
  if (proposal.reviewStatus === 'rejected') {
    if (!hasReviewer || hasOperator) {
      fail('Rejected normalization proposal requires reviewedBy and no operator');
    }
    return;
  }
  if (hasReviewer || hasOperator) {
    fail('Unreviewed normalization proposal cannot record reviewer or operator');
  }
}

function assertRevisionHistory(
  snapshot: NovelImportReviewSnapshotV1,
  current: IndexedTextRevisions,
): void {
  const revisionIds = new Set<string>();
  let active: NovelImportRevisionHistoryEntryV1 | undefined;
  for (const entry of snapshot.revisionHistory) {
    if (revisionIds.has(entry.artifactRevisionId))
      fail(`Duplicate history artifactRevisionId ${entry.artifactRevisionId}`);
    revisionIds.add(entry.artifactRevisionId);
    assertHistoryTextLayer(entry.rawTextRevision, 'raw');
    assertHistoryTextLayer(entry.canonicalTextRevision, 'canonical');
    assertHistoryTextLayer(entry.normalizedTextRevision, 'normalized');
    if (entry.active) {
      if (active !== undefined)
        fail('Review snapshot must have exactly one active history revision');
      active = entry;
    }
  }
  if (active === undefined)
    fail('Review snapshot must have exactly one active history revision');
  if (
    active.artifactId !== snapshot.baselineRevision.artifactId
    || active.artifactRevisionId !== snapshot.baselineRevision.artifactRevisionId
    || active.sourceAssetId !== snapshot.source.sourceAssetId
    || active.sourceHash !== snapshot.source.contentHash
    || !sameRevision(active.rawTextRevision, current.raw)
    || !sameRevision(active.canonicalTextRevision, current.canonical)
    || !sameRevision(active.normalizedTextRevision, current.normalized)
  ) {
    fail('Active revision history entry must match the review snapshot baseline');
  }
}

function assertHistoryTextLayer(
  value: TextRevisionRefV1,
  expectedLayer: TextLayerV1,
): void {
  const revision = parseRevision(value);
  if (revision.textLayer !== expectedLayer)
    fail(`Revision history entry must use the ${expectedLayer} text layer`);
}

function createNovelImportReviewValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(TEXT_REFERENCE_SCHEMA);
  ajv.addSchema(NOVEL_IMPORT_SCHEMA);
  ajv.addSchema(NOVEL_IMPORT_REVIEW_SCHEMA);
  return {
    ajv,
    document: getSchema(ajv, NOVEL_IMPORT_REVIEW_SCHEMA.$id),
    query: getSchema(
      ajv,
      `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/reviewQueryV1`,
    ),
    command: getSchema(
      ajv,
      `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/reviewCommandV1`,
    ),
    snapshot: getSchema(
      ajv,
      `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/reviewSnapshotV1`,
    ),
    staleQuery: getSchema(
      ajv,
      `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/stalePreviewQueryV1`,
    ),
    stalePreview: getSchema(
      ajv,
      `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/stalePreviewV1`,
    ),
  };
}

function getSchema(ajv: InstanceType<typeof Ajv2020>, reference: string) {
  const validate = ajv.getSchema(reference);
  if (validate === undefined)
    throw new Error(`Missing JSON Schema validator: ${reference}`);
  return validate;
}

function validateSchema(
  value: unknown,
  validate: ValidateFunction,
  dataVar: string,
): void {
  if (validate(value))
    return;
  fail(validators.ajv.errorsText(validate.errors, { dataVar }));
}

function parseRevision(value: unknown): TextRevisionRefV1 {
  try {
    return parseTextRevisionRefV1(value);
  } catch (error) {
    fail(errorMessage(error));
  }
}

function parseRange(
  value: unknown,
  revision: TextRevisionRefV1,
): TextRangeV1 {
  try {
    return parseTextRangeV1(value, { revision });
  } catch (error) {
    fail(errorMessage(error));
  }
}

function sameRevision(left: TextRevisionRefV1, right: TextRevisionRefV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.contentHash === right.contentHash
    && left.byteLength === right.byteLength;
}

function sameRange(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.offsetUnit === right.offsetUnit
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function rangeLength(range: TextRangeV1): number {
  return range.endByte - range.startByte;
}

function utf8ByteLength(text: string): number {
  let byteLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    const codeUnit = text.charCodeAt(index);
    if (codeUnit <= 0x7F) {
      byteLength += 1;
    } else if (codeUnit <= 0x7FF) {
      byteLength += 2;
    } else if (
      codeUnit >= 0xD800
      && codeUnit <= 0xDBFF
      && index + 1 < text.length
      && text.charCodeAt(index + 1) >= 0xDC00
      && text.charCodeAt(index + 1) <= 0xDFFF
    ) {
      byteLength += 4;
      index += 1;
    } else {
      byteLength += 3;
    }
  }
  return byteLength;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'Invalid novel import review data';
}

function fail(message: string): never {
  throw new NovelImportReviewValidationError(message);
}
