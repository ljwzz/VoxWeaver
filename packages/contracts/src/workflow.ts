import addFormatsModule from 'ajv-formats';
import Ajv2020Module from 'ajv/dist/2020.js';

const Ajv2020 = Ajv2020Module.default;
const addFormats = addFormatsModule.default;

export type ExecutionStatus
  = | 'pending'
    | 'running'
    | 'succeeded'
    | 'failed'
    | 'canceled';

export type ValidityStatus = 'current' | 'stale' | 'superseded' | 'missing';

export type ReviewStatus
  = | 'not_required'
    | 'pending'
    | 'approved'
    | 'rejected';

export type ArtifactDependencyType
  = | 'content'
    | 'structure'
    | 'voice'
    | 'pronunciation'
    | 'config';

export type TaskRecoveryStatus
  = | 'none'
    | 'resumable'
    | 'retryable'
    | 'manual'
    | 'orphaned';

export type JsonPrimitive = boolean | null | number | string;
export type JsonValue = JsonArray | JsonObject | JsonPrimitive;

export interface JsonArray extends ReadonlyArray<JsonValue> {}

export interface JsonObject {
  readonly [key: string]: JsonValue;
}

export interface ArtifactScope {
  readonly kind: string;
  readonly identifiers: readonly string[];
}

export interface ArtifactSelector {
  readonly chapterIds?: readonly string[];
  readonly blockIds?: readonly string[];
  readonly scriptUnitIds?: readonly string[];
  readonly voiceProfileIds?: readonly string[];
  readonly dictionaryEntryIds?: readonly string[];
}

