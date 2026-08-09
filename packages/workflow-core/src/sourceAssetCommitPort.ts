import type { SourceAssetRecord } from '@voxweaver/contracts';

export const SOURCE_ASSET_COMMIT_ERROR_CODES = [
  'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
  'SOURCE_ASSET_COMMIT_CONTENT_MISMATCH',
  'SOURCE_ASSET_COMMIT_DUPLICATE',
  'SOURCE_ASSET_COMMIT_CONFLICT',
  'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
] as const;

export type SourceAssetCommitErrorCode
  = typeof SOURCE_ASSET_COMMIT_ERROR_CODES[number];

/**
 * Identifies an already-written file below the active project's `tmp/` root.
 * The port never accepts a project directory or another absolute path.
 */
export interface SourceAssetTemporarySource {
  readonly relativePath: string;
}

export interface SourceAssetCommitCommand {
  readonly temporarySource: SourceAssetTemporarySource;
  readonly expectedContentHash: string;
  readonly expectedByteLength: number;
  readonly originalName: string;
  readonly sourceType: string;
  readonly createdBy: string;
  /**
   * An opaque retry key. Reusing it with the same immutable intent returns the
   * original record; reusing it with different intent is a conflict.
   */
  readonly idempotencyKey: string;
}

/** Immutable-content identity, excluding temporary path, key, and creator. */
export interface SourceAssetCommitIdentity {
  readonly expectedContentHash: string;
  readonly expectedByteLength: number;
  readonly originalName: string;
  readonly sourceType: string;
}

/**
 * Full intent bound to an idempotency key. The temporary path is excluded
 * because a successful first attempt may consume it before an exact retry.
 */
export interface SourceAssetCommitIntent extends SourceAssetCommitIdentity {
  readonly createdBy: string;
}

export type SourceAssetCommitAttemptClassification
  = | 'new'
    | 'idempotent'
    | 'duplicate'
    | 'conflict';

export type SourceAssetCommitResult = SourceAssetRecord;

/**
 * A capability view implemented by the same project workflow object that
 * implements `ProjectWorkflowPort`.
 *
 * Implementations validate hash and size before publishing, never replace a
 * registered record or its immutable file, and return the original record for
 * an exact idempotent retry.
 */
export interface SourceAssetCommitPort {
  readonly commitSourceAsset: (
    command: SourceAssetCommitCommand,
  ) => Promise<SourceAssetCommitResult>;
}

/**
 * Stable failure boundary for implementations:
 *
 * - `CONTENT_MISMATCH`: measured bytes differ from the expected hash or size;
 * - `DUPLICATE`: another key already owns the same immutable identity;
 * - `CONFLICT`: a key is rebound or a reserved target has different content;
 * - `RECOVERY_REQUIRED`: the implementation cannot prove the commit outcome.
 */
export class SourceAssetCommitError extends Error {
  readonly cause: unknown;
  readonly code: SourceAssetCommitErrorCode;

  constructor(
    code: SourceAssetCommitErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'SourceAssetCommitError';
    this.code = code;
    this.cause = cause;
  }
}

export function getSourceAssetCommitIntent(
  value: unknown,
): SourceAssetCommitIntent {
  const command = parseSourceAssetCommitCommand(value);
  return sourceAssetCommitIntentFrom(command);
}

export function getSourceAssetCommitIdentity(
  value: unknown,
): SourceAssetCommitIdentity {
  const command = parseSourceAssetCommitCommand(value);
  return sourceAssetCommitIdentityFrom(command);
}

export function classifySourceAssetCommitAttempt(
  existingKey: string,
  existingIntent: SourceAssetCommitIntent,
  nextCommand: unknown,
): SourceAssetCommitAttemptClassification {
  const command = parseSourceAssetCommitCommand(nextCommand);
  const nextIntent = sourceAssetCommitIntentFrom(command);
  if (existingKey === command.idempotencyKey) {
    return sourceAssetCommitIntentsEqual(existingIntent, nextIntent)
      ? 'idempotent'
      : 'conflict';
  }
  return sourceAssetCommitIdentitiesEqual(existingIntent, nextIntent)
    ? 'duplicate'
    : 'new';
}

function sourceAssetCommitIdentityFrom(
  command: SourceAssetCommitCommand,
): SourceAssetCommitIdentity {
  return {
    expectedContentHash: command.expectedContentHash,
    expectedByteLength: command.expectedByteLength,
    originalName: command.originalName,
    sourceType: command.sourceType,
  };
}

function sourceAssetCommitIntentFrom(
  command: SourceAssetCommitCommand,
): SourceAssetCommitIntent {
  return {
    ...sourceAssetCommitIdentityFrom(command),
    createdBy: command.createdBy,
  };
}

