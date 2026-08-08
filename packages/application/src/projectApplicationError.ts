export type ProjectApplicationErrorCode
  = | 'PROJECT_ALREADY_ACTIVE'
    | 'PROJECT_OPERATION_IN_PROGRESS';

export class ProjectApplicationError extends Error {
  readonly code: ProjectApplicationErrorCode;

  constructor(code: ProjectApplicationErrorCode, message: string) {
    super(message);
    this.name = 'ProjectApplicationError';
    this.code = code;
  }
}
