import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import addFormats from 'ajv-formats';
import Ajv2020 from 'ajv/dist/2020.js';

import {
  DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
  DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY,
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES,
  DESKTOP_NOVEL_IMPORT_METHOD_NAMES,
  DESKTOP_NOVEL_IMPORT_SCHEMA,
  DesktopNovelImportValidationError,
  NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
  parseDesktopNovelImportError,
  parseDesktopNovelImportEvent,
  parseDesktopNovelImportMethodPayload,
  parseDesktopNovelImportMethodResult,
} from '../dist/index.js';

const PROJECT_ID = uuid(1);
const PROJECT_SESSION_ID = uuid(2);
const TASK_ID = uuid(3);
const ARTIFACT_ID = uuid(4);
const ARTIFACT_REVISION_ID = uuid(5);
const SOURCE_ASSET_ID = uuid(6);
const RAW_REVISION_ID = uuid(7);
const CANONICAL_REVISION_ID = uuid(8);
const NORMALIZED_REVISION_ID = uuid(9);
const CANDIDATE_ID = uuid(11);
const CHAPTER_ID = uuid(12);
const EVIDENCE_ID = uuid(13);
const ISSUE_ID = uuid(14);
const PROPOSAL_ID = uuid(15);
const CONSUMER_ARTIFACT_ID = uuid(16);
const CONSUMER_REVISION_ID = uuid(17);

const RAW_TEXT = 'Title\r\nBody';
const CANONICAL_TEXT = 'Title\nBody';

const documentedTextSchema = await readJson(
  new URL('../../../docs/schemas/text-reference.schema.json', import.meta.url),
);
const documentedNovelImportSchema = await readJson(
  new URL('../../../docs/schemas/novel-import.schema.json', import.meta.url),
);
const documentedReviewSchema = await readJson(
  new URL('../../../docs/schemas/novel-import-review.schema.json', import.meta.url),
);
const documentedDesktopNovelImportSchema = await readJson(
  new URL('../../../docs/schemas/desktop-novel-import.schema.json', import.meta.url),
);

test('keeps the documented desktop novel import schema equal to runtime', () => {
  assert.deepEqual(documentedDesktopNovelImportSchema, DESKTOP_NOVEL_IMPORT_SCHEMA);
});

test('keeps documented and runtime validation aligned for every message kind', () => {
  const validate = createDocumentedValidator();
  const documents = [
    ...payloadCases().map(([method, payload]) => ({
      messageKind: 'payload',
      method,
      payload,
    })),
    ...resultCases().map(([method, result]) => ({
      messageKind: 'result',
      method,
      result,
    })),
    {
      messageKind: 'error',
      error: publicError('NOVEL_IMPORT_INVALID_SOURCE'),
    },
    ...eventCases().map(event => ({ messageKind: 'event', event })),
  ];

  for (const document of documents) {
    assert.equal(
      validate(document),
      true,
      JSON.stringify(validate.errors),
    );
    assert.equal(parseDocument(document), documentValue(document));
  }
});

test('parses all source, task, inspection, and adjustment method branches', () => {
  for (const [method, payload] of payloadCases()) {
    assert.equal(parseDesktopNovelImportMethodPayload(method, payload), payload);
  }
  for (const [method, result] of resultCases()) {
    assert.equal(parseDesktopNovelImportMethodResult(method, result), result);
  }
});

test('rejects unknown methods and contract majors before branch validation', () => {
  assert.throws(
    () => parseDesktopNovelImportMethodPayload('novelImport.removeSource', session()),
    error => error instanceof DesktopNovelImportValidationError
      && error.code === 'DESKTOP_NOVEL_IMPORT_METHOD_NOT_FOUND',
  );
  assert.throws(
    () => parseDesktopNovelImportMethodResult('novelImport.removeSource', session()),
    error => error instanceof DesktopNovelImportValidationError
      && error.code === 'DESKTOP_NOVEL_IMPORT_METHOD_NOT_FOUND',
  );

  for (const operation of [
    value => parseDesktopNovelImportMethodPayload(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE,
      value,
    ),
    value => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE,
      value,
    ),
    parseDesktopNovelImportError,
    parseDesktopNovelImportEvent,
  ]) {
    for (const contractVersion of ['2', '2.0', 2]) {
      assert.throws(
        () => operation({ ...session(), contractVersion }),
        error => error instanceof DesktopNovelImportValidationError
          && error.code === 'DESKTOP_NOVEL_IMPORT_VERSION_UNSUPPORTED',
      );
    }
  }
});

