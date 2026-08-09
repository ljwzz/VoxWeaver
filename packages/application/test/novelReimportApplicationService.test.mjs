import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import test from 'node:test';

import { TxtSourceAdapter } from '@voxweaver/novel-import';
import {
  sha256CanonicalJson,
  SourceAssetCommitError,
} from '@voxweaver/workflow-core';

import {
  NovelImportApplicationError,
  NovelImportApplicationService,
  ProjectApplicationService,
} from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';
const PROJECT_SESSION_ID = '348d6518-f31d-405a-bf8f-12e7c1b893c7';
const CREATED_AT = '2026-08-09T00:00:00.000Z';
const TEXT_A = Buffer.from('第一章 起点\n甲。\n稳定尾句。\n', 'utf8');
const TEXT_B = Buffer.from('第一章 起点\n乙。\n稳定尾句。\n', 'utf8');
const TEXT_C = Buffer.from('第一章 起点\n丙。\n稳定尾句。\n', 'utf8');
const TEXT_MULTI_SCOPE = Buffer.from(
  '第一章 改题\n乙。\n稳定尾句。\n',
  'utf8',
);
const TEXT_AMBIGUOUS_PREVIOUS = Buffer.from(
  '第一章 重复\nA\nX\nM\nX\nB\n',
  'utf8',
);
const TEXT_AMBIGUOUS_CURRENT = Buffer.from(
  '第一章 重复\nA\n \nX\n \nB\n',
  'utf8',
);
const DUAL_ENCODING_BYTES = Buffer.concat([
  Buffer.from('Chapter 1 Start\n', 'ascii'),
  Buffer.from([0xA4, 0xA4]),
  Buffer.from('\nStable.\n', 'ascii'),
]);

test('reuses the current revision for identical input with zero selectors and no workflow write', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  const baseline = harness.currentBaseline();
  harness.resetMutations();

  const result = await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_A, 'source-a', baseline),
  );

  assert.equal(result.outcome, 'reused-current');
  assert.equal(result.artifact.revisionId, baseline.artifactRevisionId);
  assert.deepEqual(result.impactSelectors, []);
  assert.deepEqual(result.plan.changes, emptyChanges());
  assert.deepEqual(harness.mutationCalls, []);
  assert.equal(harness.revisions().length, 1);
});

test('commits one local content change with the exact M1-16B selector and retains the old revision', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  const baseline = harness.currentBaseline();
  const previousBundle = harness.bundle(baseline.artifactRevisionId);
  harness.resetMutations();

  const result = await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_B, 'source-b', baseline),
  );

  assert.equal(result.outcome, 'committed');
  assert.equal(result.impactSelectors.length, 1);
  assert.equal(result.impactSelectors[0].changeScope, 'content');
  assert.deepEqual(
    harness.lastArtifactCommit.changeSelector,
    result.impactSelectors[0].selector,
  );
  assert.equal(
    result.plan.preservedChapters[0].preservedChapterId,
    previousBundle.chapterIndex.entries[0].chapterId,
  );
  assert.equal(
    harness.bundle(result.artifact.revisionId).chapterIndex.entries[0].chapterId,
    previousBundle.chapterIndex.entries[0].chapterId,
  );
  assert.deepEqual(harness.mutationCalls, [
    'commit-source',
    'enqueue-task',
    'start-task',
    'commit-artifact',
  ]);
  assert.equal(harness.revisions().length, 2);
  assert.equal(
    harness.revision(baseline.artifactRevisionId).validityStatus,
    'superseded',
  );
});

test('restores content by activating its historical revision and keeps both stored revisions', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  const original = harness.currentBaseline();
  await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_B, 'source-b', original),
  );
  const changed = harness.currentBaseline();
  const revisionCount = harness.revisions().length;
  const originalContentHash = harness.revision(original.artifactRevisionId).contentHash;
  const changedContentHash = harness.revision(changed.artifactRevisionId).contentHash;
  harness.resetMutations();

  const restored = await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_A, 'source-a-restored', changed),
  );

  assert.equal(restored.outcome, 'reactivated-history');
  assert.equal(restored.artifact.revisionId, original.artifactRevisionId);
  assert.equal(restored.previousActiveRevisionId, changed.artifactRevisionId);
  assert.equal(restored.impactSelectors.length, 1);
  assert.equal(restored.impactSelectors[0].changeScope, 'content');
  assert.deepEqual(
    harness.lastActivation.changeSelector,
    restored.impactSelectors[0].selector,
  );
  assert.deepEqual(harness.mutationCalls, ['commit-source', 'activate-artifact']);
  assert.deepEqual(harness.validatedSourceCommitKeys, ['source-a-restored']);
  assert.equal(harness.revisions().length, revisionCount);
  assert.equal(
    harness.revision(original.artifactRevisionId).contentHash,
    originalContentHash,
  );
  assert.equal(
    harness.revision(changed.artifactRevisionId).contentHash,
    changedContentHash,
  );
});

