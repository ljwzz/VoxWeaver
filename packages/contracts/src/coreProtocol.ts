import type { AppError } from './project.ts';
import { isAppErrorCode, isNonEmptyString, isRecord } from './project.ts';

export const CORE_PROTOCOL_VERSION = 1 as const;

export const CORE_METHODS = Object.freeze({
  getHealth: 'system.getCoreHealth',
  createProject: 'project.create',
  inspectProject: 'project.inspect',
  openProject: 'project.open',
  confirmProjectOpen: 'project.confirmOpen',
  listRecentProjects: 'project.listRecent',
  removeRecentProject: 'project.removeRecent',
  getBootstrap: 'project.getBootstrap',
  recordLastPage: 'project.recordLastPage',
  closeProject: 'project.close',
  recoverProjectSession: 'project.recoverSession',
  novelImportProbe: 'novelImport.probe',
  novelImportStart: 'novelImport.start',
  novelImportGetTask: 'novelImport.getTask',
  novelImportCancelTask: 'novelImport.cancelTask',
  novelImportRetryTask: 'novelImport.retryTask',
  novelImportGetReviewSnapshot: 'novelImport.getReviewSnapshot',
  novelImportGetTextSlice: 'novelImport.getTextSlice',
  novelImportPreviewReview: 'novelImport.previewReview',
  novelImportApplyReview: 'novelImport.applyReview',
  shutdown: 'system.shutdown',
} as const);

export type CoreMethodName = typeof CORE_METHODS[keyof typeof CORE_METHODS];
export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonPrimitive | readonly JsonValue[] | { readonly [key: string]: JsonValue };

export interface CoreTrustedContext {
  readonly appInstanceId: string;
  readonly webContentsId: number;
  readonly windowKind: 'startup' | 'project';
  readonly projectId?: string;
  readonly projectSessionId?: string;
}

export interface CoreRequestEnvelope<TPayload extends JsonValue = JsonValue> {
  readonly protocolVersion: typeof CORE_PROTOCOL_VERSION;
  readonly requestId: string;
  readonly method: CoreMethodName;
  readonly trustedContext: CoreTrustedContext;
  readonly payload: TPayload;
}

export type CoreResponseEnvelope<TResult extends JsonValue = JsonValue>
  = | {
    readonly protocolVersion: typeof CORE_PROTOCOL_VERSION;
    readonly requestId: string;
    readonly ok: true;
    readonly result: TResult;
  }
  | {
    readonly protocolVersion: typeof CORE_PROTOCOL_VERSION;
    readonly requestId: string;
    readonly ok: false;
    readonly error: AppError;
  };

export interface CoreEventEnvelope<TPayload extends JsonValue = JsonValue> {
  readonly protocolVersion: typeof CORE_PROTOCOL_VERSION;
  readonly eventId: string;
  readonly eventType: string;
  readonly occurredAt: string;
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly payload: TPayload;
}

export const CORE_REQUEST_ENVELOPE_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['protocolVersion', 'requestId', 'method', 'trustedContext', 'payload'],
  additionalProperties: true,
} as const);

export const CORE_RESPONSE_ENVELOPE_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['protocolVersion', 'requestId', 'ok'],
  additionalProperties: true,
} as const);

export const CORE_EVENT_ENVELOPE_SCHEMA = Object.freeze({
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  type: 'object',
  required: ['protocolVersion', 'eventId', 'eventType', 'occurredAt', 'projectId', 'projectSessionId', 'payload'],
  additionalProperties: true,
} as const);

export class CoreEnvelopeValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CoreEnvelopeValidationError';
  }
}

export function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): value is JsonValue {
  if (value === null)
    return true;
  if (typeof value === 'string' || typeof value === 'boolean')
    return true;
  if (typeof value === 'number')
    return Number.isFinite(value);
  if (typeof value !== 'object' || ancestors.has(value))
    return false;

  ancestors.add(value);
  const valid = Array.isArray(value)
    ? value.every(item => isJsonValue(item, ancestors))
    : (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null)
      && Object.values(value).every(item => isJsonValue(item, ancestors));
  ancestors.delete(value);
  return valid;
}

