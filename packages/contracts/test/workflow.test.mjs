import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import {
  ARTIFACT_DEPENDENCY_SCHEMA,
  ARTIFACT_RECORD_SCHEMA,
  ARTIFACT_REVISION_DOCUMENT_SCHEMA,
  ARTIFACT_REVISION_DOCUMENT_SCHEMA_VERSION,
  EXPORT_SNAPSHOT_RECORD_SCHEMA,
  parseArtifactDependency,
  parseArtifactRecord,
  parseArtifactRevisionDocument,
  parseExportSnapshotRecord,
  parseProjectRecord,
  parseReviewDecisionRecord,
  parseSourceAssetRecord,
  parseStageRunRecord,
  parseStaleCause,
  parseTaskRecord,
  PROJECT_RECORD_SCHEMA,
  REVIEW_DECISION_RECORD_SCHEMA,
  SOURCE_ASSET_RECORD_SCHEMA,
  STAGE_RUN_RECORD_SCHEMA,
  STALE_CAUSE_SCHEMA,
  TASK_RECORD_SCHEMA,
  WorkflowRecordValidationError,
} from '../dist/index.js';

const ID = '11111111-1111-4111-8111-111111111111';
const ID_2 = '22222222-2222-4222-8222-222222222222';
const ID_3 = '33333333-3333-4333-8333-333333333333';
const HASH = 'a'.repeat(64);
const TIMESTAMP = '2026-08-08T00:00:00.000Z';
const scope = { kind: 'chapter', identifiers: ['chapter-1'] };

const artifact = {
  artifactId: ID,
  artifactType: 'canonical-text',
  lineageId: ID,
  revisionId: ID_2,
  scope,
  storageKind: 'canonical',
  contentPath: `artifacts/canonical/${ID_2}/content`,
  contentHash: HASH,
  inputFingerprint: HASH,
  processorId: 'test.processor',
  processorVersion: '1',
  parametersHash: HASH,
  executionStatus: 'succeeded',
  validityStatus: 'current',
  reviewStatus: 'not_required',
  createdAt: TIMESTAMP,
  createdBy: 'test',
};

const dependency = {
  dependencyId: ID_3,
  consumerArtifactId: ID,
  consumerRevisionId: ID_2,
  producerArtifactId: ID_3,
  producerRevisionId: ID_3,
  dependencyType: 'content',
  selector: { chapterIds: ['chapter-1'] },
};

const task = {
  taskId: ID,
  projectId: ID_2,
  processorId: 'test.processor',
  inputFingerprint: HASH,
  outputScope: scope,
  dedupeKey: HASH,
  executionStatus: 'pending',
  recoveryStatus: 'resumable',
  attempt: 1,
  temporaryPath: `tmp/${ID}`,
  createdAt: TIMESTAMP,
  updatedAt: TIMESTAMP,
};

const staleCause = {
  staleCauseId: ID,
  rootCauseKey: HASH,
  consumerArtifactId: ID,
  consumerRevisionId: ID_2,
  producerArtifactId: ID_3,
  previousProducerRevisionId: ID,
  currentProducerRevisionId: ID_3,
  dependencyType: 'content',
  status: 'active',
  createdAt: TIMESTAMP,
};

const sourceAsset = {
  sourceAssetId: ID,
  sourceType: 'text/plain',
  originalName: 'source.txt',
  contentHash: HASH,
  relativePath: `inputs/novels/${ID}/source.txt`,
  createdAt: TIMESTAMP,
  createdBy: 'test',
};

const stageRun = {
  stageRunId: ID,
  stageId: 'import',
  inputFingerprint: HASH,
  executionStatus: 'succeeded',
  createdAt: TIMESTAMP,
};

const reviewDecision = {
  reviewDecisionId: ID,
  artifactId: ID_2,
  revisionId: ID_3,
  decision: 'approved',
  decidedAt: TIMESTAMP,
  decidedBy: 'reviewer',
};

const exportSnapshot = {
  exportSnapshotId: ID,
  revisionIds: [ID_2, ID_3],
  createdAt: TIMESTAMP,
  createdBy: 'test',
};

