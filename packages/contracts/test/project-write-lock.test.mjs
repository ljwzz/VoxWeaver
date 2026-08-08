import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  parseProjectWriteLock,
  PROJECT_WRITE_LOCK_SCHEMA,
  ProjectWriteLockValidationError,
} from '../dist/index.js';

const documentedSchema = await readJson(
  new URL('../../../docs/schemas/project-write-lock.schema.json', import.meta.url),
);
const validWriteLock = {
  schemaVersion: 1,
  projectId: '123e4567-e89b-42d3-a456-426614174000',
  projectSessionId: '8ac1244a-17d4-441c-bfe4-762473023e16',
  processId: 4321,
  hostname: 'workstation.local',
  acquiredAt: '2026-08-08T08:00:00Z',
};

test('keeps the documented write lock schema equal to the runtime schema', () => {
  assert.deepEqual(documentedSchema, PROJECT_WRITE_LOCK_SCHEMA);
});

test('accepts a valid project write lock', () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  assert.equal(ajv.compile(documentedSchema)(validWriteLock), true);
  assert.equal(parseProjectWriteLock(validWriteLock), validWriteLock);
});

test('keeps documented schema validation and runtime parsing aligned for invalid write locks', () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validateDocumentedSchema = ajv.compile(documentedSchema);
  const invalidWriteLocks = [
    {},
    { ...validWriteLock, schemaVersion: 2 },
    { ...validWriteLock, projectId: '123e4567-e89b-12d3-a456-426614174000' },
    { ...validWriteLock, projectSessionId: 'not-a-uuid' },
    { ...validWriteLock, processId: 0 },
    { ...validWriteLock, processId: 1.5 },
    { ...validWriteLock, hostname: '' },
    { ...validWriteLock, hostname: 'h'.repeat(256) },
    { ...validWriteLock, acquiredAt: 'not-a-date-time' },
  ];

  for (const writeLock of invalidWriteLocks) {
    assert.equal(validateDocumentedSchema(writeLock), false);
    assert.throws(
      () => parseProjectWriteLock(writeLock),
      ProjectWriteLockValidationError,
    );
  }
});

test('preserves unknown project write lock fields', () => {
  const input = {
    ...validWriteLock,
    futureField: { enabled: true },
  };

  assert.equal(parseProjectWriteLock(input), input);
  assert.deepEqual(input.futureField, { enabled: true });
});

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
