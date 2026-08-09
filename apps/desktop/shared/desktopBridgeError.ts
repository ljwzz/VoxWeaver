const DESKTOP_BRIDGE_ERROR_PREFIX = 'VOXWEAVER_DESKTOP_ERROR_V1:';

export interface SerializedDesktopBridgeError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

/**
 * Electron only guarantees an Error message across an isolated-world proxy.
 * Encode the three public, path-free error fields into that message so the
 * Renderer can recover stable semantics without receiving transport details.
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
      message: parsed.message,
      retryable: parsed.retryable,
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
    && typeof value.code === 'string'
    && /^[A-Z][A-Z0-9_]*$/.test(value.code)
    && typeof value.message === 'string'
    && value.message.length > 0
    && typeof value.retryable === 'boolean';
}

function readErrorMessage(value: unknown): string | undefined {
  if (value instanceof Error)
    return value.message;
  if (!isRecord(value))
    return undefined;
  return typeof value.message === 'string' ? value.message : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
