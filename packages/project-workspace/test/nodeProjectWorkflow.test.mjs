import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  NodeProjectWorkflow,
  NodeProjectWorkspace,
  PROJECT_STATE_RELATIVE_PATH,
} from '../dist/index.js';

const FINGERPRINT_A = 'a'.repeat(64);
const FINGERPRINT_B = 'b'.repeat(64);
const FINGERPRINT_C = 'c'.repeat(64);
const FINGERPRINT_D = 'd'.repeat(64);
const FINGERPRINT_E = 'e'.repeat(64);
const SCOPE = { kind: 'book', identifiers: ['book-1'] };

test('persists idempotent tasks and immutable artifact provenance', async () => {
  const harness = await createHarness('workflow-task');

  try {
    const command = {
      inputFingerprint: FINGERPRINT_A,
      outputScope: SCOPE,
      processorId: 'processor.import',
    };
    const enqueued = await harness.workflow.enqueueTask(command);
    const duplicate = await harness.workflow.enqueueTask(command);
    assert.equal(enqueued.reused, false);
    assert.equal(duplicate.reused, true);
    assert.equal(duplicate.task.taskId, enqueued.task.taskId);

    await writeFile(
      join(
        harness.context.projectDirectory,
        enqueued.task.temporaryPath,
        'output',
        'content.txt',
      ),
      'immutable content',
    );
    assert.equal(
      (await harness.workflow.startTask(enqueued.task.taskId)).executionStatus,
      'running',
    );

    const artifact = await harness.workflow.commitArtifactRevision({
      artifactType: 'canonical-text',
      createdBy: 'test-user',
      inputFingerprint: FINGERPRINT_A,
      outputDirectory: join(enqueued.task.temporaryPath, 'output'),
      parameters: { normalization: 'none' },
      processorId: command.processorId,
      processorVersion: '1.0.0',
      scope: SCOPE,
      storageKind: 'canonical',
      taskId: enqueued.task.taskId,
    });

    assert.equal(artifact.executionStatus, 'succeeded');
    assert.equal(artifact.validityStatus, 'current');
    assert.equal(artifact.inputFingerprint, FINGERPRINT_A);
    assert.equal(artifact.contentHash.length, 64);
    assert.equal(
      (await harness.workflow.getTask(enqueued.task.taskId)).executionStatus,
      'succeeded',
    );
    assert.equal(
      (await harness.workflow.getTask(enqueued.task.taskId)).resultRevisionId,
      artifact.revisionId,
    );
    assert.equal(
      (await harness.workflow.findReusableRevision(
        FINGERPRINT_A,
        command.processorId,
        SCOPE,
      )).revisionId,
      artifact.revisionId,
    );

    const revisionDocument = JSON.parse(await readFile(
      join(
        harness.context.projectDirectory,
        'artifacts',
        'canonical',
        artifact.revisionId,
        'revision.json',
      ),
      'utf8',
    ));
    assert.equal(revisionDocument.schemaVersion, 1);
    assert.deepEqual(revisionDocument.record, artifact);
    assert.deepEqual(revisionDocument.dependencies, []);

    const database = new DatabaseSync(
      join(harness.context.projectDirectory, PROJECT_STATE_RELATIVE_PATH),
    );
    try {
      assert.throws(() => database.prepare(`
        UPDATE artifact_revisions
        SET processor_version = 'mutated'
        WHERE revision_id = ?
      `).run(artifact.revisionId), /immutable/u);
    } finally {
      database.close();
    }

    const backupPath = await harness.workflow.createBackup();
    assert.equal((await readFile(backupPath)).length > 0, true);
    if (process.platform !== 'win32')
      assert.equal((await stat(backupPath)).mode & 0o777, 0o600);

    const stageRun = await harness.workflow.createStageRun({
      inputFingerprint: FINGERPRINT_A,
      stageId: 'stage.import',
    });
    assert.equal(stageRun.executionStatus, 'pending');
    assert.equal(
      (await harness.workflow.startStageRun(stageRun.stageRunId))
        .executionStatus,
      'running',
    );
    const finishedStage = await harness.workflow.finishStageRun(
      stageRun.stageRunId,
      'succeeded',
    );
    assert.equal(finishedStage.executionStatus, 'succeeded');
    assert.equal(
      (await harness.workflow.getStageRun(stageRun.stageRunId)).finishedAt
      !== undefined,
      true,
    );

    const retryCommand = {
      inputFingerprint: FINGERPRINT_B,
      outputScope: SCOPE,
      processorId: 'processor.retry',
    };
    const failed = await harness.workflow.enqueueTask(retryCommand);
    await harness.workflow.startTask(failed.task.taskId);
    assert.equal(
      (await harness.workflow.failTask({
        errorCode: 'PROVIDER_TIMEOUT',
        errorMessage: 'Timed out.',
        taskId: failed.task.taskId,
      })).executionStatus,
      'failed',
    );
    const retry = await harness.workflow.enqueueTask(retryCommand);
    assert.equal(retry.task.attempt, 2);
    assert.equal(
      (await harness.workflow.cancelTask(retry.task.taskId)).executionStatus,
      'canceled',
    );
    assert.equal(
      (await harness.workflow.enqueueTask(retryCommand)).task.attempt,
      3,
    );
  } finally {
    await closeHarness(harness);
  }
});

