import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  parseProjectManifest,
  PROJECT_MANIFEST_SCHEMA,
  ProjectManifestValidationError,
} from '../dist/index.js';

const fixtures = await readJson(
  new URL('./fixtures/project-manifest.fixtures.json', import.meta.url),
);
const documentedSchema = await readJson(
  new URL('../../../docs/schemas/project-manifest.schema.json', import.meta.url),
);

test('keeps the documented schema equal to the runtime schema', () => {
  assert.deepEqual(documentedSchema, PROJECT_MANIFEST_SCHEMA);
});

test('keeps documented schema validation and runtime parsing aligned', () => {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  const validateDocumentedSchema = ajv.compile(documentedSchema);

  for (const fixture of fixtures) {
    const schemaAccepts = validateDocumentedSchema(fixture.manifest);
    const parserAccepts = acceptsManifest(fixture.manifest);

    assert.equal(
      schemaAccepts,
      fixture.valid,
      `${fixture.name}: documented schema result`,
    );
    assert.equal(
      parserAccepts,
      schemaAccepts,
      `${fixture.name}: runtime parser result`,
    );
  }
});

test('preserves unknown fields', () => {
  const input = {
    ...fixtures.find(fixture => fixture.name === 'valid with unknown fields').manifest,
  };

  assert.equal(parseProjectManifest(input), input);
  assert.deepEqual(input.futureField, { enabled: true });
});

test('throws the domain validation error for an invalid manifest', () => {
  assert.throws(
    () => parseProjectManifest({}),
    ProjectManifestValidationError,
  );
});

function acceptsManifest(manifest) {
  try {
    parseProjectManifest(manifest);
    return true;
  } catch (error) {
    assert.ok(error instanceof ProjectManifestValidationError);
    return false;
  }
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
