import type { ValidateFunction } from 'ajv';

import type {
  TextRangeV1,
  TextRangeValidationContextV1,
  TextRevisionRefV1,
} from './text.js';
import type { ReviewStatus } from './workflow.js';

import Ajv2020Module from 'ajv/dist/2020.js';

import {
  parseTextRangeV1,
  parseTextRevisionRefV1,
  TEXT_REFERENCE_SCHEMA,
} from './text.js';

const Ajv2020 = Ajv2020Module.default;

export const NOVEL_IMPORT_SCHEMA_VERSION = 1 as const;
export const BLOCK_ALIGNMENT_POLICY_VERSION = 'm1-block-alignment-v1' as const;

export const NOVEL_SOURCE_FORMATS = [
  'txt',
  'epub',
  'markdown',
  'unknown',
] as const;

export type NovelSourceFormat = typeof NOVEL_SOURCE_FORMATS[number];

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

export const NOVEL_IMPORT_ERROR_CODES = [
  'NOVEL_IMPORT_UNSUPPORTED_FORMAT',
  'NOVEL_IMPORT_INVALID_SOURCE',
  'NOVEL_IMPORT_ENCODING_REQUIRED',
  'NOVEL_IMPORT_STRUCTURE_INVALID',
  'NOVEL_IMPORT_REVIEW_REQUIRED',
  'NOVEL_IMPORT_STALE_SESSION',
  'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  'NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED',
  'NOVEL_IMPORT_BUDGET_INVALID',
] as const;

export type NovelImportErrorCode = typeof NOVEL_IMPORT_ERROR_CODES[number];
export type ImportIssueSeverityV1 = 'info' | 'warning' | 'error';

export interface SourceByteRangeV1 {
  readonly offsetUnit: 'source-byte';
  readonly startByte: number;
  readonly endByte: number;
}

export interface SourceLineRangeV1 {
  readonly lineBase: 1;
  readonly startLine: number;
  readonly endLineExclusive: number;
}

export type TxtEncodingDecisionMethodV1 = 'bom' | 'strict-utf8' | 'user';

export type TxtEncodingDecisionV1
  = | {
    readonly sourceContentHash: string;
    readonly sourceEncoding: 'utf-8' | 'utf-16le' | 'utf-16be';
    readonly method: 'bom';
  }
  | {
    readonly sourceContentHash: string;
    readonly sourceEncoding: 'utf-8';
    readonly method: 'strict-utf8';
  }
  | {
    readonly sourceContentHash: string;
    readonly sourceEncoding: UserSelectedTxtSourceEncoding;
    readonly method: 'user';
  };

export interface TxtSourceLocatorV1 {
  readonly sourceAssetId: string;
  readonly sourceContentHash: string;
  readonly sourceEncoding: TxtSourceEncoding;
  readonly sourceByteRange: SourceByteRangeV1;
  readonly rawTextRange: TextRangeV1;
  readonly lineRange: SourceLineRangeV1;
}

export interface NovelMetadataV1Fields {
  readonly title?: string;
  readonly author?: string;
  readonly language?: string;
}

export type NovelMetadataV1
  = NovelMetadataV1Fields & Record<string, unknown>;

export type DocumentBlockKindV1
  = | 'heading'
    | 'paragraph'
    | 'quote'
    | 'list'
    | 'separator'
    | 'unknown';

export interface DocumentBlockV1 {
  readonly blockId: string;
  readonly kind: DocumentBlockKindV1;
  readonly rawText: string;
  readonly sourceLocator: TxtSourceLocatorV1;
  readonly contentHash: string;
}

export interface StructuralHintV1 {
  readonly kind: string;
  readonly rawValue: string;
  readonly sourceLocator: TxtSourceLocatorV1;
  readonly reviewStatus: ReviewStatus;
}

export interface ImportIssueV1Fields {
  readonly issueId: string;
  readonly code: string;
  readonly severity: ImportIssueSeverityV1;
  readonly reviewStatus: ReviewStatus;
  readonly message: string;
  readonly errorCode?: NovelImportErrorCode;
  readonly detailReason?: string;
  readonly textRange?: TextRangeV1;
  readonly sourceLocator?: TxtSourceLocatorV1;
  readonly sourceEncoding?: TxtSourceEncoding;
  readonly sourceByteRange?: SourceByteRangeV1;
}

export type ImportIssueV1
  = ImportIssueV1Fields & Record<string, unknown>;

export interface ImportedNovelV1Fields {
  readonly documentType: 'imported-novel';
  readonly schemaVersion: typeof NOVEL_IMPORT_SCHEMA_VERSION;
  readonly sourceAssetId: string;
  readonly sourceHash: string;
  readonly sourceByteLength: number;
  readonly sourceFormat: 'txt';
  readonly encodingDecision: TxtEncodingDecisionV1;
  readonly adapterId: string;
  readonly adapterVersion: string;
  readonly processorId: string;
  readonly processorVersion: string;
  readonly alignmentPolicyVersion: typeof BLOCK_ALIGNMENT_POLICY_VERSION;
  readonly rawTextRevision: TextRevisionRefV1 & { readonly textLayer: 'raw' };
  readonly metadata: NovelMetadataV1;
  readonly orderedBlocks: readonly DocumentBlockV1[];
  readonly structuralHints: readonly StructuralHintV1[];
  readonly warnings: readonly ImportIssueV1[];
  readonly reviewStatus: ReviewStatus;
}

export type ImportedNovelV1
  = ImportedNovelV1Fields & Record<string, unknown>;

export interface ChapterCandidateV1 {
  readonly chapterCandidateId: string;
  readonly headingRange: TextRangeV1;
  readonly lineRange: SourceLineRangeV1;
  readonly rawTitle: string;
  readonly normalizedTitle: string;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly ruleConfidence: number;
  readonly confidenceSource: string;
  readonly evidence: readonly string[];
  readonly contextBefore: readonly string[];
  readonly contextAfter: readonly string[];
  readonly reviewStatus: ReviewStatus;
}

export interface ChapterIndexEntryV1 {
  readonly chapterId: string;
  readonly order: number;
  readonly volumeId?: string;
  readonly volumeNumber?: string;
  readonly chapterNumber?: string;
  readonly title: string;
  readonly rawHeading: string;
  readonly headingRange: TextRangeV1;
  readonly contentRange: TextRangeV1;
  readonly sourceLineRange: SourceLineRangeV1;
  readonly confidence: number;
  readonly detectedBy: string;
  readonly reviewStatus: ReviewStatus;
}

export type CoverageClassificationV1
  = | 'front_matter'
    | 'chapter'
    | 'appendix'
    | 'noise'
    | 'unknown';

export interface ChapterCoverageSegmentV1 {
  readonly classification: 'chapter';
  readonly range: TextRangeV1;
  readonly chapterId: string;
}

export interface NonChapterCoverageSegmentV1 {
  readonly classification: Exclude<CoverageClassificationV1, 'chapter'>;
  readonly range: TextRangeV1;
  readonly chapterId?: never;
}

export type CoverageSegmentV1
  = ChapterCoverageSegmentV1 | NonChapterCoverageSegmentV1;

export interface CoverageReportV1 {
  readonly textRevisionId: string;
  readonly textLayer: 'canonical';
  readonly totalByteLength: number;
  readonly classifiedByteLength: number;
  readonly unclassifiedByteLength: number;
  readonly complete: boolean;
  readonly segments: readonly CoverageSegmentV1[];
  readonly unclassifiedRanges: readonly TextRangeV1[];
}

