import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  DESKTOP_METHOD_PAYLOAD_SCHEMA,
  DESKTOP_METHOD_RESULT_SCHEMA,
  DesktopMethodValidationError,
  parseDesktopMethodPayload,
  parseDesktopMethodResult,
} from '../dist/index.js';

const fixtures = await readJson(
  new URL('./fixtures/desktop-method.fixtures.json', import.meta.url),
);

const documentedSchemas = {
  payload: await readJson(
    new URL('../../../docs/schemas/desktop-method-payload.schema.json', import.meta.url),
  ),
  result: await readJson(
    new URL('../../../docs/schemas/desktop-method-result.schema.json', import.meta.url),
  ),
};

test('keeps documented desktop method schemas equal to runtime schemas', () => {
  assert.deepEqual(documentedSchemas.payload, DESKTOP_METHOD_PAYLOAD_SCHEMA);
  assert.deepEqual(documentedSchemas.result, DESKTOP_METHOD_RESULT_SCHEMA);
});

test('keeps documented method fixture validation and runtime parsing aligned', () => {
  const validators = createDocumentedValidators();

  for (const fixture of fixtures) {
    const candidate = {
      method: fixture.method,
      [fixture.kind]: fixture.value,
    };
    const schemaAccepts = validators[fixture.kind](candidate);
    const parserAccepts = acceptsDesktopMethodFixture(fixture);

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

test('parses its own known payload branches', () => {
  assert.deepEqual(parseDesktopMethodPayload('app.getHealth', {}), {});
  assert.deepEqual(parseDesktopMethodPayload('dialog.selectDirectory', {
    purpose: 'create-project-parent',
  }), { purpose: 'create-project-parent' });
  assert.deepEqual(parseDesktopMethodPayload('project.create', {
    displayName: 'Sample',
    selectionToken: 'token-1',
  }), { displayName: 'Sample', selectionToken: 'token-1' });
  assert.deepEqual(parseDesktopMethodPayload('project.open', {
    selectionToken: 'token-1',
  }), { selectionToken: 'token-1' });
  assert.deepEqual(parseDesktopMethodPayload('project.open', {
    recentProjectId: 'project-1',
    accessMode: 'read-only',
  }), { recentProjectId: 'project-1', accessMode: 'read-only' });
  assert.deepEqual(parseDesktopMethodPayload('project.removeRecent', {
    projectId: 'project-1',
  }), { projectId: 'project-1' });
  assert.deepEqual(parseDesktopMethodPayload('project.switch', {
    selectionToken: 'token-1',
  }), { selectionToken: 'token-1' });
});

test('rejects desktop method payloads with conflicting open selectors', () => {
  assert.throws(
    () => parseDesktopMethodPayload('project.open', {
      recentProjectId: 'project-1',
      selectionToken: 'token-1',
    }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodPayload('project.open', {}),
    DesktopMethodValidationError,
  );
});

test('rejects unknown methods with a dedicated error before payload validation', () => {
  assert.throws(
    () => parseDesktopMethodPayload('app.unknown', {}),
    error => error instanceof DesktopMethodValidationError
      && error.code === 'DESKTOP_METHOD_NOT_FOUND',
  );
  assert.throws(
    () => parseDesktopMethodResult('app.unknown', {}),
    error => error instanceof DesktopMethodValidationError
      && error.code === 'DESKTOP_METHOD_NOT_FOUND',
  );
});

test('rejects desktop method payloads with invalid branch fields', () => {
  assert.throws(
    () => parseDesktopMethodPayload('dialog.selectDirectory', {
      purpose: 'publish-release',
    }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodPayload('project.create', {
      displayName: '',
      selectionToken: 'token-1',
    }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodPayload('project.removeRecent', {
      projectId: '',
    }),
    DesktopMethodValidationError,
  );
});

test('parses matching desktop method results', () => {
  assert.deepEqual(parseDesktopMethodResult('app.getHealth', {
    healthy: true,
  }), { healthy: true });
  assert.deepEqual(parseDesktopMethodResult('dialog.selectDirectory', {
    canceled: true,
  }), { canceled: true });
  assert.deepEqual(parseDesktopMethodResult('dialog.selectDirectory', {
    canceled: false,
    displayName: 'Workspace',
    expiresAt: '2026-08-09T00:05:00.000Z',
    selectionToken: 'token-1',
  }), {
    canceled: false,
    displayName: 'Workspace',
    expiresAt: '2026-08-09T00:05:00.000Z',
    selectionToken: 'token-1',
  });
  assert.deepEqual(parseDesktopMethodResult('project.close', null), null);
  assert.deepEqual(parseDesktopMethodResult('project.getSummary', null), null);
  assert.deepEqual(parseDesktopMethodResult('project.getSummary', {
    projectId: 'project-1',
    projectSessionId: 'session-1',
    displayName: 'Sample',
    accessMode: 'read-write',
    layoutVersion: 2,
  }), {
    projectId: 'project-1',
    projectSessionId: 'session-1',
    displayName: 'Sample',
    accessMode: 'read-write',
    layoutVersion: 2,
  });
  assert.deepEqual(parseDesktopMethodResult('project.listRecent', {
    projects: [{
      projectId: 'project-1',
      displayName: 'Sample',
      lastOpenedAt: '2026-08-09T00:00:00.000Z',
      availability: 'available',
    }],
  }), {
    projects: [{
      projectId: 'project-1',
      displayName: 'Sample',
      lastOpenedAt: '2026-08-09T00:00:00.000Z',
      availability: 'available',
    }],
  });
});

test('rejects invalid desktop method results', () => {
  assert.throws(
    () => parseDesktopMethodResult('app.getHealth', { healthy: false }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodResult('dialog.selectDirectory', {
      canceled: true,
      selectionToken: 'token-1',
    }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodResult('dialog.selectDirectory', {
      canceled: false,
      selectionToken: 'token-1',
    }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodResult('project.getSummary', {
      projectId: 'project-1',
      projectSessionId: 'session-1',
      displayName: 'Sample',
      accessMode: 'read-write',
    }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodResult('project.close', {}),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodResult('project.listRecent', { projects: [{
      projectId: 'project-1',
      displayName: 'Sample',
      lastOpenedAt: '2026-08-09T00:00:00.000Z',
    }] }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodResult('project.getSummary', {
      accessMode: 'read-write',
      displayName: 'Sample',
      layoutVersion: 2,
      projectDirectory: '/private/project',
      projectId: 'project-1',
      projectSessionId: 'session-1',
    }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodResult('project.listRecent', { projects: [{
      availability: 'available',
      displayName: 'Sample',
      lastOpenedAt: '2026-08-09T00:00:00.000Z',
      projectDirectory: '/private/project',
      projectId: 'project-1',
    }] }),
    DesktopMethodValidationError,
  );
});

test('preserves compatible unknown method payload fields but closes public result DTOs', () => {
  const payload = parseDesktopMethodPayload('project.create', {
    displayName: 'Sample',
    selectionToken: 'token-1',
    futureField: { enabled: true },
  });
  assert.deepEqual(payload.futureField, { enabled: true });

  assert.throws(
    () => parseDesktopMethodResult('app.getHealth', {
      healthy: true,
      futureField: { enabled: true },
    }),
    DesktopMethodValidationError,
  );
});

test('rejects non-JSON payload and result values', () => {
  assert.throws(
    () => parseDesktopMethodPayload('project.create', {
      displayName: 'Sample',
      selectionToken: 'token-1',
      invalid: undefined,
    }),
    DesktopMethodValidationError,
  );
  assert.throws(
    () => parseDesktopMethodResult('app.getHealth', {
      healthy: true,
      invalid: Number.NaN,
    }),
    DesktopMethodValidationError,
  );
});

function acceptsDesktopMethodFixture(fixture) {
  try {
    if (fixture.kind === 'payload')
      parseDesktopMethodPayload(fixture.method, fixture.value);
    else if (fixture.kind === 'result')
      parseDesktopMethodResult(fixture.method, fixture.value);
    else
      throw new Error(`Unknown fixture kind: ${fixture.kind}`);

    return true;
  } catch (error) {
    assert.ok(error instanceof DesktopMethodValidationError);
    return false;
  }
}

function createDocumentedValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  return {
    payload: ajv.compile(documentedSchemas.payload),
    result: ajv.compile(documentedSchemas.result),
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
