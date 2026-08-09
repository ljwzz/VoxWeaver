import type { ValidateFunction } from 'ajv';

import type {
  NovelImportErrorCode,
  UserSelectedTxtSourceEncoding,
} from './novelImport.js';
import type {
  NovelImportReviewBaselineV1,
  NovelImportReviewCommandV1,
  NovelImportReviewQueryV1,
  NovelImportReviewSnapshotV1,
  NovelImportStalePreviewQueryV1,
  NovelImportStalePreviewV1,
} from './novelImportReview.js';
import type {
  ExecutionStatus,
  ReviewStatus,
  TaskRecoveryStatus,
  ValidityStatus,
} from './workflow.js';

import addFormatsModule from 'ajv-formats';
import Ajv2020Module from 'ajv/dist/2020.js';

import {
  NOVEL_IMPORT_ERROR_CODES,
  NOVEL_IMPORT_SCHEMA,
} from './novelImport.js';
import {
  NOVEL_IMPORT_REVIEW_SCHEMA,
  parseNovelImportReviewCommandV1,
  parseNovelImportReviewQueryV1,
  parseNovelImportReviewSnapshotV1,
  parseNovelImportStalePreviewQueryV1,
  parseNovelImportStalePreviewV1,
} from './novelImportReview.js';
import { TEXT_REFERENCE_SCHEMA } from './text.js';

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;

export const DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION = '1' as const;

export const DESKTOP_NOVEL_IMPORT_USER_SOURCE_ENCODINGS = [
  'gbk',
  'gb18030',
  'big5',
  'utf-16le',
  'utf-16be',
] as const satisfies readonly UserSelectedTxtSourceEncoding[];

export const DESKTOP_NOVEL_IMPORT_METHOD_NAMES = {
  CANCEL_TASK: 'novelImport.cancelTask',
  EXECUTE_REVIEW_COMMAND: 'novelImport.executeReviewCommand',
  GET_TASK: 'novelImport.getTask',
  INSPECT: 'novelImport.inspect',
  PREVIEW_STALE_IMPACT: 'novelImport.previewStaleImpact',
  RETRY_TASK: 'novelImport.retryTask',
  SELECT_SOURCE: 'novelImport.selectSource',
  START: 'novelImport.start',
} as const;

export type DesktopNovelImportMethodName
  = typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES[
    keyof typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES
  ];

export const DESKTOP_NOVEL_IMPORT_EVENT_TYPES = {
  TASK_CANCELED: 'novelImport.taskCanceled',
  TASK_COMPLETED: 'novelImport.taskCompleted',
  TASK_FAILED: 'novelImport.taskFailed',
  TASK_PROGRESS: 'novelImport.taskProgress',
  TASK_RETRY_SCHEDULED: 'novelImport.taskRetryScheduled',
} as const;

export type DesktopNovelImportEventType
  = typeof DESKTOP_NOVEL_IMPORT_EVENT_TYPES[
    keyof typeof DESKTOP_NOVEL_IMPORT_EVENT_TYPES
  ];

export const DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY = {
  DESKTOP_CORE_UNAVAILABLE: true,
  DESKTOP_METHOD_NOT_FOUND: false,
  DESKTOP_PAYLOAD_INVALID: false,
  DESKTOP_PROTOCOL_UNSUPPORTED: false,
  DESKTOP_SELECTION_INVALID: false,
  NOVEL_IMPORT_BUDGET_INVALID: false,
  NOVEL_IMPORT_CONFLICT: true,
  NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE: true,
  NOVEL_IMPORT_ENCODING_REQUIRED: false,
  NOVEL_IMPORT_INVALID_SOURCE: false,
  NOVEL_IMPORT_RESOURCE_LIMIT_EXCEEDED: false,
  NOVEL_IMPORT_REVIEW_REQUIRED: false,
  NOVEL_IMPORT_STALE_SESSION: false,
  NOVEL_IMPORT_STRUCTURE_INVALID: false,
  NOVEL_IMPORT_TASK_NOT_CANCELABLE: false,
  NOVEL_IMPORT_TASK_NOT_FOUND: false,
  NOVEL_IMPORT_TASK_NOT_RETRYABLE: false,
  NOVEL_IMPORT_UNSUPPORTED_FORMAT: false,
  PROJECT_READ_ONLY: false,
  PROJECT_SESSION_ACCESS_INVALID: false,
  PROJECT_SESSION_STALE: false,
} as const satisfies Record<string, boolean>;

export type DesktopNovelImportErrorCode
  = keyof typeof DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY;

export type DesktopNovelImportTaskErrorCode = NovelImportErrorCode;

export interface DesktopNovelImportProjectSessionV1 {
  readonly contractVersion: typeof DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION;
  readonly projectId: string;
  readonly projectSessionId: string;
}