export interface ChapterIndexV1Fields {
  readonly documentType: 'chapter-index';
  readonly schemaVersion: typeof NOVEL_IMPORT_SCHEMA_VERSION;
  readonly sourceAssetId: string;
  readonly sourceHash: string;
  readonly processorId: string;
  readonly processorVersion: string;
  readonly textRevision: TextRevisionRefV1 & { readonly textLayer: 'canonical' };
  readonly candidates: readonly ChapterCandidateV1[];
  readonly entries: readonly ChapterIndexEntryV1[];
  readonly coverageReport: CoverageReportV1;
  readonly issues: readonly ImportIssueV1[];
  readonly reviewStatus: ReviewStatus;
}

export type ChapterIndexV1
  = ChapterIndexV1Fields & Record<string, unknown>;

export const SCENE_BOUNDARY_REASONS_V1 = [
  'explicit_separator',
  'time_change',
  'location_change',
  'viewpoint_change',
  'event_change',
  'memory_transition',
  'dream_transition',
] as const;

export type SceneBoundaryReasonV1
  = typeof SCENE_BOUNDARY_REASONS_V1[number];

export interface SceneBoundaryCandidateV1 {
  readonly sceneBoundaryCandidateId: string;
  readonly chapterId: string;
  readonly blockId: string;
  readonly reasons: readonly SceneBoundaryReasonV1[];
  readonly evidenceRange: TextRangeV1;
  readonly proposedBoundary: TextRangeV1;
  readonly appliedBoundary?: TextRangeV1;
  readonly sourceLocator: TxtSourceLocatorV1;
  readonly ruleId: string;
  readonly ruleVersion: string;
  readonly evidence: readonly string[];
  readonly reviewStatus: ReviewStatus;
}

export interface SceneBlockReferenceV1 {
  readonly blockId: string;
  readonly range: TextRangeV1;
  readonly sourceLocator: TxtSourceLocatorV1;
}

/** The only formal Scene representation in the public novel structure contract. */
export interface SceneV1 {
  readonly sceneId: string;
  readonly chapterId: string;
  readonly order: number;
  readonly range: TextRangeV1;
  readonly startBoundaryCandidateId?: string;
  readonly blockReferences: readonly SceneBlockReferenceV1[];
}

export interface SceneIssueV1Fields extends ImportIssueV1Fields {
  readonly chapterId: string;
  readonly blockId?: string;
  readonly sceneBoundaryCandidateId?: string;
}

export type SceneIssueV1
  = SceneIssueV1Fields & Record<string, unknown>;

export interface SceneIndexV1Fields {
  readonly documentType: 'scene-index';
  readonly schemaVersion: typeof NOVEL_IMPORT_SCHEMA_VERSION;
  readonly sourceAssetId: string;
  readonly sourceHash: string;
  readonly processorId: string;
  readonly processorVersion: string;
  readonly textRevision: TextRevisionRefV1 & { readonly textLayer: 'canonical' };
  readonly candidates: readonly SceneBoundaryCandidateV1[];
  readonly scenes: readonly SceneV1[];
  readonly issues: readonly SceneIssueV1[];
  readonly reviewStatus: ReviewStatus;
}

export type SceneIndexV1
  = SceneIndexV1Fields & Record<string, unknown>;

export type NovelImportDocumentV1
  = ChapterIndexV1 | ImportedNovelV1 | SceneIndexV1;

export interface TxtSourceLocatorValidationContextV1 {
  readonly sourceAssetId: string;
  readonly sourceContentHash: string;
  readonly sourceByteLength: number;
  readonly sourceEncoding: TxtSourceEncoding;
  readonly rawTextRevision: TextRevisionRefV1 & { readonly textLayer: 'raw' };
  readonly rawUtf8Bytes?: Uint8Array;
}

export interface ImportedNovelValidationContextV1 {
  readonly sha256Utf8: (text: string) => string;
  readonly sha256Utf8Parts: (parts: Iterable<string>) => string;
}

const MAX_SAFE_INTEGER = Number.MAX_SAFE_INTEGER;
const UUID_V4_PATTERN
  = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const SHA256_PATTERN = '^[0-9a-f]{64}$';
const UUID_V4 = { type: 'string', pattern: UUID_V4_PATTERN } as const;
const SHA256 = { type: 'string', pattern: SHA256_PATTERN } as const;
const NON_EMPTY_STRING = { type: 'string', minLength: 1 } as const;
const SAFE_NON_NEGATIVE_INTEGER = {
  type: 'integer',
  minimum: 0,
  maximum: MAX_SAFE_INTEGER,
} as const;
const SAFE_POSITIVE_INTEGER = {
  type: 'integer',
  minimum: 1,
  maximum: MAX_SAFE_INTEGER,
} as const;
const REVIEW_STATUS_SCHEMA = {
  type: 'string',
  enum: ['not_required', 'pending', 'approved', 'rejected'],
} as const;
const TXT_ENCODING_SCHEMA = {
  type: 'string',
  enum: TXT_SOURCE_ENCODINGS,
} as const;
const NOVEL_IMPORT_ERROR_CODE_SCHEMA = {
  type: 'string',
  enum: NOVEL_IMPORT_ERROR_CODES,
} as const;
const TEXT_RANGE_V1_REF
  = `${TEXT_REFERENCE_SCHEMA.$id}#/$defs/textRangeV1` as const;
const TEXT_REVISION_REF_V1_REF
  = `${TEXT_REFERENCE_SCHEMA.$id}#/$defs/textRevisionRefV1` as const;

const SOURCE_BYTE_RANGE_V1_SCHEMA = {
  type: 'object',
  required: ['offsetUnit', 'startByte', 'endByte'],
  properties: {
    offsetUnit: { const: 'source-byte' },
    startByte: SAFE_NON_NEGATIVE_INTEGER,
    endByte: SAFE_NON_NEGATIVE_INTEGER,
  },
  additionalProperties: false,
} as const;

const SOURCE_LINE_RANGE_V1_SCHEMA = {
  type: 'object',
  required: ['lineBase', 'startLine', 'endLineExclusive'],
  properties: {
    lineBase: { const: 1 },
    startLine: SAFE_POSITIVE_INTEGER,
    endLineExclusive: SAFE_POSITIVE_INTEGER,
  },
  additionalProperties: false,
} as const;

const TXT_ENCODING_DECISION_V1_SCHEMA = {
  type: 'object',
  required: ['sourceContentHash', 'sourceEncoding', 'method'],
  properties: {
    sourceContentHash: SHA256,
    sourceEncoding: TXT_ENCODING_SCHEMA,
    method: {
      type: 'string',
      enum: ['bom', 'strict-utf8', 'user'],
    },
  },
  oneOf: [
    {
      properties: {
        method: { const: 'bom' },
        sourceEncoding: {
          type: 'string',
          enum: ['utf-8', 'utf-16le', 'utf-16be'],
        },
      },
    },
    {
      properties: {
        method: { const: 'strict-utf8' },
        sourceEncoding: { const: 'utf-8' },
      },
    },
    {
      properties: {
        method: { const: 'user' },
        sourceEncoding: {
          type: 'string',
          enum: ['gbk', 'gb18030', 'big5', 'utf-16le', 'utf-16be'],
        },
      },
    },
  ],
  additionalProperties: false,
} as const;

const TXT_SOURCE_LOCATOR_V1_SCHEMA = {
  type: 'object',
  required: [
    'sourceAssetId',
    'sourceContentHash',
    'sourceEncoding',
    'sourceByteRange',
    'rawTextRange',
    'lineRange',
  ],
  properties: {
    sourceAssetId: UUID_V4,
    sourceContentHash: SHA256,
    sourceEncoding: TXT_ENCODING_SCHEMA,
    sourceByteRange: { $ref: '#/$defs/sourceByteRangeV1' },
    rawTextRange: { $ref: TEXT_RANGE_V1_REF },
    lineRange: { $ref: '#/$defs/sourceLineRangeV1' },
  },
  additionalProperties: false,
} as const;

