export type ProjectWorkflowErrorCode
  = | 'PROJECT_WORKFLOW_CONTENT_INVALID'
    | 'PROJECT_WORKFLOW_OUTPUT_CONFLICT'
    | 'PROJECT_WORKFLOW_PATH_INVALID'
    | 'PROJECT_WORKFLOW_TASK_MISMATCH';

export class ProjectWorkflowError extends Error {
  readonly cause: unknown;
  readonly code: ProjectWorkflowErrorCode;

  constructor(
    code: ProjectWorkflowErrorCode,
    message: string,
    cause?: unknown,
  ) {
    super(message);
    this.name = 'ProjectWorkflowError';
    this.code = code;
    this.cause = cause;
  }
}