export interface ProjectRecord {
  readonly projectId: string;
  readonly schemaVersion: number;
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface SourceAssetRecord {
  readonly sourceAssetId: string;
  readonly sourceType: string;
  readonly originalName: string;
  readonly contentHash: string;
  readonly relativePath: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

export interface ArtifactRevisionDependencyFields {
  readonly dependencyType: ArtifactDependencyType;
  readonly producerArtifactId: string;
  readonly producerRevisionId: string;
  readonly selector?: ArtifactSelector;
}

export type ArtifactRevisionDependency
  = ArtifactRevisionDependencyFields & Record<string, unknown>;

export interface ArtifactRecordFields {
  readonly artifactId: string;
  readonly artifactType: string;
  readonly lineageId: string;
  readonly revisionId: string;
  readonly scope: ArtifactScope;
  readonly storageKind: ArtifactStorageKind;
  readonly contentPath: string;
  readonly contentHash: string;
  readonly inputFingerprint: string;
  readonly processorId: string;
  readonly processorVersion: string;
  readonly parametersHash: string;
  readonly executionStatus: ExecutionStatus;
  readonly validityStatus: ValidityStatus;
  readonly reviewStatus: ReviewStatus;
  readonly createdAt: string;
  readonly createdBy: string;
}

export type ArtifactRecord = ArtifactRecordFields & Record<string, unknown>;

export type ArtifactStorageKind
  = | 'imported'
    | 'canonical'
    | 'normalized'
    | 'corrected'
    | 'structure'
    | 'knowledge'
    | 'scripts'
    | 'spoken'
    | 'voice-profiles'
    | 'renders'
    | 'qa'
    | 'assemblies';

export interface ArtifactDependencyFields {
  readonly dependencyId: string;
  readonly consumerArtifactId: string;
  readonly consumerRevisionId: string;
  readonly producerArtifactId: string;
  readonly producerRevisionId: string;
  readonly dependencyType: ArtifactDependencyType;
  readonly selector?: ArtifactSelector;
}

export type ArtifactDependency
  = ArtifactDependencyFields & Record<string, unknown>;

export const ARTIFACT_REVISION_DOCUMENT_SCHEMA_VERSION = 1 as const;

export interface ArtifactRevisionDocumentFields {
  readonly schemaVersion: typeof ARTIFACT_REVISION_DOCUMENT_SCHEMA_VERSION;
  readonly record: ArtifactRecord;
  readonly dependencies: readonly ArtifactRevisionDependency[];
}

export type ArtifactRevisionDocument
  = ArtifactRevisionDocumentFields & Record<string, unknown>;

export interface StageRunRecord {
  readonly stageRunId: string;
  readonly stageId: string;
  readonly inputFingerprint: string;
  readonly executionStatus: ExecutionStatus;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly createdAt: string;
}

export interface TaskRecordFields {
  readonly taskId: string;
  readonly projectId: string;
  readonly processorId: string;
  readonly inputFingerprint: string;
  readonly outputScope: ArtifactScope;
  readonly dedupeKey: string;
  readonly executionStatus: ExecutionStatus;
  readonly recoveryStatus: TaskRecoveryStatus;
  readonly attempt: number;
  readonly temporaryPath: string;
  readonly resultRevisionId?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
}

export type TaskRecord = TaskRecordFields & Record<string, unknown>;

export interface ReviewDecisionRecord {
  readonly reviewDecisionId: string;
  readonly artifactId: string;
  readonly revisionId: string;
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
  readonly decidedAt: string;
  readonly decidedBy: string;
}

export interface StaleCauseFields {
  readonly staleCauseId: string;
  readonly rootCauseKey: string;
  readonly consumerArtifactId: string;
  readonly consumerRevisionId: string;
  readonly producerArtifactId: string;
  readonly previousProducerRevisionId: string;
  readonly currentProducerRevisionId: string;
  readonly dependencyType: ArtifactDependencyType;
  readonly selector?: ArtifactSelector;
  readonly status: 'active' | 'resolved';
  readonly createdAt: string;
  readonly resolvedAt?: string;
}

export type StaleCause = StaleCauseFields & Record<string, unknown>;

export interface ExportSnapshotRecord {
  readonly exportSnapshotId: string;
  readonly revisionIds: readonly string[];
  readonly staleWaiverReason?: string;
  readonly createdAt: string;
  readonly createdBy: string;
}

const UUID_V4_PATTERN
  = '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-4[0-9a-fA-F]{3}-[89abAB][0-9a-fA-F]{3}-[0-9a-fA-F]{12}$';
const SHA256_PATTERN = '^[0-9a-f]{64}$';
const NON_EMPTY_STRING = { type: 'string', minLength: 1 } as const;
const UUID_V4 = { type: 'string', pattern: UUID_V4_PATTERN } as const;
const SHA256 = { type: 'string', pattern: SHA256_PATTERN } as const;
const DATE_TIME = { type: 'string', format: 'date-time' } as const;

const ARTIFACT_SCOPE_SCHEMA = {
  type: 'object',
  required: ['kind', 'identifiers'],
  properties: {
    kind: NON_EMPTY_STRING,
    identifiers: {
      type: 'array',
      items: NON_EMPTY_STRING,
      uniqueItems: true,
    },
  },
  additionalProperties: false,
} as const;

const ARTIFACT_SELECTOR_SCHEMA = {
  type: 'object',
  minProperties: 1,
  properties: Object.fromEntries(
    [
      'chapterIds',
      'blockIds',
      'scriptUnitIds',
      'voiceProfileIds',
      'dictionaryEntryIds',
    ].map(key => [key, {
      type: 'array',
      minItems: 1,
      items: NON_EMPTY_STRING,
      uniqueItems: true,
    }]),
  ),
  additionalProperties: false,
} as const;

export const PROJECT_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/project-record.schema.json',
  title: 'VoxWeaver project state record',
  type: 'object',
  required: ['projectId', 'schemaVersion', 'createdAt', 'updatedAt'],
  properties: {
    projectId: UUID_V4,
    schemaVersion: { type: 'integer', minimum: 1 },
    createdAt: DATE_TIME,
    updatedAt: DATE_TIME,
  },
  additionalProperties: true,
} as const;

export const SOURCE_ASSET_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/source-asset-record.schema.json',
  title: 'VoxWeaver source asset record',
  type: 'object',
  required: [
    'sourceAssetId',
    'sourceType',
    'originalName',
    'contentHash',
    'relativePath',
    'createdAt',
    'createdBy',
  ],
  properties: {
    sourceAssetId: UUID_V4,
    sourceType: NON_EMPTY_STRING,
    originalName: NON_EMPTY_STRING,
    contentHash: SHA256,
    relativePath: NON_EMPTY_STRING,
    createdAt: DATE_TIME,
    createdBy: NON_EMPTY_STRING,
  },
  additionalProperties: true,
} as const;

