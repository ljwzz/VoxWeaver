export type ProjectStateErrorCode
  = | 'PROJECT_STATE_CLOSED'
    | 'PROJECT_STATE_CONFLICT'
    | 'PROJECT_STATE_INVALID'
    | 'PROJECT_STATE_MIGRATION_FAILED'
    | 'PROJECT_STATE_MIGRATION_REQUIRED'
    | 'PROJECT_STATE_NOT_FOUND'
    | 'PROJECT_STATE_READ_ONLY'
    | 'PROJECT_STATE_SCHEMA_TOO_NEW'
    | 'PROJECT_STATE_TRANSACTION_FAILED';

export class ProjectStateError extends Error {
  readonly cause: unknown;
  readonly code: ProjectStateErrorCode;

  constructor(
    code: ProjectStateErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'ProjectStateError';
    this.code = code;
    this.cause = cause;
  }
}
