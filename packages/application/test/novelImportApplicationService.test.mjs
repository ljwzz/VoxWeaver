import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { TxtSourceAdapter } from '@voxweaver/novel-import';
import { sha256CanonicalJson } from '@voxweaver/workflow-core';

import {
  NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
  NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION,
  NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE,
  NovelImportApplicationError,
  NovelImportApplicationService,
  ProjectApplicationService,
} from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';
const PROJECT_SESSION_ID = '348d6518-f31d-405a-bf8f-12e7c1b893c7';
const STALE_SESSION_ID = '6a4ab824-dcab-4682-aea3-9c8958642c1a';
const SOURCE_ASSET_ID = '517540a8-2047-4bb0-8a1e-7e9b3ab87781';
const CREATED_AT = '2026-08-09T00:00:00.000Z';
const SOURCE_BYTES = Buffer.from('第一章 起点\n正文。\n', 'utf8');
const SOURCE_HASH = sha256(SOURCE_BYTES);

const baseProject = {
  accessMode: 'read-write',
  projectDirectory: '/projects/demo',
  projectSessionId: PROJECT_SESSION_ID,
  manifest: {
    schemaVersion: 1,
    layoutVersion: 2,
    projectId: PROJECT_ID,
    displayName: 'Demo',
    directoryName: `demo--${PROJECT_ID}`,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  },
};

test('runs the complete TXT import in one write session and commits one validated bundle', async () => {
  const harness = await createHarness();
  const result = await harness.service.importTxt(importCommand());

  assert.equal(result.reused, false);
  assert.deepEqual(harness.calls, [
    'workflow-factory',
    'commit-source',
    'enqueue-task',
    'start-task',
    'resolve-adapter',
    'resolve-source',
    'adapter-extract',
    'write-bundle',
    'validate-bundle',
    'commit-artifact',
  ]);
  assert.equal(harness.captures.workflowFactoryContexts.length, 1);
  assert.equal(
    harness.captures.workflowFactoryContexts[0].projectSessionId,
    PROJECT_SESSION_ID,
  );

  const sourceCommit = harness.captures.sourceCommit;
  assert.deepEqual(sourceCommit, {
    temporarySource: { relativePath: 'tmp/upload/source.txt' },
    expectedContentHash: SOURCE_HASH,
    expectedByteLength: SOURCE_BYTES.byteLength,
    originalName: 'fixture.txt',
    sourceType: 'novel-txt',
    createdBy: 'operator:test',
    idempotencyKey: 'import-fixture-1',
  });

  const bundle = harness.captures.bundle;
  const artifactCommit = harness.captures.artifactCommit;
  assert.equal(bundle.documentType, 'novel-import-bundle');
  assert.equal(bundle.sourceAsset.sourceAssetId, SOURCE_ASSET_ID);
  assert.equal(bundle.selectedEncoding.sourceEncoding, 'utf-8');
  assert.equal(bundle.selectedEncoding.method, 'strict-utf8');
  assert.deepEqual(bundle.importWarnings, []);
  assert.equal(bundle.chapterIndex.coverageReport.complete, true);
  assert.equal(bundle.chapterIndex.coverageReport.unclassifiedByteLength, 0);
  assert.equal(bundle.chapterIndex.entries.length, 1);
  assert.ok(bundle.blockIndex.blocks.length >= 2);
  assert.ok(bundle.normalization.proposals.every(item =>
    item.reviewStatus === 'pending'));
  assert.equal(bundle.normalization.result.applied, true);
  assert.equal(bundle.normalization.result.changes.length, 0);
  assert.equal(
    bundle.normalization.result.normalizedText,
    bundle.canonical.text,
  );
  assert.notEqual(
    bundle.normalization.result.normalizedTextRevision.textRevisionId,
    bundle.canonical.revision.textRevisionId,
  );
  assert.equal(
    bundle.importedNovel.rawTextRevision.textLayer,
    'raw',
  );
  assert.equal(bundle.canonical.revision.textLayer, 'canonical');
  assert.equal(
    bundle.normalization.result.normalizedTextRevision.textLayer,
    'normalized',
  );
  assert.deepEqual(bundle.dependencySelector.blockIds, bundle.blockIndex.blocks.map(
    block => block.blockId,
  ));
  assert.deepEqual(bundle.dependencySelector.chapterIds, bundle.chapterIndex.entries.map(
    chapter => chapter.chapterId,
  ));
  assert.deepEqual(
    bundle.parameters.dependencySelector,
    bundle.dependencySelector,
  );
  assert.equal(
    bundle.parameters.fingerprintParameters.versions.adapterVersion,
    bundle.importedNovel.adapterVersion,
  );
  assert.equal(
    bundle.parameters.fingerprintParameters.versions.canonicalProcessorVersion,
    bundle.canonical.rawToCanonicalRangeMap.processorVersion,
  );
  assert.equal(
    bundle.parameters.fingerprintParameters.versions.chapterIndexProcessorVersion,
    bundle.chapterIndex.processorVersion,
  );
  assert.equal(
    bundle.parameters.fingerprintParameters.versions.normalizerProcessorVersion,
    bundle.normalization.result.rangeMap.processorVersion,
  );
  assert.equal(
    bundle.fingerprintParametersHash,
    sha256CanonicalJson(bundle.parameters.fingerprintParameters),
  );
  assert.equal(bundle.parametersHash, sha256CanonicalJson(bundle.parameters));

  assert.equal(artifactCommit.artifactType, NOVEL_IMPORT_BUNDLE_ARTIFACT_TYPE);
  assert.equal(artifactCommit.processorId, NOVEL_IMPORT_APPLICATION_PROCESSOR_ID);
  assert.equal(
    artifactCommit.processorVersion,
    NOVEL_IMPORT_APPLICATION_PROCESSOR_VERSION,
  );
  assert.equal(artifactCommit.taskId, 'task-1');
  assert.equal(artifactCommit.inputFingerprint, bundle.inputFingerprint);
  assert.deepEqual(artifactCommit.parameters, bundle.parameters);
  assert.deepEqual(artifactCommit.dependencies, []);
  assert.deepEqual(artifactCommit.scope, {
    kind: 'novel-import',
    identifiers: [SOURCE_ASSET_ID],
  });
  assert.equal(
    artifactCommit.outputDirectory,
    'tmp/task-1/output/novel-import-bundle',
  );
  assert.ok(!artifactCommit.outputDirectory.startsWith('/'));
  assert.equal(result.artifact.parametersHash, bundle.parametersHash);
});