test('requires an explicit valid project and project session fence', () => {
  const value = startPayload();
  for (const invalid of [
    { ...value, projectId: '' },
    { ...value, projectId: 'project-1' },
    { ...value, projectSessionId: '' },
    { ...value, projectSessionId: uuid(20).replace('-4', '-1') },
    omit(value, 'projectId'),
    omit(value, 'projectSessionId'),
  ]) {
    assert.throws(
      () => parseDesktopNovelImportMethodPayload(
        DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
        invalid,
      ),
      DesktopNovelImportValidationError,
    );
  }
});

test('rejects non-JSON values at every public boundary', () => {
  const circular = session();
  circular.self = circular;

  assert.throws(
    () => parseDesktopNovelImportMethodPayload(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
      { ...startPayload(), value: undefined },
    ),
    DesktopNovelImportValidationError,
  );

  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK,
      { ...taskQueryResult(), value: Number.NaN },
    ),
    DesktopNovelImportValidationError,
  );
  assert.throws(
    () => parseDesktopNovelImportError({ ...publicError(), value: 1n }),
    DesktopNovelImportValidationError,
  );
  assert.throws(
    () => parseDesktopNovelImportEvent(circular),
    DesktopNovelImportValidationError,
  );
});

test('closes public DTOs against filesystem-shaped values and path fields', () => {
  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE,
      { ...sourceSelection(), displayName: 'private/source.txt' },
    ),
    DesktopNovelImportValidationError,
  );
  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
      {
        ...taskResult(),
        task: {
          ...succeededTask(),
          temporaryPath: 'tmp/import/task-1',
        },
      },
    ),
    DesktopNovelImportValidationError,
  );
  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT,
      { ...inspectResult(), absolutePath: 'private/project' },
    ),
    DesktopNovelImportValidationError,
  );
  assert.throws(
    () => parseDesktopNovelImportError({
      ...publicError(),
      details: { sourcePath: 'private/source.txt' },
    }),
    DesktopNovelImportValidationError,
  );
  assert.throws(
    () => parseDesktopNovelImportMethodPayload(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
      { ...startPayload(), filesystemPath: 'private/source.txt' },
    ),
    DesktopNovelImportValidationError,
  );
});

test('enforces the explicit public error retry mapping', () => {
  for (const [code, retryable] of Object.entries(
    DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY,
  )) {
    const value = publicError(code);
    assert.equal(value.retryable, retryable);
    assert.equal(parseDesktopNovelImportError(value), value);
    assert.throws(
      () => parseDesktopNovelImportError({ ...value, retryable: !retryable }),
      DesktopNovelImportValidationError,
    );
  }

  assert.throws(
    () => parseDesktopNovelImportError(publicError('UNMAPPED_INTERNAL_ERROR')),
    DesktopNovelImportValidationError,
  );
});

test('requires ordered, session-bound task events with matching states', () => {
  for (const event of eventCases()) {
    assert.equal(parseDesktopNovelImportEvent(event), event);
  }

  const completed = completedEvent();
  const failed = failedEvent();
  const retry = retryEvent();
  for (const invalid of [
    { ...progressEvent(), sequence: 0 },
    { ...progressEvent(), eventType: 'novelImport.unknown' },
    { ...completed, task: pendingTask() },
    {
      ...completed,
      baselineRevision: {
        ...completed.baselineRevision,
        artifactRevisionId: uuid(40),
      },
    },
    {
      ...failed,
      error: { ...failed.error, taskId: uuid(41) },
    },
    {
      ...failed,
      error: publicError('NOVEL_IMPORT_STRUCTURE_INVALID'),
    },
    {
      ...failed,
      error: { ...failed.error, projectSessionId: uuid(42) },
    },
    { ...retry, previousAttempt: retry.task.attempt },
  ]) {
    assert.throws(
      () => parseDesktopNovelImportEvent(invalid),
      DesktopNovelImportValidationError,
    );
  }
});