export const ARTIFACT_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/artifact-record.schema.json',
  title: 'VoxWeaver artifact revision record',
  type: 'object',
  required: [
    'artifactId',
    'artifactType',
    'lineageId',
    'revisionId',
    'scope',
    'storageKind',
    'contentPath',
    'contentHash',
    'inputFingerprint',
    'processorId',
    'processorVersion',
    'parametersHash',
    'executionStatus',
    'validityStatus',
    'reviewStatus',
    'createdAt',
    'createdBy',
  ],
  properties: {
    artifactId: UUID_V4,
    artifactType: NON_EMPTY_STRING,
    lineageId: UUID_V4,
    revisionId: UUID_V4,
    scope: ARTIFACT_SCOPE_SCHEMA,
    storageKind: {
      type: 'string',
      enum: [
        'imported',
        'canonical',
        'normalized',
        'corrected',
        'structure',
        'knowledge',
        'scripts',
        'spoken',
        'voice-profiles',
        'renders',
        'qa',
        'assemblies',
      ],
    },
    contentPath: NON_EMPTY_STRING,
    contentHash: SHA256,
    inputFingerprint: SHA256,
    processorId: NON_EMPTY_STRING,
    processorVersion: NON_EMPTY_STRING,
    parametersHash: SHA256,
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
    createdAt: DATE_TIME,
    createdBy: NON_EMPTY_STRING,
  },
  additionalProperties: true,
} as const;

export const ARTIFACT_DEPENDENCY_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/artifact-dependency.schema.json',
  title: 'VoxWeaver artifact dependency',
  type: 'object',
  required: [
    'dependencyId',
    'consumerArtifactId',
    'consumerRevisionId',
    'producerArtifactId',
    'producerRevisionId',
    'dependencyType',
  ],
  properties: {
    dependencyId: UUID_V4,
    consumerArtifactId: UUID_V4,
    consumerRevisionId: UUID_V4,
    producerArtifactId: UUID_V4,
    producerRevisionId: UUID_V4,
    dependencyType: {
      type: 'string',
      enum: ['content', 'structure', 'voice', 'pronunciation', 'config'],
    },
    selector: ARTIFACT_SELECTOR_SCHEMA,
  },
  additionalProperties: true,
} as const;

export const ARTIFACT_REVISION_DOCUMENT_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/artifact-revision.schema.json',
  title: 'VoxWeaver artifact revision document',
  type: 'object',
  required: ['schemaVersion', 'record', 'dependencies'],
  properties: {
    schemaVersion: {
      type: 'integer',
      const: ARTIFACT_REVISION_DOCUMENT_SCHEMA_VERSION,
    },
    record: { $ref: ARTIFACT_RECORD_SCHEMA.$id },
    dependencies: {
      type: 'array',
      items: {
        type: 'object',
        required: [
          'producerArtifactId',
          'producerRevisionId',
          'dependencyType',
        ],
        properties: {
          producerArtifactId: UUID_V4,
          producerRevisionId: UUID_V4,
          dependencyType: {
            type: 'string',
            enum: ['content', 'structure', 'voice', 'pronunciation', 'config'],
          },
          selector: ARTIFACT_SELECTOR_SCHEMA,
        },
        additionalProperties: true,
      },
    },
  },
  additionalProperties: true,
} as const;

