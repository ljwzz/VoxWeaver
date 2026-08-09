export { type BuildDocumentBlockIndexInputV1, buildDocumentBlockIndexV1 } from './blockIndex.js';

export type {
  CanonicalizeRawTextInputV1,
  CanonicalizeRawTextResultV1,
} from './canonicalizer.js';
export {
  CANONICAL_RULE_IDS,
  CANONICAL_RULE_VERSION,
  CANONICALIZER_PROCESSOR_ID,
  CANONICALIZER_PROCESSOR_VERSION,
  canonicalizeRawTextV1,
} from './canonicalizer.js';

export type {
  ChapterHeadingKindV1,
  DetectChapterCandidatesOptionsV1,
  ParsedChapterHeadingV1,
} from './chapterCandidateDetector.js';
export {
  CHAPTER_CONFIDENCE_FORMULA_VERSION,
  CHAPTER_CONTEXT_BLOCK_LIMIT,
  CHAPTER_HEADING_RULE_VERSION,
  ChapterCandidateDetectionError,
  detectChapterCandidatesV1,
  parseChapterHeadingV1,
} from './chapterCandidateDetector.js';

export type {
  BuildChapterIndexInputV1,
  BuildChapterIndexOptionsV1,
  ChapterContentLengthPolicyV1,
} from './chapterIndex.js';
export {
  buildChapterIndexV1,
  CHAPTER_INDEX_PROCESSOR_ID,
  CHAPTER_INDEX_PROCESSOR_VERSION,
  ChapterIndexBuildError,
} from './chapterIndex.js';

export type {
  ChapterNumberSourceKindV1,
  ParsedChapterNumberV1,
} from './chapterNumber.js';

export { parseChapterNumberV1 } from './chapterNumber.js';

export type {
  ChapterSliceV1,
  CoverageSliceV1,
  SliceChapterIndexInputV1,
} from './chapterSlicer.js';
export {
  ChapterSlicingError,
  restoreCanonicalTextFromCoverageV1,
  sliceChapterCoverageV1,
  sliceChapterIndexV1,
} from './chapterSlicer.js';

export type {
  DiscoverNormalizationProposalOptionsV1,
  DiscoverNormalizationProposalsInputV1,
  NormalizationProposalOperationV1,
  NormalizationProposalRiskV1,
  NormalizationProposalV1,
  ValidateNormalizationProposalsInputV1,
} from './normalizationProposal.js';
export {
  discoverNormalizationProposalsV1,
  NORMALIZATION_PROPOSER_ID,
  NORMALIZATION_RULE_IDS,
  NORMALIZATION_RULE_VERSION,
  NormalizationProposalValidationError,
  validateNormalizationProposalsV1,
} from './normalizationProposal.js';

export type {
  NormalizationAppliedChangeV1,
  NormalizationApplyResultV1,
  NormalizationDryRunResultV1,
  NormalizationModeV1,
  NormalizationPreviewChangeV1,
  NormalizationSkippedProposalV1,
  NormalizeTextInputV1,
  NormalizeTextResultV1,
  RestoreCanonicalTextInputV1,
} from './normalizer.js';
export {
  NormalizationExecutionError,
  NORMALIZER_IDENTITY_RULE_ID,
  NORMALIZER_PROCESSOR_ID,
  NORMALIZER_PROCESSOR_VERSION,
  normalizeTextV1,
  restoreCanonicalTextFromNormalizationV1,
} from './normalizer.js';

export type {
  DetectScenesInputV1,
  DetectScenesOptionsV1,
  SceneBoundaryReviewV1,
} from './sceneDetector.js';
export {
  detectScenesV1,
  SCENE_BOUNDARY_RULE_VERSION,
  SCENE_DETECTOR_PROCESSOR_ID,
  SCENE_DETECTOR_PROCESSOR_VERSION,
  SceneDetectionError,
} from './sceneDetector.js';

export { TextTransformValidationError } from './textTransform.js';
export { DocumentBlockIndexValidationError } from '@voxweaver/novel-domain';
