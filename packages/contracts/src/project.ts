export const PROJECT_MANIFEST_SCHEMA_VERSION = 1 as const;
export const PROJECT_LAYOUT_VERSION = 1 as const;

export interface ProjectManifestFields {
  schemaVersion: typeof PROJECT_MANIFEST_SCHEMA_VERSION;
  layoutVersion: typeof PROJECT_LAYOUT_VERSION;
  projectId: string;
  displayName: string;
  directoryName: string;
  createdAt: string;
  updatedAt: string;
}

export type ProjectManifest = ProjectManifestFields & Record<string, unknown>;

export interface ProjectContext {
  projectDirectory: string;
  manifest: ProjectManifest;
}

const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const RFC_3339_PATTERN
  = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/;

export class ProjectManifestValidationError extends Error {
  readonly code = 'PROJECT_MANIFEST_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'ProjectManifestValidationError';
  }
}

export function parseProjectManifest(value: unknown): ProjectManifest {
  if (!isRecord(value))
    throw new ProjectManifestValidationError('Project manifest must be an object.');

  assertLiteral(value, 'schemaVersion', PROJECT_MANIFEST_SCHEMA_VERSION);
  assertLiteral(value, 'layoutVersion', PROJECT_LAYOUT_VERSION);
  assertUuid(value, 'projectId');
  assertTrimmedString(value, 'displayName', 120);
  assertDirectoryName(value, 'directoryName');
  assertTimestamp(value, 'createdAt');
  assertTimestamp(value, 'updatedAt');

  if (!value.directoryName.endsWith(`--${value.projectId}`)) {
    throw new ProjectManifestValidationError(
      'Project directory name must end with the project ID.',
    );
  }

  return value as ProjectManifest;
}

function assertDirectoryName<const TField extends string>(
  value: Record<string, unknown>,
  field: TField,
): asserts value is Record<string, unknown> & Record<TField, string> {
  assertTrimmedString(value, field, 160);

  const directoryName = value[field];
  if (
    directoryName === '.'
    || directoryName === '..'
    || directoryName.includes('/')
    || directoryName.includes('\\')
    || directoryName.includes('\0')
  ) {
    throw new ProjectManifestValidationError(
      `Project manifest field "${field}" is not a safe directory name.`,
    );
  }
}

function assertLiteral<const TField extends string, const TValue extends number>(
  value: Record<string, unknown>,
  field: TField,
  expected: TValue,
): asserts value is Record<string, unknown> & Record<TField, TValue> {
  if (value[field] !== expected) {
    throw new ProjectManifestValidationError(
      `Project manifest field "${field}" must be ${expected}.`,
    );
  }
}

function assertTimestamp<const TField extends string>(
  value: Record<string, unknown>,
  field: TField,
): asserts value is Record<string, unknown> & Record<TField, string> {
  const timestamp = value[field];
  if (
    typeof timestamp !== 'string'
    || !RFC_3339_PATTERN.test(timestamp)
    || !Number.isFinite(Date.parse(timestamp))
  ) {
    throw new ProjectManifestValidationError(
      `Project manifest field "${field}" must be an RFC 3339 timestamp.`,
    );
  }
}

function assertTrimmedString<const TField extends string>(
  value: Record<string, unknown>,
  field: TField,
  maximumLength: number,
): asserts value is Record<string, unknown> & Record<TField, string> {
  const fieldValue = value[field];
  if (
    typeof fieldValue !== 'string'
    || fieldValue.length === 0
    || fieldValue !== fieldValue.trim()
    || Array.from(fieldValue).length > maximumLength
  ) {
    throw new ProjectManifestValidationError(
      `Project manifest field "${field}" must be a non-empty trimmed string.`,
    );
  }
}

function assertUuid<const TField extends string>(
  value: Record<string, unknown>,
  field: TField,
): asserts value is Record<string, unknown> & Record<TField, string> {
  const identifier = value[field];
  if (typeof identifier !== 'string' || !UUID_V4_PATTERN.test(identifier)) {
    throw new ProjectManifestValidationError(
      `Project manifest field "${field}" must be a UUID v4 string.`,
    );
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
