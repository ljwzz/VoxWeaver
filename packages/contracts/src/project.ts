export const PROJECT_SCHEMA_VERSION = 1 as const;
export const PROJECT_LAYOUT_VERSION = 1 as const;
export const PROJECT_STATE_DATABASE_PATH = 'state/project.sqlite' as const;

export type AppErrorCode
  = | 'CATALOG_UNAVAILABLE'
    | 'FORBIDDEN'
    | 'PROJECT_CREATE_FAILED'
    | 'PROJECT_DATABASE_INVALID'
    | 'PROJECT_DIRECTORY_INVALID'
    | 'PROJECT_DIRECTORY_NOT_EMPTY'
    | 'PROJECT_MANIFEST_INVALID'
    | 'PROJECT_NAME_INVALID'
    | 'PROJECT_OPERATION_IN_PROGRESS'
    | 'PROJECT_SOURCE_MISMATCH'
    | 'PROJECT_SOURCE_MISSING'
    | 'PROJECT_VERSION_UNSUPPORTED'
    | 'PROJECT_WINDOW_OPEN_FAILED'
    | 'SELECTION_INVALID'
    | 'SOURCE_FILE_INVALID';

export interface AppError {
  code: AppErrorCode;
  message: string;
  retryable: boolean;
}

export type AppResult<T>
  = | {
    ok: true;
    value: T;
    warnings?: string[];
  }
  | {
    ok: false;
    error: AppError;
  };

export interface SourceAssetManifest {
  id: string;
  originalName: string;
  relativePath: string;
  byteLength: number;
  sha256: string;
}

export interface ProjectManifest {
  schemaVersion: typeof PROJECT_SCHEMA_VERSION;
  layoutVersion: typeof PROJECT_LAYOUT_VERSION;
  projectId: string;
  displayName: string;
  createdAt: string;
  stateDatabase: typeof PROJECT_STATE_DATABASE_PATH;
  sourceAsset: SourceAssetManifest;
}

export interface ProjectSummary {
  projectId: string;
  displayName: string;
  sourceFileName: string;
  createdAt: string;
}

export type RecentProjectAvailability = 'available' | 'invalid' | 'missing';

export interface RecentProjectSummary extends ProjectSummary {
  directoryPath: string;
  lastOpenedAt: string;
  availability: RecentProjectAvailability;
}

export type WindowContext
  = | { kind: 'startup' }
    | { kind: 'project'; project: ProjectSummary };

export interface SelectionResult {
  selectionId: string;
  name: string;
  displayPath: string;
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

  constructor(code: AppErrorCode, message: string, retryable = true) {
    super(message);
    this.name = 'VoxWeaverError';
    this.code = code;
    this.retryable = retryable;
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const SHA256_PATTERN = /^[0-9a-f]{64}$/u;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isSafeRelativePath(value: string): boolean {
  return !value.startsWith('/')
    && !value.startsWith('\\')
    && !value.split(/[\\/]/u).includes('..');
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
    );
  }

  return displayName;
}

export function parseProjectManifest(value: unknown): ProjectManifest {
  if (!isRecord(value))
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', 'project.json 不是有效对象。', false);

  if (value.schemaVersion !== PROJECT_SCHEMA_VERSION || value.layoutVersion !== PROJECT_LAYOUT_VERSION) {
    throw new VoxWeaverError(
      'PROJECT_VERSION_UNSUPPORTED',
      '项目版本不受当前版本支持。',
      false,
    );
  }

  if (!UUID_PATTERN.test(String(value.projectId)))
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目 ID 无效。', false);

  let displayName: string;
  try {
    displayName = normalizeProjectDisplayName(String(value.displayName ?? ''));
  } catch {
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目名称记录无效。', false);
  }
  const createdAt = String(value.createdAt ?? '');
  if (!createdAt || Number.isNaN(Date.parse(createdAt)))
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目创建时间无效。', false);

  if (value.stateDatabase !== PROJECT_STATE_DATABASE_PATH)
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目状态库路径无效。', false);

  if (!isRecord(value.sourceAsset))
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目源文件记录无效。', false);

  const sourceAsset = value.sourceAsset;
  const sourceId = String(sourceAsset.id ?? '');
  const originalName = String(sourceAsset.originalName ?? '');
  const relativePath = String(sourceAsset.relativePath ?? '');
  const sha256 = String(sourceAsset.sha256 ?? '');
  const expectedRelativePath = `inputs/source-assets/${sourceId}/${originalName}`;

  if (!UUID_PATTERN.test(sourceId)
    || !isNonEmptyString(originalName)
    || originalName === '.'
    || originalName === '..'
    || originalName.includes('/')
    || originalName.includes('\\')
    || !isNonEmptyString(relativePath)
    || !isSafeRelativePath(relativePath)
    || relativePath !== expectedRelativePath
    || typeof sourceAsset.byteLength !== 'number'
    || !Number.isSafeInteger(sourceAsset.byteLength)
    || sourceAsset.byteLength < 0
    || !SHA256_PATTERN.test(sha256)) {
    throw new VoxWeaverError('PROJECT_MANIFEST_INVALID', '项目源文件记录无效。', false);
  }

  return {
    schemaVersion: PROJECT_SCHEMA_VERSION,
    layoutVersion: PROJECT_LAYOUT_VERSION,
    projectId: String(value.projectId),
    displayName,
    createdAt,
    stateDatabase: PROJECT_STATE_DATABASE_PATH,
    sourceAsset: {
      id: sourceId,
      originalName,
      relativePath,
      byteLength: sourceAsset.byteLength,
      sha256,
    },
  };
}

export function toProjectSummary(manifest: ProjectManifest): ProjectSummary {
  return {
    projectId: manifest.projectId,
    displayName: manifest.displayName,
    sourceFileName: manifest.sourceAsset.originalName,
    createdAt: manifest.createdAt,
  };
}

export function success<T>(value: T, warnings?: string[]): AppResult<T> {
  if (warnings?.length)
    return { ok: true, value, warnings };

  return { ok: true, value };
}

export function failure<T>(error: AppError): AppResult<T> {
  return { ok: false, error };
}