test('propagates only intersecting dependencies and preserves multiple causes', async () => {
  const harness = await createHarness('workflow-stale');

  try {
    const sourceA = await commitManualArtifact(harness, {
      artifactType: 'source-a',
      fingerprint: FINGERPRINT_A,
      label: 'source-a-v1',
    });
    const sourceE = await commitManualArtifact(harness, {
      artifactType: 'source-e',
      fingerprint: FINGERPRINT_B,
      label: 'source-e-v1',
    });
    const consumer = await commitManualArtifact(harness, {
      artifactType: 'consumer',
      dependencies: [
        {
          dependencyType: 'content',
          producerArtifactId: sourceA.artifactId,
          producerRevisionId: sourceA.revisionId,
          selector: { chapterIds: ['chapter-1'] },
        },
        {
          dependencyType: 'voice',
          producerArtifactId: sourceE.artifactId,
          producerRevisionId: sourceE.revisionId,
          selector: { voiceProfileIds: ['voice-1'] },
        },
      ],
      fingerprint: FINGERPRINT_C,
      label: 'consumer-v1',
      reviewRequired: true,
    });
    const downstream = await commitManualArtifact(harness, {
      artifactType: 'downstream',
      dependencies: [{
        dependencyType: 'content',
        producerArtifactId: consumer.artifactId,
        producerRevisionId: consumer.revisionId,
      }],
      fingerprint: FINGERPRINT_D,
      label: 'downstream-v1',
    });
    const unaffected = await commitManualArtifact(harness, {
      artifactType: 'unaffected',
      dependencies: [{
        dependencyType: 'content',
        producerArtifactId: sourceA.artifactId,
        producerRevisionId: sourceA.revisionId,
        selector: { chapterIds: ['chapter-2'] },
      }],
      fingerprint: FINGERPRINT_E,
      label: 'unaffected-v1',
    });
    assert.equal(consumer.reviewStatus, 'pending');

    const preview = await harness.workflow.previewArtifactImpact({
      changeSelector: { chapterIds: ['chapter-1'] },
      producerArtifactId: sourceA.artifactId,
    });
    assert.equal(preview.producerRevisionId, sourceA.revisionId);
    assert.deepEqual(
      preview.impacts.map(impact => [
        impact.consumerRevisionId,
        impact.depth,
      ]),
      [
        [consumer.revisionId, 1],
        [downstream.revisionId, 2],
      ],
    );

    await assert.rejects(
      harness.workflow.previewArtifactImpact({
        changeSelector: { chapterIds: [] },
        producerArtifactId: sourceA.artifactId,
      }),
      error => error?.code === 'PROJECT_WORKFLOW_CONTENT_INVALID',
    );

    await commitManualArtifact(harness, {
      artifactId: sourceA.artifactId,
      artifactType: sourceA.artifactType,
      changeSelector: { chapterIds: ['chapter-1'] },
      fingerprint: FINGERPRINT_B,
      label: 'source-a-v2',
      lineageId: sourceA.lineageId,
    });
    assert.equal(
      (await harness.workflow.getArtifactRevision(consumer.revisionId))
        .validityStatus,
      'stale',
    );
    assert.equal(
      (await harness.workflow.getArtifactRevision(downstream.revisionId))
        .validityStatus,
      'stale',
    );
    assert.equal(
      (await harness.workflow.getArtifactRevision(unaffected.revisionId))
        .validityStatus,
      'current',
    );

    await commitManualArtifact(harness, {
      artifactId: sourceE.artifactId,
      artifactType: sourceE.artifactType,
      changeSelector: { voiceProfileIds: ['voice-1'] },
      fingerprint: FINGERPRINT_C,
      label: 'source-e-v2',
      lineageId: sourceE.lineageId,
    });

    const consumerCauses = await harness.workflow.listStaleCauses(
      consumer.revisionId,
    );
    const downstreamCauses = await harness.workflow.listStaleCauses(
      downstream.revisionId,
    );
    assert.equal(consumerCauses.length, 2);
    assert.equal(downstreamCauses.length, 2);
    assert.equal(new Set(consumerCauses.map(cause => cause.rootCauseKey)).size, 2);

    await assert.rejects(
      harness.workflow.createExportSnapshot({
        createdBy: 'test-user',
        revisionIds: [consumer.revisionId],
      }),
      error => error?.code === 'PROJECT_STATE_CONFLICT',
    );
    const waived = await harness.workflow.createExportSnapshot({
      createdBy: 'test-user',
      revisionIds: [consumer.revisionId],
      staleWaiverReason: 'comparison-only export',
    });
    assert.deepEqual(waived.revisionIds, [consumer.revisionId]);

    await harness.workflow.resolveStaleCause(consumerCauses[0].staleCauseId);
    assert.equal(
      (await harness.workflow.getArtifactRevision(consumer.revisionId))
        .validityStatus,
      'stale',
    );
    await harness.workflow.resolveStaleCause(consumerCauses[1].staleCauseId);
    assert.equal(
      (await harness.workflow.getArtifactRevision(consumer.revisionId))
        .validityStatus,
      'current',
    );

    await harness.workflow.resolveStaleCause(downstreamCauses[0].staleCauseId);
    assert.equal(
      (await harness.workflow.getArtifactRevision(downstream.revisionId))
        .validityStatus,
      'stale',
    );
    await harness.workflow.resolveStaleCause(downstreamCauses[1].staleCauseId);
    assert.equal(
      (await harness.workflow.getArtifactRevision(downstream.revisionId))
        .validityStatus,
      'current',
    );

    const review = await harness.workflow.recordReviewDecision({
      artifactId: consumer.artifactId,
      decidedBy: 'reviewer',
      decision: 'approved',
      note: 'verified',
      revisionId: consumer.revisionId,
    });
    assert.equal(review.decision, 'approved');
    assert.equal(
      (await harness.workflow.getArtifactRevision(consumer.revisionId))
        .reviewStatus,
      'approved',
    );
    assert.equal(
      (await harness.workflow.recover()).missingRevisionIds.length,
      0,
    );
  } finally {
    await closeHarness(harness);
  }
});