test('returns an enqueue dedupe result without starting or processing again', async () => {
  const harness = await createHarness({ enqueueReused: true });
  const result = await harness.service.importTxt(importCommand());

  assert.equal(result.reused, true);
  assert.equal(result.task.taskId, 'task-existing');
  assert.deepEqual(harness.calls, [
    'workflow-factory',
    'commit-source',
    'enqueue-task',
  ]);
  assert.equal(harness.captures.bundle, undefined);
  assert.equal(harness.captures.artifactCommit, undefined);
});

test('keeps gbk as an authorized user encoding at the adapter boundary', async () => {
  const harness = await createHarness({ adapterExtractFails: true });

  await assert.rejects(
    harness.service.importTxt({ ...importCommand(), sourceEncoding: 'gbk' }),
    error => error instanceof NovelImportApplicationError
      && error.detailReason === 'adapter-processing_failed',
  );
  assert.ok(harness.calls.includes('adapter-extract'));
  assert.deepEqual(harness.captures.extractContext.userEncoding, {
    sourceContentHash: SOURCE_HASH,
    sourceEncoding: 'gbk',
  });
  assert.equal(harness.captures.failTask.taskId, 'task-1');
});

test('commits an empty source before the adapter rejects it without a formal artifact', async () => {
  const sourceBytes = Buffer.alloc(0);
  const harness = await createHarness({ sourceBytes });

  await assert.rejects(
    harness.service.importTxt(importCommand(sourceBytes)),
    error => error instanceof NovelImportApplicationError
      && error.code === 'NOVEL_IMPORT_INVALID_SOURCE'
      && error.detailReason === 'empty_source',
  );
  assert.deepEqual(harness.calls, [
    'workflow-factory',
    'commit-source',
    'enqueue-task',
    'start-task',
    'resolve-adapter',
    'resolve-source',
    'adapter-extract',
    'fail-task',
  ]);
  assert.equal(harness.captures.sourceCommit.expectedByteLength, 0);
  assert.ok(!harness.calls.includes('commit-artifact'));
});

