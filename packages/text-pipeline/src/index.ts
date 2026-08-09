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
  ChapterNumberSourceKindV1,
  ParsedChapterNumberV1,
} from './chapterNumber.js';

export { parseChapterNumberV1 } from './chapterNumber.js';
export { TextTransformValidationError } from './textTransform.js';
export { DocumentBlockIndexValidationError } from '@voxweaver/novel-domain';
