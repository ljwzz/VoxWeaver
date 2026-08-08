export type ProjectWorkspaceErrorCode
  = | 'PROJECT_ACCESS_MODE_INVALID'
    | 'PROJECT_ALREADY_EXISTS'
    | 'PROJECT_CREATE_FAILED'
    | 'PROJECT_DIRECTORY_INVALID'
    | 'PROJECT_ID_INVALID'
    | 'PROJECT_LAYOUT_INCOMPLETE'
    | 'PROJECT_MANIFEST_INVALID'
    | 'PROJECT_MIGRATION_FAILED'
    | 'PROJECT_MIGRATION_REQUIRED'
    | 'PROJECT_NAME_INVALID'
    | 'PROJECT_PARENT_INVALID'
    | 'PROJECT_SESSION_ID_INVALID'
    | 'PROJECT_WRITE_LOCK_ACQUIRE_FAILED'
    | 'PROJECT_WRITE_LOCK_INVALID'
    | 'PROJECT_WRITE_LOCK_RELEASE_FAILED'
    | 'PROJECT_WRITE_LOCKED';

export class ProjectWorkspaceError extends Error {
  readonly cause: unknown;
  readonly code: ProjectWorkspaceErrorCode;

  constructor(
    code: ProjectWorkspaceErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'ProjectWorkspaceError';
    this.code = code;
    this.cause = cause;
  }
}