test('omits an empty chapter selector while retaining all generated block IDs', async () => {
  const sourceBytes = Buffer.from('只有正文，没有章节标题。\n', 'utf8');
  const harness = await createHarness({ sourceBytes });
  const result = await harness.service.importTxt(importCommand(sourceBytes));

  assert.equal(result.reused, false);
  assert.equal(harness.captures.bundle.chapterIndex.entries.length, 0);
  assert.ok(harness.captures.bundle.dependencySelector.blockIds.length > 0);
  assert.equal(
    Object.hasOwn(harness.captures.bundle.dependencySelector, 'chapterIds'),
    false,
  );
  assert.equal(
    Object.hasOwn(
      harness.captures.bundle.parameters.dependencySelector,
      'chapterIds',
    ),
    false,
  );
});

test('persists stable task failure for adapter validation and does not commit an artifact', async () => {
  const harness = await createHarness({ adapterValidationFails: true });

  await assert.rejects(
    harness.service.importTxt(importCommand()),
    error => error instanceof NovelImportApplicationError
      && error.code === 'NOVEL_IMPORT_INVALID_SOURCE'
      && error.detailReason === 'synthetic_invalid_source',
  );
  assert.deepEqual(harness.captures.failTask, {
    errorCode: 'NOVEL_IMPORT_INVALID_SOURCE',
    errorMessage: 'TXT adapter processing failed.',
    taskId: 'task-1',
  });
  assert.ok(harness.calls.includes('fail-task'));
  assert.ok(harness.calls.includes('adapter-extract'));
  assert.ok(!harness.calls.includes('commit-artifact'));
});

test('maps deterministic adapter processing failure to failTask without a formal artifact', async () => {
  const harness = await createHarness({ adapterExtractFails: true });

  await assert.rejects(
    harness.service.importTxt(importCommand()),
    error => error instanceof NovelImportApplicationError
      && error.code === 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE'
      && error.detailReason === 'adapter-processing_failed'
      && !('cause' in error)
      && !error.message.includes('/private/'),
  );
  assert.equal(
    harness.captures.failTask.errorCode,
    'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
  );
  assert.ok(harness.calls.includes('fail-task'));
  assert.ok(!harness.calls.includes('write-bundle'));
  assert.ok(!harness.calls.includes('commit-artifact'));
});

for (const interruption of ['writer', 'validator']) {
  test(`interrupts on ${interruption} failure before the single formal artifact commit`, async () => {
    const harness = await createHarness({
      writerFails: interruption === 'writer',
      validatorFails: interruption === 'validator',
    });

    await assert.rejects(
      harness.service.importTxt(importCommand()),
      error => error instanceof NovelImportApplicationError
        && error.code === 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE'
        && error.detailReason === `artifact-${interruption === 'writer'
          ? 'write'
          : 'validation'}_failed`,
    );
    assert.ok(harness.calls.includes('fail-task'));
    assert.ok(!harness.calls.includes('commit-artifact'));
    assert.equal(harness.captures.artifactCommit, undefined);
  });
}

test('maps artifact commit failure to failTask and never returns success', async () => {
  const harness = await createHarness({ artifactCommitFails: true });

  await assert.rejects(
    harness.service.importTxt(importCommand()),
    error => error instanceof NovelImportApplicationError
      && error.detailReason === 'artifact-commit_failed',
  );
  assert.deepEqual(harness.calls.slice(-2), ['commit-artifact', 'fail-task']);
  assert.equal(harness.captures.failTask.taskId, 'task-1');
});

test('rejects a mismatched committed artifact projection instead of reporting success', async () => {
  const harness = await createHarness({ artifactProjectionMismatch: true });

  await assert.rejects(
    harness.service.importTxt(importCommand()),
    error => error instanceof NovelImportApplicationError
      && error.detailReason === 'committed_artifact_projection_mismatch',
  );
  assert.deepEqual(harness.calls.slice(-2), ['commit-artifact', 'fail-task']);
});

test('fails an acquired task when startTask is interrupted', async () => {
  const harness = await createHarness({ startTaskFails: true });

  await assert.rejects(
    harness.service.importTxt(importCommand()),
    error => error instanceof NovelImportApplicationError
      && error.detailReason === 'task-start_failed',
  );
  assert.deepEqual(harness.calls.slice(-2), ['start-task', 'fail-task']);
  assert.ok(!harness.calls.includes('resolve-adapter'));
});

