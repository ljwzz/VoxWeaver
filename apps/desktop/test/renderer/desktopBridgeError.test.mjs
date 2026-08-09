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
    currentArtifactRevisionId: '00000000-0000-4000-8000-000000000003',
    message: 'Project migration confirmation is required.',
    operationId: 'operation-bridge-test',
    retryable: true,
    taskId: '00000000-0000-4000-8000-000000000002',
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

  const safe = {
    code: 'DESKTOP_CORE_UNAVAILABLE',
    message: 'The desktop request could not be completed.',
    retryable: true,
  };
  for (const invalid of [
    { ...safe, operationId: 'folder/operation' },
    { ...safe, taskId: 'task-not-uuid-v4' },
    { ...safe, currentArtifactRevisionId: 'revision-not-uuid-v4' },
    { ...safe, details: { internal: true } },
  ]) {
    assert.throws(() => encodeDesktopBridgeError(invalid), /invalid/);
    assert.equal(
      decodeDesktopBridgeError(new Error(
        `VOXWEAVER_DESKTOP_ERROR_V1:${JSON.stringify(invalid)}`,
      )),
      undefined,
    );
  }
});