test('preserves M1 review semantic validation across the IPC boundary', () => {
  assert.throws(
    () => parseDesktopNovelImportMethodPayload(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT,
      {
        ...inspectPayload(),
        query: { ...reviewQuery(), schemaVersion: 2 },
      },
    ),
    DesktopNovelImportValidationError,
  );

  const overlappingBoundary = boundaryCommand();
  overlappingBoundary.contentRange = range(
    CANONICAL_REVISION_ID,
    'canonical',
    4,
    8,
  );
  assert.throws(
    () => parseDesktopNovelImportMethodPayload(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
      { ...session(), command: overlappingBoundary },
    ),
    error => error instanceof DesktopNovelImportValidationError
      && error.code === 'DESKTOP_NOVEL_IMPORT_PAYLOAD_INVALID',
  );

  const inconsistentSnapshot = snapshot();
  inconsistentSnapshot.uncoveredRanges = [];
  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT,
      { ...session(), snapshot: inconsistentSnapshot },
    ),
    error => error instanceof DesktopNovelImportValidationError
      && error.code === 'DESKTOP_NOVEL_IMPORT_RESULT_INVALID',
  );

  const result = reviewCommandResult();
  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
      {
        ...result,
        artifact: { ...result.artifact, artifactRevisionId: uuid(43) },
      },
    ),
    DesktopNovelImportValidationError,
  );

  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
      { ...taskResult(), baselineRevision: undefined },
    ),
    DesktopNovelImportValidationError,
  );
  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK,
      { ...session(), task: null, baselineRevision: baselineRevision() },
    ),
    DesktopNovelImportValidationError,
  );
  assert.throws(
    () => parseDesktopNovelImportMethodResult(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
      {
        ...reviewCommandResult(),
        artifact: {
          ...reviewCommandResult().artifact,
          validityStatus: 'stale',
        },
      },
    ),
    DesktopNovelImportValidationError,
  );
});

function payloadCases() {
  return [
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE, session()],
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START, startPayload()],
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK, taskPayload()],
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK, taskPayload()],
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.RETRY_TASK, taskPayload()],
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT, inspectPayload()],
    [
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT,
      { ...session(), query: stalePreviewQuery() },
    ],
    [
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
      { ...session(), command: boundaryCommand() },
    ],
  ];
}

function resultCases() {
  return [
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE, sourceSelection()],
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START, taskResult()],
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK, taskQueryResult()],
    [
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK,
      { ...session(), task: canceledTask() },
    ],
    [
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.RETRY_TASK,
      { ...session(), task: pendingTask({ attempt: 2 }) },
    ],
    [DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT, inspectResult()],
    [
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT,
      { ...session(), preview: stalePreview() },
    ],
    [
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
      reviewCommandResult(),
    ],
  ];
}

function eventCases() {
  return [
    progressEvent(),
    completedEvent(),
    failedEvent(),
    retryEvent(),
    canceledEvent(),
  ];
}

function session() {
  return {
    contractVersion: DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
  };
}

function startPayload() {
  return {
    ...session(),
    selectionToken: 'selection_token_0001',
    idempotencyKey: 'import-request-1',
    requestedBy: 'operator:test',
    sourceEncoding: 'gb18030',
  };
}

function taskPayload() {
  return { ...session(), taskId: TASK_ID };
}

function inspectPayload() {
  return { ...session(), query: reviewQuery() };
}

function sourceSelection() {
  return {
    ...session(),
    canceled: false,
    selectionToken: 'selection_token_0001',
    displayName: 'sample.txt',
    expiresAt: '2026-08-09T00:05:00.000Z',
  };
}