test('rejects a stale session before creating workflow or touching SourceAsset', async () => {
  const harness = await createHarness();

  await assert.rejects(
    harness.service.importTxt({
      ...importCommand(),
      projectSessionId: STALE_SESSION_ID,
    }),
    error => error instanceof NovelImportApplicationError
      && error.code === 'NOVEL_IMPORT_STALE_SESSION'
      && error.detailReason === 'project_session_stale',
  );
  assert.deepEqual(harness.calls, []);
});

test('rejects a read-only project before creating workflow or touching SourceAsset', async () => {
  const harness = await createHarness({ accessMode: 'read-only' });

  await assert.rejects(
    harness.service.importTxt(importCommand()),
    error => error?.code === 'PROJECT_READ_ONLY',
  );
  assert.deepEqual(harness.calls, []);
});

test('keeps the active project session fenced until validation and commit complete', async () => {
  let releaseWriter;
  const writerGate = new Promise((resolve) => {
    releaseWriter = resolve;
  });
  const harness = await createHarness({ writerGate });
  const operation = harness.service.importTxt(importCommand());
  await waitFor(() => harness.calls.includes('write-bundle'));

  await assert.rejects(
    harness.projects.closeProject(),
    error => error?.code === 'PROJECT_OPERATION_IN_PROGRESS',
  );
  releaseWriter();
  assert.equal((await operation).reused, false);
  await harness.projects.closeProject();
});

async function createHarness(options = {}) {
  const calls = [];
  const sourceBytes = options.sourceBytes ?? SOURCE_BYTES;
  const captures = {
    workflowFactoryContexts: [],
  };
  const project = {
    ...baseProject,
    accessMode: options.accessMode ?? baseProject.accessMode,
  };
  const projects = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      return project;
    },
    async openProject() {
      return project;
    },
  });
  await projects.openProject({ projectDirectory: project.projectDirectory });

  const task = taskRecord('task-1', 'pending');
  const workflow = {
    async commitSourceAsset(command) {
      calls.push('commit-source');
      captures.sourceCommit = command;
      return sourceAssetRecord(sourceBytes);
    },
    async enqueueTask(command) {
      calls.push('enqueue-task');
      captures.enqueueTask = command;
      if (options.enqueueReused) {
        return {
          reused: true,
          task: {
            ...taskRecord('task-existing', 'succeeded'),
            inputFingerprint: command.inputFingerprint,
            outputScope: command.outputScope,
            resultRevisionId: uuid(98_000),
          },
        };
      }
      task.inputFingerprint = command.inputFingerprint;
      task.outputScope = command.outputScope;
      return { reused: false, task };
    },
    async startTask(taskId) {
      calls.push('start-task');
      assert.equal(taskId, task.taskId);
      if (options.startTaskFails)
        throw new Error('synthetic start failure');
      task.executionStatus = 'running';
      return task;
    },
    async failTask(command) {
      calls.push('fail-task');
      captures.failTask = command;
      task.executionStatus = 'failed';
      task.errorCode = command.errorCode;
      task.errorMessage = command.errorMessage;
      return task;
    },
    async commitArtifactRevision(command) {
      calls.push('commit-artifact');
      captures.artifactCommit = command;
      if (options.artifactCommitFails)
        throw new Error('synthetic artifact commit failure');
      task.executionStatus = 'succeeded';
      task.resultRevisionId = command.revisionId;
      const artifact = {
        artifactId: command.artifactId,
        artifactType: command.artifactType,
        lineageId: command.lineageId,
        revisionId: command.revisionId,
        scope: command.scope,
        storageKind: command.storageKind,
        contentPath: `artifacts/imported/${command.revisionId}/content`,
        contentHash: 'b'.repeat(64),
        inputFingerprint: command.inputFingerprint,
        processorId: command.processorId,
        processorVersion: command.processorVersion,
        parametersHash: sha256CanonicalJson(command.parameters),
        executionStatus: 'succeeded',
        validityStatus: 'current',
        reviewStatus: command.reviewRequired ? 'pending' : 'not_required',
        createdAt: CREATED_AT,
        createdBy: command.createdBy,
      };
      if (options.artifactProjectionMismatch)
        artifact.parametersHash = 'c'.repeat(64);
      return artifact;
    },
  };

  const actualAdapter = new TxtSourceAdapter();
  const adapter = {
    adapterId: actualAdapter.adapterId,
    adapterVersion: actualAdapter.adapterVersion,
    async probe(source) {
      return actualAdapter.probe(source);
    },
    async validate(source, context) {
      return actualAdapter.validate(source, context);
    },
    async extract(source, context) {
      calls.push('adapter-extract');
      captures.extractContext = context;
      if (options.adapterValidationFails) {
        throw Object.assign(new Error('private details must not be persisted'), {
          code: 'NOVEL_IMPORT_INVALID_SOURCE',
          detailReason: 'synthetic_invalid_source',
        });
      }
      if (options.adapterExtractFails)
        throw new Error('synthetic adapter failure at /private/fixture.txt');
      return actualAdapter.extract(source, context);
    },
  };

  const service = new NovelImportApplicationService(
    projects,
    (context) => {
      calls.push('workflow-factory');
      captures.workflowFactoryContexts.push(context);
      return workflow;
    },
    {
      async resolveSourceAsset(record, expectedByteLength) {
        calls.push('resolve-source');
        assert.equal(record.sourceAssetId, SOURCE_ASSET_ID);
        assert.equal(expectedByteLength, sourceBytes.byteLength);
        return {
          sourceAssetId: record.sourceAssetId,
          sourceContentHash: record.contentHash,
          sourceByteLength: expectedByteLength,
          mediaType: 'text/plain',
          fileExtension: '.txt',
          openByteStream() {
            return [sourceBytes];
          },
        };
      },
    },
    {
      resolveAdapter(adapterId) {
        calls.push('resolve-adapter');
        assert.equal(adapterId, actualAdapter.adapterId);
        return adapter;
      },
    },
    {
      async writeBundle(command) {
        calls.push('write-bundle');
        captures.bundle = command.bundle;
        if (options.writerGate)
          await options.writerGate;
        if (options.writerFails)
          throw new Error('synthetic writer failure at /private/output');
        return {
          outputDirectory: `${command.task.temporaryPath}/output/novel-import-bundle`,
        };
      },
    },
    {
      async validateBundle(command) {
        calls.push('validate-bundle');
        captures.validation = command;
        assert.equal(command.expectedBundle, captures.bundle);
        assert.equal(
          command.artifact.outputDirectory,
          `${command.task.temporaryPath}/output/novel-import-bundle`,
        );
        if (options.validatorFails)
          throw new Error('synthetic validator failure at /private/output');
      },
    },
    { createOpaqueId: sequentialIdFactory(10_000) },
  );
  return { calls, captures, projects, service };
}

