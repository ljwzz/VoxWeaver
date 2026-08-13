import type {
  AppError,
  CoreEventEnvelope,
  CoreMethodName,
  CoreRequestEnvelope,
  CoreResponseEnvelope,
  CoreTrustedContext,
  JsonValue,
} from '@voxweaver/contracts';

import {
  CORE_PROTOCOL_VERSION,
  parseCoreRequestEnvelope,
} from '@voxweaver/contracts';

export type CoreProcessMessageListener = (message: unknown) => void;
export type CoreProcessExitListener = (exitCode: number) => void;

/**
 * The subset of Electron.UtilityProcess used by the transport. Keeping this
 * boundary structural lets Main inject the Electron process and keeps the
 * lifecycle logic unit-testable without loading Electron in Node.
 */
export interface CoreProcessHandle {
  readonly kill: () => boolean;
  readonly off: {
    (event: 'exit', listener: CoreProcessExitListener): unknown;
    (event: 'message', listener: CoreProcessMessageListener): unknown;
  };
  readonly on: {
    (event: 'exit', listener: CoreProcessExitListener): unknown;
    (event: 'message', listener: CoreProcessMessageListener): unknown;
  };
  readonly postMessage: (message: unknown) => void;
}

export interface CoreProcessLauncher {
  readonly fork: () => CoreProcessHandle;
}

export interface CoreProcessRequest<TPayload extends JsonValue = JsonValue> {
  readonly method: CoreMethodName;
  readonly payload: TPayload;
  readonly trustedContext: CoreTrustedContext;
}

export function createCoreRequestEnvelope<TPayload extends JsonValue>(
  requestId: string,
  request: CoreProcessRequest<TPayload>,
): CoreRequestEnvelope<TPayload> {
  return parseCoreRequestEnvelope({
    protocolVersion: CORE_PROTOCOL_VERSION,
    requestId,
    method: request.method,
    trustedContext: request.trustedContext,
    payload: request.payload,
  }) as CoreRequestEnvelope<TPayload>;
}

export function createCoreSuccessResponse<TResult extends JsonValue>(
  requestId: string,
  result: TResult,
): CoreResponseEnvelope<TResult> {
  return {
    protocolVersion: CORE_PROTOCOL_VERSION,
    requestId,
    ok: true,
    result,
  };
}

export function createCoreFailureResponse(
  requestId: string,
  error: AppError,
): CoreResponseEnvelope {
  return {
    protocolVersion: CORE_PROTOCOL_VERSION,
    requestId,
    ok: false,
    error,
  };
}

export function isCoreEventCandidate(value: unknown): boolean {
  return isRecord(value)
    && ('eventId' in value || 'eventType' in value || 'occurredAt' in value);
}

export function readCoreRequestId(value: unknown): string | undefined {
  if (!isRecord(value) || typeof value.requestId !== 'string' || value.requestId.length === 0)
    return undefined;

  return value.requestId;
}

export function readCoreParentMessage(value: unknown): unknown {
  if (isRecord(value) && 'data' in value)
    return value.data;

  return value;
}

export function isCoreProtocolMismatch(value: unknown): boolean {
  return isRecord(value)
    && 'protocolVersion' in value
    && value.protocolVersion !== CORE_PROTOCOL_VERSION;
}

export type ValidatedCoreEvent = CoreEventEnvelope;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