export const STAGE_RUN_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/stage-run-record.schema.json',
  title: 'VoxWeaver stage run record',
  type: 'object',
  required: [
    'stageRunId',
    'stageId',
    'inputFingerprint',
    'executionStatus',
    'createdAt',
  ],
  properties: {
    stageRunId: UUID_V4,
    stageId: NON_EMPTY_STRING,
    inputFingerprint: SHA256,
    executionStatus: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'canceled'],
    },
    startedAt: DATE_TIME,
    finishedAt: DATE_TIME,
    createdAt: DATE_TIME,
  },
  additionalProperties: true,
} as const;

export const TASK_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/task-record.schema.json',
  title: 'VoxWeaver task record',
  type: 'object',
  required: [
    'taskId',
    'projectId',
    'processorId',
    'inputFingerprint',
    'outputScope',
    'dedupeKey',
    'executionStatus',
    'recoveryStatus',
    'attempt',
    'temporaryPath',
    'createdAt',
    'updatedAt',
  ],
  properties: {
    taskId: UUID_V4,
    projectId: UUID_V4,
    processorId: NON_EMPTY_STRING,
    inputFingerprint: SHA256,
    outputScope: ARTIFACT_SCOPE_SCHEMA,
    dedupeKey: SHA256,
    executionStatus: {
      type: 'string',
      enum: ['pending', 'running', 'succeeded', 'failed', 'canceled'],
    },
    recoveryStatus: {
      type: 'string',
      enum: ['none', 'resumable', 'retryable', 'manual', 'orphaned'],
    },
    attempt: { type: 'integer', minimum: 1 },
    temporaryPath: NON_EMPTY_STRING,
    resultRevisionId: UUID_V4,
    errorCode: NON_EMPTY_STRING,
    errorMessage: NON_EMPTY_STRING,
    createdAt: DATE_TIME,
    updatedAt: DATE_TIME,
    startedAt: DATE_TIME,
    finishedAt: DATE_TIME,
  },
  additionalProperties: true,
} as const;

export const STALE_CAUSE_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/stale-cause.schema.json',
  title: 'VoxWeaver stale cause',
  type: 'object',
  required: [
    'staleCauseId',
    'rootCauseKey',
    'consumerArtifactId',
    'consumerRevisionId',
    'producerArtifactId',
    'previousProducerRevisionId',
    'currentProducerRevisionId',
    'dependencyType',
    'status',
    'createdAt',
  ],
  properties: {
    staleCauseId: UUID_V4,
    rootCauseKey: SHA256,
    consumerArtifactId: UUID_V4,
    consumerRevisionId: UUID_V4,
    producerArtifactId: UUID_V4,
    previousProducerRevisionId: UUID_V4,
    currentProducerRevisionId: UUID_V4,
    dependencyType: {
      type: 'string',
      enum: ['content', 'structure', 'voice', 'pronunciation', 'config'],
    },
    selector: ARTIFACT_SELECTOR_SCHEMA,
    status: { type: 'string', enum: ['active', 'resolved'] },
    createdAt: DATE_TIME,
    resolvedAt: DATE_TIME,
  },
  additionalProperties: true,
} as const;

export const REVIEW_DECISION_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/review-decision-record.schema.json',
  title: 'VoxWeaver review decision record',
  type: 'object',
  required: [
    'reviewDecisionId',
    'artifactId',
    'revisionId',
    'decision',
    'decidedAt',
    'decidedBy',
  ],
  properties: {
    reviewDecisionId: UUID_V4,
    artifactId: UUID_V4,
    revisionId: UUID_V4,
    decision: { type: 'string', enum: ['approved', 'rejected'] },
    note: NON_EMPTY_STRING,
    decidedAt: DATE_TIME,
    decidedBy: NON_EMPTY_STRING,
  },
  additionalProperties: true,
} as const;

export const EXPORT_SNAPSHOT_RECORD_SCHEMA = {
  $schema: 'https://json-schema.org/draft/2020-12/schema',
  $id: 'https://voxweaver.local/schemas/export-snapshot-record.schema.json',
  title: 'VoxWeaver export snapshot record',
  type: 'object',
  required: [
    'exportSnapshotId',
    'revisionIds',
    'createdAt',
    'createdBy',
  ],
  properties: {
    exportSnapshotId: UUID_V4,
    revisionIds: {
      type: 'array',
      minItems: 1,
      uniqueItems: true,
      items: UUID_V4,
    },
    staleWaiverReason: NON_EMPTY_STRING,
    createdAt: DATE_TIME,
    createdBy: NON_EMPTY_STRING,
  },
  additionalProperties: true,
} as const;

