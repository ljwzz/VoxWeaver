import assert from 'node:assert/strict';
import test from 'node:test';

import {
  parseProjectManifest,
  ProjectManifestValidationError,
} from '../dist/index.js';

const validManifest = {
  schemaVersion: 1,
  layoutVersion: 1,
  projectId: '9451cf18-18c8-4ddd-98b2-28ab65fb85b5',
  displayName: 'Demo Project',
  directoryName: 'demo-project--9451cf18-18c8-4ddd-98b2-28ab65fb85b5',
  createdAt: '2026-08-08T00:00:00.000Z',
  updatedAt: '2026-08-08T00:00:00.000Z',
};

test('parses a valid project manifest and preserves unknown fields', () => {
  const input = { ...validManifest, futureField: { enabled: true } };

  assert.equal(parseProjectManifest(input), input);
});

test('rejects unsupported manifest versions', () => {
  assert.throws(
    () => parseProjectManifest({ ...validManifest, schemaVersion: 2 }),
    ProjectManifestValidationError,
  );
});

test('rejects a directory name that does not belong to the project ID', () => {
  assert.throws(
    () => parseProjectManifest({ ...validManifest, directoryName: 'other-project' }),
    /must end with the project ID/,
  );
});