export type DesktopNovelImportSelectSourcePayloadV1
  = DesktopNovelImportProjectSessionV1;

export interface DesktopNovelImportStartPayloadV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly selectionToken: string;
  readonly idempotencyKey: string;
  readonly requestedBy: string;
  readonly sourceEncoding?: UserSelectedTxtSourceEncoding;
}

export interface DesktopNovelImportTaskPayloadV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly taskId: string;
}

export interface DesktopNovelImportInspectPayloadV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly query: NovelImportReviewQueryV1;
}

export interface DesktopNovelImportStalePreviewPayloadV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly query: NovelImportStalePreviewQueryV1;
}

export interface DesktopNovelImportReviewCommandPayloadV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly command: NovelImportReviewCommandV1;
}

export interface DesktopNovelImportMethodPayloadMap {
  'novelImport.cancelTask': DesktopNovelImportTaskPayloadV1;
  'novelImport.executeReviewCommand': DesktopNovelImportReviewCommandPayloadV1;
  'novelImport.getTask': DesktopNovelImportTaskPayloadV1;
  'novelImport.inspect': DesktopNovelImportInspectPayloadV1;
  'novelImport.previewStaleImpact': DesktopNovelImportStalePreviewPayloadV1;
  'novelImport.retryTask': DesktopNovelImportTaskPayloadV1;
  'novelImport.selectSource': DesktopNovelImportSelectSourcePayloadV1;
  'novelImport.start': DesktopNovelImportStartPayloadV1;
}

export type DesktopNovelImportMethodPayload<
  TMethod extends DesktopNovelImportMethodName = DesktopNovelImportMethodName,
> = DesktopNovelImportMethodPayloadMap[TMethod];

export type DesktopNovelImportSourceSelectionV1
  = | (DesktopNovelImportProjectSessionV1 & {
    readonly canceled: true;
  })
  | (DesktopNovelImportProjectSessionV1 & {
    readonly canceled: false;
    readonly selectionToken: string;
    readonly displayName: string;
    readonly expiresAt: string;
  });

export interface DesktopNovelImportTaskV1 {
  readonly taskId: string;
  readonly executionStatus: ExecutionStatus;
  readonly recoveryStatus: TaskRecoveryStatus;
  readonly attempt: number;
  readonly resultArtifactRevisionId?: string;
  readonly errorCode?: DesktopNovelImportTaskErrorCode;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export interface DesktopNovelImportTaskResultV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly task: DesktopNovelImportTaskV1;
  readonly baselineRevision?: NovelImportReviewBaselineV1;
}

export interface DesktopNovelImportTaskQueryResultV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly task: DesktopNovelImportTaskV1 | null;
  readonly baselineRevision?: NovelImportReviewBaselineV1;
}

export interface DesktopNovelImportInspectResultV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly snapshot: NovelImportReviewSnapshotV1;
}

export interface DesktopNovelImportStalePreviewResultV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly preview: NovelImportStalePreviewV1;
}

export interface DesktopNovelImportArtifactSummaryV1 {
  readonly artifactId: string;
  readonly artifactRevisionId: string;
  readonly executionStatus: ExecutionStatus;
  readonly validityStatus: ValidityStatus;
  readonly reviewStatus: ReviewStatus;
}

export interface DesktopNovelImportReviewCommandResultV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly outcome: 'committed' | 'unchanged';
  readonly artifact: DesktopNovelImportArtifactSummaryV1;
  readonly snapshot: NovelImportReviewSnapshotV1;
}

export interface DesktopNovelImportMethodResultMap {
  'novelImport.cancelTask': DesktopNovelImportTaskResultV1;
  'novelImport.executeReviewCommand': DesktopNovelImportReviewCommandResultV1;
  'novelImport.getTask': DesktopNovelImportTaskQueryResultV1;
  'novelImport.inspect': DesktopNovelImportInspectResultV1;
  'novelImport.previewStaleImpact': DesktopNovelImportStalePreviewResultV1;
  'novelImport.retryTask': DesktopNovelImportTaskResultV1;
  'novelImport.selectSource': DesktopNovelImportSourceSelectionV1;
  'novelImport.start': DesktopNovelImportTaskResultV1;
}

export type DesktopNovelImportMethodResult<
  TMethod extends DesktopNovelImportMethodName = DesktopNovelImportMethodName,
> = DesktopNovelImportMethodResultMap[TMethod];

export interface DesktopNovelImportErrorV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly code: DesktopNovelImportErrorCode;
  readonly message: 'The novel import request could not be completed.';
  readonly retryable: boolean;
  readonly method?: DesktopNovelImportMethodName;
  readonly operationId?: string;
  readonly taskId?: string;
  readonly currentArtifactRevisionId?: string;
}

