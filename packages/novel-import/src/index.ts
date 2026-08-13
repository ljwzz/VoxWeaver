export {
  type DecodedProjectSourceAsset,
  decodeSourceAsset,
  type ManualTxtEncodingSelection,
  probeSourceAsset,
  USER_SELECTED_TXT_SOURCE_ENCODINGS,
} from './encoding.ts';

export {
  invalidSlice,
  invalidSource,
  NovelImportError,
  type NovelImportErrorReason,
} from './errors.ts';

export {
  createNovelImportProcessorFingerprint,
  type ImportedNovelArtifact,
  importSourceAsset,
  sha256Utf8,
  type Utf8NovelTextArtifact,
} from './importEngine.ts';

export {
  type ProjectSourceAsset,
  readProjectSourceAsset,
  sha256Bytes,
  verifyProjectSourceAsset,
} from './sourceAsset.ts';

export {
  analyzeNovelStructure,
  CHAPTER_HEADING_MAX_CODE_POINTS,
  type NovelStructureAnalysis,
} from './structure.ts';

export {
  decodeUtf8TextSlice,
  type DecodeUtf8TextSliceInput,
  readUtf8TextSlice,
  type ReadUtf8TextSliceInput,
} from './textSlice.ts';
