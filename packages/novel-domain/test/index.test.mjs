import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageEntry from '../dist/index.js';

test('exposes only the M1-06 document block runtime API', () => {
  assert.deepEqual(Object.keys(packageEntry), [
    'DOCUMENT_BLOCK_INDEX_SCHEMA_VERSION',
    'DocumentBlockIndexValidationError',
    'alignDocumentBlockIndexV1',
    'validateDocumentBlockIndexV1',
  ]);
});