function taskResult() {
  return {
    ...session(),
    task: succeededTask(),
    baselineRevision: baselineRevision(),
  };
}

function taskQueryResult() {
  return { ...session(), task: pendingTask() };
}

function inspectResult() {
  return { ...session(), snapshot: snapshot() };
}

function reviewCommandResult() {
  return {
    ...session(),
    outcome: 'unchanged',
    artifact: {
      artifactId: ARTIFACT_ID,
      artifactRevisionId: ARTIFACT_REVISION_ID,
      executionStatus: 'succeeded',
      validityStatus: 'current',
      reviewStatus: 'pending',
    },
    snapshot: snapshot(),
  };
}

function pendingTask(overrides = {}) {
  return task('pending', overrides);
}

function succeededTask(overrides = {}) {
  return task('succeeded', {
    startedAt: '2026-08-09T00:00:01.000Z',
    finishedAt: '2026-08-09T00:00:02.000Z',
    resultArtifactRevisionId: ARTIFACT_REVISION_ID,
    ...overrides,
  });
}

function failedTask(overrides = {}) {
  return task('failed', {
    startedAt: '2026-08-09T00:00:01.000Z',
    finishedAt: '2026-08-09T00:00:02.000Z',
    errorCode: 'NOVEL_IMPORT_INVALID_SOURCE',
    ...overrides,
  });
}

function canceledTask(overrides = {}) {
  return task('canceled', {
    finishedAt: '2026-08-09T00:00:02.000Z',
    ...overrides,
  });
}

function task(executionStatus, overrides = {}) {
  return {
    taskId: TASK_ID,
    executionStatus,
    recoveryStatus: 'none',
    attempt: 1,
    createdAt: '2026-08-09T00:00:00.000Z',
    updatedAt: '2026-08-09T00:00:02.000Z',
    ...overrides,
  };
}

function publicError(code = 'NOVEL_IMPORT_INVALID_SOURCE') {
  return {
    ...session(),
    code,
    message: 'The novel import request could not be completed.',
    retryable: DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY[code] ?? false,
    method: DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
    operationId: 'operation-1',
    taskId: TASK_ID,
  };
}

function eventBase(eventType, taskValue, sequence) {
  return {
    ...session(),
    eventId: uuid(30 + sequence),
    eventType,
    occurredAt: '2026-08-09T00:00:02.000Z',
    sequence,
    task: taskValue,
  };
}

function progressEvent() {
  return eventBase(
    DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_PROGRESS,
    task('running', { startedAt: '2026-08-09T00:00:01.000Z' }),
    1,
  );
}

function completedEvent() {
  return {
    ...eventBase(
      DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_COMPLETED,
      succeededTask(),
      2,
    ),
    baselineRevision: baselineRevision(),
  };
}

function failedEvent() {
  return {
    ...eventBase(
      DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_FAILED,
      failedTask(),
      3,
    ),
    error: publicError('NOVEL_IMPORT_INVALID_SOURCE'),
  };
}

function retryEvent() {
  return {
    ...eventBase(
      DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_RETRY_SCHEDULED,
      pendingTask({ attempt: 2 }),
      4,
    ),
    previousAttempt: 1,
  };
}

function canceledEvent() {
  return eventBase(
    DESKTOP_NOVEL_IMPORT_EVENT_TYPES.TASK_CANCELED,
    canceledTask(),
    5,
  );
}

function baselineRevision() {
  return {
    artifactId: ARTIFACT_ID,
    artifactRevisionId: ARTIFACT_REVISION_ID,
    canonicalTextRevision: revision(
      CANONICAL_REVISION_ID,
      'canonical',
      CANONICAL_TEXT,
    ),
  };
}

function reviewQuery() {
  return {
    documentType: 'novel-import-review-query',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    baselineRevision: baselineRevision(),
  };
}

function commandBase(commandType) {
  return {
    documentType: 'novel-import-review-command',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    commandType,
    baselineRevision: baselineRevision(),
    requestedBy: 'operator:test',
  };
}

