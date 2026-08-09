/**
 * Private Main-to-Core transport messages. These are never exposed through
 * preload and may contain Main-validated filesystem context.
 */
export const CORE_INIT_MESSAGE_TYPE = 'voxweaver.core.init.v1' as const;
export const CORE_REQUEST_MESSAGE_TYPE = 'voxweaver.core.request.v1' as const;
export const CORE_RESPONSE_MESSAGE_TYPE = 'voxweaver.core.response.v1' as const;

export type DirectorySelectionPurpose
  = | 'create-project-parent'
    | 'open-project'
    | 'switch-project';

export interface CoreTrustedRequestContext {
  readonly projectDirectory?: string;
  readonly selectionPurpose?: DirectorySelectionPurpose;
  readonly selectionToken?: string;
}

export interface CoreInitControlMessage {
  readonly type: typeof CORE_INIT_MESSAGE_TYPE;
  readonly userDataDirectory: string;
}

export interface CoreWireRequest {
  readonly messageId: string;
  readonly request: unknown;
  readonly trustedContext?: CoreTrustedRequestContext;
  readonly type: typeof CORE_REQUEST_MESSAGE_TYPE;
}

export interface CoreWireResponse {
  readonly messageId: string;
  readonly response: unknown;
  readonly type: typeof CORE_RESPONSE_MESSAGE_TYPE;
}

export interface CoreMessageEvent {
  readonly data: unknown;
}

export interface CoreMessagePort {
  readonly addEventListener?: (
    type: 'close' | 'message',
    listener: (event: CoreMessageEvent) => void,
  ) => void;
  readonly close?: () => void;
  readonly off?: (
    type: 'close' | 'message',
    listener: (event: CoreMessageEvent) => void,
  ) => void;
  readonly on?: (
    type: 'close' | 'message',
    listener: (event: CoreMessageEvent) => void,
  ) => unknown;
  readonly postMessage: (message: unknown) => void;
  readonly removeEventListener?: (
    type: 'close' | 'message',
    listener: (event: CoreMessageEvent) => void,
  ) => void;
  readonly start?: () => void;
}

export function createCoreInitControlMessage(
  userDataDirectory: string,
): CoreInitControlMessage {
  if (!isNonEmptyString(userDataDirectory))
    throw new TypeError('The Core user-data directory is required.');

  return {
    type: CORE_INIT_MESSAGE_TYPE,
    userDataDirectory,
  };
}

export function createCoreWireRequest(
  messageId: string,
  request: unknown,
  trustedContext?: CoreTrustedRequestContext,
): CoreWireRequest {
  if (!isNonEmptyString(messageId))
    throw new TypeError('The Core message ID is required.');

  return trustedContext === undefined
    ? {
        messageId,
        request,
        type: CORE_REQUEST_MESSAGE_TYPE,
      }
    : {
        messageId,
        request,
        trustedContext,
        type: CORE_REQUEST_MESSAGE_TYPE,
      };
}

export function createCoreWireResponse(
  messageId: string,
  response: unknown,
): CoreWireResponse {
  if (!isNonEmptyString(messageId))
    throw new TypeError('The Core message ID is required.');

  return {
    messageId,
    response,
    type: CORE_RESPONSE_MESSAGE_TYPE,
  };
}

export function isCoreInitControlMessage(
  value: unknown,
): value is CoreInitControlMessage {
  return isRecord(value)
    && value.type === CORE_INIT_MESSAGE_TYPE
    && isNonEmptyString(value.userDataDirectory);
}

export function isCoreWireRequest(value: unknown): value is CoreWireRequest {
  return isRecord(value)
    && value.type === CORE_REQUEST_MESSAGE_TYPE
    && isNonEmptyString(value.messageId)
    && hasOwn(value, 'request')
    && (value.trustedContext === undefined
      || isCoreTrustedRequestContext(value.trustedContext));
}

export function isCoreWireResponse(value: unknown): value is CoreWireResponse {
  return isRecord(value)
    && value.type === CORE_RESPONSE_MESSAGE_TYPE
    && isNonEmptyString(value.messageId)
    && hasOwn(value, 'response');
}

export function subscribeToCorePortMessages(
  port: CoreMessagePort,
  listener: (message: unknown) => void,
): () => void {
  const eventListener = (event: CoreMessageEvent) => {
    listener(readCoreMessageEvent(event));
  };

  port.start?.();
  if (port.addEventListener && port.removeEventListener) {
    port.addEventListener('message', eventListener);
    return () => port.removeEventListener?.('message', eventListener);
  }

  if (port.on && port.off) {
    port.on('message', eventListener);
    return () => port.off?.('message', eventListener);
  }

  throw new TypeError('The Core message port does not support message listeners.');
}

export function subscribeToCorePortClose(
  port: CoreMessagePort,
  listener: () => void,
): () => void {
  const eventListener = () => listener();
  if (port.addEventListener && port.removeEventListener) {
    port.addEventListener('close', eventListener);
    return () => port.removeEventListener?.('close', eventListener);
  }

  if (port.on && port.off) {
    port.on('close', eventListener);
    return () => port.off?.('close', eventListener);
  }

  return () => {};
}

export function readCoreMessageEvent(event: unknown): unknown {
  if (isRecord(event) && hasOwn(event, 'data'))
    return event.data;
  return event;
}

function isCoreTrustedRequestContext(
  value: unknown,
): value is CoreTrustedRequestContext {
  if (!isRecord(value))
    return false;

  const { projectDirectory, selectionPurpose, selectionToken } = value;
  return (projectDirectory === undefined || typeof projectDirectory === 'string')
    && (selectionToken === undefined || typeof selectionToken === 'string')
    && (selectionPurpose === undefined || isDirectorySelectionPurpose(selectionPurpose));
}

function isDirectorySelectionPurpose(
  value: unknown,
): value is DirectorySelectionPurpose {
  return value === 'create-project-parent'
    || value === 'open-project'
    || value === 'switch-project';
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasOwn(value: object, key: PropertyKey): boolean {
  return Object.hasOwn(value, key);
}