test('keeps M0 workflow schemas equal to their documented forms', async () => {
  const schemas = [
    ['artifact-record.schema.json', ARTIFACT_RECORD_SCHEMA],
    ['artifact-revision.schema.json', ARTIFACT_REVISION_DOCUMENT_SCHEMA],
    ['artifact-dependency.schema.json', ARTIFACT_DEPENDENCY_SCHEMA],
    ['export-snapshot-record.schema.json', EXPORT_SNAPSHOT_RECORD_SCHEMA],
    ['project-record.schema.json', PROJECT_RECORD_SCHEMA],
    ['review-decision-record.schema.json', REVIEW_DECISION_RECORD_SCHEMA],
    ['source-asset-record.schema.json', SOURCE_ASSET_RECORD_SCHEMA],
    ['stage-run-record.schema.json', STAGE_RUN_RECORD_SCHEMA],
    ['task-record.schema.json', TASK_RECORD_SCHEMA],
    ['stale-cause.schema.json', STALE_CAUSE_SCHEMA],
  ];

  for (const [name, runtimeSchema] of schemas) {
    const documented = JSON.parse(
      await readFile(
        new URL(`../../../docs/schemas/${name}`, import.meta.url),
        'utf8',
      ),
    );
    assert.deepEqual(documented, runtimeSchema);
  }
});

test('validates artifact, dependency, task, and stale-cause records', () => {
  assert.equal(parseArtifactRecord(artifact), artifact);
  const revisionDocument = {
    schemaVersion: ARTIFACT_REVISION_DOCUMENT_SCHEMA_VERSION,
    record: artifact,
    dependencies: [{
      dependencyType: dependency.dependencyType,
      producerArtifactId: dependency.producerArtifactId,
      producerRevisionId: dependency.producerRevisionId,
      selector: dependency.selector,
    }],
  };
  assert.equal(parseArtifactRevisionDocument(revisionDocument), revisionDocument);
  assert.equal(parseArtifactDependency(dependency), dependency);
  assert.equal(parseExportSnapshotRecord(exportSnapshot), exportSnapshot);
  const projectRecord = {
    projectId: ID,
    schemaVersion: 1,
    createdAt: TIMESTAMP,
    updatedAt: TIMESTAMP,
  };
  assert.equal(parseProjectRecord(projectRecord), projectRecord);
  assert.equal(parseReviewDecisionRecord(reviewDecision), reviewDecision);
  assert.equal(parseSourceAssetRecord(sourceAsset), sourceAsset);
  assert.equal(parseTaskRecord(task), task);
  assert.equal(parseStaleCause(staleCause), staleCause);
  assert.equal(parseStageRunRecord(stageRun), stageRun);
});

test('rejects invalid workflow status, hashes, selectors, and IDs', () => {
  const invalidRecords = [
    () => parseArtifactRecord({ ...artifact, contentHash: 'invalid' }),
    () => parseArtifactRecord({ ...artifact, validityStatus: 'valid' }),
    () => parseArtifactDependency({
      ...dependency,
      selector: { chapterIds: [] },
    }),
    () => parseArtifactRevisionDocument({
      schemaVersion: 2,
      record: artifact,
      dependencies: [],
    }),
    () => parseExportSnapshotRecord({ ...exportSnapshot, revisionIds: [] }),
    () => parseReviewDecisionRecord({ ...reviewDecision, decision: 'maybe' }),
    () => parseSourceAssetRecord({ ...sourceAsset, contentHash: 'invalid' }),
    () => parseStageRunRecord({ ...stageRun, executionStatus: 'complete' }),
    () => parseTaskRecord({ ...task, attempt: 0 }),
    () => parseStaleCause({ ...staleCause, staleCauseId: 'not-an-id' }),
  ];

  for (const parse of invalidRecords)
    assert.throws(parse, WorkflowRecordValidationError);
});

test('preserves compatible unknown workflow fields', () => {
  const extended = { ...artifact, futureField: { enabled: true } };
  assert.equal(parseArtifactRecord(extended), extended);
});