function importCommand(sourceBytes = SOURCE_BYTES) {
  return {
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
    createdBy: 'operator:test',
    source: {
      temporaryRelativePath: 'tmp/upload/source.txt',
      contentHash: sha256(sourceBytes),
      byteLength: sourceBytes.byteLength,
      originalName: 'fixture.txt',
      idempotencyKey: 'import-fixture-1',
    },
  };
}

function sourceAssetRecord(sourceBytes = SOURCE_BYTES) {
  return {
    sourceAssetId: SOURCE_ASSET_ID,
    sourceType: 'novel-txt',
    originalName: 'fixture.txt',
    contentHash: sha256(sourceBytes),
    relativePath: `inputs/source-assets/${SOURCE_ASSET_ID}/fixture.txt`,
    createdAt: CREATED_AT,
    createdBy: 'operator:test',
  };
}

function taskRecord(taskId, executionStatus) {
  return {
    taskId,
    projectId: PROJECT_ID,
    processorId: NOVEL_IMPORT_APPLICATION_PROCESSOR_ID,
    inputFingerprint: '0'.repeat(64),
    outputScope: { kind: 'novel-import', identifiers: [SOURCE_ASSET_ID] },
    dedupeKey: '1'.repeat(64),
    executionStatus,
    recoveryStatus: 'resumable',
    attempt: 1,
    temporaryPath: `tmp/${taskId}`,
    createdAt: CREATED_AT,
    updatedAt: CREATED_AT,
  };
}

function sequentialIdFactory(start) {
  let value = start;
  return () => uuid(value++);
}

function uuid(value) {
  const suffix = value.toString(16).padStart(12, '0').slice(-12);
  return `00000000-0000-4000-8000-${suffix}`;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (predicate())
      return;
    await new Promise(resolve => setImmediate(resolve));
  }
  assert.fail('Timed out waiting for deterministic test checkpoint');
}