test('reactivates an exact historical revision and resolves reversed causes', async () => {
  const harness = await createHarness('workflow-reuse');

  try {
    const sourceV1 = await commitManualArtifact(harness, {
      artifactType: 'source',
      fingerprint: FINGERPRINT_A,
      label: 'source-v1',
    });
    const consumer = await commitManualArtifact(harness, {
      artifactType: 'consumer',
      dependencies: [{
        dependencyType: 'content',
        producerArtifactId: sourceV1.artifactId,
        producerRevisionId: sourceV1.revisionId,
      }],
      fingerprint: FINGERPRINT_B,
      label: 'consumer-v1',
    });
    const sourceV2 = await commitManualArtifact(harness, {
      artifactId: sourceV1.artifactId,
      artifactType: sourceV1.artifactType,
      fingerprint: FINGERPRINT_C,
      label: 'source-v2',
      lineageId: sourceV1.lineageId,
    });
    assert.equal(
      (await harness.workflow.getArtifactRevision(consumer.revisionId))
        .validityStatus,
      'stale',
    );

    const reusable = await harness.workflow.findReusableRevision(
      FINGERPRINT_A,
      'processor.test',
      SCOPE,
    );
    assert.equal(reusable.revisionId, sourceV1.revisionId);
    const reactivated = await harness.workflow.activateArtifactRevision({
      revisionId: reusable.revisionId,
    });
    assert.equal(reactivated.validityStatus, 'current');
    assert.equal(
      (await harness.workflow.getArtifactRevision(sourceV2.revisionId))
        .validityStatus,
      'superseded',
    );
    assert.equal(
      (await harness.workflow.getArtifactRevision(consumer.revisionId))
        .validityStatus,
      'current',
    );
    assert.deepEqual(
      (await harness.workflow.listStaleCauses(consumer.revisionId))
        .map(cause => cause.status),
      ['resolved'],
    );
  } finally {
    await closeHarness(harness);
  }
});

