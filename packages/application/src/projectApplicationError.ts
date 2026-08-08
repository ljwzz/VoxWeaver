export type ProjectApplicationErrorCode
  = | 'PROJECT_ALREADY_ACTIVE'
    | 'PROJECT_OPERATION_IN_PROGRESS'
    | 'PROJECT_READ_ONLY'
    | 'PROJECT_SESSION_ACCESS_INVALID'
    | 'PROJECT_SESSION_STALE'
    | 'PROJECT_SWITCH_OPEN_FAILED';

export interface ProjectApplicationErrorOptions {
  cause?: unknown;
}

export class ProjectApplicationError extends Error {
  readonly cause: unknown;
  readonly code: ProjectApplicationErrorCode;

  constructor(
    code: ProjectApplicationErrorCode,
    message: string,
    options: ProjectApplicationErrorOptions = {},
  ) {
    super(message);
    this.name = 'ProjectApplicationError';
    this.code = code;
    this.cause = options.cause;
  }
}