interface DesktopNovelImportTaskEventBaseV1
  extends DesktopNovelImportProjectSessionV1 {
  readonly eventId: string;
  readonly occurredAt: string;
  readonly sequence: number;
  readonly task: DesktopNovelImportTaskV1;
}

export interface DesktopNovelImportTaskProgressEventV1
  extends DesktopNovelImportTaskEventBaseV1 {
  readonly eventType: 'novelImport.taskProgress';
}

export interface DesktopNovelImportTaskCompletedEventV1
  extends DesktopNovelImportTaskEventBaseV1 {
  readonly eventType: 'novelImport.taskCompleted';
  readonly baselineRevision: NovelImportReviewBaselineV1;
}

export interface DesktopNovelImportTaskFailedEventV1
  extends DesktopNovelImportTaskEventBaseV1 {
  readonly eventType: 'novelImport.taskFailed';
  readonly error: DesktopNovelImportErrorV1;
}

export interface DesktopNovelImportTaskRetryScheduledEventV1
  extends DesktopNovelImportTaskEventBaseV1 {
  readonly eventType: 'novelImport.taskRetryScheduled';
  readonly previousAttempt: number;
}

export interface DesktopNovelImportTaskCanceledEventV1
  extends DesktopNovelImportTaskEventBaseV1 {
  readonly eventType: 'novelImport.taskCanceled';
}

export type DesktopNovelImportEventV1
  = | DesktopNovelImportTaskCanceledEventV1
    | DesktopNovelImportTaskCompletedEventV1
    | DesktopNovelImportTaskFailedEventV1
    | DesktopNovelImportTaskProgressEventV1
    | DesktopNovelImportTaskRetryScheduledEventV1;

const UUID_V4_PATTERN
  = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const UUID_V4 = { type: 'string', pattern: UUID_V4_PATTERN } as const;
const CONTRACT_VERSION = {
  type: 'string',
  const: DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
} as const;
const OPAQUE_VALUE = {
  type: 'string',
  minLength: 1,
  maxLength: 200,
  pattern: '^(?!\\s)(?![\\s\\S]*[\\\\/\\u0000])[\\s\\S]*\\S$',
} as const;
const SELECTION_TOKEN = {
  type: 'string',
  minLength: 16,
  maxLength: 256,
  pattern: '^[A-Za-z0-9_-]+$',
} as const;
const FILE_DISPLAY_NAME = {
  type: 'string',
  minLength: 1,
  maxLength: 255,
  pattern: '^(?!\\s)(?![\\s\\S]*[\\\\/:\\u0000])[\\s\\S]*\\S$',
} as const;
const POSITIVE_INTEGER = {
  type: 'integer',
  minimum: 1,
  maximum: Number.MAX_SAFE_INTEGER,
} as const;
const DATE_TIME = { type: 'string', format: 'date-time' } as const;
const SESSION_REQUIRED = ['contractVersion', 'projectId', 'projectSessionId'] as const;
const SESSION_PROPERTIES = {
  contractVersion: CONTRACT_VERSION,
  projectId: UUID_V4,
  projectSessionId: UUID_V4,
} as const;
const REVIEW_BASELINE_REF
  = `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/baselineRevisionV1` as const;
const REVIEW_QUERY_REF
  = `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/reviewQueryV1` as const;
const REVIEW_COMMAND_REF
  = `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/reviewCommandV1` as const;
const REVIEW_SNAPSHOT_REF
  = `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/reviewSnapshotV1` as const;
const STALE_PREVIEW_QUERY_REF
  = `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/stalePreviewQueryV1` as const;
const STALE_PREVIEW_REF
  = `${NOVEL_IMPORT_REVIEW_SCHEMA.$id}#/$defs/stalePreviewV1` as const;

const SELECT_SOURCE_PAYLOAD_SCHEMA = sessionObject();
const START_PAYLOAD_SCHEMA = sessionObject(
  ['selectionToken', 'idempotencyKey', 'requestedBy'],
  {
    selectionToken: SELECTION_TOKEN,
    idempotencyKey: OPAQUE_VALUE,
    requestedBy: OPAQUE_VALUE,
    sourceEncoding: {
      type: 'string',
      enum: DESKTOP_NOVEL_IMPORT_USER_SOURCE_ENCODINGS,
    },
  },
);
const TASK_PAYLOAD_SCHEMA = sessionObject(['taskId'], { taskId: UUID_V4 });
const INSPECT_PAYLOAD_SCHEMA = sessionObject(
  ['query'],
  { query: { $ref: REVIEW_QUERY_REF } },
);
const STALE_PREVIEW_PAYLOAD_SCHEMA = sessionObject(
  ['query'],
  { query: { $ref: STALE_PREVIEW_QUERY_REF } },
);
const REVIEW_COMMAND_PAYLOAD_SCHEMA = sessionObject(
  ['command'],
  { command: { $ref: REVIEW_COMMAND_REF } },
);