test('recovers interrupted tasks, missing content, and orphan paths', async () => {
  const harness = await createHarness('workflow-recovery');

  try {
    const running = await harness.workflow.enqueueTask({
      inputFingerprint: FINGERPRINT_A,
      outputScope: SCOPE,
      processorId: 'processor.running',
    });
    await harness.workflow.startTask(running.task.taskId);
    const interruptedStage = await harness.workflow.createStageRun({
      inputFingerprint: FINGERPRINT_A,
      stageId: 'stage.interrupted',
    });
    await harness.workflow.startStageRun(interruptedStage.stageRunId);

    const missingTemporary = await harness.workflow.enqueueTask({
      inputFingerprint: FINGERPRINT_B,
      outputScope: SCOPE,
      processorId: 'processor.missing-temp',
    });
    await rm(join(
      harness.context.projectDirectory,
      missingTemporary.task.temporaryPath,
    ), { recursive: true });

    const completed = await completeTaskArtifact(harness, {
      fingerprint: FINGERPRINT_C,
      processorId: 'processor.completed',
    });
    await writeFile(
      join(
        harness.context.projectDirectory,
        completed.artifact.contentPath,
        'content.txt',
      ),
      'tampered',
    );

    const orphanRevisionId = randomUUID();
    const orphanOutput = join('tmp', `orphan-output-${randomUUID()}`);
    await mkdir(join(harness.context.projectDirectory, orphanOutput));
    await writeFile(
      join(harness.context.projectDirectory, orphanOutput, 'content.txt'),
      'orphaned after transaction rollback',
    );
    const missingProducerId = randomUUID();
    await assert.rejects(
      harness.workflow.commitArtifactRevision({
        artifactType: 'orphaned',
        createdBy: 'test-user',
        dependencies: [{
          dependencyType: 'content',
          producerArtifactId: missingProducerId,
          producerRevisionId: randomUUID(),
        }],
        inputFingerprint: FINGERPRINT_D,
        outputDirectory: orphanOutput,
        parameters: {},
        processorId: 'processor.orphaned',
        processorVersion: '1.0.0',
        revisionId: orphanRevisionId,
        scope: SCOPE,
        storageKind: 'canonical',
      }),
      error => error?.code === 'PROJECT_STATE_NOT_FOUND',
    );
    assert.equal(
      await harness.workflow.getArtifactRevision(orphanRevisionId),
      undefined,
    );
    await mkdir(join(harness.context.projectDirectory, 'tmp', 'orphan-task'));

    const report = await harness.workflow.recover();
    assert.deepEqual(report.interruptedStageRunIds, [interruptedStage.stageRunId]);
    assert.deepEqual(report.interruptedTaskIds, [running.task.taskId]);
    assert.equal(report.missingRevisionIds.includes(completed.artifact.revisionId), true);
    assert.equal(
      report.orphanArtifactPaths.includes(
        `artifacts/canonical/${orphanRevisionId}`,
      ),
      true,
    );
    assert.equal(report.orphanTemporaryPaths.includes('tmp/orphan-task'), true);
    assert.equal(report.resumableTaskIds.includes(running.task.taskId), true);
    assert.equal(
      report.retryableTaskIds.includes(missingTemporary.task.taskId),
      true,
    );
    assert.equal(
      (await harness.workflow.getArtifactRevision(completed.artifact.revisionId))
        .validityStatus,
      'missing',
    );
    assert.equal(
      (await harness.workflow.getTask(running.task.taskId)).executionStatus,
      'pending',
    );
    assert.equal(
      (await harness.workflow.getStageRun(interruptedStage.stageRunId))
        .executionStatus,
      'failed',
    );
    assert.equal(
      (await harness.workflow.getTask(missingTemporary.task.taskId))
        .recoveryStatus,
      'retryable',
    );

    const retried = await harness.workflow.enqueueTask({
      inputFingerprint: FINGERPRINT_C,
      outputScope: SCOPE,
      processorId: 'processor.completed',
    });
    assert.equal(retried.reused, false);
    assert.equal(retried.task.attempt, 2);

    await writeFile(
      join(
        harness.context.projectDirectory,
        completed.artifact.contentPath,
        'content.txt',
      ),
      'completed content',
    );
    const restored = await harness.workflow.recover();
    assert.deepEqual(restored.restoredRevisionIds, [completed.artifact.revisionId]);
    assert.equal(
      (await harness.workflow.getArtifactRevision(completed.artifact.revisionId))
        .validityStatus,
      'current',
    );
  } finally {
    await closeHarness(harness);
  }
});

