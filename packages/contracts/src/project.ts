export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECT_LEGACY_LAYOUT_VERSION = 1 as const;
export const PROJECT_LAYOUT_VERSION = 2 as const;
export const PROJECT_STATE_DATABASE_PATH = 'state/project.sqlite' as const;

export const APP_ERROR_CODES = [
  'CATALOG_UNAVAILABLE',
  'CONFIRMATION_EXPIRED',
  'CONFIRMATION_INVALID',
  'CONFIRMATION_STATE_CHANGED',
  'CORE_PROTOCOL_MISMATCH',
  'CORE_TIMEOUT',
  'CORE_UNAVAILABLE',
  'FORBIDDEN',
  'IPC_PAYLOAD_INVALID',
  'NOVEL_IMPORT_CONFLICT',
  'NOVEL_IMPORT_ENCODING_REQUIRED',
  'NOVEL_IMPORT_INVALID_SOURCE',
  'NOVEL_IMPORT_REVIEW_REQUIRED',
  'NOVEL_IMPORT_TASK_NOT_CANCELABLE',
  'NOVEL_IMPORT_TASK_NOT_FOUND',
  'NOVEL_IMPORT_TASK_NOT_RETRYABLE',
  'PROJECT_CREATE_FAILED',
  'PROJECT_DATABASE_INVALID',
  'PROJECT_DIRECTORY_INVALID',
  'PROJECT_DIRECTORY_NOT_EMPTY',
  'PROJECT_MANIFEST_INVALID',
  'PROJECT_MIGRATION_FAILED',
  'PROJECT_MIGRATION_REQUIRED',
  'PROJECT_NAME_INVALID',
  'PROJECT_OPERATION_IN_PROGRESS',
  'PROJECT_SESSION_STALE',
  'PROJECT_SOURCE_MISMATCH',
  'PROJECT_SOURCE_MISSING',
  'PROJECT_VERSION_UNSUPPORTED',
  'PROJECT_WINDOW_OPEN_FAILED',
  'PROJECT_WRITE_LOCK_ACTIVE',
  'PROJECT_WRITE_LOCK_STALE',
  'SELECTION_INVALID',
  'SOURCE_FILE_INVALID',
] as const;

export type AppErrorCode = typeof APP_ERROR_CODES[number];

export function isAppErrorCode(value: unknown): value is AppErrorCode {
  return typeof value === 'string' && (APP_ERROR_CODES as readonly string[]).includes(value);
}

export interface AppError {
  readonly code: AppErrorCode;
  readonly message: string;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export type AppResult<T>
  = | {
    readonly ok: true;
    readonly value: T;
    readonly warnings?: readonly string[];
  }
  | {
    readonly ok: false;
    readonly error: AppError;
  };

export interface SourceAssetManifest {
  readonly id: string;
  readonly originalName: string;
  readonly relativePath: string;
  readonly byteLength: number;
  readonly sha256: string;
}

interface ProjectManifestBase {
  readonly schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  readonly projectId: string;
  readonly displayName: string;
  readonly createdAt: string;
  readonly stateDatabase: typeof PROJECT_STATE_DATABASE_PATH;
  readonly sourceAsset: SourceAssetManifest;
}

export type LegacyProjectManifest = ProjectManifestBase & {
  readonly layoutVersion: typeof PROJECT_LEGACY_LAYOUT_VERSION;
} & Record<string, unknown>;

export type ProjectManifest = ProjectManifestBase & {
  readonly layoutVersion: typeof PROJECT_LAYOUT_VERSION;
  readonly updatedAt: string;
} & Record<string, unknown>;

export type AnySupportedProjectManifest = LegacyProjectManifest | ProjectManifest;

export interface ProjectSummaryDto {
  readonly projectId: string;
  readonly displayName: string;
  readonly sourceFileName: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly layoutVersion: typeof PROJECT_LAYOUT_VERSION;
}

/** @deprecated Use ProjectSummaryDto. */
export type ProjectSummary = ProjectSummaryDto;

export type RecentProjectAvailability = 'available' | 'invalid' | 'missing';

export interface RecentProjectSummaryDto extends ProjectSummaryDto {
  readonly directoryPath: string;
  readonly lastOpenedAt: string;
  readonly availability: RecentProjectAvailability;
}

/** @deprecated Use RecentProjectSummaryDto. */
export type RecentProjectSummary = RecentProjectSummaryDto;

export type WindowContext
  = | { readonly kind: 'startup' }
    | { readonly kind: 'project'; readonly project: ProjectSummaryDto };

export interface SelectionResult {
  readonly selectionId: string;
  readonly name: string;
  readonly displayPath: string;
}

export interface CreateProjectRequest {
  displayName: string;
  directorySelectionId: string;
  sourceSelectionId: string;
}

export interface DesktopApi {
  selectProjectDirectory: () => Promise<AppResult<SelectionResult | null>>;
  selectSourceFile: () => Promise<AppResult<SelectionResult | null>>;
  createProject: (request: CreateProjectRequest) => Promise<AppResult<ProjectSummary>>;
  openProjectFromDialog: () => Promise<AppResult<ProjectSummary | null>>;
  listRecentProjects: () => Promise<AppResult<RecentProjectSummary[]>>;
  openRecentProject: (projectId: string) => Promise<AppResult<ProjectSummary>>;
  removeRecentProject: (projectId: string) => Promise<AppResult<void>>;
  getWindowContext: () => Promise<AppResult<WindowContext>>;
  closeCurrentProject: () => Promise<AppResult<void>>;
}

export class VoxWeaverError extends Error {
  readonly code: AppErrorCode;
  readonly retryable: boolean;
  readonly details?: Readonly<Record<string, unknown>>;