function boundaryCommand() {
  return {
    ...commandBase('adjust-chapter-boundary'),
    chapterId: CHAPTER_ID,
    headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
    contentRange: range(CANONICAL_REVISION_ID, 'canonical', 5, 8),
  };
}

function snapshot() {
  const rawRevision = revision(RAW_REVISION_ID, 'raw', RAW_TEXT);
  const canonicalRevision = revision(
    CANONICAL_REVISION_ID,
    'canonical',
    CANONICAL_TEXT,
  );
  const normalizedRevision = revision(
    NORMALIZED_REVISION_ID,
    'normalized',
    CANONICAL_TEXT,
  );
  return {
    documentType: 'novel-import-review-snapshot',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    readOnly: false,
    baselineRevision: baselineRevision(),
    source: {
      sourceAssetId: SOURCE_ASSET_ID,
      format: 'txt',
      byteLength: Buffer.byteLength(RAW_TEXT, 'utf8'),
      contentHash: sha256(RAW_TEXT),
      encoding: 'utf-8',
    },
    adapter: {
      adapterId: 'voxweaver.novel-import.txt',
      adapterVersion: '1.0.0',
      selectionMethod: 'probe',
    },
    textRevisions: [rawRevision, canonicalRevision, normalizedRevision],
    layerDiffs: [
      {
        fromRevision: rawRevision,
        toRevision: canonicalRevision,
        hunks: [{
          operation: 'delete',
          fromRange: range(RAW_REVISION_ID, 'raw', 5, 6),
          toRange: range(CANONICAL_REVISION_ID, 'canonical', 5, 5),
          beforeText: '\r',
          afterText: '',
        }],
      },
      {
        fromRevision: canonicalRevision,
        toRevision: normalizedRevision,
        hunks: [],
      },
    ],
    chapterCandidates: [chapterCandidate()],
    chapters: [chapterEntry()],
    tableOfContentsEvidence: [{
      evidenceId: EVIDENCE_ID,
      kind: 'candidate-sequence',
      range: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
      rawText: 'Title',
      candidateIds: [CANDIDATE_ID],
      confidence: 1,
      reviewStatus: 'not_required',
    }],
    coverage: {
      textRevisionId: CANONICAL_REVISION_ID,
      textLayer: 'canonical',
      totalByteLength: Buffer.byteLength(CANONICAL_TEXT, 'utf8'),
      classifiedByteLength: 8,
      unclassifiedByteLength: 2,
      complete: false,
      segments: [{
        classification: 'chapter',
        range: range(CANONICAL_REVISION_ID, 'canonical', 0, 8),
        chapterId: CHAPTER_ID,
      }],
      unclassifiedRanges: [
        range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
      ],
    },
    issues: [{
      issueId: ISSUE_ID,
      code: 'unclassified-tail',
      severity: 'warning',
      reviewStatus: 'pending',
      message: 'Synthetic fixture leaves a short tail for review.',
      textRange: range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
    }],
    uncoveredRanges: [{
      range: range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
      suggestedClassification: 'noise',
      reviewStatus: 'pending',
    }],
    revisionHistory: [{
      artifactId: ARTIFACT_ID,
      artifactRevisionId: ARTIFACT_REVISION_ID,
      sourceAssetId: SOURCE_ASSET_ID,
      sourceHash: sha256(RAW_TEXT),
      processorId: 'voxweaver.application.novel-import',
      processorVersion: '1.0.0',
      rawTextRevision: rawRevision,
      canonicalTextRevision: canonicalRevision,
      normalizedTextRevision: normalizedRevision,
      active: true,
    }],
    normalizationProposals: [normalizationProposal()],
  };
}

function chapterCandidate() {
  return {
    chapterCandidateId: CANDIDATE_ID,
    headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
    lineRange: { lineBase: 1, startLine: 1, endLineExclusive: 2 },
    rawTitle: 'Title',
    normalizedTitle: 'Title',
    ruleId: 'synthetic-heading',
    ruleVersion: '1.0.0',
    ruleConfidence: 1,
    confidenceSource: 'deterministic-test-rule',
    evidence: ['synthetic-test-fixture'],
    contextBefore: [],
    contextAfter: ['Body'],
    reviewStatus: 'not_required',
  };
}