const SOURCE_SELECTION_RESULT_SCHEMA = {
  oneOf: [
    sessionObject(['canceled'], {
      canceled: { const: true },
    }),
    sessionObject(
      ['canceled', 'selectionToken', 'displayName', 'expiresAt'],
      {
        canceled: { const: false },
        selectionToken: SELECTION_TOKEN,
        displayName: FILE_DISPLAY_NAME,
        expiresAt: DATE_TIME,
      },
    ),
  ],
} as const;

const TASK_SCHEMA = {
  type: 'object',
  required: [
    'taskId',
    'executionStatus',
    'recoveryStatus',
    'attempt',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    taskId: UUID_V4,
    executionStatus: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'canceled'],
    },
    recoveryStatus: {
      type: 'string',
      enum: ['none', 'resumable', 'retryable', 'manual', 'orphaned'],
    },
    attempt: POSITIVE_INTEGER,
    resultArtifactRevisionId: UUID_V4,
    errorCode: {
      type: 'string',
      enum: NOVEL_IMPORT_ERROR_CODES,
    },
    createdAt: DATE_TIME,
    updatedAt: DATE_TIME,
    startedAt: DATE_TIME,
    finishedAt: DATE_TIME,
  },
  oneOf: [
    taskStatusBranch('pending', [], ['resultArtifactRevisionId', 'errorCode', 'finishedAt']),
    taskStatusBranch('running', [], ['resultArtifactRevisionId', 'errorCode', 'finishedAt']),
    taskStatusBranch(
      'succeeded',
      ['resultArtifactRevisionId', 'finishedAt'],
      ['errorCode'],
    ),
    taskStatusBranch('failed', ['errorCode', 'finishedAt'], ['resultArtifactRevisionId']),
    taskStatusBranch('canceled', ['finishedAt'], ['resultArtifactRevisionId', 'errorCode']),
  ],
  additionalProperties: false,
} as const;

const TASK_RESULT_SCHEMA = sessionObject(
  ['task'],
  {
    task: { $ref: '#/$defs/taskV1' },
    baselineRevision: { $ref: REVIEW_BASELINE_REF },
  },
);
const TASK_QUERY_RESULT_SCHEMA = sessionObject(
  ['task'],
  {
    task: {
      oneOf: [
        { type: 'null' },
        { $ref: '#/$defs/taskV1' },
      ],
    },
    baselineRevision: { $ref: REVIEW_BASELINE_REF },
  },
);
const INSPECT_RESULT_SCHEMA = sessionObject(
  ['snapshot'],
  { snapshot: { $ref: REVIEW_SNAPSHOT_REF } },
);
const STALE_PREVIEW_RESULT_SCHEMA = sessionObject(
  ['preview'],
  { preview: { $ref: STALE_PREVIEW_REF } },
);
const ARTIFACT_SUMMARY_SCHEMA = {
  type: 'object',
  required: [
    'artifactId',
    'artifactRevisionId',
    'executionStatus',
    'validityStatus',
    'reviewStatus',
  ],
  properties: {
    artifactId: UUID_V4,
    artifactRevisionId: UUID_V4,
    executionStatus: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'canceled'],
    },
    validityStatus: {
      type: 'string',
      enum: ['current', 'stale', 'superseded', 'missing'],
    },
    reviewStatus: {
      type: 'string',
      enum: ['not_required', 'pending', 'approved', 'rejected'],
    },
  },
  additionalProperties: false,
} as const;
const REVIEW_COMMAND_RESULT_SCHEMA = sessionObject(
  ['outcome', 'artifact', 'snapshot'],
  {
    outcome: { type: 'string', enum: ['committed', 'unchanged'] },
    artifact: { $ref: '#/$defs/artifactSummaryV1' },
    snapshot: { $ref: REVIEW_SNAPSHOT_REF },
  },
);

const ERROR_SCHEMA = sessionObject(
  ['code', 'message', 'retryable'],
  {
    code: {
      type: 'string',
      enum: Object.keys(DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY),
    },
    message: { const: 'The novel import request could not be completed.' },
    retryable: { type: 'boolean' },
    method: {
      type: 'string',
      enum: Object.values(DESKTOP_NOVEL_IMPORT_METHOD_NAMES),
    },
    operationId: OPAQUE_VALUE,
    taskId: UUID_V4,
    currentArtifactRevisionId: UUID_V4,
  },
  {
    oneOf: Object.entries(DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY).map(
      ([code, retryable]) => ({
        required: ['code', 'retryable'],
        properties: {
          code: { const: code },
          retryable: { const: retryable },
        },
      }),
    ),
  },
);

