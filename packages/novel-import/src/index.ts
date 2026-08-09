export {
  type NovelSourceAdapter,
  NovelSourceAdapterError,
  type NovelSourceAsset,
  type NovelSourceDiagnostic,
  type NovelSourceExtractContext,
  type NovelSourceProbeResult,
  type NovelSourceValidationContext,
  type NovelSourceValidationResult,
  type NovelSourceWarning,
  type TxtUserEncodingSelection,
} from './novelSourceAdapter.js';

export {
  probeTxtDecoderCapabilities,
  TXT_IMPORT_PROCESSOR_ID,
  TXT_IMPORT_PROCESSOR_VERSION,
  TXT_SOURCE_ADAPTER_ID,
  TXT_SOURCE_ADAPTER_VERSION,
  type TxtDecoderCapabilityProbe,
  type TxtDecoderFactory,
  type TxtDecoderLike,
  TxtSourceAdapter,
  type TxtSourceAdapterOptions,
} from './txtSourceAdapter.js';
