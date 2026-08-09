import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageEntry from '../dist/index.js';

test('exposes only the M1-09 text pipeline runtime API', () => {
  assert.deepEqual(Object.keys(packageEntry), [
    'CANONICALIZER_PROCESSOR_ID',
    'CANONICALIZER_PROCESSOR_VERSION',
    'CANONICAL_RULE_IDS',
    'CANONICAL_RULE_VERSION',
    'CHAPTER_CONFIDENCE_FORMULA_VERSION',
    'CHAPTER_CONTEXT_BLOCK_LIMIT',
    'CHAPTER_HEADING_RULE_VERSION',
    'CHAPTER_INDEX_PROCESSOR_ID',
    'CHAPTER_INDEX_PROCESSOR_VERSION',
    'ChapterCandidateDetectionError',
    'ChapterIndexBuildError',
    'ChapterSlicingError',
    'DocumentBlockIndexValidationError',
    'NORMALIZATION_PROPOSER_ID',
    'NORMALIZATION_RULE_IDS',
    'NORMALIZATION_RULE_VERSION',
    'NORMALIZER_IDENTITY_RULE_ID',
    'NORMALIZER_PROCESSOR_ID',
    'NORMALIZER_PROCESSOR_VERSION',
    'NormalizationExecutionError',
    'NormalizationProposalValidationError',
    'SCENE_BOUNDARY_RULE_VERSION',
    'SCENE_DETECTOR_PROCESSOR_ID',
    'SCENE_DETECTOR_PROCESSOR_VERSION',
    'SceneDetectionError',
    'TextTransformValidationError',
    'buildChapterIndexV1',
    'buildDocumentBlockIndexV1',
    'canonicalizeRawTextV1',
    'detectChapterCandidatesV1',
    'detectScenesV1',
    'discoverNormalizationProposalsV1',
    'normalizeTextV1',
    'parseChapterHeadingV1',
    'parseChapterNumberV1',
    'restoreCanonicalTextFromCoverageV1',
    'restoreCanonicalTextFromNormalizationV1',
    'sliceChapterCoverageV1',
    'sliceChapterIndexV1',
    'validateNormalizationProposalsV1',
  ]);
});