const EVENT_COMMON_REQUIRED = [
  ...SESSION_REQUIRED,
  'eventId',
  'eventType',
  'occurredAt',
  'sequence',
  'task',
] as const;
const EVENT_COMMON_PROPERTIES = {
  ...SESSION_PROPERTIES,
  eventId: UUID_V4,
  occurredAt: DATE_TIME,
  sequence: POSITIVE_INTEGER,
  task: { $ref: '#/$defs/taskV1' },
} as const;
const TASK_PROGRESS_EVENT_SCHEMA = eventObject(
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_PROGRESS,
);
const TASK_COMPLETED_EVENT_SCHEMA = eventObject(
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_COMPLETED,
  ['baselineRevision'],
  { baselineRevision: { $ref: REVIEW_BASELINE_REF } },
);
const TASK_FAILED_EVENT_SCHEMA = eventObject(
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_FAILED,
  ['error'],
  { error: { $ref: '#/$defs/errorV1' } },
);
const TASK_RETRY_SCHEDULED_EVENT_SCHEMA = eventObject(
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_RETRY_SCHEDULED,
  ['previousAttempt'],
  { previousAttempt: POSITIVE_INTEGER },
);
const TASK_CANCELED_EVENT_SCHEMA = eventObject(
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_CANCELED,
);

export const DESKTOP_NOVEL_IMPORT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/desktop-novel-import.schema.json',
  title: 'VoxWeaver M1 desktop novel import IPC contract',
  oneOf: [
    { $ref: '#/$defs/methodPayloadEnvelopeV1' },
    { $ref: '#/$defs/methodResultEnvelopeV1' },
    { $ref: '#/$defs/errorEnvelopeV1' },
    { $ref: '#/$defs/eventEnvelopeV1' },
  ],
  $defs: {
    selectSourcePayloadV1: SELECT_SOURCE_PAYLOAD_SCHEMA,
    startPayloadV1: START_PAYLOAD_SCHEMA,
    taskPayloadV1: TASK_PAYLOAD_SCHEMA,
    inspectPayloadV1: INSPECT_PAYLOAD_SCHEMA,
    stalePreviewPayloadV1: STALE_PREVIEW_PAYLOAD_SCHEMA,
    reviewCommandPayloadV1: REVIEW_COMMAND_PAYLOAD_SCHEMA,
    sourceSelectionResultV1: SOURCE_SELECTION_RESULT_SCHEMA,
    taskV1: TASK_SCHEMA,
    taskResultV1: TASK_RESULT_SCHEMA,
    taskQueryResultV1: TASK_QUERY_RESULT_SCHEMA,
    inspectResultV1: INSPECT_RESULT_SCHEMA,
    stalePreviewResultV1: STALE_PREVIEW_RESULT_SCHEMA,
    artifactSummaryV1: ARTIFACT_SUMMARY_SCHEMA,
    reviewCommandResultV1: REVIEW_COMMAND_RESULT_SCHEMA,
    errorV1: ERROR_SCHEMA,
    taskProgressEventV1: TASK_PROGRESS_EVENT_SCHEMA,
    taskCompletedEventV1: TASK_COMPLETED_EVENT_SCHEMA,
    taskFailedEventV1: TASK_FAILED_EVENT_SCHEMA,
    taskRetryScheduledEventV1: TASK_RETRY_SCHEDULED_EVENT_SCHEMA,
    taskCanceledEventV1: TASK_CANCELED_EVENT_SCHEMA,
    methodPayloadEnvelopeV1: {
      oneOf: [
        methodBranch('payload', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE, 'selectSourcePayloadV1'),
        methodBranch('payload', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START, 'startPayloadV1'),
        methodBranch('payload', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK, 'taskPayloadV1'),
        methodBranch('payload', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK, 'taskPayloadV1'),
        methodBranch('payload', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.RETRY_TASK, 'taskPayloadV1'),
        methodBranch('payload', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT, 'inspectPayloadV1'),
        methodBranch(
          'payload',
          DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT,
          'stalePreviewPayloadV1',
        ),
        methodBranch(
          'payload',
          DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
          'reviewCommandPayloadV1',
        ),
      ],
    },
    methodResultEnvelopeV1: {
      oneOf: [
        methodBranch('result', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE, 'sourceSelectionResultV1'),
        methodBranch('result', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START, 'taskResultV1'),
        methodBranch('result', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK, 'taskQueryResultV1'),
        methodBranch('result', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK, 'taskResultV1'),
        methodBranch('result', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.RETRY_TASK, 'taskResultV1'),
        methodBranch('result', DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT, 'inspectResultV1'),
        methodBranch(
          'result',
          DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT,
          'stalePreviewResultV1',
        ),
        methodBranch(
          'result',
          DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
          'reviewCommandResultV1',
        ),
      ],
    },
    errorEnvelopeV1: valueEnvelope('error', 'errorV1'),
    eventEnvelopeV1: {
      oneOf: [
        eventEnvelopeBranch('taskProgressEventV1'),
        eventEnvelopeBranch('taskCompletedEventV1'),
        eventEnvelopeBranch('taskFailedEventV1'),
        eventEnvelopeBranch('taskRetryScheduledEventV1'),
        eventEnvelopeBranch('taskCanceledEventV1'),
      ],
    },
  },
} as const;