test('registers only physical source content inside inputs and enforces read-only writes', async () => {
  const harness = await createHarness('workflow-source');

  try {
    const sourcePath = join(
      harness.context.projectDirectory,
      'inputs',
      'novels',
      'source.txt',
    );
    await writeFile(sourcePath, 'source text');
    const source = await harness.workflow.registerSourceAsset({
      createdBy: 'test-user',
      originalName: 'source.txt',
      relativePath: 'inputs/novels/source.txt',
      sourceType: 'text/plain',
    });
    assert.equal(source.relativePath, 'inputs/novels/source.txt');
    assert.equal(source.contentHash.length, 64);
    await symlink(
      sourcePath,
      join(harness.context.projectDirectory, 'inputs/novels/source-link.txt'),
    );
    await assert.rejects(
      harness.workflow.registerSourceAsset({
        createdBy: 'test-user',
        originalName: 'source-link.txt',
        relativePath: 'inputs/novels/source-link.txt',
        sourceType: 'text/plain',
      }),
      error => error?.code === 'PROJECT_WORKFLOW_PATH_INVALID',
    );

    const outsidePath = join(harness.parentDirectory, 'outside.txt');
    await writeFile(outsidePath, 'outside');
    await assert.rejects(
      harness.workflow.registerSourceAsset({
        createdBy: 'test-user',
        originalName: 'outside.txt',
        relativePath: outsidePath,
        sourceType: 'text/plain',
      }),
      error => error?.code === 'PROJECT_WORKFLOW_PATH_INVALID',
    );

    const readerWorkspace = new NodeProjectWorkspace();
    const readOnlyContext = await readerWorkspace.openProject({
      accessMode: 'read-only',
      projectDirectory: harness.context.projectDirectory,
    });
    const readOnlyWorkflow = new NodeProjectWorkflow(readOnlyContext);
    assert.equal(
      (await readOnlyWorkflow.getArtifactRevision(randomUUID())),
      undefined,
    );
    await assert.rejects(
      readOnlyWorkflow.enqueueTask({
        inputFingerprint: FINGERPRINT_A,
        outputScope: SCOPE,
        processorId: 'processor.read-only',
      }),
      error => error?.code === 'PROJECT_STATE_READ_ONLY',
    );
    await readerWorkspace.closeProject(readOnlyContext);
  } finally {
    await closeHarness(harness);
  }
});

async function createHarness(prefix) {
  const parentDirectory = await mkdtemp(join(tmpdir(), `voxweaver-${prefix}-`));
  const workspace = new NodeProjectWorkspace();
  const context = await workspace.createProject({
    displayName: prefix,
    parentDirectory,
  });
  return {
    context,
    parentDirectory,
    workflow: new NodeProjectWorkflow(context),
    workspace,
  };
}

async function closeHarness(harness) {
  await harness.workspace.closeProject(harness.context).catch(() => {});
  await rm(harness.parentDirectory, { force: true, recursive: true });
}

async function commitManualArtifact(harness, options) {
  const temporaryName = `manual-${randomUUID()}`;
  const outputDirectory = join('tmp', temporaryName);
  await mkdir(join(harness.context.projectDirectory, outputDirectory));
  await writeFile(
    join(harness.context.projectDirectory, outputDirectory, 'content.txt'),
    options.label,
  );
  return harness.workflow.commitArtifactRevision({
    ...(options.artifactId ? { artifactId: options.artifactId } : {}),
    artifactType: options.artifactType,
    ...(options.changeSelector
      ? { changeSelector: options.changeSelector }
      : {}),
    createdBy: 'test-user',
    dependencies: options.dependencies ?? [],
    inputFingerprint: options.fingerprint,
    ...(options.lineageId ? { lineageId: options.lineageId } : {}),
    outputDirectory,
    parameters: { label: options.label },
    processorId: 'processor.test',
    processorVersion: '1.0.0',
    ...(options.reviewRequired ? { reviewRequired: true } : {}),
    scope: SCOPE,
    storageKind: 'canonical',
  });
}

async function completeTaskArtifact(harness, options) {
  const enqueued = await harness.workflow.enqueueTask({
    inputFingerprint: options.fingerprint,
    outputScope: SCOPE,
    processorId: options.processorId,
  });
  await writeFile(
    join(
      harness.context.projectDirectory,
      enqueued.task.temporaryPath,
      'output',
      'content.txt',
    ),
    'completed content',
  );
  await harness.workflow.startTask(enqueued.task.taskId);
  const artifact = await harness.workflow.commitArtifactRevision({
    artifactType: 'completed',
    createdBy: 'test-user',
    inputFingerprint: options.fingerprint,
    outputDirectory: join(enqueued.task.temporaryPath, 'output'),
    parameters: {},
    processorId: options.processorId,
    processorVersion: '1.0.0',
    scope: SCOPE,
    storageKind: 'canonical',
    taskId: enqueued.task.taskId,
  });
  return { artifact, task: enqueued.task };
}