function parseProtocolVersion(value: unknown): typeof CORE_PROTOCOL_VERSION {
  if (value !== CORE_PROTOCOL_VERSION)
    throw new CoreEnvelopeValidationError('Core protocol version is unsupported.');
  return CORE_PROTOCOL_VERSION;
}

function parseTrustedContext(value: unknown): CoreTrustedContext {
  if (!isRecord(value)
    || !isNonEmptyString(value.appInstanceId)
    || !Number.isSafeInteger(value.webContentsId)
    || (value.windowKind !== 'startup' && value.windowKind !== 'project')) {
    throw new CoreEnvelopeValidationError('Core trusted context is invalid.');
  }

  const projectId = value.projectId;
  const projectSessionId = value.projectSessionId;
  if (value.windowKind === 'project'
    && (!isNonEmptyString(projectId) || !isNonEmptyString(projectSessionId))) {
    throw new CoreEnvelopeValidationError('Project trusted context is incomplete.');
  }
  if ((projectId !== undefined && !isNonEmptyString(projectId))
    || (projectSessionId !== undefined && !isNonEmptyString(projectSessionId))) {
    throw new CoreEnvelopeValidationError('Core project session identity is invalid.');
  }

  return {
    appInstanceId: value.appInstanceId,
    webContentsId: value.webContentsId as number,
    windowKind: value.windowKind,
    ...(projectId === undefined ? {} : { projectId }),
    ...(projectSessionId === undefined ? {} : { projectSessionId }),
  };
}

export function parseCoreRequestEnvelope(value: unknown): CoreRequestEnvelope {
  if (!isRecord(value)
    || !isNonEmptyString(value.requestId)
    || !isNonEmptyString(value.method)
    || !Object.values(CORE_METHODS).includes(value.method as CoreMethodName)
    || !isJsonValue(value.payload)) {
    throw new CoreEnvelopeValidationError('Core request envelope is invalid.');
  }

  return {
    protocolVersion: parseProtocolVersion(value.protocolVersion),
    requestId: value.requestId,
    method: value.method as CoreMethodName,
    trustedContext: parseTrustedContext(value.trustedContext),
    payload: value.payload,
  };
}

function parseAppError(value: unknown): AppError {
  if (!isRecord(value)
    || !isAppErrorCode(value.code)
    || !isNonEmptyString(value.message)
    || typeof value.retryable !== 'boolean') {
    throw new CoreEnvelopeValidationError('Core response error is invalid.');
  }
  if (value.details !== undefined && !isRecord(value.details))
    throw new CoreEnvelopeValidationError('Core response error details are invalid.');

  return {
    code: value.code,
    message: value.message,
    retryable: value.retryable,
    ...(value.details === undefined ? {} : { details: value.details }),
  };
}

export function parseCoreResponseEnvelope(value: unknown): CoreResponseEnvelope {
  if (!isRecord(value) || !isNonEmptyString(value.requestId) || typeof value.ok !== 'boolean')
    throw new CoreEnvelopeValidationError('Core response envelope is invalid.');
  const protocolVersion = parseProtocolVersion(value.protocolVersion);

  if (value.ok) {
    if ('error' in value || !isJsonValue(value.result))
      throw new CoreEnvelopeValidationError('Core success response is invalid.');
    return { protocolVersion, requestId: value.requestId, ok: true, result: value.result };
  }

  if ('result' in value)
    throw new CoreEnvelopeValidationError('Core failure response is invalid.');
  return {
    protocolVersion,
    requestId: value.requestId,
    ok: false,
    error: parseAppError(value.error),
  };
}

export function parseCoreEventEnvelope(value: unknown): CoreEventEnvelope {
  if (!isRecord(value)
    || !isNonEmptyString(value.eventId)
    || !isNonEmptyString(value.eventType)
    || !isNonEmptyString(value.occurredAt)
    || Number.isNaN(Date.parse(value.occurredAt))
    || !isNonEmptyString(value.projectId)
    || !isNonEmptyString(value.projectSessionId)
    || !isJsonValue(value.payload)) {
    throw new CoreEnvelopeValidationError('Core event envelope is invalid.');
  }

  return {
    protocolVersion: parseProtocolVersion(value.protocolVersion),
    eventId: value.eventId,
    eventType: value.eventType,
    occurredAt: value.occurredAt,
    projectId: value.projectId,
    projectSessionId: value.projectSessionId,
    payload: value.payload,
  };
}