const validators = createValidators();
const methodNames = new Set<string>(Object.values(DESKTOP_NOVEL_IMPORT_METHOD_NAMES));

export type DesktopNovelImportValidationErrorCode
  = | 'DESKTOP_NOVEL_IMPORT_ERROR_INVALID'
    | 'DESKTOP_NOVEL_IMPORT_EVENT_INVALID'
    | 'DESKTOP_NOVEL_IMPORT_METHOD_NOT_FOUND'
    | 'DESKTOP_NOVEL_IMPORT_PAYLOAD_INVALID'
    | 'DESKTOP_NOVEL_IMPORT_RESULT_INVALID'
    | 'DESKTOP_NOVEL_IMPORT_VERSION_UNSUPPORTED';

export class DesktopNovelImportValidationError extends Error {
  constructor(
    readonly code: DesktopNovelImportValidationErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'DesktopNovelImportValidationError';
  }
}

export function isDesktopNovelImportMethodName(
  method: string,
): method is DesktopNovelImportMethodName {
  return methodNames.has(method);
}

export function parseDesktopNovelImportMethodPayload<
  TMethod extends DesktopNovelImportMethodName,
>(
  method: TMethod,
  value: unknown,
): DesktopNovelImportMethodPayload<TMethod>;
export function parseDesktopNovelImportMethodPayload(
  method: string,
  value: unknown,
): DesktopNovelImportMethodPayload;
export function parseDesktopNovelImportMethodPayload(
  method: string,
  value: unknown,
): DesktopNovelImportMethodPayload {
  assertKnownMethod(method);
  assertContractVersion(value);
  assertJsonValue(value, 'Desktop novel import payload', 'DESKTOP_NOVEL_IMPORT_PAYLOAD_INVALID');
  validate(
    { messageKind: 'payload', method, payload: value },
    validators.payload,
    'Desktop novel import payload',
    'DESKTOP_NOVEL_IMPORT_PAYLOAD_INVALID',
  );
  try {
    validateReviewPayload(method, value as DesktopNovelImportMethodPayload);
  } catch (error) {
    if (error instanceof DesktopNovelImportValidationError)
      throw error;
    invalid(
      'DESKTOP_NOVEL_IMPORT_PAYLOAD_INVALID',
      'The nested novel import review payload is invalid.',
    );
  }
  return value as DesktopNovelImportMethodPayload;
}

export function parseDesktopNovelImportMethodResult<
  TMethod extends DesktopNovelImportMethodName,
>(
  method: TMethod,
  value: unknown,
): DesktopNovelImportMethodResult<TMethod>;
export function parseDesktopNovelImportMethodResult(
  method: string,
  value: unknown,
): DesktopNovelImportMethodResult;
export function parseDesktopNovelImportMethodResult(
  method: string,
  value: unknown,
): DesktopNovelImportMethodResult {
  assertKnownMethod(method);
  assertContractVersion(value);
  assertJsonValue(value, 'Desktop novel import result', 'DESKTOP_NOVEL_IMPORT_RESULT_INVALID');
  validate(
    { messageKind: 'result', method, result: value },
    validators.result,
    'Desktop novel import result',
    'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
  );
  try {
    validateMethodResult(method, value as DesktopNovelImportMethodResult);
  } catch (error) {
    if (error instanceof DesktopNovelImportValidationError)
      throw error;
    invalid(
      'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
      'The nested novel import review result is invalid.',
    );
  }
  return value as DesktopNovelImportMethodResult;
}

export function parseDesktopNovelImportError(
  value: unknown,
): DesktopNovelImportErrorV1 {
  assertContractVersion(value);
  assertJsonValue(value, 'Desktop novel import error', 'DESKTOP_NOVEL_IMPORT_ERROR_INVALID');
  validate(
    { error: value, messageKind: 'error' },
    validators.error,
    'Desktop novel import error',
    'DESKTOP_NOVEL_IMPORT_ERROR_INVALID',
  );
  return value as DesktopNovelImportErrorV1;
}

export function parseDesktopNovelImportEvent(
  value: unknown,
): DesktopNovelImportEventV1 {
  assertContractVersion(value);
  assertJsonValue(value, 'Desktop novel import event', 'DESKTOP_NOVEL_IMPORT_EVENT_INVALID');
  validate(
    { event: value, messageKind: 'event' },
    validators.event,
    'Desktop novel import event',
    'DESKTOP_NOVEL_IMPORT_EVENT_INVALID',
  );
  validateEventSemantics(value as DesktopNovelImportEventV1);
  return value as DesktopNovelImportEventV1;
}

