export type ProjectWorkspaceErrorCode
  = | 'PROJECT_ALREADY_EXISTS'
    | 'PROJECT_CREATE_FAILED'
    | 'PROJECT_DIRECTORY_INVALID'
    | 'PROJECT_ID_INVALID'
    | 'PROJECT_LAYOUT_INCOMPLETE'
    | 'PROJECT_MANIFEST_INVALID'
    | 'PROJECT_NAME_INVALID'
    | 'PROJECT_PARENT_INVALID';

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