const validators = createValidators();

export class WorkflowRecordValidationError extends Error {
  readonly code = 'WORKFLOW_RECORD_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'WorkflowRecordValidationError';
  }
}

export function parseArtifactRecord(value: unknown): ArtifactRecord {
  return validateRecord(value, validators.artifact, 'Artifact record');
}

export function parseArtifactDependency(value: unknown): ArtifactDependency {
  return validateRecord(value, validators.dependency, 'Artifact dependency');
}

export function parseArtifactRevisionDocument(
  value: unknown,
): ArtifactRevisionDocument {
  return validateRecord(value, validators.artifactRevision, 'Artifact revision');
}

export function parseExportSnapshotRecord(value: unknown): ExportSnapshotRecord {
  return validateRecord(value, validators.exportSnapshot, 'Export snapshot');
}

export function parseProjectRecord(value: unknown): ProjectRecord {
  return validateRecord(value, validators.project, 'Project record');
}

export function parseReviewDecisionRecord(value: unknown): ReviewDecisionRecord {
  return validateRecord(value, validators.reviewDecision, 'Review decision');
}

export function parseSourceAssetRecord(value: unknown): SourceAssetRecord {
  return validateRecord(value, validators.sourceAsset, 'Source asset');
}

export function parseStageRunRecord(value: unknown): StageRunRecord {
  return validateRecord(value, validators.stageRun, 'Stage run');
}

export function parseTaskRecord(value: unknown): TaskRecord {
  return validateRecord(value, validators.task, 'Task record');
}

export function parseStaleCause(value: unknown): StaleCause {
  return validateRecord(value, validators.staleCause, 'Stale cause');
}

function createValidators() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);

  const artifact = ajv.compile<ArtifactRecordFields>(ARTIFACT_RECORD_SCHEMA);

  return {
    ajv,
    artifact,
    artifactRevision: ajv.compile<ArtifactRevisionDocumentFields>(
      ARTIFACT_REVISION_DOCUMENT_SCHEMA,
    ),
    dependency: ajv.compile<ArtifactDependencyFields>(
      ARTIFACT_DEPENDENCY_SCHEMA,
    ),
    exportSnapshot: ajv.compile<ExportSnapshotRecord>(
      EXPORT_SNAPSHOT_RECORD_SCHEMA,
    ),
    project: ajv.compile<ProjectRecord>(PROJECT_RECORD_SCHEMA),
    reviewDecision: ajv.compile<ReviewDecisionRecord>(
      REVIEW_DECISION_RECORD_SCHEMA,
    ),
    sourceAsset: ajv.compile<SourceAssetRecord>(SOURCE_ASSET_RECORD_SCHEMA),
    stageRun: ajv.compile<StageRunRecord>(STAGE_RUN_RECORD_SCHEMA),
    task: ajv.compile<TaskRecordFields>(TASK_RECORD_SCHEMA),
    staleCause: ajv.compile<StaleCauseFields>(STALE_CAUSE_SCHEMA),
  };
}

function validateRecord<T>(
  value: unknown,
  validator: ReturnType<typeof createValidators>[
    | 'artifact'
    | 'artifactRevision'
    | 'dependency'
    | 'exportSnapshot'
    | 'project'
    | 'reviewDecision'
    | 'sourceAsset'
    | 'stageRun'
    | 'staleCause'
    | 'task'
  ],
  dataVar: string,
): T & Record<string, unknown> {
  if (!validator(value)) {
    throw new WorkflowRecordValidationError(
      validators.ajv.errorsText(validator.errors, { dataVar }),
    );
  }

  return value as unknown as T & Record<string, unknown>;
}