test('continues reprocessing after a validated duplicate SourceAsset uses a different encoding', async () => {
  const harness = await createHarness();
  await harness.importInitial(DUAL_ENCODING_BYTES, 'dual-gbk', 'gbk');
  const baseline = harness.currentBaseline();
  const sourceAssetId = harness.currentBundle().sourceAsset.sourceAssetId;
  harness.resetMutations();

  const result = await harness.service.reimportTxt(
    harness.reimportCommand(
      DUAL_ENCODING_BYTES,
      'dual-big5',
      baseline,
      'big5',
    ),
  );

  assert.equal(result.outcome, 'committed');
  assert.equal(result.impactSelectors.length, 1);
  assert.equal(result.impactSelectors[0].changeScope, 'content');
  assert.equal(harness.currentBundle().sourceAsset.sourceAssetId, sourceAssetId);
  assert.equal(harness.currentBundle().selectedEncoding.sourceEncoding, 'big5');
  assert.deepEqual(harness.validatedSourceCommitKeys, ['dual-big5']);
  assert.deepEqual(harness.mutationCalls, [
    'commit-source',
    'enqueue-task',
    'start-task',
    'commit-artifact',
  ]);
});

test('reprocesses a rejected historical revision while reusing its immutable SourceAsset', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  const original = harness.currentBaseline();
  await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_B, 'source-b', original),
  );
  const changed = harness.currentBaseline();
  harness.patchRevision(original.artifactRevisionId, {
    reviewStatus: 'rejected',
  });
  harness.resetMutations();

  const result = await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_A, 'source-a-rejected', changed),
  );

  assert.equal(result.outcome, 'committed');
  assert.notEqual(result.artifact.revisionId, original.artifactRevisionId);
  assert.equal(result.impactSelectors.length, 1);
  assert.equal(result.impactSelectors[0].changeScope, 'content');
  assert.deepEqual(harness.validatedSourceCommitKeys, ['source-a-rejected']);
  assert.deepEqual(harness.mutationCalls, [
    'commit-source',
    'enqueue-task',
    'start-task',
    'commit-artifact',
  ]);
  assert.equal(harness.revisions().length, 3);
});

test('does not treat a SourceAsset commit conflict as a reusable duplicate', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_B, 'source-b', harness.currentBaseline()),
  );
  const baseline = harness.currentBaseline();
  harness.resetMutations();

  await assert.rejects(
    harness.service.reimportTxt(
      harness.reimportCommand(TEXT_A, 'source-b', baseline),
    ),
    (error) => {
      assert.ok(error instanceof NovelImportApplicationError);
      assert.equal(error.code, 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
      assert.equal(error.detailReason, 'source-commit_failed');
      return true;
    },
  );
  assert.deepEqual(harness.mutationCalls, ['commit-source']);
  assert.deepEqual(harness.validatedSourceCommitKeys, []);
  assert.equal(
    harness.currentBaseline().artifactRevisionId,
    baseline.artifactRevisionId,
  );
});

test('rejects a lossy artifact projection returned after historical activation', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  const original = harness.currentBaseline();
  await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_B, 'source-b', original),
  );
  const changed = harness.currentBaseline();
  harness.patchNextActivation({ processorVersion: 'synthetic-mismatch' });
  harness.resetMutations();

  await assert.rejects(
    harness.service.reimportTxt(
      harness.reimportCommand(TEXT_A, 'source-a-projection', changed),
    ),
    (error) => {
      assert.ok(error instanceof NovelImportApplicationError);
      assert.equal(
        error.detailReason,
        'reimport_activation_projection_invalid',
      );
      return true;
    },
  );
  assert.deepEqual(harness.mutationCalls, ['commit-source', 'activate-artifact']);
  assert.deepEqual(harness.validatedSourceCommitKeys, ['source-a-projection']);
});

