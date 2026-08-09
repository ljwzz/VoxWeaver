const DESKTOP_BRIDGE_ERROR_PREFIX = 'VOXWEAVER_DESKTOP_ERROR_V1:';

export interface SerializedDesktopBridgeError {
  readonly code: string;
  readonly currentArtifactRevisionId?: string;
  readonly message: string;
  readonly operationId?: string;
  readonly retryable: boolean;
  readonly taskId?: string;
}

/**
 * Electron only guarantees an Error message across an isolated-world proxy.
 * Encode the public, path-free fields into that message so the Renderer can
 * recover stable semantics without receiving transport details.
 */
export function encodeDesktopBridgeError(
  error: SerializedDesktopBridgeError,
): string {
  assertDesktopBridgeError(error);
  return `${DESKTOP_BRIDGE_ERROR_PREFIX}${JSON.stringify(error)}`;
}

export function decodeDesktopBridgeError(
  value: unknown,
): SerializedDesktopBridgeError | undefined {
  const message = readErrorMessage(value);
  if (message === undefined)
    return undefined;

  const prefixIndex = message.indexOf(DESKTOP_BRIDGE_ERROR_PREFIX);
  if (prefixIndex < 0)
    return undefined;

  try {
    const parsed: unknown = JSON.parse(message.slice(
      prefixIndex + DESKTOP_BRIDGE_ERROR_PREFIX.length,
    ));
    if (!isDesktopBridgeError(parsed))
      return undefined;
    return {
      code: parsed.code,
      ...(parsed.currentArtifactRevisionId === undefined
        ? {}
        : { currentArtifactRevisionId: parsed.currentArtifactRevisionId }),
      message: parsed.message,
      ...(parsed.operationId === undefined
        ? {}
        : { operationId: parsed.operationId }),
      retryable: parsed.retryable,
      ...(parsed.taskId === undefined ? {} : { taskId: parsed.taskId }),
    };
  } catch {
    return undefined;
  }
}

function assertDesktopBridgeError(
  value: SerializedDesktopBridgeError,
): void {
  if (!isDesktopBridgeError(value))
    throw new TypeError('The desktop bridge error is invalid.');
}

function isDesktopBridgeError(
  value: unknown,
): value is SerializedDesktopBridgeError {
  return isRecord(value)
    && hasOnlyBridgeErrorKeys(value)
    && typeof value.code === 'string'
    && /^[A-Z][A-Z0-9_]*$/.test(value.code)
    && typeof value.message === 'string'
    && value.message.length > 0
    && !containsAbsolutePath(value.message)
    && typeof value.retryable === 'boolean'
    && optionalOpaqueId(value, 'operationId')
    && optionalUuidV4(value, 'taskId')
    && optionalUuidV4(value, 'currentArtifactRevisionId');
}

const BRIDGE_ERROR_REQUIRED_KEYS = ['code', 'message', 'retryable'] as const;
const BRIDGE_ERROR_ALLOWED_KEYS = new Set([
  ...BRIDGE_ERROR_REQUIRED_KEYS,
  'currentArtifactRevisionId',
  'operationId',
  'taskId',
]);
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function hasOnlyBridgeErrorKeys(value: Record<string, unknown>): boolean {
  return BRIDGE_ERROR_REQUIRED_KEYS.every(key => Object.hasOwn(value, key))
    && Object.keys(value).every(key => BRIDGE_ERROR_ALLOWED_KEYS.has(key));
}

function optionalOpaqueId(
  value: Record<string, unknown>,
  property: 'operationId',
): boolean {
  if (!Object.hasOwn(value, property))
    return true;
  const identifier = value[property];
  return typeof identifier === 'string'
    && identifier.length > 0
    && identifier.length <= 200
    && identifier.trimStart() === identifier
    && identifier.trimEnd() === identifier
    && !identifier.includes('/')
    && !identifier.includes('\\')
    && !identifier.includes('\0');
}

function optionalUuidV4(
  value: Record<string, unknown>,
  property: 'currentArtifactRevisionId' | 'taskId',
): boolean {
  if (!Object.hasOwn(value, property))
    return true;
  const identifier = value[property];
  return typeof identifier === 'string' && UUID_V4_PATTERN.test(identifier);
}

function readErrorMessage(value: unknown): string | undefined {
  if (value instanceof Error)
    return value.message;
  if (!isRecord(value))
    return undefined;
  return typeof value.message === 'string' ? value.message : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value))
    return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function containsAbsolutePath(value: string): boolean {
  return /(?:^|[\s"'(])\/\S*|[A-Z]:[\\/]/i.test(value);
}
