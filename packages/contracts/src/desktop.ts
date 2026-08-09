import type { ValidateFunction } from 'ajv';

import type { JsonValue } from './workflow.js';

import addFormatsModule from 'ajv-formats';
import Ajv2020Module from 'ajv/dist/2020.js';

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;

const NON_EMPTY_STRING = { type: 'string', minLength: 1 } as const;

const JSON_VALUE_DEFINITIONS = {
  jsonValue: {
    anyOf: [
      { type: 'null' },
      { type: 'boolean' },
      { type: 'number' },
      { type: 'string' },
      {
        type: 'array',
        items: { $ref: '#/$defs/jsonValue' },
      },
      {
        type: 'object',
        additionalProperties: { $ref: '#/$defs/jsonValue' },
      },
    ],
  },
} as const;

const JSON_VALUE_SCHEMA = { $ref: '#/$defs/jsonValue' } as const;

const DESKTOP_PROJECT_CONTEXT_SCHEMA = {
  type: 'object',
  required: ['projectId', 'projectSessionId'],
  properties: {
    projectId: NON_EMPTY_STRING,
    projectSessionId: NON_EMPTY_STRING,
  },
  additionalProperties: false,
} as const;

const DESKTOP_ERROR_SCHEMA = {
  type: 'object',
  required: ['code', 'message', 'retryable'],
  properties: {
    code: NON_EMPTY_STRING,
    message: NON_EMPTY_STRING,
    retryable: { type: 'boolean' },
    operationId: NON_EMPTY_STRING,
    details: JSON_VALUE_SCHEMA,
  },
  additionalProperties: true,
} as const;

export const DESKTOP_PROTOCOL_VERSION = '1' as const;

export interface DesktopProjectContextFields {
  readonly projectId: string;
  readonly projectSessionId: string;
}

export type DesktopProjectContext = DesktopProjectContextFields;

export interface DesktopRequestFields<TPayload extends JsonValue = JsonValue> {
  readonly protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly method: string;
  readonly projectContext?: DesktopProjectContext;
  readonly payload: TPayload;
}

export type DesktopRequest<TPayload extends JsonValue = JsonValue>
  = DesktopRequestFields<TPayload> & Record<string, unknown>;

export interface DesktopErrorFields {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
  readonly operationId?: string;
  readonly details?: JsonValue;
}

export type DesktopError = DesktopErrorFields & Record<string, unknown>;

export interface DesktopSuccessResponseFields<TResult extends JsonValue = JsonValue> {
  readonly protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly ok: true;
  readonly result: TResult;
}

export type DesktopSuccessResponse<TResult extends JsonValue = JsonValue>
  = DesktopSuccessResponseFields<TResult> & Record<string, unknown>;

export interface DesktopFailureResponseFields {
  readonly protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly ok: false;
  readonly error: DesktopError;
}

export type DesktopFailureResponse = DesktopFailureResponseFields & Record<string, unknown>;

export type DesktopResponse<TResult extends JsonValue = JsonValue>
  = | DesktopSuccessResponse<TResult>
    | DesktopFailureResponse;

export interface DesktopEventFields<TPayload extends JsonValue = JsonValue> {
  readonly protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly projectId?: string;
  readonly projectSessionId?: string;
  readonly payload: TPayload;
}

export type DesktopEvent<TPayload extends JsonValue = JsonValue>
  = DesktopEventFields<TPayload> & Record<string, unknown>;

export const DESKTOP_REQUEST_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/desktop-request.schema.json',
  title: 'VoxWeaver desktop request envelope',
  type: 'object',
  required: ['protocolVersion', 'requestId', 'method', 'payload'],
  properties: {
    protocolVersion: { const: DESKTOP_PROTOCOL_VERSION },
    requestId: NON_EMPTY_STRING,
    method: NON_EMPTY_STRING,
    projectContext: DESKTOP_PROJECT_CONTEXT_SCHEMA,
    payload: JSON_VALUE_SCHEMA,
  },
  additionalProperties: true,
  $defs: JSON_VALUE_DEFINITIONS,
} as const;

