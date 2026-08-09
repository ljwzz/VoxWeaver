import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageEntry from '../dist/index.js';

test('exposes only the M1-07 text pipeline runtime API', () => {
  assert.deepEqual(Object.keys(packageEntry), [
    'CANONICALIZER_PROCESSOR_ID',
    'CANONICALIZER_PROCESSOR_VERSION',
    'CANONICAL_RULE_IDS',
    'CANONICAL_RULE_VERSION',
    'CHAPTER_CONFIDENCE_FORMULA_VERSION',
    'CHAPTER_CONTEXT_BLOCK_LIMIT',
    'CHAPTER_HEADING_RULE_VERSION',
    'ChapterCandidateDetectionError',
    'DocumentBlockIndexValidationError',
    'TextTransformValidationError',
    'buildDocumentBlockIndexV1',
    'canonicalizeRawTextV1',
    'detectChapterCandidatesV1',
    'parseChapterHeadingV1',
    'parseChapterNumberV1',
  ]);
});