function validateReviewPayload(
  method: DesktopNovelImportMethodName,
  value: DesktopNovelImportMethodPayload,
): void {
  switch (method) {
    case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT:
      parseNovelImportReviewQueryV1(
        (value as DesktopNovelImportInspectPayloadV1).query,
      );
      break;
    case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT:
      parseNovelImportStalePreviewQueryV1(
        (value as DesktopNovelImportStalePreviewPayloadV1).query,
      );
      break;
    case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND:
      parseNovelImportReviewCommandV1(
        (value as DesktopNovelImportReviewCommandPayloadV1).command,
      );
      break;
    default:
      break;
  }
}

function validateMethodResult(
  method: DesktopNovelImportMethodName,
  value: DesktopNovelImportMethodResult,
): void {
  switch (method) {
    case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT: {
      const result = value as DesktopNovelImportInspectResultV1;
      parseNovelImportReviewSnapshotV1(result.snapshot);
      break;
    }
    case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT: {
      const result = value as DesktopNovelImportStalePreviewResultV1;
      parseNovelImportStalePreviewV1(result.preview);
      break;
    }
    case DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND: {
      const result = value as DesktopNovelImportReviewCommandResultV1;
      parseNovelImportReviewSnapshotV1(result.snapshot);
      if (
        result.artifact.artifactId
        !== result.snapshot.baselineRevision.artifactId
        || result.artifact.artifactRevisionId
        !== result.snapshot.baselineRevision.artifactRevisionId
      ) {
        invalid(
          'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
          'Desktop novel import review result artifact must match its snapshot baseline.',
        );
      }
      if (
        result.artifact.executionStatus !== 'succeeded'
        || result.artifact.validityStatus !== 'current'
      ) {
        invalid(
          'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
          'Desktop novel import review result artifact must be current and succeeded.',
        );
      }
      break;
    }
    default:
      validateTaskResultBaseline(value);
      break;
  }
}

function validateTaskResultBaseline(value: DesktopNovelImportMethodResult): void {
  if (!isRecord(value) || !('task' in value))
    return;
  const task = value.task;
  if (task === null) {
    if (value.baselineRevision !== undefined) {
      invalid(
        'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
        'A missing novel import task cannot include a review baseline.',
      );
    }
    return;
  }
  if (!isRecord(task))
    return;
  const baseline = value.baselineRevision;
  if (task.executionStatus === 'succeeded') {
    if (!isRecord(baseline)) {
      invalid(
        'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
        'A succeeded novel import task result must include its review baseline.',
      );
    }
    if (task.resultArtifactRevisionId !== baseline.artifactRevisionId) {
      invalid(
        'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
        'Novel import task result revision must match its review baseline.',
      );
    }
    return;
  }
  if (baseline !== undefined) {
    invalid(
      'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
      'Only a succeeded novel import task result may include a review baseline.',
    );
  }
}

function validateEventSemantics(event: DesktopNovelImportEventV1): void {
  switch (event.eventType) {
    case DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_PROGRESS:
      if (event.task.executionStatus !== 'pending'
        && event.task.executionStatus !== 'running') {
        eventInvalid('A progress event requires a pending or running task.');
      }
      break;
    case DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_COMPLETED:
      if (event.task.executionStatus !== 'succeeded')
        eventInvalid('A completed event requires a succeeded task.');
      if (
        event.task.resultArtifactRevisionId
        !== event.baselineRevision.artifactRevisionId
      ) {
        eventInvalid('A completed event baseline must match the task result revision.');
      }
      break;
    case DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_FAILED:
      if (event.task.executionStatus !== 'failed')
        eventInvalid('A failed event requires a failed task.');
      if (event.error.taskId !== event.task.taskId)
        eventInvalid('A failed event error must reference the same task.');
      if (event.error.code !== event.task.errorCode)
        eventInvalid('A failed event error must match the task error code.');
      if (
        event.error.projectId !== event.projectId
        || event.error.projectSessionId !== event.projectSessionId
      ) {
        eventInvalid('A failed event error must use the same project session.');
      }
      break;
    case DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_RETRY_SCHEDULED:
      if (event.task.executionStatus !== 'pending')
        eventInvalid('A retry event requires a pending task.');
      if (event.previousAttempt >= event.task.attempt)
        eventInvalid('A retry event must advance the task attempt.');
      break;
    case DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_CANCELED:
      if (event.task.executionStatus !== 'canceled')
        eventInvalid('A canceled event requires a canceled task.');
      break;
  }
}

function sessionObject(
  extraRequired: readonly string[] = [],
  extraProperties: Record<string, unknown> = {},
  extraKeywords: Record<string, unknown> = {},
) {
  return {
    type: 'object',
    required: [...SESSION_REQUIRED, ...extraRequired],
    properties: {
      ...SESSION_PROPERTIES,
      ...extraProperties,
    },
    additionalProperties: false,
    ...extraKeywords,
  } as const;
}

