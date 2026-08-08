import assert from 'node:assert/strict';
import test from 'node:test';

import {
  err,
  invariant,
  isNonEmptyString,
  ok,
  toError,
} from '../dist/index.js';

test('creates successful and failed results', () => {
  assert.deepEqual(ok('value'), { ok: true, value: 'value' });

  const error = new Error('failed');
  assert.deepEqual(err(error), { error, ok: false });
});

test('normalizes thrown values to Error instances', () => {
  const original = new Error('original');

  assert.equal(toError(original), original);
  assert.equal(toError('message').message, 'message');
  assert.equal(toError({ reason: 'unknown' }).message, 'Unknown error');
});

test('asserts invariants', () => {
  assert.doesNotThrow(() => invariant(true, 'unused'));
  assert.throws(() => invariant(false, 'invalid state'), /invalid state/);
});

test('recognizes non-empty strings', () => {
  assert.equal(isNonEmptyString('VoxWeaver'), true);
  assert.equal(isNonEmptyString('   '), false);
  assert.equal(isNonEmptyString(null), false);
});