test('rejects a stale revision returned by an inconsistent reusable lookup', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  const original = harness.currentBaseline();
  await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_B, 'source-b', original),
  );
  const changed = harness.currentBaseline();
  harness.patchNextReusable({ validityStatus: 'stale' });
  harness.resetMutations();

  await assert.rejects(
    harness.service.reimportTxt(
      harness.reimportCommand(TEXT_A, 'source-a-stale', changed),
    ),
    (error) => {
      assert.ok(error instanceof NovelImportApplicationError);
      assert.equal(error.detailReason, 'reimport_reusable_revision_invalid');
      return true;
    },
  );
  assert.deepEqual(harness.mutationCalls, []);
  assert.deepEqual(harness.validatedSourceCommitKeys, []);
});

test('marks an ambiguous reimport for review without discarding its exact content selector', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_AMBIGUOUS_PREVIOUS, 'source-ambiguous-a');
  const baseline = harness.currentBaseline();

  const result = await harness.service.reimportTxt(
    harness.reimportCommand(
      TEXT_AMBIGUOUS_CURRENT,
      'source-ambiguous-b',
      baseline,
    ),
  );

  assert.equal(result.outcome, 'committed');
  assert.equal(result.plan.reviewStatus, 'pending');
  assert.ok(result.plan.ambiguities.some(item => item.entityType === 'block'));
  assert.equal(result.impactSelectors.length, 1);
  assert.equal(result.impactSelectors[0].changeScope, 'content');
  assert.equal(result.artifact.reviewStatus, 'pending');
  assert.equal(harness.lastArtifactCommit.reviewRequired, true);
});

test('submits two independent local transitions without resolving either stale cause', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_B, 'source-b', harness.currentBaseline()),
  );
  await harness.service.reimportTxt(
    harness.reimportCommand(TEXT_C, 'source-c', harness.currentBaseline()),
  );

  assert.equal(harness.staleTransitions.length, 2);
  assert.ok(harness.staleTransitions.every(item => item.changeSelector));
  assert.equal(harness.resolveStaleCauseCalls, 0);
  assert.equal(harness.revisions().length, 3);
});

test('keeps a display-only historical plan in typed details without any workflow write', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  const original = harness.currentBaseline();
  harness.seedDisplayOnlyRevision('显示标题');
  const displayBaseline = harness.currentBaseline();
  harness.resetMutations();

  await assert.rejects(
    harness.service.reimportTxt(
      harness.reimportCommand(TEXT_A, 'source-a', displayBaseline),
    ),
    (error) => {
      assert.ok(error instanceof NovelImportApplicationError);
      assert.equal(
        error.detailReason,
        'reimport_display_change_scope_unavailable',
      );
      assert.equal(error.code, 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE');
      assert.deepEqual(
        error.details.impactSelectors.map(item => item.changeScope),
        ['display'],
      );
      assert.equal(error.details.plan.documentType, 'novel-reimport-plan');
      const serialized = JSON.stringify(error.details);
      assert.ok(!serialized.includes('显示标题'));
      assert.ok(!serialized.includes('/'));
      return true;
    },
  );
  assert.deepEqual(harness.mutationCalls, []);
  assert.equal(harness.currentBaseline().artifactRevisionId, displayBaseline.artifactRevisionId);
  assert.ok(harness.revision(original.artifactRevisionId));
});

test('keeps multiple scoped selectors separate and refuses lossy workflow projection before writes', async () => {
  const harness = await createHarness();
  await harness.importInitial(TEXT_A, 'source-a');
  const alternate = await createHarness({ sourceStart: 60_000 });
  await alternate.importInitial(TEXT_MULTI_SCOPE, 'source-multi');
  harness.seedBundleRevision(alternate.currentBundle(), true);
  const multiScopeBaseline = harness.currentBaseline();
  harness.resetMutations();

  await assert.rejects(
    harness.service.reimportTxt(
      harness.reimportCommand(TEXT_A, 'source-a', multiScopeBaseline),
    ),
    (error) => {
      assert.ok(error instanceof NovelImportApplicationError);
      assert.equal(
        error.detailReason,
        'reimport_multiple_change_scopes_unavailable',
      );
      assert.deepEqual(
        error.details.impactSelectors.map(item => item.changeScope),
        ['content', 'structure'],
      );
      return true;
    },
  );
  assert.deepEqual(harness.mutationCalls, []);
  assert.equal(
    harness.currentBaseline().artifactRevisionId,
    multiScopeBaseline.artifactRevisionId,
  );
});

