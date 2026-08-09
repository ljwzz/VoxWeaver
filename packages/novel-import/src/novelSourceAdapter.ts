import type {
  ImportedNovelV1,
  NovelImportErrorCode,
  NovelSourceFormat,
  SourceByteRangeV1,
  TxtEncodingDecisionV1,
  TxtSourceEncoding,
  UserSelectedTxtSourceEncoding,
} from '@voxweaver/contracts';

export interface NovelSourceAsset {
  readonly sourceAssetId: string;
  readonly sourceContentHash: string;
  readonly sourceByteLength: number;
  readonly mediaType?: string;
  readonly fileExtension?: string;
  openByteStream: () => AsyncIterable<Uint8Array> | Iterable<Uint8Array>;
}

export interface NovelSourceProbeResult {
  readonly format: NovelSourceFormat;
  readonly confidence: number;
  readonly reasons: readonly string[];
}

export interface NovelSourceDiagnostic {
  readonly code: NovelImportErrorCode;
  readonly detailReason: string;
  readonly message: string;
  readonly sourceEncoding?: TxtSourceEncoding;
  readonly sourceByteRange?: SourceByteRangeV1;
}

export interface NovelSourceWarning {
  readonly code: string;
  readonly message: string;
  readonly sourceEncoding?: TxtSourceEncoding;
  readonly sourceByteRange?: SourceByteRangeV1;
}

export interface TxtUserEncodingSelection {
  readonly sourceContentHash: string;
  readonly sourceEncoding: UserSelectedTxtSourceEncoding;
}

export interface NovelSourceValidationContext {
  readonly userEncoding?: TxtUserEncodingSelection;
}

export interface NovelSourceValidationResult {
  readonly valid: boolean;
  readonly probe: NovelSourceProbeResult;
  readonly encodingDecision?: TxtEncodingDecisionV1;
  readonly errors: readonly NovelSourceDiagnostic[];
  readonly warnings: readonly NovelSourceWarning[];
}

export interface NovelSourceExtractContext extends NovelSourceValidationContext {
  readonly createOpaqueId?: () => string;
}

export interface NovelSourceAdapter {
  readonly adapterId: string;
  readonly adapterVersion: string;

  probe: (source: NovelSourceAsset) => Promise<NovelSourceProbeResult>;
  validate: (
    source: NovelSourceAsset,
    context?: NovelSourceValidationContext,
  ) => Promise<NovelSourceValidationResult>;
  extract: (
    source: NovelSourceAsset,
    context?: NovelSourceExtractContext,
  ) => Promise<ImportedNovelV1>;
}

export class NovelSourceAdapterError extends Error {
  readonly code: NovelImportErrorCode;
  readonly detailReason: string;
  readonly sourceEncoding?: TxtSourceEncoding;
  readonly sourceByteRange?: SourceByteRangeV1;

  constructor(diagnostic: NovelSourceDiagnostic) {
    super(diagnostic.message);
    this.name = 'NovelSourceAdapterError';
    this.code = diagnostic.code;
    this.detailReason = diagnostic.detailReason;
    this.sourceEncoding = diagnostic.sourceEncoding;
    this.sourceByteRange = diagnostic.sourceByteRange;
  }
}
