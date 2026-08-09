import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageEntry from '../dist/index.js';

test('loads the package skeleton without exposing a public API', () => {
  assert.deepEqual(Object.keys(packageEntry), []);
});