function sourceAssetCommitIdentitiesEqual(
  left: SourceAssetCommitIdentity,
  right: SourceAssetCommitIdentity,
): boolean {
  return left.expectedContentHash === right.expectedContentHash
    && left.expectedByteLength === right.expectedByteLength
    && left.originalName === right.originalName
    && left.sourceType === right.sourceType;
}

function sourceAssetCommitIntentsEqual(
  left: SourceAssetCommitIntent,
  right: SourceAssetCommitIntent,
): boolean {
  return sourceAssetCommitIdentitiesEqual(left, right)
    && left.createdBy === right.createdBy;
}

export function parseSourceAssetCommitCommand(
  value: unknown,
): SourceAssetCommitCommand {
  if (!isRecord(value))
    invalid('Source asset commit command must be an object.');

  assertExactKeys(value, [
    'temporarySource',
    'expectedContentHash',
    'expectedByteLength',
    'originalName',
    'sourceType',
    'createdBy',
    'idempotencyKey',
  ], 'command');
  const command = value as Partial<SourceAssetCommitCommand>;
  if (!isRecord(command.temporarySource))
    invalid('Source asset commit temporarySource is required.');

  assertExactKeys(
    command.temporarySource,
    ['relativePath'],
    'temporarySource',
  );
  assertTemporaryRelativePath(command.temporarySource.relativePath);
  assertSha256(command.expectedContentHash);
  assertExpectedByteLength(command.expectedByteLength);
  assertPortableOriginalName(command.originalName);
  assertNonEmpty(command.sourceType, 'sourceType');
  assertNonEmpty(command.createdBy, 'createdBy');
  assertNonEmpty(command.idempotencyKey, 'idempotencyKey');
  return value as unknown as SourceAssetCommitCommand;
}

export function isSourceAssetCommitErrorCode(
  value: unknown,
): value is SourceAssetCommitErrorCode {
  return typeof value === 'string'
    && (SOURCE_ASSET_COMMIT_ERROR_CODES as readonly string[]).includes(value);
}

function assertTemporaryRelativePath(value: unknown): void {
  assertNonEmpty(value, 'temporarySource.relativePath');
  const path = value as string;
  if (path.includes('\\') || containsControlCharacter(path)) {
    invalid(
      'Source asset temporarySource.relativePath must be a portable project-relative path.',
    );
  }

  const components = path.split('/');
  if (
    components[0] !== 'tmp'
    || components.length < 2
    || components.some(component => !isPortablePathComponent(component))
  ) {
    invalid(
      'Source asset temporarySource.relativePath must identify content below project tmp/.',
    );
  }
}

function assertSha256(value: unknown): void {
  if (typeof value !== 'string' || !/^[0-9a-f]{64}$/u.test(value)) {
    invalid(
      'Source asset expectedContentHash must be lowercase SHA-256 hex.',
    );
  }
}

function assertExpectedByteLength(value: unknown): void {
  if (
    typeof value !== 'number'
    || !Number.isSafeInteger(value)
    || value < 0
  ) {
    invalid(
      'Source asset expectedByteLength must be a non-negative safe integer.',
    );
  }
}

function assertPortableOriginalName(value: unknown): void {
  assertNonEmpty(value, 'originalName');
  const name = value as string;
  if (
    name.includes('/')
    || name.includes('\\')
    || !isPortablePathComponent(name)
  ) {
    invalid('Source asset originalName must be a single portable name.');
  }
}

function isPortablePathComponent(component: string): boolean {
  if (
    component.length === 0
    || component === '.'
    || component === '..'
    || component.endsWith('.')
    || component.endsWith(' ')
    || containsControlCharacter(component)
  ) {
    return false;
  }
  for (const character of component) {
    if ('<>:"|?*'.includes(character))
      return false;
  }
  return !/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\..*)?$/iu.test(
    component,
  );
}

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1F || codePoint === 0x7F))
      return true;
  }
  return false;
}

function assertExactKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  field: string,
): void {
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype)
    invalid(`Source asset ${field} must be a plain object.`);

  const ownKeys = Reflect.ownKeys(value);
  const unexpected = ownKeys.find(
    key => typeof key !== 'string' || !allowed.includes(key),
  );
  if (unexpected !== undefined) {
    invalid(
      `Source asset ${field} contains unsupported field ${String(unexpected)}.`,
    );
  }
  const missing = allowed.find(
    key => !ownKeys.includes(key),
  );
  if (missing !== undefined)
    invalid(`Source asset ${field} is missing required field ${missing}.`);
}

function assertNonEmpty(value: unknown, field: string): void {
  if (typeof value !== 'string' || value.trim().length === 0)
    invalid(`Source asset ${field} must be a non-empty string.`);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalid(message: string): never {
  throw new SourceAssetCommitError(
    'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
    message,
  );
}
