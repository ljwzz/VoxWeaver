import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageEntry from '../dist/index.js';

test('exposes only the M1-06 text pipeline runtime API', () => {
  assert.deepEqual(Object.keys(packageEntry), [
    'CANONICALIZER_PROCESSOR_ID',
    'CANONICALIZER_PROCESSOR_VERSION',
    'CANONICAL_RULE_IDS',
    'CANONICAL_RULE_VERSION',
    'DocumentBlockIndexValidationError',
    'TextTransformValidationError',
    'buildDocumentBlockIndexV1',
    'canonicalizeRawTextV1',
  ]);
});
