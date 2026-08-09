import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageEntry from '../dist/index.js';

test('exposes only the M1-08 novel domain runtime API', () => {
  assert.deepEqual(Object.keys(packageEntry), [
    'ChapterIndexDomainValidationError',
    'DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION',
    'DocumentBlockIndexValidationError',
    'alignDocumentBlockIndexV1',
    'getChapterCoverageRatioV1',
    'validateChapterIndexDomainV1',
    'validateDocumentBlockIndexV1',
  ]);
});