async function createHarness(options = {}) {
  const mutationCalls = [];
  const sourceCommands = new Map();
  const sourceByKey = new Map();
  const sourceIntentByKey = new Map();
  const sourceBytesById = new Map();
  const validatedSourceCommitKeys = [];
  const tasks = new Map();
  const revisions = new Map();
  const bundles = new Map();
  const dependencies = new Map();
  const revisionOrder = [];
  const pendingBundles = new Map();
  const staleTransitions = [];
  let activeRevisionId;
  let taskSequence = 0;
  let sourceSequence = options.sourceStart ?? 50_000;
  let timestampSequence = 0;
  let lastArtifactCommit;
  let lastActivation;
  let activationProjectionPatch;
  let reusableProjectionPatch;
  let resolveStaleCauseCalls = 0;

  const project = {
    accessMode: 'read-write',
    projectDirectory: 'synthetic/projects/demo',
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

  const workflow = {
    async commitSourceAsset(command) {
      mutationCalls.push('commit-source');
      const existing = sourceByKey.get(command.idempotencyKey);
      if (existing) {
        const intent = sourceIntentByKey.get(command.idempotencyKey);
        assert.ok(intent);
        if (!sameSourceCommitIntent(intent, command)) {
          throw new SourceAssetCommitError(
            'SOURCE_ASSET_COMMIT_CONFLICT',
            'Synthetic source asset idempotency conflict.',
          );
        }
        return structuredClone(existing);
      }
      const bytes = sourceCommands.get(command.temporarySource.relativePath);
      assert.ok(bytes);
      assert.equal(command.expectedContentHash, sha256(bytes));
      assert.equal(command.expectedByteLength, bytes.byteLength);
      validatedSourceCommitKeys.push(command.idempotencyKey);
      if (
        [...sourceIntentByKey.values()].some(intent =>
          sameSourceCommitIdentity(intent, command))
      ) {
        throw new SourceAssetCommitError(
          'SOURCE_ASSET_COMMIT_DUPLICATE',
          'Synthetic duplicate source asset identity.',
        );
      }
      const sourceAssetId = uuid(sourceSequence++);
      const record = {
        sourceAssetId,
        sourceType: command.sourceType,
        originalName: command.originalName,
        contentHash: command.expectedContentHash,
        relativePath: `inputs/source-assets/${sourceAssetId}/fixture.txt`,
        createdAt: CREATED_AT,
        createdBy: command.createdBy,
      };
      sourceByKey.set(command.idempotencyKey, record);
      sourceIntentByKey.set(
        command.idempotencyKey,
        toSourceCommitIntent(command),
      );
      sourceBytesById.set(sourceAssetId, bytes);
      return structuredClone(record);
    },
    async enqueueTask(command) {
      mutationCalls.push('enqueue-task');
      const taskId = `task-${++taskSequence}`;
      const task = {
        taskId,
        projectId: PROJECT_ID,
        processorId: command.processorId,
        inputFingerprint: command.inputFingerprint,
        outputScope: structuredClone(command.outputScope),
        dedupeKey: sha256(Buffer.from(taskId)),
        executionStatus: 'pending',
        recoveryStatus: 'resumable',
        attempt: 1,
        temporaryPath: `tmp/${taskId}`,
        createdAt: CREATED_AT,
        updatedAt: CREATED_AT,
      };
      tasks.set(taskId, task);
      return { reused: false, task: structuredClone(task) };
    },
    async startTask(taskId) {
      mutationCalls.push('start-task');
      const task = tasks.get(taskId);
      assert.ok(task);
      task.executionStatus = 'running';
      return structuredClone(task);
    },
    async failTask(command) {
      mutationCalls.push('fail-task');
      const task = tasks.get(command.taskId);
      assert.ok(task);
      task.executionStatus = 'failed';
      task.errorCode = command.errorCode;
      task.errorMessage = command.errorMessage;
      return structuredClone(task);
    },
    async commitArtifactRevision(command) {
      mutationCalls.push('commit-artifact');
      lastArtifactCommit = structuredClone(command);
      const bundle = pendingBundles.get(command.outputDirectory);
      assert.ok(bundle);
      const previousRevisionId = activeRevisionId;
      if (previousRevisionId && revisions.has(previousRevisionId))
        revisions.get(previousRevisionId).validityStatus = 'superseded';
      const artifact = {
        artifactId: command.artifactId,
        artifactType: command.artifactType,
        lineageId: command.lineageId,
        revisionId: command.revisionId,
        scope: structuredClone(command.scope),
        storageKind: command.storageKind,
        contentPath: `artifacts/imported/${command.revisionId}/content`,
        contentHash: sha256(Buffer.from(JSON.stringify(bundle))),
        inputFingerprint: command.inputFingerprint,
        processorId: command.processorId,
        processorVersion: command.processorVersion,
        parametersHash: sha256CanonicalJson(command.parameters),
        executionStatus: 'succeeded',
        validityStatus: 'current',
        reviewStatus: command.reviewRequired ? 'pending' : 'not_required',
        createdAt: nextTimestamp(),
        createdBy: command.createdBy,
      };
      revisions.set(artifact.revisionId, artifact);
      bundles.set(artifact.revisionId, bundle);
      dependencies.set(artifact.revisionId, command.dependencies ?? []);
      revisionOrder.push(artifact.revisionId);
      activeRevisionId = artifact.revisionId;
      if (previousRevisionId && command.changeSelector) {
        staleTransitions.push({
          previousRevisionId,
          currentRevisionId: artifact.revisionId,
          changeSelector: structuredClone(command.changeSelector),
        });
      }
      const task = tasks.get(command.taskId);
      if (task) {
        task.executionStatus = 'succeeded';
        task.resultRevisionId = artifact.revisionId;
      }
      return structuredClone(artifact);
    },
    async getArtifactRevision(revisionId) {
      const artifact = revisions.get(revisionId);
      return artifact ? structuredClone(artifact) : undefined;
    },
    async findReusableRevision(inputFingerprint, processorId, scope) {
      for (const revisionId of [...revisionOrder].reverse()) {
        const artifact = revisions.get(revisionId);
        if (
          artifact.inputFingerprint === inputFingerprint
          && artifact.processorId === processorId
          && sameScope(artifact.scope, scope)
          && artifact.validityStatus !== 'missing'
          && artifact.reviewStatus !== 'rejected'
        ) {
          const projection = {
            ...structuredClone(artifact),
            ...(reusableProjectionPatch ?? {}),
          };
          reusableProjectionPatch = undefined;
          return projection;
        }
      }
      return undefined;
    },
    async listArtifactDependencies(revisionId) {
      return structuredClone(dependencies.get(revisionId) ?? []);
    },
    async activateArtifactRevision(command) {
      mutationCalls.push('activate-artifact');
      lastActivation = structuredClone(command);
      const target = revisions.get(command.revisionId);
      assert.ok(target);
      const previousRevisionId = activeRevisionId;
      if (previousRevisionId && revisions.has(previousRevisionId))
        revisions.get(previousRevisionId).validityStatus = 'superseded';
      target.validityStatus = 'current';
      activeRevisionId = target.revisionId;
      staleTransitions.push({
        previousRevisionId,
        currentRevisionId: target.revisionId,
        changeSelector: structuredClone(command.changeSelector),
      });
      const projection = {
        ...structuredClone(target),
        ...(activationProjectionPatch ?? {}),
      };
      activationProjectionPatch = undefined;
      return projection;
    },
    async resolveStaleCause() {
      resolveStaleCauseCalls += 1;
      throw new Error('not used');
    },
  };

  const adapter = new TxtSourceAdapter();
  const service = new NovelImportApplicationService(
    projects,
    () => workflow,
    {
      async resolveSourceAsset(record, expectedByteLength) {
        const bytes = sourceBytesById.get(record.sourceAssetId);
        assert.ok(bytes);
        assert.equal(bytes.byteLength, expectedByteLength);
        return {
          sourceAssetId: record.sourceAssetId,
          sourceContentHash: record.contentHash,
          sourceByteLength: expectedByteLength,
          mediaType: 'text/plain',
          fileExtension: '.txt',
          openByteStream() {
            return [bytes];
          },
        };
      },
    },
    {
      resolveAdapter() {
        return adapter;
      },
    },
    {
      async writeBundle(command) {
        const outputDirectory
          = `${command.task.temporaryPath}/output/novel-import-bundle`;
        pendingBundles.set(outputDirectory, command.bundle);
        return { outputDirectory };
      },
    },
    {
      async validateBundle(command) {
        assert.equal(
          pendingBundles.get(command.artifact.outputDirectory),
          command.expectedBundle,
        );
      },
    },
    {
      createOpaqueId: sequentialIdFactory(options.opaqueIdStart ?? 10_000),
      reimportArtifactStoreFactory: () => ({
        async readBundle(artifact) {
          const bundle = bundles.get(artifact.revisionId);
          assert.ok(bundle);
          return bundle;
        },
        async listRevisions(artifactId) {
          return revisionOrder
            .filter(revisionId => revisions.get(revisionId).artifactId === artifactId)
            .map(revisionId => ({
              artifact: structuredClone(revisions.get(revisionId)),
              bundle: bundles.get(revisionId),
            }));
        },
      }),
    },
  );

  function registerSource(bytes, key) {
    const temporaryRelativePath = `tmp/upload/${key}.txt`;
    sourceCommands.set(temporaryRelativePath, bytes);
    return {
      temporaryRelativePath,
      contentHash: sha256(bytes),
      byteLength: bytes.byteLength,
      originalName: 'fixture.txt',
      idempotencyKey: key,
    };
  }

  function currentBaseline() {
    const artifact = revisions.get(activeRevisionId);
    const bundle = bundles.get(activeRevisionId);
    assert.ok(artifact);
    assert.ok(bundle);
    return {
      artifactId: artifact.artifactId,
      artifactRevisionId: artifact.revisionId,
      canonicalTextRevision: bundle.canonical.revision,
    };
  }

  function seedBundleRevision(bundle, remapChangedIds = false) {
    const baselineArtifact = revisions.get(activeRevisionId);
    const baselineBundle = bundles.get(activeRevisionId);
    assert.ok(baselineArtifact);
    assert.ok(baselineBundle);
    const seededBundle = structuredClone(bundle);
    if (remapChangedIds) {
      const previousBlockById = new Map(
        baselineBundle.blockIndex.blocks.map(block => [block.blockId, block]),
      );
      const remappedBlockIds = new Map();
      seededBundle.blockIndex.blocks = seededBundle.blockIndex.blocks.map(
        (block, index) => {
          const previous = previousBlockById.get(block.blockId);
          if (previous === undefined || previous.contentHash === block.contentHash)
            return block;
          const blockId = uuid(70_000 + index);
          remappedBlockIds.set(block.blockId, blockId);
          return { ...block, blockId };
        },
      );
      const remappedChapterIds = new Map(
        seededBundle.chapterIndex.entries.map((entry, index) => [
          entry.chapterId,
          uuid(80_000 + index),
        ]),
      );
      seededBundle.chapterIndex.entries = seededBundle.chapterIndex.entries.map(
        entry => ({
          ...entry,
          chapterId: remappedChapterIds.get(entry.chapterId),
        }),
      );
      seededBundle.chapterIndex.coverageReport.segments
        = seededBundle.chapterIndex.coverageReport.segments.map(segment => (
          segment.classification === 'chapter'
            ? {
                ...segment,
                chapterId: remappedChapterIds.get(segment.chapterId),
              }
            : segment
        ));
      seededBundle.dependencySelector = {
        blockIds: seededBundle.blockIndex.blocks.map(block => block.blockId),
        chapterIds: seededBundle.chapterIndex.entries.map(entry => entry.chapterId),
      };
      seededBundle.parameters = {
        ...seededBundle.parameters,
        dependencySelector: seededBundle.dependencySelector,
      };
      seededBundle.parametersHash = sha256CanonicalJson(seededBundle.parameters);
      assert.ok(remappedBlockIds.size > 0);
    }
    baselineArtifact.validityStatus = 'superseded';
    const revisionId = uuid(90_000 + revisionOrder.length);
    const artifact = {
      ...structuredClone(baselineArtifact),
      revisionId,
      inputFingerprint: seededBundle.inputFingerprint,
      parametersHash: seededBundle.parametersHash,
      contentPath: `artifacts/imported/${revisionId}/content`,
      contentHash: sha256(Buffer.from(JSON.stringify(seededBundle))),
      validityStatus: 'current',
      reviewStatus: 'not_required',
      createdAt: nextTimestamp(),
    };
    revisions.set(revisionId, artifact);
    bundles.set(revisionId, seededBundle);
    dependencies.set(revisionId, []);
    revisionOrder.push(revisionId);
    activeRevisionId = revisionId;
  }

  function seedDisplayOnlyRevision(title) {
    const current = structuredClone(bundles.get(activeRevisionId));
    current.chapterIndex.entries[0].title = title;
    const heading = current.chapterIndex.entries[0].headingRange;
    const candidate = current.chapterIndex.candidates.find(item =>
      item.headingRange.startByte === heading.startByte
      && item.headingRange.endByte === heading.endByte);
    assert.ok(candidate);
    candidate.normalizedTitle = title;
    current.chapterCandidates = current.chapterIndex.candidates;
    current.inputFingerprint = 'd'.repeat(64);
    current.parameters = {
      ...current.parameters,
      inputFingerprint: current.inputFingerprint,
    };
    current.parametersHash = sha256CanonicalJson(current.parameters);
    seedBundleRevision(current);
  }

  function nextTimestamp() {
    const value = new Date(Date.parse(CREATED_AT) + timestampSequence * 1_000);
    timestampSequence += 1;
    return value.toISOString();
  }

  const harness = {
    service,
    mutationCalls,
    staleTransitions,
    validatedSourceCommitKeys,
    get lastArtifactCommit() {
      return lastArtifactCommit;
    },
    get lastActivation() {
      return lastActivation;
    },
    get resolveStaleCauseCalls() {
      return resolveStaleCauseCalls;
    },
    async importInitial(bytes, key, sourceEncoding) {
      return service.importTxt({
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_ID,
        createdBy: 'operator:test',
        source: registerSource(bytes, key),
        ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
      });
    },
    reimportCommand(bytes, key, baseline, sourceEncoding) {
      return {
        projectId: PROJECT_ID,
        projectSessionId: PROJECT_SESSION_ID,
        createdBy: 'operator:test',
        source: registerSource(bytes, key),
        baselineRevision: baseline,
        ...(sourceEncoding === undefined ? {} : { sourceEncoding }),
      };
    },
    currentBaseline,
    currentBundle() {
      return bundles.get(activeRevisionId);
    },
    bundle(revisionId) {
      return bundles.get(revisionId);
    },
    revision(revisionId) {
      const artifact = revisions.get(revisionId);
      return artifact ? structuredClone(artifact) : undefined;
    },
    revisions() {
      return revisionOrder.map(revisionId => structuredClone(revisions.get(revisionId)));
    },
    resetMutations() {
      mutationCalls.length = 0;
      validatedSourceCommitKeys.length = 0;
    },
    patchNextActivation(patch) {
      activationProjectionPatch = structuredClone(patch);
    },
    patchNextReusable(patch) {
      reusableProjectionPatch = structuredClone(patch);
    },
    patchRevision(revisionId, patch) {
      const artifact = revisions.get(revisionId);
      assert.ok(artifact);
      Object.assign(artifact, structuredClone(patch));
    },
    seedBundleRevision,
    seedDisplayOnlyRevision,
  };
  return harness;
}

function emptyChanges() {
  return {
    content: emptyAffectedIds(),
    structure: emptyAffectedIds(),
    display: emptyAffectedIds(),
  };
}

function emptyAffectedIds() {
  return {
    previousBlockIds: [],
    currentBlockIds: [],
    previousChapterIds: [],
    currentChapterIds: [],
  };
}

function sameScope(left, right) {
  return left.kind === right.kind
    && left.identifiers.length === right.identifiers.length
    && left.identifiers.every((value, index) => value === right.identifiers[index]);
}

function toSourceCommitIntent(command) {
  return {
    expectedContentHash: command.expectedContentHash,
    expectedByteLength: command.expectedByteLength,
    originalName: command.originalName,
    sourceType: command.sourceType,
    createdBy: command.createdBy,
  };
}

function sameSourceCommitIdentity(left, right) {
  return left.expectedContentHash === right.expectedContentHash
    && left.expectedByteLength === right.expectedByteLength
    && left.originalName === right.originalName
    && left.sourceType === right.sourceType;
}

function sameSourceCommitIntent(left, right) {
  return sameSourceCommitIdentity(left, right)
    && left.createdBy === right.createdBy;
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
