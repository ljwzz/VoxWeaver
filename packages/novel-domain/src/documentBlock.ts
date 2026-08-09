import type {
  DocumentBlockKindV1,
  TextRangeV1,
  TextRevisionRefV1,
  TxtSourceEncoding,
  TxtSourceLocatorV1,
} from '@voxweaver/contracts';

export const DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION = 1 as const;

export type BlockAlignmentEvidenceLevelV1
  = | 'same-source-exact-locator'
    | 'changed-source-exact-locator'
    | 'two-sided-content-anchors'
    | 'one-sided-matched-anchor'
    | 'globally-unique-content';

export interface CanonicalDocumentBlockV1 {
  readonly blockId: string;
  readonly kind: DocumentBlockKindV1;
  readonly canonicalText: string;
  readonly canonicalRange: TextRangeV1 & { readonly textLayer: 'canonical' };
  readonly contentHash: string;
  readonly sourceLocator: TxtSourceLocatorV1;
}

export interface DocumentBlockIndexIssueV1 {
  readonly code: 'ambiguous_reimport_alignment';
  readonly severity: 'warning';
  readonly reviewStatus: 'pending';
  readonly message: string;
  readonly currentBlockId: string;
  readonly candidateOldBlockIds: readonly string[];
  readonly evidenceLevel: BlockAlignmentEvidenceLevelV1;
}

export interface DocumentBlockIndexV1 {
  readonly documentType: 'document-block-index';
  readonly schemaVersion: typeof DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION;
  readonly alignmentPolicyVersion: 'm1-block-alignment-v1';
  readonly sourceAssetId: string;
  readonly sourceContentHash: string;
  readonly sourceByteLength: number;
  readonly sourceEncoding: TxtSourceEncoding;
  readonly rawTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'raw';
  };
  readonly canonicalTextRevision: TextRevisionRefV1 & {
    readonly textLayer: 'canonical';
  };
  readonly blocks: readonly CanonicalDocumentBlockV1[];
  readonly issues: readonly DocumentBlockIndexIssueV1[];
  readonly reviewStatus: 'not_required' | 'pending';
}

export class DocumentBlockIndexValidationError extends Error {
  readonly code = 'NOVEL_IMPORT_STRUCTURE_INVALID';

  constructor(
    readonly detailReason: string,
    message: string,
  ) {
    super(message);
    this.name = 'DocumentBlockIndexValidationError';
  }
}