export const DESKTOP_RESPONSE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/desktop-response.schema.json',
  title: 'VoxWeaver desktop response envelope',
  type: 'object',
  required: ['protocolVersion', 'requestId', 'ok'],
  properties: {
    protocolVersion: { const: DESKTOP_PROTOCOL_VERSION },
    requestId: NON_EMPTY_STRING,
  },
  oneOf: [
    {
      required: ['ok', 'result'],
      properties: {
        ok: { const: true },
        result: JSON_VALUE_SCHEMA,
      },
      not: { required: ['error'] },
    },
    {
      required: ['ok', 'error'],
      properties: {
        ok: { const: false },
        error: DESKTOP_ERROR_SCHEMA,
      },
      not: { required: ['result'] },
    },
  ],
  additionalProperties: true,
  $defs: JSON_VALUE_DEFINITIONS,
} as const;

export const DESKTOP_EVENT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/desktop-event.schema.json',
  title: 'VoxWeaver desktop event envelope',
  type: 'object',
  required: [
    'protocolVersion',
    'eventId',
    'eventType',
    'occurredAt',
    'payload',
  ],
  properties: {
    protocolVersion: { const: DESKTOP_PROTOCOL_VERSION },
    eventId: NON_EMPTY_STRING,
    eventType: NON_EMPTY_STRING,
    occurredAt: { type: 'string', format: 'date-time' },
    projectId: NON_EMPTY_STRING,
    projectSessionId: NON_EMPTY_STRING,
    payload: JSON_VALUE_SCHEMA,
  },
  additionalProperties: true,
  $defs: JSON_VALUE_DEFINITIONS,
} as const;

const validators = createDesktopMessageValidators();

export class DesktopMessageValidationError extends Error {
  readonly code = 'DESKTOP_MESSAGE_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'DesktopMessageValidationError';
  }
}

export function parseDesktopRequest(value: unknown): DesktopRequest {
  const request = validateDesktopMessage<DesktopRequest>(
    value,
    validators.request,
    'Desktop request',
  );
  assertJsonValue(request.payload, 'Desktop request payload');
  return request;
}

export function parseDesktopResponse(value: unknown): DesktopResponse {
  const response = validateDesktopMessage<DesktopResponse>(
    value,
    validators.response,
    'Desktop response',
  );

  if (response.ok) {
    if ('error' in response)
      throw new DesktopMessageValidationError('Desktop success response must not contain error');

    assertJsonValue(response.result, 'Desktop response result');
  } else {
    if ('result' in response)
      throw new DesktopMessageValidationError('Desktop failure response must not contain result');

    if ('details' in response.error)
      assertJsonValue(response.error.details, 'Desktop response error details');
  }

  return response;
}

export function parseDesktopEvent(value: unknown): DesktopEvent {
  const event = validateDesktopMessage<DesktopEvent>(
    value,
    validators.event,
    'Desktop event',
  );
  assertJsonValue(event.payload, 'Desktop event payload');
  return event;
}

function validateDesktopMessage<T>(
  value: unknown,
  validate: ValidateFunction,
  dataName: string,
): T {
  if (!validate(value)) {
    throw new DesktopMessageValidationError(
      validators.ajv.errorsText(validate.errors, { dataVar: dataName }),
    );
  }

  return value as T;
}

function assertJsonValue(value: unknown, dataName: string): asserts value is JsonValue {
  if (isJsonValue(value))
    return;

  throw new DesktopMessageValidationError(`${dataName} must be a JSON value`);
}

function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): value is JsonValue {
  if (value === null)
    return true;

  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (ancestors.has(value))
        return false;

      if (Array.isArray(value)) {
        ancestors.add(value);
        const valid = value.every(item => isJsonValue(item, ancestors));
        ancestors.delete(value);
        return valid;
      }

      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null)
        return false;

      ancestors.add(value);
      const valid = Object.values(value).every(item => isJsonValue(item, ancestors));
      ancestors.delete(value);
      return valid;
    }
    default:
      return false;
  }
}

function createDesktopMessageValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  return {
    ajv,
    request: ajv.compile(DESKTOP_REQUEST_SCHEMA),
    response: ajv.compile(DESKTOP_RESPONSE_SCHEMA),
    event: ajv.compile(DESKTOP_EVENT_SCHEMA),
  };
}