  constructor(
    code: AppErrorCode,
    message: string,
    retryable = true,
    details?: Readonly<Record<string, unknown>>,
  ) {
    super(message);
    this.name = 'VoxWeaverError';
    this.code = code;
    this.retryable = retryable;
    if (details !== undefined)
      this.details = details;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSafeRelativePath(value: string): boolean {
  return !value.startsWith('/')
    && !value.startsWith('\\')
    && !value.split(/[\\/]/u).includes('..');
}

function parseDateTime(value: unknown, label: string): string {
  const dateTime = typeof value === 'string' ? value : '';
  if (!dateTime || Number.isNaN(Date.parse(dateTime)))
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', `${label}无效。`, false);
  return dateTime;
}

function parseSourceAsset(value: unknown): SourceAssetManifest {
  if (!isRecord(value))
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目源文件记录无效。', false);

  const sourceId = String(value.id ?? '');
  const originalName = String(value.originalName ?? '');
  const relativePath = String(value.relativePath ?? '');
  const sha256 = String(value.sha256 ?? '');
  const expectedRelativePath = `inputs/source-assets/${sourceId}/${originalName}`;

  if (!UUID_PATTERN.test(sourceId)
    || !isNonEmptyString(originalName)
    || originalName === '.'
    || originalName === '..'
    || originalName.includes('/')
    || originalName.includes('\\')
    || !isSafeRelativePath(relativePath)
    || relativePath !== expectedRelativePath
    || typeof value.byteLength !== 'number'
    || !Number.isSafeInteger(value.byteLength)
    || value.byteLength < 0
    || !SHA256_PATTERN.test(sha256)) {
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目源文件记录无效。', false);
  }

  return {
    id: sourceId,
    originalName,
    relativePath,
    byteLength: value.byteLength,
    sha256,
  };
}

export function normalizeProjectDisplayName(value: string): string {
  const displayName = value.trim();
  const containsControlCharacter = Array.from(displayName).some((character) => {
    const codePoint = character.codePointAt(0) ?? 0;
    return codePoint <= 0x1F || codePoint === 0x7F;
  });

  if (!displayName || containsControlCharacter) {
    throw new VoxWeaverError(
      'PROJECT_NAME_INVALID',
      '项目名称不能为空，且不能包含控制字符。',
      false,
    );
  }

  return displayName;
}

export function parseAnyProjectManifest(value: unknown): AnySupportedProjectManifest {
  if (!isRecord(value))
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', 'project.json 不是有效对象。', false);

  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION
    || (value.layoutVersion !== PROJECT_LEGACY_LAYOUT_VERSION
      && value.layoutVersion !== PROJECT_LAYOUT_VERSION)) {
    throw new VoxWeaverError(
      'PROJECT_VERSION_UNSUPPORTED',
      '项目版本不受当前版本支持。',
      false,
    );
  }

  const projectId = String(value.projectId ?? '');
  if (!UUID_PATTERN.test(projectId))
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目 ID 无效。', false);

  let displayName: string;
  try {
    displayName = normalizeProjectDisplayName(String(value.displayName ?? ''));
  } catch {
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目名称记录无效。', false);
  }

  if (value.stateDatabase !== PROJECT_STATE_DATABASE_PATH)
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目状态库路径无效。', false);

  const createdAt = parseDateTime(value.createdAt, '项目创建时间');
  const sourceAsset = parseSourceAsset(value.sourceAsset);
  const common = {
    ...value,
    schemaVersion: PROJECT_SCHEMA_VERSION,
    projectId,
    displayName,
    createdAt,
    stateDatabase: PROJECT_STATE_DATABASE_PATH,
    sourceAsset,
  };

  if (value.layoutVersion === PROJECT_LEGACY_LAYOUT_VERSION) {
    return {
      ...common,
      layoutVersion: PROJECT_LEGACY_LAYOUT_VERSION,
    };
  }

  return {
    ...common,
    layoutVersion: PROJECT_LAYOUT_VERSION,
    updatedAt: parseDateTime(value.updatedAt, '项目更新时间'),
  };
}

export function parseProjectManifest(value: unknown): ProjectManifest {
  const manifest = parseAnyProjectManifest(value);
  if (manifest.layoutVersion !== PROJECT_LAYOUT_VERSION) {
    throw new VoxWeaverError(
      'PROJECT_MIGRATION_REQUIRED',
      '该项目需要迁移后才能打开。',
      false,
    );
  }
  return manifest;
}

export function toProjectSummary(manifest: ProjectManifest): ProjectSummaryDto {
  return {
    projectId: manifest.projectId,
    displayName: manifest.displayName,
    sourceFileName: manifest.sourceAsset.originalName,
    createdAt: manifest.createdAt,
    updatedAt: manifest.updatedAt,
    layoutVersion: manifest.layoutVersion,
  };
}

export function success<T>(value: T, warnings?: readonly string[]): AppResult<T> {
  if (warnings?.length)
    return { ok: true, value, warnings };

  return { ok: true, value };
}

export function failure<T>(error: AppError): AppResult<T> {
  return { ok: false, error };
}
