import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  DESKTOP_EVENT_SCHEMA,
  DESKTOP_REQUEST_SCHEMA,
  DESKTOP_RESPONSE_SCHEMA,
  DesktopMessageValidationError,
  parseDesktopEvent,
  parseDesktopRequest,
  parseDesktopResponse,
} from '../dist/index.js';

const fixtures = await readJson(
  new URL('./fixtures/desktop-message.fixtures.json', import.meta.url),
);

const documentedSchemas = {
  request: await readJson(
    new URL('../../../docs/schemas/desktop-request.schema.json', import.meta.url),
  ),
  response: await readJson(
    new URL('../../../docs/schemas/desktop-response.schema.json', import.meta.url),
  ),
  event: await readJson(
    new URL('../../../docs/schemas/desktop-event.schema.json', import.meta.url),
  ),
};

test('keeps documented desktop schemas equal to runtime schemas', () => {
  assert.deepEqual(documentedSchemas.request, DESKTOP_REQUEST_SCHEMA);
  assert.deepEqual(documentedSchemas.response, DESKTOP_RESPONSE_SCHEMA);
  assert.deepEqual(documentedSchemas.event, DESKTOP_EVENT_SCHEMA);
});

test('keeps documented JSON fixture validation and runtime parsing aligned', () => {
  const validators = createDocumentedValidators();

  for (const fixture of fixtures) {
    const schemaAccepts = validators[fixture.kind](fixture.value);
    const parserAccepts = acceptsDesktopMessage(fixture.kind, fixture.value);

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

test('preserves compatible unknown desktop message fields', () => {
  const fixture = fixtures.find(
    fixture => fixture.name === 'valid request with exact project context and unknown envelope fields',
  );
  const input = structuredClone(fixture.value);

  assert.equal(parseDesktopRequest(input), input);
  assert.deepEqual(input.futureField, { enabled: true });
  assert.deepEqual(input.projectContext, {
    projectId: 'project-1',
    projectSessionId: 'session-1',
  });
});

test('rejects path-bearing fields in a public project context', () => {
  assert.throws(
    () => parseDesktopRequest({
      method: 'project.close',
      payload: {},
      projectContext: {
        projectDirectory: '/private/project',
        projectId: 'project-1',
        projectSessionId: 'session-1',
      },
      protocolVersion: '1',
      requestId: 'request-path',
    }),
    DesktopMessageValidationError,
  );
});

test('rejects non-JSON payloads, results, and error details', () => {
  assert.throws(
    () => parseDesktopRequest({
      protocolVersion: '1',
      requestId: 'request-1',
      method: 'app.getHealth',
      payload: { invalid: undefined },
    }),
    DesktopMessageValidationError,
  );
  assert.throws(
    () => parseDesktopResponse({
      protocolVersion: '1',
      requestId: 'request-2',
      ok: true,
      result: Number.NaN,
    }),
    DesktopMessageValidationError,
  );
  assert.throws(
    () => parseDesktopResponse({
      protocolVersion: '1',
      requestId: 'request-3',
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'Internal error',
        retryable: false,
        details: () => undefined,
      },
    }),
    DesktopMessageValidationError,
  );
  assert.throws(
    () => parseDesktopEvent({
      protocolVersion: '1',
      eventId: 'event-1',
      eventType: 'app.healthChanged',
      occurredAt: '2026-08-09T00:00:00.000Z',
      payload: Symbol('not-json'),
    }),
    DesktopMessageValidationError,
  );
  assert.throws(
    () => parseDesktopEvent({
      protocolVersion: '1',
      eventId: 'event-2',
      eventType: 'app.healthChanged',
      occurredAt: '2026-08-09T00:00:00.000Z',
      payload: 1n,
    }),
    DesktopMessageValidationError,
  );
});

test('rejects response branches with forbidden own properties', () => {
  assert.throws(
    () => parseDesktopResponse({
      protocolVersion: '1',
      requestId: 'request-4',
      ok: true,
      result: {},
      error: undefined,
    }),
    DesktopMessageValidationError,
  );
  assert.throws(
    () => parseDesktopResponse({
      protocolVersion: '1',
      requestId: 'request-5',
      ok: false,
      error: {
        code: 'INTERNAL',
        message: 'Internal error',
        retryable: false,
      },
      result: undefined,
    }),
    DesktopMessageValidationError,
  );
});

function acceptsDesktopMessage(kind, value) {
  try {
    switch (kind) {
      case 'request':
        parseDesktopRequest(value);
        break;
      case 'response':
        parseDesktopResponse(value);
        break;
      case 'event':
        parseDesktopEvent(value);
        break;
      default:
        throw new Error(`Unknown fixture kind: ${kind}`);
    }
    return true;
  } catch (error) {
    assert.ok(error instanceof DesktopMessageValidationError);
    return false;
  }
}

function createDocumentedValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  return {
    request: ajv.compile(documentedSchemas.request),
    response: ajv.compile(documentedSchemas.response),
    event: ajv.compile(documentedSchemas.event),
  };
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
