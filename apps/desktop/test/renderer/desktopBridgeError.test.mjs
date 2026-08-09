/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import test from 'node:test';

import {
  decodeDesktopBridgeError,
  encodeDesktopBridgeError,
} from '../.generated/shared/desktopBridgeError.js';

test('round-trips safe desktop errors through an isolated-world Error message', () => {
  const expected = {
    code: 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
    message: 'Project migration confirmation is required.',
    retryable: true,
  };
  const proxied = new Error(
    `Error invoking desktop bridge: ${encodeDesktopBridgeError(expected)}`,
  );

  assert.deepEqual(decodeDesktopBridgeError(proxied), expected);
});

test('rejects ordinary, malformed, and unsafe bridge errors', () => {
  assert.equal(decodeDesktopBridgeError(new Error('ordinary failure')), undefined);
  assert.equal(
    decodeDesktopBridgeError(new Error('VOXWEAVER_DESKTOP_ERROR_V1:not-json')),
    undefined,
  );
  assert.throws(
    () => encodeDesktopBridgeError({
      code: 'invalid-code',
      message: 'Failure',
      retryable: false,
    }),
    /invalid/,
  );
});