function chapterEntry() {
  return {
    chapterId: CHAPTER_ID,
    order: 0,
    title: 'Title',
    rawHeading: 'Title',
    headingRange: range(CANONICAL_REVISION_ID, 'canonical', 0, 5),
    contentRange: range(CANONICAL_REVISION_ID, 'canonical', 5, 8),
    sourceLineRange: { lineBase: 1, startLine: 1, endLineExclusive: 3 },
    confidence: 1,
    detectedBy: 'rule:synthetic-heading@1.0.0',
    reviewStatus: 'not_required',
  };
}

function normalizationProposal() {
  return {
    proposalId: PROPOSAL_ID,
    canonicalRange: range(CANONICAL_REVISION_ID, 'canonical', 8, 10),
    operation: 'delete',
    beforeText: 'dy',
    afterText: '',
    contextBefore: ['Body'],
    contextAfter: [],
    ruleId: 'synthetic.trailing-noise',
    ruleVersion: '1.0.0',
    reason: 'Synthetic fixture exercises review decisions.',
    evidence: ['synthetic-test-fixture'],
    confidence: 0.75,
    confidenceSource: 'deterministic-test-rule',
    risk: 'medium',
    proposedBy: 'test-suite',
    reviewStatus: 'pending',
    conflictProposalIds: [],
  };
}

function stalePreviewQuery() {
  return {
    documentType: 'novel-import-stale-preview-query',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    readOnly: true,
    baselineRevision: baselineRevision(),
    changeKind: 'boundary-adjustment',
    changeSelector: { chapterIds: [CHAPTER_ID] },
  };
}

function stalePreview() {
  return {
    documentType: 'novel-import-stale-preview',
    schemaVersion: NOVEL_IMPORT_REVIEW_SCHEMA_VERSION,
    baselineRevision: baselineRevision(),
    currentArtifactRevisionId: ARTIFACT_REVISION_ID,
    baselineStatus: 'current',
    canApply: true,
    changeSelector: { chapterIds: [CHAPTER_ID] },
    impacts: [{
      consumerArtifactId: CONSUMER_ARTIFACT_ID,
      consumerRevisionId: CONSUMER_REVISION_ID,
      producerArtifactId: ARTIFACT_ID,
      producerRevisionId: ARTIFACT_REVISION_ID,
      dependencyType: 'structure',
      depth: 1,
      selector: { chapterIds: [CHAPTER_ID] },
    }],
  };
}

function revision(textRevisionId, textLayer, text) {
  return {
    textRevisionId,
    textLayer,
    contentHash: sha256(text),
    byteLength: Buffer.byteLength(text, 'utf8'),
  };
}

function range(textRevisionId, textLayer, startByte, endByte) {
  return {
    textRevisionId,
    textLayer,
    offsetUnit: 'utf8-byte',
    startByte,
    endByte,
  };
}

function createDocumentedValidator() {
  const ajv = new Ajv2020({ allErrors: true });
  addFormats(ajv);
  ajv.addSchema(documentedTextSchema);
  ajv.addSchema(documentedNovelImportSchema);
  ajv.addSchema(documentedReviewSchema);
  return ajv.compile(documentedDesktopNovelImportSchema);
}

function parseDocument(document) {
  switch (document.messageKind) {
    case 'payload':
      return parseDesktopNovelImportMethodPayload(document.method, document.payload);
    case 'result':
      return parseDesktopNovelImportMethodResult(document.method, document.result);
    case 'error':
      return parseDesktopNovelImportError(document.error);
    case 'event':
      return parseDesktopNovelImportEvent(document.event);
    default:
      throw new Error(`Unknown message kind: ${document.messageKind}`);
  }
}

function documentValue(document) {
  return document[document.messageKind];
}

function omit(value, key) {
  const clone = { ...value };
  delete clone[key];
  return clone;
}

function sha256(value) {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}

async function readJson(url) {
  return JSON.parse(await readFile(url, 'utf8'));
}
