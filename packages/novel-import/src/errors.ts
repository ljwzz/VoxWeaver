import type { AppErrorCode } from '@voxweaver/contracts';

export type NovelImportErrorReason
  = | 'binary_nul'
    | 'decode_failed'
    | 'empty_source'
    | 'encoding_selection_incomplete'
    | 'encoding_selection_not_allowed'
    | 'encoding_selection_source_mismatch'
    | 'invalid_source_asset'
    | 'invalid_utf8_text'
    | 'source_asset_hash_mismatch'
    | 'source_asset_length_mismatch'
    | 'source_asset_not_regular_file'
    | 'source_asset_not_txt'
    | 'source_asset_outside_project'
    | 'source_asset_path_invalid'
    | 'source_asset_read_failed'
    | 'source_asset_symlink'
    | 'text_slice_invalid_range'
    | 'text_slice_too_large'
    | 'text_slice_utf8_boundary'
    | 'unsupported_encoding'
    | 'utf32_not_supported';

export class NovelImportError extends Error {
  readonly code: AppErrorCode;
  readonly reason: NovelImportErrorReason;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: AppErrorCode,
    reason: NovelImportErrorReason,
    message: string,
    retryable = false,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'NovelImportError';
    this.code = code;
    this.reason = reason;
    this.retryable = retryable;
    if (details !== undefined)
      this.details = details;
  }
}

export function invalidSource(
  reason: NovelImportErrorReason,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): NovelImportError {
  return new NovelImportError(
    'NOVEL_IMPORT_INVALID_SOURCE',
    reason,
    message,
    false,
    details,
  );
}

export function invalidSlice(
  reason: NovelImportErrorReason,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): NovelImportError {
  return new NovelImportError(
    'IPC_PAYLOAD_INVALID',
    reason,
    message,
    false,
    details,
  );
}