function taskStatusBranch(
  executionStatus: ExecutionStatus,
  required: readonly string[],
  forbidden: readonly string[],
) {
  return {
    required: ['executionStatus', ...required],
    properties: {
      executionStatus: { const: executionStatus },
    },
    ...(forbidden.length === 0
      ? {}
      : { not: { anyOf: forbidden.map(property => ({ required: [property] })) } }),
  } as const;
}

function eventObject(
  eventType: DesktopNovelImportEventType,
  extraRequired: readonly string[] = [],
  extraProperties: Record<string, unknown> = {},
) {
  return {
    type: 'object',
    required: [...EVENT_COMMON_REQUIRED, ...extraRequired],
    properties: {
      ...EVENT_COMMON_PROPERTIES,
      eventType: { const: eventType },
      ...extraProperties,
    },
    additionalProperties: false,
  } as const;
}

function methodBranch(
  kind: 'payload' | 'result',
  method: DesktopNovelImportMethodName,
  definition: string,
) {
  return {
    type: 'object',
    required: ['messageKind', 'method', kind],
    properties: {
      messageKind: { const: kind },
      method: { const: method },
      [kind]: { $ref: `#/$defs/${definition}` },
    },
    additionalProperties: false,
  } as const;
}

function valueEnvelope(kind: 'error', definition: string) {
  return {
    type: 'object',
    required: ['messageKind', kind],
    properties: {
      messageKind: { const: kind },
      [kind]: { $ref: `#/$defs/${definition}` },
    },
    additionalProperties: false,
  } as const;
}

function eventEnvelopeBranch(definition: string) {
  return {
    type: 'object',
    required: ['messageKind', 'event'],
    properties: {
      messageKind: { const: 'event' },
      event: { $ref: `#/$defs/${definition}` },
    },
    additionalProperties: false,
  } as const;
}

function assertKnownMethod(
  method: string,
): asserts method is DesktopNovelImportMethodName {
  if (isDesktopNovelImportMethodName(method))
    return;
  invalid(
    'DESKTOP_NOVEL_IMPORT_METHOD_NOT_FOUND',
    `Unknown desktop novel import method: ${method}`,
  );
}

function assertContractVersion(value: unknown): void {
  if (
    isRecord(value)
    && 'contractVersion' in value
    && value.contractVersion !== DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION
  ) {
    invalid(
      'DESKTOP_NOVEL_IMPORT_VERSION_UNSUPPORTED',
      'The desktop novel import contract major is unsupported.',
    );
  }
}

function assertJsonValue(
  value: unknown,
  dataName: string,
  code: DesktopNovelImportValidationErrorCode,
): void {
  if (isJsonValue(value))
    return;
  invalid(code, `${dataName} must be a JSON value.`);
}

function isJsonValue(value: unknown, ancestors = new WeakSet<object>()): boolean {
  if (value === null)
    return true;
  switch (typeof value) {
    case 'boolean':
    case 'string':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'object': {
      if (ancestors.has(value))
        return false;
      if (Array.isArray(value)) {
        ancestors.add(value);
        const valid = value.every(item => isJsonValue(item, ancestors));
        ancestors.delete(value);
        return valid;
      }
      const prototype = Object.getPrototypeOf(value);
      if (prototype !== Object.prototype && prototype !== null)
        return false;
      ancestors.add(value);
      const valid = Object.values(value).every(item => isJsonValue(item, ancestors));
      ancestors.delete(value);
      return valid;
    }
    default:
      return false;
  }
}

function validate(
  value: unknown,
  validator: ValidateFunction,
  dataName: string,
  code: DesktopNovelImportValidationErrorCode,
): void {
  if (validator(value))
    return;
  invalid(code, validators.ajv.errorsText(validator.errors, { dataVar: dataName }));
}

function createValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  ajv.addSchema(TEXT_REFERENCE_SCHEMA);
  ajv.addSchema(NOVEL_IMPORT_SCHEMA);
  ajv.addSchema(NOVEL_IMPORT_REVIEW_SCHEMA);
  const validateDocument = ajv.compile(DESKTOP_NOVEL_IMPORT_SCHEMA);
  return {
    ajv,
    payload: validateDocument,
    result: validateDocument,
    error: validateDocument,
    event: validateDocument,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function eventInvalid(message: string): never {
  return invalid('DESKTOP_NOVEL_IMPORT_EVENT_INVALID', message);
}

function invalid(
  code: DesktopNovelImportValidationErrorCode,
  message: string,
): never {
  throw new DesktopNovelImportValidationError(code, message);
}

if (
  NOVEL_IMPORT_ERROR_CODES.some(
    code => !(code in DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY),
  )
) {
  throw new Error('Desktop novel import error mapping is incomplete.');
}