const NOVEL_METADATA_V1_SCHEMA = {
  type: 'object',
  properties: {
    title: NON_EMPTY_STRING,
    author: NON_EMPTY_STRING,
    language: NON_EMPTY_STRING,
  },
  additionalProperties: true,
} as const;

const DOCUMENT_BLOCK_V1_SCHEMA = {
  type: 'object',
  required: ['blockId', 'kind', 'rawText', 'sourceLocator', 'contentHash'],
  properties: {
    blockId: UUID_V4,
    kind: {
      type: 'string',
      enum: ['heading', 'paragraph', 'quote', 'list', 'separator', 'unknown'],
    },
    rawText: NON_EMPTY_STRING,
    sourceLocator: { $ref: '#/$defs/txtSourceLocatorV1' },
    contentHash: SHA256,
  },
  additionalProperties: false,
} as const;

const STRUCTURAL_HINT_V1_SCHEMA = {
  type: 'object',
  required: ['kind', 'rawValue', 'sourceLocator', 'reviewStatus'],
  properties: {
    kind: NON_EMPTY_STRING,
    rawValue: { type: 'string' },
    sourceLocator: { $ref: '#/$defs/txtSourceLocatorV1' },
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  additionalProperties: false,
} as const;

const IMPORT_ISSUE_V1_SCHEMA = {
  type: 'object',
  required: ['issueId', 'code', 'severity', 'reviewStatus', 'message'],
  properties: {
    issueId: UUID_V4,
    code: NON_EMPTY_STRING,
    severity: {
      type: 'string',
      enum: ['info', 'warning', 'error'],
    },
    reviewStatus: REVIEW_STATUS_SCHEMA,
    message: NON_EMPTY_STRING,
    errorCode: NOVEL_IMPORT_ERROR_CODE_SCHEMA,
    detailReason: NON_EMPTY_STRING,
    textRange: { $ref: TEXT_RANGE_V1_REF },
    sourceLocator: { $ref: '#/$defs/txtSourceLocatorV1' },
    sourceEncoding: TXT_ENCODING_SCHEMA,
    sourceByteRange: { $ref: '#/$defs/sourceByteRangeV1' },
  },
  additionalProperties: true,
} as const;

const IMPORTED_NOVEL_V1_SCHEMA = {
  type: 'object',
  required: [
    'documentType',
    'schemaVersion',
    'sourceAssetId',
    'sourceHash',
    'sourceByteLength',
    'sourceFormat',
    'encodingDecision',
    'adapterId',
    'adapterVersion',
    'processorId',
    'processorVersion',
    'alignmentPolicyVersion',
    'rawTextRevision',
    'metadata',
    'orderedBlocks',
    'structuralHints',
    'warnings',
    'reviewStatus',
  ],
  properties: {
    documentType: { const: 'imported-novel' },
    schemaVersion: {
      type: 'integer',
      const: NOVEL_IMPORT_SCHEMA_VERSION,
    },
    sourceAssetId: UUID_V4,
    sourceHash: SHA256,
    sourceByteLength: SAFE_NON_NEGATIVE_INTEGER,
    sourceFormat: { const: 'txt' },
    encodingDecision: { $ref: '#/$defs/txtEncodingDecisionV1' },
    adapterId: NON_EMPTY_STRING,
    adapterVersion: NON_EMPTY_STRING,
    processorId: NON_EMPTY_STRING,
    processorVersion: NON_EMPTY_STRING,
    alignmentPolicyVersion: { const: BLOCK_ALIGNMENT_POLICY_VERSION },
    rawTextRevision: { $ref: TEXT_REVISION_REF_V1_REF },
    metadata: { $ref: '#/$defs/novelMetadataV1' },
    orderedBlocks: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/documentBlockV1' },
    },
    structuralHints: {
      type: 'array',
      items: { $ref: '#/$defs/structuralHintV1' },
    },
    warnings: {
      type: 'array',
      items: { $ref: '#/$defs/importIssueV1' },
    },
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  additionalProperties: true,
} as const;

const CHAPTER_CANDIDATE_V1_SCHEMA = {
  type: 'object',
  required: [
    'chapterCandidateId',
    'headingRange',
    'lineRange',
    'rawTitle',
    'normalizedTitle',
    'ruleId',
    'ruleVersion',
    'ruleConfidence',
    'confidenceSource',
    'evidence',
    'contextBefore',
    'contextAfter',
    'reviewStatus',
  ],
  properties: {
    chapterCandidateId: UUID_V4,
    headingRange: { $ref: TEXT_RANGE_V1_REF },
    lineRange: { $ref: '#/$defs/sourceLineRangeV1' },
    rawTitle: NON_EMPTY_STRING,
    normalizedTitle: NON_EMPTY_STRING,
    ruleId: NON_EMPTY_STRING,
    ruleVersion: NON_EMPTY_STRING,
    ruleConfidence: { type: 'number', minimum: 0, maximum: 1 },
    confidenceSource: NON_EMPTY_STRING,
    evidence: {
      type: 'array',
      minItems: 1,
      items: NON_EMPTY_STRING,
    },
    contextBefore: {
      type: 'array',
      items: { type: 'string' },
    },
    contextAfter: {
      type: 'array',
      items: { type: 'string' },
    },
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  additionalProperties: false,
} as const;

const CHAPTER_INDEX_ENTRY_V1_SCHEMA = {
  type: 'object',
  required: [
    'chapterId',
    'order',
    'title',
    'rawHeading',
    'headingRange',
    'contentRange',
    'sourceLineRange',
    'confidence',
    'detectedBy',
    'reviewStatus',
  ],
  properties: {
    chapterId: UUID_V4,
    order: SAFE_NON_NEGATIVE_INTEGER,
    volumeId: UUID_V4,
    volumeNumber: NON_EMPTY_STRING,
    chapterNumber: NON_EMPTY_STRING,
    title: NON_EMPTY_STRING,
    rawHeading: NON_EMPTY_STRING,
    headingRange: { $ref: TEXT_RANGE_V1_REF },
    contentRange: { $ref: TEXT_RANGE_V1_REF },
    sourceLineRange: { $ref: '#/$defs/sourceLineRangeV1' },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    detectedBy: NON_EMPTY_STRING,
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  additionalProperties: false,
} as const;

const COVERAGE_SEGMENT_V1_SCHEMA = {
  type: 'object',
  required: ['classification', 'range'],
  properties: {
    classification: {
      type: 'string',
      enum: [
        'front_matter',
        'chapter',
        'appendix',
        'noise',
        'unknown',
      ],
    },
    range: { $ref: TEXT_RANGE_V1_REF },
    chapterId: UUID_V4,
  },
  oneOf: [
    {
      properties: { classification: { const: 'chapter' } },
      required: ['chapterId'],
    },
    {
      properties: {
        classification: {
          type: 'string',
          enum: [
            'front_matter',
            'appendix',
            'noise',
            'unknown',
          ],
        },
      },
      not: { required: ['chapterId'] },
    },
  ],
  additionalProperties: false,
} as const;

const COVERAGE_REPORT_V1_SCHEMA = {
  type: 'object',
  required: [
    'textRevisionId',
    'textLayer',
    'totalByteLength',
    'classifiedByteLength',
    'unclassifiedByteLength',
    'complete',
    'segments',
    'unclassifiedRanges',
  ],
  properties: {
    textRevisionId: UUID_V4,
    textLayer: { const: 'canonical' },
    totalByteLength: SAFE_NON_NEGATIVE_INTEGER,
    classifiedByteLength: SAFE_NON_NEGATIVE_INTEGER,
    unclassifiedByteLength: SAFE_NON_NEGATIVE_INTEGER,
    complete: { type: 'boolean' },
    segments: {
      type: 'array',
      items: { $ref: '#/$defs/coverageSegmentV1' },
    },
    unclassifiedRanges: {
      type: 'array',
      items: { $ref: TEXT_RANGE_V1_REF },
    },
  },
  additionalProperties: false,
} as const;

const CHAPTER_INDEX_V1_SCHEMA = {
  type: 'object',
  required: [
    'documentType',
    'schemaVersion',
    'sourceAssetId',
    'sourceHash',
    'processorId',
    'processorVersion',
    'textRevision',
    'candidates',
    'entries',
    'coverageReport',
    'issues',
    'reviewStatus',
  ],
  properties: {
    documentType: { const: 'chapter-index' },
    schemaVersion: {
      type: 'integer',
      const: NOVEL_IMPORT_SCHEMA_VERSION,
    },
    sourceAssetId: UUID_V4,
    sourceHash: SHA256,
    processorId: NON_EMPTY_STRING,
    processorVersion: NON_EMPTY_STRING,
    textRevision: { $ref: TEXT_REVISION_REF_V1_REF },
    candidates: {
      type: 'array',
      items: { $ref: '#/$defs/chapterCandidateV1' },
    },
    entries: {
      type: 'array',
      items: { $ref: '#/$defs/chapterIndexEntryV1' },
    },
    coverageReport: { $ref: '#/$defs/coverageReportV1' },
    issues: {
      type: 'array',
      items: { $ref: '#/$defs/importIssueV1' },
    },
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  additionalProperties: true,
} as const;

const SCENE_BOUNDARY_CANDIDATE_V1_SCHEMA = {
  type: 'object',
  required: [
    'sceneBoundaryCandidateId',
    'chapterId',
    'blockId',
    'reasons',
    'evidenceRange',
    'proposedBoundary',
    'sourceLocator',
    'ruleId',
    'ruleVersion',
    'evidence',
    'reviewStatus',
  ],
  properties: {
    sceneBoundaryCandidateId: UUID_V4,
    chapterId: UUID_V4,
    blockId: UUID_V4,
    reasons: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: {
        type: 'string',
        enum: SCENE_BOUNDARY_REASONS_V1,
      },
    },
    evidenceRange: { $ref: TEXT_RANGE_V1_REF },
    proposedBoundary: { $ref: TEXT_RANGE_V1_REF },
    appliedBoundary: { $ref: TEXT_RANGE_V1_REF },
    sourceLocator: { $ref: '#/$defs/txtSourceLocatorV1' },
    ruleId: NON_EMPTY_STRING,
    ruleVersion: NON_EMPTY_STRING,
    evidence: {
      type: 'array',
      minItems: 1,
      items: NON_EMPTY_STRING,
    },
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  oneOf: [
    {
      properties: {
        reviewStatus: {
          type: 'string',
          enum: ['not_required', 'approved'],
        },
      },
      required: ['appliedBoundary'],
    },
    {
      properties: {
        reviewStatus: {
          type: 'string',
          enum: ['pending', 'rejected'],
        },
      },
      not: { required: ['appliedBoundary'] },
    },
  ],
  additionalProperties: false,
} as const;

const SCENE_BLOCK_REFERENCE_V1_SCHEMA = {
  type: 'object',
  required: ['blockId', 'range', 'sourceLocator'],
  properties: {
    blockId: UUID_V4,
    range: { $ref: TEXT_RANGE_V1_REF },
    sourceLocator: { $ref: '#/$defs/txtSourceLocatorV1' },
  },
  additionalProperties: false,
} as const;

const SCENE_V1_SCHEMA = {
  type: 'object',
  required: ['sceneId', 'chapterId', 'order', 'range', 'blockReferences'],
  properties: {
    sceneId: UUID_V4,
    chapterId: UUID_V4,
    order: SAFE_NON_NEGATIVE_INTEGER,
    range: { $ref: TEXT_RANGE_V1_REF },
    startBoundaryCandidateId: UUID_V4,
    blockReferences: {
      type: 'array',
      minItems: 1,
      items: { $ref: '#/$defs/sceneBlockReferenceV1' },
    },
  },
  additionalProperties: false,
} as const;

const SCENE_ISSUE_V1_SCHEMA = {
  type: 'object',
  required: [
    'issueId',
    'code',
    'severity',
    'reviewStatus',
    'message',
    'chapterId',
  ],
  properties: {
    ...IMPORT_ISSUE_V1_SCHEMA.properties,
    chapterId: UUID_V4,
    blockId: UUID_V4,
    sceneBoundaryCandidateId: UUID_V4,
  },
  additionalProperties: true,
} as const;

const SCENE_INDEX_V1_SCHEMA = {
  type: 'object',
  required: [
    'documentType',
    'schemaVersion',
    'sourceAssetId',
    'sourceHash',
    'processorId',
    'processorVersion',
    'textRevision',
    'candidates',
    'scenes',
    'issues',
    'reviewStatus',
  ],
  properties: {
    documentType: { const: 'scene-index' },
    schemaVersion: {
      type: 'integer',
      const: NOVEL_IMPORT_SCHEMA_VERSION,
    },
    sourceAssetId: UUID_V4,
    sourceHash: SHA256,
    processorId: NON_EMPTY_STRING,
    processorVersion: NON_EMPTY_STRING,
    textRevision: { $ref: TEXT_REVISION_REF_V1_REF },
    candidates: {
      type: 'array',
      items: { $ref: '#/$defs/sceneBoundaryCandidateV1' },
    },
    scenes: {
      type: 'array',
      items: { $ref: '#/$defs/sceneV1' },
    },
    issues: {
      type: 'array',
      items: { $ref: '#/$defs/sceneIssueV1' },
    },
    reviewStatus: REVIEW_STATUS_SCHEMA,
  },
  additionalProperties: true,
} as const;

export const NOVEL_IMPORT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/novel-import.schema.json',
  title: 'VoxWeaver novel import and structure documents',
  type: 'object',
  oneOf: [
    { $ref: '#/$defs/importedNovelV1' },
    { $ref: '#/$defs/chapterIndexV1' },
    { $ref: '#/$defs/sceneIndexV1' },
  ],
  additionalProperties: true,
  $defs: {
    sourceByteRangeV1: SOURCE_BYTE_RANGE_V1_SCHEMA,
    sourceLineRangeV1: SOURCE_LINE_RANGE_V1_SCHEMA,
    txtEncodingDecisionV1: TXT_ENCODING_DECISION_V1_SCHEMA,
    txtSourceLocatorV1: TXT_SOURCE_LOCATOR_V1_SCHEMA,
    novelMetadataV1: NOVEL_METADATA_V1_SCHEMA,
    documentBlockV1: DOCUMENT_BLOCK_V1_SCHEMA,
    structuralHintV1: STRUCTURAL_HINT_V1_SCHEMA,
    importIssueV1: IMPORT_ISSUE_V1_SCHEMA,
    importedNovelV1: IMPORTED_NOVEL_V1_SCHEMA,
    chapterCandidateV1: CHAPTER_CANDIDATE_V1_SCHEMA,
    chapterIndexEntryV1: CHAPTER_INDEX_ENTRY_V1_SCHEMA,
    coverageSegmentV1: COVERAGE_SEGMENT_V1_SCHEMA,
    coverageReportV1: COVERAGE_REPORT_V1_SCHEMA,
    chapterIndexV1: CHAPTER_INDEX_V1_SCHEMA,
    sceneBoundaryCandidateV1: SCENE_BOUNDARY_CANDIDATE_V1_SCHEMA,
    sceneBlockReferenceV1: SCENE_BLOCK_REFERENCE_V1_SCHEMA,
    sceneV1: SCENE_V1_SCHEMA,
    sceneIssueV1: SCENE_ISSUE_V1_SCHEMA,
    sceneIndexV1: SCENE_INDEX_V1_SCHEMA,
  },
} as const;

const validators = createNovelImportValidators();

export class NovelImportValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_CONTRACT_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'NovelImportValidationError';
  }
}

export function parseNovelImportDocumentV1(
  value: unknown,
  context?: ImportedNovelValidationContextV1,
): NovelImportDocumentV1 {
  validateSchema(value, validators.document, 'Novel import document');
  const document = value as NovelImportDocumentV1;
  if (document.documentType === 'chapter-index')
    return parseChapterIndexV1(document);
  if (document.documentType === 'scene-index')
    return parseSceneIndexV1(document);
  if (context === undefined)
    fail('ImportedNovel validation requires synchronous SHA-256 context functions');
  return parseImportedNovelV1(document, context);
}

export function parseImportedNovelV1(
  value: unknown,
  context: ImportedNovelValidationContextV1,
): ImportedNovelV1 {
  validateSchema(value, validators.importedNovel, 'Imported novel');
  const importedNovel = value as ImportedNovelV1;
  const rawTextRevision = parseNovelTextRevision(importedNovel.rawTextRevision);

  if (rawTextRevision.textLayer !== 'raw')
    fail('Imported novel rawTextRevision must use the raw text layer');

  if (importedNovel.encodingDecision.sourceContentHash !== importedNovel.sourceHash) {
    fail(
      'Imported novel encoding decision must be bound to the current source hash',
    );
  }

  const locatorContext: TxtSourceLocatorValidationContextV1 = {
    sourceAssetId: importedNovel.sourceAssetId,
    sourceContentHash: importedNovel.sourceHash,
    sourceByteLength: importedNovel.sourceByteLength,
    sourceEncoding: importedNovel.encodingDecision.sourceEncoding,
    rawTextRevision: { ...rawTextRevision, textLayer: 'raw' },
  };
  const blockIds = new Set<string>();
  const exactLocators = new Set<string>();
  let previousSourceEnd = 0;
  let previousRawEnd = 0;
  let rawTextByteLength = 0;

  for (const block of importedNovel.orderedBlocks) {
    if (blockIds.has(block.blockId))
      fail(`Imported novel contains duplicate blockId ${block.blockId}`);
    blockIds.add(block.blockId);

    const locator = parseTxtSourceLocatorV1(block.sourceLocator, locatorContext);
    const exactLocator = getTxtExactLocatorKeyV1(locator);
    if (exactLocators.has(exactLocator)) {
      fail(
        'Imported novel contains duplicate TXT exact-locator projections',
      );
    }
    exactLocators.add(exactLocator);

    if (locator.sourceByteRange.startByte !== previousSourceEnd) {
      fail(
        'Imported novel block source ranges must cover the source without gaps or overlaps',
      );
    }
    previousSourceEnd = locator.sourceByteRange.endByte;

    if (locator.rawTextRange.startByte !== previousRawEnd) {
      fail('Imported novel block raw ranges must cover the raw revision without gaps or overlaps');
    }
    previousRawEnd = locator.rawTextRange.endByte;

    if (utf8ByteLength(block.rawText) !== rangeByteLength(locator.rawTextRange)) {
      fail('DocumentBlock rawText UTF-8 byte length must equal rawTextRange length');
    }

    const blockContentHash = computeContextHash(context, block.rawText);
    if (blockContentHash !== block.contentHash)
      fail('DocumentBlock contentHash must equal the exact rawText UTF-8 SHA-256');
    rawTextByteLength += rangeByteLength(locator.rawTextRange);
  }

  if (previousSourceEnd !== importedNovel.sourceByteLength)
    fail('Imported novel blocks must cover the entire immutable source byte range');
  if (previousRawEnd !== rawTextRevision.byteLength)
    fail('Imported novel blocks must cover the entire raw text revision');
  if (rawTextByteLength !== rawTextRevision.byteLength)
    fail('Imported novel block UTF-8 byte lengths must equal the raw revision byte length');

  const rawRevisionHash = computeContextPartsHash(
    context,
    iterateBlockRawText(importedNovel.orderedBlocks),
  );
  if (rawRevisionHash !== rawTextRevision.contentHash)
    fail('Imported novel rawTextRevision contentHash must match its ordered blocks');

  for (const hint of importedNovel.structuralHints)
    parseTxtSourceLocatorV1(hint.sourceLocator, locatorContext);

  assertUniqueIssueIds(importedNovel.warnings, 'Imported novel warnings');
  if (importedNovel.warnings.some(issue => issue.severity === 'error'))
    fail('Imported novel warnings must not contain blocking error issues');
  assertIssues(importedNovel.warnings, rawTextRevision, locatorContext);
  return importedNovel;
}

export function parseTxtSourceLocatorV1(
  value: unknown,
  context?: TxtSourceLocatorValidationContextV1,
): TxtSourceLocatorV1 {
  validateSchema(value, validators.txtSourceLocator, 'TXT source locator');
  const locator = value as TxtSourceLocatorV1;
  assertSourceByteRange(locator.sourceByteRange, 'TXT source locator sourceByteRange');
  assertSourceLineRange(locator.lineRange, 'TXT source locator lineRange');

  if (locator.sourceByteRange.startByte === locator.sourceByteRange.endByte) {
    fail('TXT source-backed locator sourceByteRange must be non-empty');
  }

  if (locator.rawTextRange.textLayer !== 'raw')
    fail('TXT source locator rawTextRange must use the raw text layer');
  if (locator.rawTextRange.startByte === locator.rawTextRange.endByte)
    fail('TXT source locator rawTextRange must be non-empty');

  if (context === undefined) {
    parseNovelTextRange(locator.rawTextRange);
    return locator;
  }

  if (
    locator.sourceAssetId !== context.sourceAssetId
    || locator.sourceContentHash !== context.sourceContentHash
    || locator.sourceEncoding !== context.sourceEncoding
  ) {
    fail('TXT source locator provenance does not match its ImportedNovel');
  }

  if (locator.sourceByteRange.endByte > context.sourceByteLength)
    fail('TXT source locator sourceByteRange exceeds the source byteLength');

  parseNovelTextRange(locator.rawTextRange, {
    revision: context.rawTextRevision,
    utf8Bytes: context.rawUtf8Bytes,
  });
  return locator;
}

export function getTxtExactLocatorKeyV1(locator: TxtSourceLocatorV1): string {
  return JSON.stringify([
    locator.sourceEncoding,
    locator.sourceByteRange.startByte,
    locator.sourceByteRange.endByte,
  ]);
}

export function parseChapterCandidateV1(
  value: unknown,
  textRevision?: TextRevisionRefV1,
): ChapterCandidateV1 {
  validateSchema(value, validators.chapterCandidate, 'Chapter candidate');
  const candidate = value as ChapterCandidateV1;
  assertSourceLineRange(candidate.lineRange, 'Chapter candidate lineRange');
  const headingRange = parseNovelTextRange(
    candidate.headingRange,
    textRevision === undefined ? undefined : { revision: textRevision },
  );
  if (headingRange.startByte === headingRange.endByte)
    fail('Chapter candidate headingRange must be non-empty');
  return candidate;
}

export function parseChapterIndexV1(value: unknown): ChapterIndexV1 {
  validateSchema(value, validators.chapterIndex, 'Chapter index');
  const chapterIndex = value as ChapterIndexV1;
  const textRevision = parseNovelTextRevision(chapterIndex.textRevision);

  if (textRevision.textLayer !== 'canonical')
    fail('Chapter index textRevision must use the canonical text layer');

  const candidateIds = new Set<string>();
  for (const candidate of chapterIndex.candidates) {
    if (candidateIds.has(candidate.chapterCandidateId)) {
      fail(
        `Chapter index contains duplicate chapterCandidateId ${candidate.chapterCandidateId}`,
      );
    }
    candidateIds.add(candidate.chapterCandidateId);
    parseChapterCandidateV1(candidate, textRevision);
  }

  const chapterSpans = new Map<string, TextRangeV1>();
  const orders = new Set<number>();
  let previousOrder = -1;
  let previousEntryEnd = 0;

  for (const entry of chapterIndex.entries) {
    if (chapterSpans.has(entry.chapterId))
      fail(`Chapter index contains duplicate chapterId ${entry.chapterId}`);

    if (orders.has(entry.order))
      fail(`Chapter index contains duplicate order ${entry.order}`);
    orders.add(entry.order);

    if (entry.order <= previousOrder)
      fail('Chapter index entries must be strictly ordered by order');
    previousOrder = entry.order;

    assertSourceLineRange(entry.sourceLineRange, 'Chapter entry sourceLineRange');
    const headingRange = parseNovelTextRange(entry.headingRange, {
      revision: textRevision,
    });
    const contentRange = parseNovelTextRange(entry.contentRange, {
      revision: textRevision,
    });

    if (headingRange.startByte === headingRange.endByte)
      fail('Chapter entry headingRange must be non-empty');
    if (headingRange.endByte > contentRange.startByte)
      fail('Chapter entry headingRange must not overlap contentRange');
    if (headingRange.startByte < previousEntryEnd)
      fail('Chapter index entries must have monotonic non-overlapping ranges');
    previousEntryEnd = contentRange.endByte;
    chapterSpans.set(entry.chapterId, {
      ...headingRange,
      endByte: contentRange.endByte,
    });
  }

  assertCoverageReport(
    chapterIndex.coverageReport,
    textRevision,
    chapterSpans,
  );
  assertUniqueIssueIds(chapterIndex.issues, 'Chapter index issues');
  assertIssues(chapterIndex.issues, textRevision);
  return chapterIndex;
}

export function parseSceneIndexV1(value: unknown): SceneIndexV1 {
  validateSchema(value, validators.sceneIndex, 'Scene index');
  const sceneIndex = value as SceneIndexV1;
  const textRevision = parseNovelTextRevision(sceneIndex.textRevision);
  if (textRevision.textLayer !== 'canonical')
    fail('Scene index textRevision must use the canonical text layer');

  const candidates = new Map<string, SceneBoundaryCandidateV1>();
  for (const candidate of sceneIndex.candidates) {
    if (candidates.has(candidate.sceneBoundaryCandidateId)) {
      fail(
        `Scene index contains duplicate sceneBoundaryCandidateId ${candidate.sceneBoundaryCandidateId}`,
      );
    }
    const evidenceRange = parseNovelTextRange(candidate.evidenceRange, {
      revision: textRevision,
    });
    if (evidenceRange.startByte === evidenceRange.endByte)
      fail('Scene boundary candidate evidenceRange must be non-empty');
    const proposedBoundary = parseSceneBoundaryCursor(
      candidate.proposedBoundary,
      textRevision,
      'proposedBoundary',
    );
    if (
      proposedBoundary.startByte < evidenceRange.startByte
      || proposedBoundary.startByte > evidenceRange.endByte
    ) {
      fail('Scene boundary candidate proposedBoundary must touch its evidenceRange');
    }
    if (candidate.appliedBoundary !== undefined) {
      parseSceneBoundaryCursor(
        candidate.appliedBoundary,
        textRevision,
        'appliedBoundary',
      );
    }
    if (
      candidate.reviewStatus === 'not_required'
      && (
        candidate.reasons.length !== 1
        || candidate.reasons[0] !== 'explicit_separator'
      )
    ) {
      fail('Only an explicit separator boundary may bypass review');
    }
    const locator = parseTxtSourceLocatorV1(candidate.sourceLocator);
    assertSceneLocatorProvenance(locator, sceneIndex);
    candidates.set(candidate.sceneBoundaryCandidateId, candidate);
  }

  const sceneIds = new Set<string>();
  const chapterIds = new Set<string>();
  const blockReferencesByChapter = new Map<
    string,
    Map<string, SceneBlockReferenceV1[]>
  >();
  const chapterSceneSpans = new Map<string, TextRangeV1>();
  const usedBoundaryCandidateIds = new Set<string>();
  const closedChapterIds = new Set<string>();
  let activeChapterId: string | undefined;
  let expectedChapterOrder = 0;
  let previousSceneEnd = 0;

  for (const scene of sceneIndex.scenes) {
    if (sceneIds.has(scene.sceneId))
      fail(`Scene index contains duplicate sceneId ${scene.sceneId}`);
    sceneIds.add(scene.sceneId);

    if (scene.chapterId !== activeChapterId) {
      if (closedChapterIds.has(scene.chapterId))
        fail('Scene entries for one chapter must form one contiguous group');
      if (activeChapterId !== undefined)
        closedChapterIds.add(activeChapterId);
      activeChapterId = scene.chapterId;
      expectedChapterOrder = 0;
      chapterIds.add(scene.chapterId);
    }
    if (scene.order !== expectedChapterOrder)
      fail('Scene order must be contiguous within each chapter');
    expectedChapterOrder += 1;

    const sceneRange = parseNovelTextRange(scene.range, { revision: textRevision });
    if (sceneRange.startByte === sceneRange.endByte)
      fail('Scene range must be non-empty');
    if (sceneRange.startByte < previousSceneEnd)
      fail('Scene ranges must be monotonic and non-overlapping');
    previousSceneEnd = sceneRange.endByte;
    const previousChapterSpan = chapterSceneSpans.get(scene.chapterId);
    chapterSceneSpans.set(scene.chapterId, previousChapterSpan === undefined
      ? sceneRange
      : { ...previousChapterSpan, endByte: sceneRange.endByte });

    if (scene.order === 0) {
      if (scene.startBoundaryCandidateId !== undefined) {
        fail('The first Scene in a chapter must not reference a start boundary candidate');
      }
    } else {
      const boundaryCandidateId = scene.startBoundaryCandidateId;
      if (boundaryCandidateId === undefined)
        fail('Every non-first Scene must reference its applied start boundary candidate');
      const candidate = candidates.get(boundaryCandidateId);
      if (
        candidate === undefined
        || candidate.chapterId !== scene.chapterId
        || candidate.appliedBoundary === undefined
        || candidate.appliedBoundary.startByte !== sceneRange.startByte
      ) {
        fail('Scene start boundary candidate must resolve to its exact Scene start');
      }
      if (usedBoundaryCandidateIds.has(boundaryCandidateId))
        fail('An applied Scene boundary candidate may start only one Scene');
      usedBoundaryCandidateIds.add(boundaryCandidateId);
    }

    let referenceCursor = sceneRange.startByte;
    const sceneBlockIds = new Set<string>();
    for (const reference of scene.blockReferences) {
      if (sceneBlockIds.has(reference.blockId))
        fail('Scene blockReferences must not repeat a blockId within one Scene');
      sceneBlockIds.add(reference.blockId);
      const range = parseNovelTextRange(reference.range, { revision: textRevision });
      if (range.startByte === range.endByte)
        fail('Scene block reference range must be non-empty');
      if (range.startByte !== referenceCursor || range.endByte > sceneRange.endByte) {
        fail('Scene block references must exactly and contiguously cover the Scene range');
      }
      referenceCursor = range.endByte;
      const locator = parseTxtSourceLocatorV1(reference.sourceLocator);
      assertSceneLocatorProvenance(locator, sceneIndex);
      const chapterBlocks = blockReferencesByChapter.get(scene.chapterId)
        ?? new Map<string, SceneBlockReferenceV1[]>();
      const references = chapterBlocks.get(reference.blockId) ?? [];
      references.push(reference);
      chapterBlocks.set(reference.blockId, references);
      blockReferencesByChapter.set(scene.chapterId, chapterBlocks);
    }
    if (referenceCursor !== sceneRange.endByte)
      fail('Scene block references must reach the end of the Scene range');
  }

  for (const candidate of candidates.values()) {
    if (!chapterIds.has(candidate.chapterId))
      fail('Scene boundary candidate must reference a chapter represented by Scenes');
    const references = blockReferencesByChapter
      .get(candidate.chapterId)
      ?.get(candidate.blockId) ?? [];
    const evidenceReference = references.find(reference =>
      rangeContains(reference.range, candidate.evidenceRange)
      && sameTxtSourceLocator(reference.sourceLocator, candidate.sourceLocator));
    if (evidenceReference === undefined) {
      fail(
        'Scene boundary candidate must preserve a same-chapter block range and source locator',
      );
    }
    const chapterSpan = chapterSceneSpans.get(candidate.chapterId);
    if (
      chapterSpan === undefined
      || candidate.proposedBoundary.startByte <= chapterSpan.startByte
      || candidate.proposedBoundary.startByte >= chapterSpan.endByte
      || (
        candidate.appliedBoundary !== undefined
        && (
          candidate.appliedBoundary.startByte <= chapterSpan.startByte
          || candidate.appliedBoundary.startByte >= chapterSpan.endByte
        )
      )
    ) {
      fail('Scene boundary candidates must remain strictly inside their Chapter span');
    }
    if (
      candidate.appliedBoundary !== undefined
      && !usedBoundaryCandidateIds.has(candidate.sceneBoundaryCandidateId)
    ) {
      fail('Every applied Scene boundary candidate must start a Scene');
    }
  }

  assertUniqueIssueIds(sceneIndex.issues, 'Scene index issues');
  assertIssues(sceneIndex.issues, textRevision);
  const pendingIssueCounts = new Map<string, number>();
  for (const issue of sceneIndex.issues) {
    if (!chapterIds.has(issue.chapterId))
      fail('Scene issue must reference a chapter represented by Scenes');
    if (issue.blockId !== undefined) {
      const references = blockReferencesByChapter
        .get(issue.chapterId)
        ?.get(issue.blockId) ?? [];
      const matchingReference = references.find(reference =>
        (issue.textRange === undefined || rangeContains(reference.range, issue.textRange))
        && (
          issue.sourceLocator === undefined
          || sameTxtSourceLocator(reference.sourceLocator, issue.sourceLocator)
        ));
      if (matchingReference === undefined) {
        fail(
          'Scene issue block range and source locator must resolve within its referenced chapter',
        );
      }
    }
    if (issue.textRange !== undefined)
      parseNovelTextRange(issue.textRange, { revision: textRevision });
    if (issue.sourceLocator !== undefined) {
      const locator = parseTxtSourceLocatorV1(issue.sourceLocator);
      assertSceneLocatorProvenance(locator, sceneIndex);
    }
    if (issue.sceneBoundaryCandidateId !== undefined) {
      const candidate = candidates.get(issue.sceneBoundaryCandidateId);
      if (candidate === undefined || candidate.chapterId !== issue.chapterId)
        fail('Scene issue candidate reference must resolve within its chapter');
      if (issue.blockId !== undefined && issue.blockId !== candidate.blockId)
        fail('Scene issue blockId must match its boundary candidate');
      if (issue.code === 'scene_boundary_review_required') {
        pendingIssueCounts.set(
          issue.sceneBoundaryCandidateId,
          (pendingIssueCounts.get(issue.sceneBoundaryCandidateId) ?? 0) + 1,
        );
      }
    }
  }

  for (const candidate of candidates.values()) {
    const issueCount = pendingIssueCounts.get(candidate.sceneBoundaryCandidateId) ?? 0;
    if (candidate.reviewStatus === 'pending' && issueCount !== 1) {
      fail('Each pending Scene boundary candidate must have one review issue');
    }
    if (candidate.reviewStatus !== 'pending' && issueCount !== 0) {
      fail('Resolved Scene boundary candidates must not retain pending review issues');
    }
  }

  const hasPendingReview = sceneIndex.candidates.some(candidate =>
    candidate.reviewStatus === 'pending')
  || sceneIndex.issues.some(issue => issue.reviewStatus === 'pending');
  if (
    sceneIndex.reviewStatus !== (hasPendingReview ? 'pending' : 'not_required')
  ) {
    fail('Scene index reviewStatus must reflect its unresolved candidates and issues');
  }
  return sceneIndex;
}

function parseSceneBoundaryCursor(
  value: unknown,
  textRevision: TextRevisionRefV1,
  fieldName: string,
): TextRangeV1 {
  const range = parseNovelTextRange(value, { revision: textRevision });
  if (range.startByte !== range.endByte)
    fail(`Scene boundary candidate ${fieldName} must be a zero-length cursor`);
  return range;
}

function assertSceneLocatorProvenance(
  locator: TxtSourceLocatorV1,
  sceneIndex: SceneIndexV1,
): void {
  if (
    locator.sourceAssetId !== sceneIndex.sourceAssetId
    || locator.sourceContentHash !== sceneIndex.sourceHash
  ) {
    fail('Scene source locator provenance must match its Scene index');
  }
}

function rangeContains(container: TextRangeV1, contained: TextRangeV1): boolean {
  return container.textRevisionId === contained.textRevisionId
    && container.textLayer === contained.textLayer
    && container.offsetUnit === contained.offsetUnit
    && container.startByte <= contained.startByte
    && container.endByte >= contained.endByte;
}

function sameTxtSourceLocator(
  left: TxtSourceLocatorV1,
  right: TxtSourceLocatorV1,
): boolean {
  return left.sourceAssetId === right.sourceAssetId
    && left.sourceContentHash === right.sourceContentHash
    && left.sourceEncoding === right.sourceEncoding
    && left.sourceByteRange.offsetUnit === right.sourceByteRange.offsetUnit
    && left.sourceByteRange.startByte === right.sourceByteRange.startByte
    && left.sourceByteRange.endByte === right.sourceByteRange.endByte
    && sameTextRange(left.rawTextRange, right.rawTextRange)
    && left.lineRange.lineBase === right.lineRange.lineBase
    && left.lineRange.startLine === right.lineRange.startLine
    && left.lineRange.endLineExclusive === right.lineRange.endLineExclusive;
}

function assertCoverageReport(
  report: CoverageReportV1,
  textRevision: TextRevisionRefV1,
  chapterSpans: ReadonlyMap<string, TextRangeV1>,
): void {
  if (
    report.textRevisionId !== textRevision.textRevisionId
    || report.textLayer !== textRevision.textLayer
    || report.totalByteLength !== textRevision.byteLength
  ) {
    fail('Coverage report must reference the ChapterIndex text revision exactly');
  }

  let classifiedByteLength = 0;
  let previousClassifiedEnd = 0;
  const allRanges: TextRangeV1[] = [];
  const coveredChapterIds = new Set<string>();

  for (const segment of report.segments) {
    const range = parseNovelTextRange(segment.range, { revision: textRevision });
    if (range.startByte === range.endByte)
      fail('Coverage segments must be non-empty');
    if (range.startByte < previousClassifiedEnd)
      fail('Coverage segments must be monotonic and non-overlapping');
    previousClassifiedEnd = range.endByte;
    classifiedByteLength += range.endByte - range.startByte;
    allRanges.push(range);

    if (segment.classification === 'chapter') {
      const expectedRange = chapterSpans.get(segment.chapterId);
      if (expectedRange === undefined)
        fail('Chapter coverage segment must reference an existing chapterId');
      if (coveredChapterIds.has(segment.chapterId))
        fail('Each ChapterIndex entry must have exactly one coverage segment');
      if (!sameTextRange(range, expectedRange)) {
        fail(
          'Chapter coverage segment must exactly cover its entry heading and content span',
        );
      }
      coveredChapterIds.add(segment.chapterId);
    }
  }

  for (const chapterId of chapterSpans.keys()) {
    if (!coveredChapterIds.has(chapterId))
      fail('Every ChapterIndex entry must have a matching chapter coverage segment');
  }

  let unclassifiedByteLength = 0;
  let previousUnclassifiedEnd = 0;
  for (const unclassifiedRange of report.unclassifiedRanges) {
    const range = parseNovelTextRange(unclassifiedRange, { revision: textRevision });
    if (range.startByte === range.endByte)
      fail('Unclassified coverage ranges must be non-empty');
    if (range.startByte < previousUnclassifiedEnd) {
      fail('Unclassified coverage ranges must be monotonic and non-overlapping');
    }
    previousUnclassifiedEnd = range.endByte;
    unclassifiedByteLength += range.endByte - range.startByte;
    allRanges.push(range);
  }

  if (
    classifiedByteLength !== report.classifiedByteLength
    || unclassifiedByteLength !== report.unclassifiedByteLength
    || classifiedByteLength + unclassifiedByteLength !== report.totalByteLength
  ) {
    fail('Coverage byte counts are inconsistent with their ranges');
  }

  allRanges.sort((left, right) => left.startByte - right.startByte);
  let coverageCursor = 0;
  for (const range of allRanges) {
    if (range.startByte !== coverageCursor) {
      fail('Coverage ranges must classify or expose every input byte exactly once');
    }
    coverageCursor = range.endByte;
  }

  if (coverageCursor !== textRevision.byteLength)
    fail('Coverage ranges must reach the end of the text revision');

  if (report.complete !== (unclassifiedByteLength === 0)) {
    fail('Coverage complete must agree with unclassifiedByteLength');
  }
}

function assertIssues(
  issues: readonly ImportIssueV1[],
  textRevision: TextRevisionRefV1,
  locatorContext?: TxtSourceLocatorValidationContextV1,
): void {
  for (const issue of issues) {
    if (issue.textRange !== undefined)
      parseNovelTextRange(issue.textRange, { revision: textRevision });
    if (issue.sourceLocator !== undefined)
      parseTxtSourceLocatorV1(issue.sourceLocator, locatorContext);
    if (issue.sourceByteRange !== undefined) {
      assertSourceByteRange(issue.sourceByteRange, 'Import issue sourceByteRange');
      if (
        locatorContext !== undefined
        && issue.sourceByteRange.endByte > locatorContext.sourceByteLength
      ) {
        fail('Import issue sourceByteRange exceeds the source byteLength');
      }
    }
  }
}

function assertUniqueIssueIds(
  issues: readonly ImportIssueV1[],
  dataName: string,
): void {
  const issueIds = new Set<string>();
  for (const issue of issues) {
    if (issueIds.has(issue.issueId))
      fail(`${dataName} contains duplicate issueId ${issue.issueId}`);
    issueIds.add(issue.issueId);
  }
}

function assertSourceByteRange(range: SourceByteRangeV1, dataName: string): void {
  if (range.startByte > range.endByte)
    fail(`${dataName} startByte must not exceed endByte`);
}

function assertSourceLineRange(range: SourceLineRangeV1, dataName: string): void {
  if (range.startLine >= range.endLineExclusive) {
    fail(`${dataName} must be a non-empty one-based half-open line range`);
  }
}

function computeContextHash(
  context: ImportedNovelValidationContextV1,
  text: string,
): string {
  let hash: string;
  try {
    hash = context.sha256Utf8(text);
  } catch {
    fail('ImportedNovel sha256Utf8 validation context failed');
  }

  if (!/^[0-9a-f]{64}$/.test(hash)) {
    fail(
      'ImportedNovel sha256Utf8 validation context must return lowercase SHA-256 hex',
    );
  }
  return hash;
}

function computeContextPartsHash(
  context: ImportedNovelValidationContextV1,
  parts: Iterable<string>,
): string {
  let hash: string;
  try {
    hash = context.sha256Utf8Parts(parts);
  } catch {
    fail('ImportedNovel sha256Utf8Parts validation context failed');
  }

  if (!/^[0-9a-f]{64}$/.test(hash)) {
    fail(
      'ImportedNovel sha256Utf8Parts validation context must return lowercase SHA-256 hex',
    );
  }
  return hash;
}

function* iterateBlockRawText(
  blocks: readonly DocumentBlockV1[],
): IterableIterator<string> {
  for (const block of blocks)
    yield block.rawText;
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

function rangeByteLength(range: TextRangeV1): number {
  return range.endByte - range.startByte;
}

function sameTextRange(left: TextRangeV1, right: TextRangeV1): boolean {
  return left.textRevisionId === right.textRevisionId
    && left.textLayer === right.textLayer
    && left.offsetUnit === right.offsetUnit
    && left.startByte === right.startByte
    && left.endByte === right.endByte;
}

function parseNovelTextRevision(value: unknown): TextRevisionRefV1 {
  try {
    return parseTextRevisionRefV1(value);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Invalid text revision reference');
  }
}

function parseNovelTextRange(
  value: unknown,
  context?: TextRangeValidationContextV1,
): TextRangeV1 {
  try {
    return parseTextRangeV1(value, context);
  } catch (error) {
    fail(error instanceof Error ? error.message : 'Invalid text range');
  }
}

function createNovelImportValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  ajv.addSchema(TEXT_REFERENCE_SCHEMA);
  ajv.addSchema(NOVEL_IMPORT_SCHEMA);

  return {
    ajv,
    document: getSchema(ajv, NOVEL_IMPORT_SCHEMA.$id),
    importedNovel: getSchema(
      ajv,
      `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/importedNovelV1`,
    ),
    txtSourceLocator: getSchema(
      ajv,
      `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/txtSourceLocatorV1`,
    ),
    chapterCandidate: getSchema(
      ajv,
      `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/chapterCandidateV1`,
    ),
    chapterIndex: getSchema(
      ajv,
      `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/chapterIndexV1`,
    ),
    sceneIndex: getSchema(
      ajv,
      `${NOVEL_IMPORT_SCHEMA.$id}#/$defs/sceneIndexV1`,
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

function fail(message: string): never {
  throw new NovelImportValidationError(message);
}
