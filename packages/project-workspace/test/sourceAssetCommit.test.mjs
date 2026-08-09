import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  link,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  readlink,
  rename,
  rm,
  symlink,
  unlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  NodeProjectStateStore,
  NodeProjectWorkflow,
  NodeProjectWorkspace,
  PROJECT_STATE_RELATIVE_PATH,
} from '../dist/index.js';

const PUBLISHING_DIRECTORY_RELATIVE_PATH
  = 'inputs/.source-asset-commit-staging';

test('commits raw immutable files, reserves before inputs writes, and retries exactly', async () => {
  const harness = await createHarness('source-asset-success');
  let checkedReservation = false;

  try {
    const command = await writeTemporarySource(harness, {
      content: 'A中😀\n',
      idempotencyKey: 'source-success-1',
      originalName: 'novel.txt',
    });
    harness.workflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: async (checkpoint, context) => {
        if (
          checkpoint !== 'before-inputs-write'
          || context.idempotencyKey !== command.idempotencyKey
        ) {
          return;
        }
        const mapping = await getMapping(harness, command.idempotencyKey);
        assert.equal(mapping.status, 'reserved');
        assert.equal(
          await pathExists(join(
            harness.context.projectDirectory,
            'inputs',
            'source-assets',
          )),
          false,
        );
        checkedReservation = true;
      },
    });

    const record = await harness.workflow.commitSourceAsset(command);
    assert.equal(checkedReservation, true);
    assert.equal(record.contentHash, command.expectedContentHash);
    assert.equal(record.originalName, command.originalName);
    assert.equal(record.sourceType, command.sourceType);
    assert.match(record.relativePath, /^inputs\/source-assets\//u);
    assert.deepEqual(
      await readFile(join(harness.context.projectDirectory, record.relativePath)),
      Buffer.from('A中😀\n'),
    );
    assert.equal(
      await pathExists(absoluteTemporarySource(harness, command)),
      false,
    );
    const committed = await getMapping(harness, command.idempotencyKey);
    assert.equal(committed.status, 'committed');
    assert.deepEqual(committed.sourceAsset, record);
    assert.equal(
      await pathExists(absolutePublishingTemporary(harness, committed)),
      false,
    );

    const exactRetry = await harness.workflow.commitSourceAsset({
      ...command,
      temporarySource: { relativePath: 'tmp/already-consumed.txt' },
    });
    assert.deepEqual(exactRetry, record);
    const unrelatedSameBytes = join(
      harness.context.projectDirectory,
      'tmp/unrelated-same-bytes.txt',
    );
    await writeFile(unrelatedSameBytes, 'A中😀\n');
    assert.deepEqual(
      await harness.workflow.commitSourceAsset({
        ...command,
        temporarySource: { relativePath: 'tmp/unrelated-same-bytes.txt' },
      }),
      record,
    );
    assert.equal(await pathExists(unrelatedSameBytes), true);

    const replacedBeforeCleanup = await writeTemporarySource(harness, {
      content: 'replacement must survive cleanup',
      idempotencyKey: 'source-cleanup-identity',
    });
    const replacedPath = absoluteTemporarySource(
      harness,
      replacedBeforeCleanup,
    );
    let replacementSourceIdentity;
    let replacementStageIdentity;
    let replacementStagePath;
    harness.workflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: async (checkpoint, context) => {
        if (
          checkpoint !== 'finalized'
          || context.idempotencyKey !== replacedBeforeCleanup.idempotencyKey
        ) {
          return;
        }
        await unlink(replacedPath);
        await writeFile(replacedPath, 'replacement must survive cleanup');
        const replacementSourceEntry = await lstat(replacedPath);
        replacementSourceIdentity = {
          dev: replacementSourceEntry.dev,
          ino: replacementSourceEntry.ino,
        };
        replacementStagePath = join(
          harness.context.projectDirectory,
          context.publishingTemporaryRelativePath,
        );
        await unlink(replacementStagePath);
        await writeFile(
          replacementStagePath,
          'replacement must survive cleanup',
        );
        const replacementStageEntry = await lstat(replacementStagePath);
        replacementStageIdentity = {
          dev: replacementStageEntry.dev,
          ino: replacementStageEntry.ino,
        };
      },
    });
    await harness.workflow.commitSourceAsset(replacedBeforeCleanup);
    const retainedSourceEntry = await lstat(replacedPath);
    assert.deepEqual(
      { dev: retainedSourceEntry.dev, ino: retainedSourceEntry.ino },
      replacementSourceIdentity,
    );
    const retainedStageEntry = await lstat(replacementStagePath);
    assert.deepEqual(
      { dev: retainedStageEntry.dev, ino: retainedStageEntry.ino },
      replacementStageIdentity,
    );
    assert.equal(
      await readFile(replacementStagePath, 'utf8'),
      'replacement must survive cleanup',
    );
    harness.workflow = new NodeProjectWorkflow(harness.context);

    const readerWorkspace = new NodeProjectWorkspace();
    const readerContext = await readerWorkspace.openProject({
      accessMode: 'read-only',
      projectDirectory: harness.context.projectDirectory,
    });
    try {
      await assert.rejects(
        new NodeProjectWorkflow(readerContext).commitSourceAsset(command),
        error => error?.code === 'PROJECT_STATE_READ_ONLY',
      );
    } finally {
      await readerWorkspace.closeProject(readerContext);
    }

    const sameName = await writeTemporarySource(harness, {
      content: 'different bytes',
      idempotencyKey: 'source-success-2',
      originalName: 'novel.txt',
    });
    const sameNameRecord = await harness.workflow.commitSourceAsset(sameName);
    assert.notEqual(sameNameRecord.sourceAssetId, record.sourceAssetId);
    assert.notEqual(sameNameRecord.relativePath, record.relativePath);

    for (const [index, originalName] of [
      '.source-asset-commit.tmp',
      '.SOURCE-ASSET-COMMIT.TMP',
      '.source-asset-commit-2.tmp',
      '.SOURCE-ASSET-COMMIT-2.TMP',
    ].entries()) {
      const reservedName = await writeTemporarySource(harness, {
        content: `reserved-looking filename ${index}`,
        idempotencyKey: `source-success-reserved-name-${index}`,
        originalName,
      });
      const reservedNameRecord = await harness.workflow.commitSourceAsset(
        reservedName,
      );
      assert.equal(
        basename(reservedNameRecord.relativePath),
        reservedName.originalName,
      );
      assert.equal(
        await pathExists(absolutePublishingTemporary(
          harness,
          await getMapping(harness, reservedName.idempotencyKey),
        )),
        false,
      );
    }
  } finally {
    await closeHarness(harness);
  }
});

test('rejects mismatched, missing, traversing, directory, and symbolic temporary sources before reservation', async () => {
  const harness = await createHarness('source-asset-invalid');

  try {
    const initialInputs = await readdir(
      join(harness.context.projectDirectory, 'inputs'),
    );
    const valid = await writeTemporarySource(harness, {
      content: 'validated source',
      idempotencyKey: 'invalid-hash',
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset({
        ...valid,
        expectedContentHash: 'f'.repeat(64),
      }),
      error => error?.code === 'SOURCE_ASSET_COMMIT_CONTENT_MISMATCH',
    );
    assert.equal(await getMapping(harness, valid.idempotencyKey), undefined);

    await assert.rejects(
      harness.workflow.commitSourceAsset({
        ...valid,
        expectedByteLength: valid.expectedByteLength + 1,
        idempotencyKey: 'invalid-size',
      }),
      error => error?.code === 'SOURCE_ASSET_COMMIT_CONTENT_MISMATCH',
    );
    assert.equal(await getMapping(harness, 'invalid-size'), undefined);

    const missing = sourceAssetCommand({
      content: 'missing bytes',
      idempotencyKey: 'invalid-missing',
      relativePath: 'tmp/missing.txt',
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(missing),
      error => error?.code === 'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
    );

    await mkdir(join(harness.context.projectDirectory, 'tmp/source-directory'));
    const directory = sourceAssetCommand({
      content: '',
      idempotencyKey: 'invalid-directory',
      relativePath: 'tmp/source-directory',
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(directory),
      error => error?.code === 'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
    );

    await assert.rejects(
      harness.workflow.commitSourceAsset({
        ...missing,
        idempotencyKey: 'invalid-traversal',
        temporarySource: { relativePath: 'tmp/../outside.txt' },
      }),
      error => error?.code === 'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
    );

    const outsideFile = join(harness.parentDirectory, 'outside.txt');
    await writeFile(outsideFile, 'outside source');
    await symlink(
      outsideFile,
      join(harness.context.projectDirectory, 'tmp/source-link.txt'),
    );
    const leafLink = sourceAssetCommand({
      content: 'outside source',
      idempotencyKey: 'invalid-leaf-link',
      relativePath: 'tmp/source-link.txt',
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(leafLink),
      error => error?.code === 'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
    );

    const outsideDirectory = join(harness.parentDirectory, 'outside-directory');
    await mkdir(outsideDirectory);
    await writeFile(join(outsideDirectory, 'source.txt'), 'ancestor source');
    await symlink(
      outsideDirectory,
      join(harness.context.projectDirectory, 'tmp/source-link-directory'),
    );
    const ancestorLink = sourceAssetCommand({
      content: 'ancestor source',
      idempotencyKey: 'invalid-ancestor-link',
      relativePath: 'tmp/source-link-directory/source.txt',
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(ancestorLink),
      error => error?.code === 'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
    );

    const temporaryRoot = join(harness.context.projectDirectory, 'tmp');
    const movedTemporaryRoot = join(
      harness.context.projectDirectory,
      'tmp-physical',
    );
    await rename(temporaryRoot, movedTemporaryRoot);
    await symlink(movedTemporaryRoot, temporaryRoot);
    try {
      const rootLink = sourceAssetCommand({
        content: 'root source',
        idempotencyKey: 'invalid-root-link',
        relativePath: 'tmp/root.txt',
      });
      await writeFile(join(movedTemporaryRoot, 'root.txt'), 'root source');
      await assert.rejects(
        harness.workflow.commitSourceAsset(rootLink),
        error => error?.code === 'SOURCE_ASSET_COMMIT_COMMAND_INVALID',
      );
      assert.equal(await getMapping(harness, rootLink.idempotencyKey), undefined);
    } finally {
      await unlink(temporaryRoot);
      await rename(movedTemporaryRoot, temporaryRoot);
    }

    assert.deepEqual(
      await readdir(join(harness.context.projectDirectory, 'inputs')),
      initialInputs,
    );
  } finally {
    await closeHarness(harness);
  }
});

test('maps duplicate identity and idempotency-key rebinding to stable errors', async () => {
  const harness = await createHarness('source-asset-classification');

  try {
    const first = await writeTemporarySource(harness, {
      content: 'same identity',
      idempotencyKey: 'classification-first',
      relativePath: 'tmp/first.txt',
    });
    const record = await harness.workflow.commitSourceAsset(first);

    const duplicate = await writeTemporarySource(harness, {
      content: 'same identity',
      idempotencyKey: 'classification-duplicate',
      relativePath: 'tmp/duplicate.txt',
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(duplicate),
      error => error?.code === 'SOURCE_ASSET_COMMIT_DUPLICATE',
    );
    assert.equal(
      await getMapping(harness, duplicate.idempotencyKey),
      undefined,
    );

    await assert.rejects(
      harness.workflow.commitSourceAsset({
        ...first,
        createdBy: 'another-user',
        temporarySource: { relativePath: 'tmp/not-required-for-conflict.txt' },
      }),
      error => error?.code === 'SOURCE_ASSET_COMMIT_CONFLICT',
    );
    assert.deepEqual(
      (await getMapping(harness, first.idempotencyKey)).sourceAsset,
      record,
    );
  } finally {
    await closeHarness(harness);
  }
});

test('converges concurrent exact retries on one committed record', async () => {
  const harness = await createHarness('source-asset-concurrent');

  try {
    const command = await writeTemporarySource(harness, {
      content: Buffer.alloc(512 * 1024, 0x61),
      idempotencyKey: 'concurrent-exact-retry',
    });
    const results = await Promise.allSettled([
      new NodeProjectWorkflow(harness.context).commitSourceAsset(command),
      new NodeProjectWorkflow(harness.context).commitSourceAsset(command),
    ]);
    const fulfilled = results.filter(result => result.status === 'fulfilled');
    const rejected = results.filter(result => result.status === 'rejected');
    assert.equal(fulfilled.length >= 1, true);
    for (const result of rejected) {
      assert.equal(
        result.reason?.code,
        'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
      );
    }
    const mapping = await getMapping(harness, command.idempotencyKey);
    assert.equal(mapping.status, 'committed');
    for (const result of fulfilled)
      assert.deepEqual(result.value, mapping.sourceAsset);
    assert.deepEqual(
      await new NodeProjectWorkflow(harness.context).commitSourceAsset(command),
      mapping.sourceAsset,
    );

    const stale = await writeTemporarySource(harness, {
      content: 'stale reserved caller must not downgrade committed',
      idempotencyKey: 'concurrent-stale-reserved',
    });
    let releaseStale;
    let staleReached;
    const staleReachedPromise = new Promise((resolve) => {
      staleReached = resolve;
    });
    const releaseStalePromise = new Promise((resolve) => {
      releaseStale = resolve;
    });
    const staleWorkflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: async (checkpoint) => {
        if (checkpoint !== 'publishing-temporary-ready')
          return;
        staleReached();
        await releaseStalePromise;
      },
    });
    const staleCommit = staleWorkflow.commitSourceAsset(stale);
    await staleReachedPromise;
    let winningRecord;
    try {
      winningRecord = await new NodeProjectWorkflow(
        harness.context,
      ).commitSourceAsset(stale);
    } finally {
      releaseStale();
    }
    assert.deepEqual(await staleCommit, winningRecord);
    assert.equal(
      (await getMapping(harness, stale.idempotencyKey)).status,
      'committed',
    );
    assert.deepEqual(
      await new NodeProjectWorkflow(harness.context).commitSourceAsset({
        ...stale,
        temporarySource: { relativePath: 'tmp/already-consumed-stale.txt' },
      }),
      winningRecord,
    );
  } finally {
    await closeHarness(harness);
  }
});

test('closes reservation, staging, publish, and finalized crash windows across reopen', async () => {
  const harness = await createHarness('source-asset-crashes');

  try {
    const beforeInputs = await writeTemporarySource(harness, {
      content: 'crash before inputs',
      idempotencyKey: 'crash-before-inputs',
    });
    harness.workflow = crashingWorkflow(
      harness,
      'before-inputs-write',
    );
    await assert.rejects(
      harness.workflow.commitSourceAsset(beforeInputs),
      /simulated crash: before-inputs-write/u,
    );
    assert.equal(
      (await getMapping(harness, beforeInputs.idempotencyKey)).status,
      'reserved',
    );
    harness.workflow = new NodeProjectWorkflow(harness.context);
    await harness.workflow.commitSourceAsset(beforeInputs);

    const staged = await writeTemporarySource(harness, {
      content: 'crash with complete staging',
      idempotencyKey: 'crash-staged',
    });
    harness.workflow = crashingWorkflow(
      harness,
      'publishing-temporary-ready',
    );
    await assert.rejects(
      harness.workflow.commitSourceAsset(staged),
      /simulated crash: publishing-temporary-ready/u,
    );
    const stagedMapping = await getMapping(harness, staged.idempotencyKey);
    assert.equal(stagedMapping.status, 'reserved');
    assert.deepEqual(
      await readFile(absolutePublishingTemporary(harness, stagedMapping)),
      Buffer.from('crash with complete staging'),
    );
    await reopenHarness(harness);
    const stagedRecord = await harness.workflow.commitSourceAsset(staged);
    assert.equal(stagedRecord.sourceAssetId, stagedMapping.sourceAssetId);

    const published = await writeTemporarySource(harness, {
      content: 'crash after publish',
      idempotencyKey: 'crash-published',
    });
    harness.workflow = crashingWorkflow(harness, 'published');
    await assert.rejects(
      harness.workflow.commitSourceAsset(published),
      /simulated crash: published/u,
    );
    const publishedMapping = await getMapping(
      harness,
      published.idempotencyKey,
    );
    assert.equal(publishedMapping.status, 'reserved');
    assert.deepEqual(
      await readFile(absoluteTarget(harness, publishedMapping)),
      Buffer.from('crash after publish'),
    );
    harness.workflow = new NodeProjectWorkflow(harness.context);
    await harness.workflow.commitSourceAsset(published);

    const finalized = await writeTemporarySource(harness, {
      content: 'crash after finalize',
      idempotencyKey: 'crash-finalized',
    });
    harness.workflow = crashingWorkflow(harness, 'finalized');
    await assert.rejects(
      harness.workflow.commitSourceAsset(finalized),
      /simulated crash: finalized/u,
    );
    const finalizedMapping = await getMapping(
      harness,
      finalized.idempotencyKey,
    );
    assert.equal(finalizedMapping.status, 'committed');
    await rm(absoluteTemporarySource(harness, finalized), { force: true });
    await reopenHarness(harness);
    assert.deepEqual(
      await harness.workflow.commitSourceAsset(finalized),
      finalizedMapping.sourceAsset,
    );
  } finally {
    await closeHarness(harness);
  }
});

test('persists recovery for copy interruption and partial staging without guessing', async () => {
  const harness = await createHarness('source-asset-copy-recovery');

  try {
    const changed = await writeTemporarySource(harness, {
      content: 'source before reservation',
      idempotencyKey: 'copy-source-changed',
    });
    harness.workflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: async (checkpoint) => {
        if (checkpoint === 'before-inputs-write') {
          await writeFile(
            absoluteTemporarySource(harness, changed),
            'source after reservation',
          );
        }
      },
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(changed),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    const changedMapping = await getMapping(harness, changed.idempotencyKey);
    assert.equal(changedMapping.status, 'recovery_required');
    assert.equal(
      await pathExists(absolutePublishingTemporary(harness, changedMapping)),
      false,
    );
    await writeFile(
      absoluteTemporarySource(harness, changed),
      'source before reservation',
    );
    harness.workflow = new NodeProjectWorkflow(harness.context);
    await harness.workflow.commitSourceAsset(changed);

    const oversized = await writeTemporarySource(harness, {
      content: 'small source',
      idempotencyKey: 'copy-source-oversized',
    });
    harness.workflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: async (checkpoint) => {
        if (checkpoint === 'before-inputs-write') {
          await writeFile(
            absoluteTemporarySource(harness, oversized),
            Buffer.alloc(1024 * 1024, 0x62),
          );
        }
      },
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(oversized),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    const oversizedMapping = await getMapping(
      harness,
      oversized.idempotencyKey,
    );
    assert.equal(oversizedMapping.status, 'recovery_required');
    assert.equal(
      await pathExists(absolutePublishingTemporary(harness, oversizedMapping)),
      false,
    );

    const partial = await writeTemporarySource(harness, {
      content: 'complete source bytes',
      idempotencyKey: 'copy-partial-staging',
    });
    const partialMapping = await reserveMapping(harness, partial);
    await mkdir(dirname(absoluteTarget(harness, partialMapping)), {
      recursive: true,
    });
    await writeFile(
      absolutePublishingTemporary(harness, partialMapping),
      'partial',
    );
    await assert.rejects(
      harness.workflow.commitSourceAsset(partial),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    const recovery = await getMapping(harness, partial.idempotencyKey);
    assert.equal(recovery.status, 'recovery_required');
    assert.equal(await readFile(
      absolutePublishingTemporary(harness, recovery),
      'utf8',
    ), 'partial');
    await assert.rejects(
      harness.workflow.commitSourceAsset(partial),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    assert.equal(
      (await getMapping(harness, partial.idempotencyKey)).recoveryReason,
      recovery.recoveryReason,
    );
    await unlink(absolutePublishingTemporary(harness, recovery));
    await harness.workflow.commitSourceAsset(partial);
  } finally {
    await closeHarness(harness);
  }
});

test('never overwrites a colliding target and retains proven staging for recovery', async () => {
  const harness = await createHarness('source-asset-target-collision');

  try {
    const command = await writeTemporarySource(harness, {
      content: 'intended bytes',
      idempotencyKey: 'target-collision',
    });
    let collisionPath;
    harness.workflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: async (checkpoint, context) => {
        if (checkpoint !== 'publishing-temporary-ready')
          return;
        collisionPath = join(
          harness.context.projectDirectory,
          context.targetRelativePath,
        );
        await writeFile(collisionPath, 'competing bytes', { flag: 'wx' });
      },
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(command),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    const recovery = await getMapping(harness, command.idempotencyKey);
    assert.equal(recovery.status, 'recovery_required');
    assert.equal(await readFile(collisionPath, 'utf8'), 'competing bytes');
    assert.equal(
      await readFile(
        absolutePublishingTemporary(harness, recovery),
        'utf8',
      ),
      'intended bytes',
    );

    harness.workflow = new NodeProjectWorkflow(harness.context);
    await assert.rejects(
      harness.workflow.commitSourceAsset(command),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    await unlink(collisionPath);
    const record = await harness.workflow.commitSourceAsset(command);
    assert.equal(await readFile(
      join(harness.context.projectDirectory, record.relativePath),
      'utf8',
    ), 'intended bytes');
  } finally {
    await closeHarness(harness);
  }
});

test('rejects symbolic destination roots, ancestors, and files without external writes', async (t) => {
  await t.test('inputs root replacement after reservation', async () => {
    const harness = await createHarness('source-asset-inputs-link');
    const inputsRoot = join(harness.context.projectDirectory, 'inputs');
    const movedInputsRoot = join(
      harness.context.projectDirectory,
      'inputs-physical',
    );
    const outsideDirectory = join(harness.parentDirectory, 'outside-inputs');
    try {
      const command = await writeTemporarySource(harness, {
        content: 'inputs root link',
        idempotencyKey: 'inputs-root-link',
      });
      await mkdir(outsideDirectory);
      harness.workflow = new NodeProjectWorkflow(harness.context, {
        sourceAssetCommitCheckpoint: async (checkpoint) => {
          if (checkpoint !== 'before-inputs-write')
            return;
          await rename(inputsRoot, movedInputsRoot);
          await symlink(outsideDirectory, inputsRoot);
        },
      });
      await assert.rejects(
        harness.workflow.commitSourceAsset(command),
        error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
      );
      assert.deepEqual(await readdir(outsideDirectory), []);
      assert.equal(
        (await getMapping(harness, command.idempotencyKey)).status,
        'recovery_required',
      );
    } finally {
      if (await pathExists(inputsRoot))
        await rm(inputsRoot, { force: true });
      if (await pathExists(movedInputsRoot))
        await rename(movedInputsRoot, inputsRoot);
      await closeHarness(harness);
    }
  });

  await t.test('target directory replacement before publish', async () => {
    const harness = await createHarness('source-asset-target-dir-swap');
    const outsideDirectory = join(
      harness.parentDirectory,
      'outside-target-directory',
    );
    let movedTargetDirectory;
    let targetDirectory;
    try {
      const command = await writeTemporarySource(harness, {
        content: 'target directory swap',
        idempotencyKey: 'target-directory-swap',
      });
      const mapping = await reserveMapping(harness, command);
      targetDirectory = dirname(absoluteTarget(harness, mapping));
      movedTargetDirectory = `${targetDirectory}-physical`;
      await mkdir(outsideDirectory);
      harness.workflow = new NodeProjectWorkflow(harness.context, {
        sourceAssetCommitCheckpoint: async (checkpoint) => {
          if (checkpoint !== 'publishing-temporary-ready')
            return;
          await rename(targetDirectory, movedTargetDirectory);
          await symlink(outsideDirectory, targetDirectory);
        },
      });
      await assert.rejects(
        harness.workflow.commitSourceAsset(command),
        error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
      );
      assert.deepEqual(await readdir(outsideDirectory), []);
      assert.equal(
        (await getMapping(harness, command.idempotencyKey)).status,
        'recovery_required',
      );
    } finally {
      if (targetDirectory && await pathExists(targetDirectory))
        await rm(targetDirectory, { force: true });
      if (movedTargetDirectory && await pathExists(movedTargetDirectory))
        await rename(movedTargetDirectory, targetDirectory);
      await closeHarness(harness);
    }
  });

  for (const destinationKind of [
    'source-assets-root',
    'source-asset-directory',
    'publishing-root',
    'target',
    'publishing-temporary',
  ]) {
    await t.test(destinationKind, async () => {
      const harness = await createHarness(`source-asset-${destinationKind}`);
      try {
        const content = `symbolic ${destinationKind}`;
        const command = await writeTemporarySource(harness, {
          content,
          idempotencyKey: `symbolic-${destinationKind}`,
        });
        const mapping = await reserveMapping(harness, command);
        const sourceAssetsRoot = join(
          harness.context.projectDirectory,
          'inputs/source-assets',
        );
        const assetDirectory = dirname(absoluteTarget(harness, mapping));
        const publishingRoot = join(
          harness.context.projectDirectory,
          PUBLISHING_DIRECTORY_RELATIVE_PATH,
        );
        const outsideDirectory = join(
          harness.parentDirectory,
          `outside-${destinationKind}`,
        );
        const outsideFile = join(outsideDirectory, 'outside.txt');
        await mkdir(outsideDirectory);
        await writeFile(outsideFile, content);

        if (destinationKind === 'source-assets-root') {
          await symlink(outsideDirectory, sourceAssetsRoot);
        } else if (destinationKind === 'publishing-root') {
          await symlink(outsideDirectory, publishingRoot);
        } else {
          await mkdir(sourceAssetsRoot);
          if (destinationKind === 'source-asset-directory') {
            await symlink(outsideDirectory, assetDirectory);
          } else {
            await mkdir(assetDirectory);
            if (destinationKind === 'publishing-temporary') {
              await mkdir(publishingRoot);
              await symlink(
                outsideFile,
                absolutePublishingTemporary(harness, mapping),
              );
            } else {
              await symlink(outsideFile, absoluteTarget(harness, mapping));
            }
          }
        }

        await assert.rejects(
          harness.workflow.commitSourceAsset(command),
          error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
        );
        assert.equal(await readFile(outsideFile, 'utf8'), content);
        assert.equal(
          (await getMapping(harness, command.idempotencyKey)).status,
          'recovery_required',
        );
      } finally {
        await closeHarness(harness);
      }
    });
  }

  for (const replacementKind of ['symlink', 'hardlink', 'regular-file']) {
    await t.test(`staging replacement: ${replacementKind}`, async () => {
      const harness = await createHarness(
        `source-asset-stage-${replacementKind}`,
      );
      try {
        const content = `same external staging bytes ${replacementKind}`;
        const command = await writeTemporarySource(harness, {
          content,
          idempotencyKey: `staging-replacement-${replacementKind}`,
        });
        const outsideFile = join(
          harness.parentDirectory,
          `outside-stage-${replacementKind}.txt`,
        );
        await writeFile(outsideFile, content);
        let replacementIdentity;
        let stagingPath;
        let targetPath;
        harness.workflow = new NodeProjectWorkflow(harness.context, {
          sourceAssetCommitCheckpoint: async (checkpoint, context) => {
            if (checkpoint !== 'publishing-temporary-ready')
              return;
            stagingPath = join(
              harness.context.projectDirectory,
              context.publishingTemporaryRelativePath,
            );
            targetPath = join(
              harness.context.projectDirectory,
              context.targetRelativePath,
            );
            await unlink(stagingPath);
            if (replacementKind === 'symlink') {
              await symlink(outsideFile, stagingPath);
            } else if (replacementKind === 'hardlink') {
              await link(outsideFile, stagingPath);
            } else {
              await writeFile(stagingPath, content);
            }
            const replacementEntry = await lstat(stagingPath);
            replacementIdentity = {
              dev: replacementEntry.dev,
              ino: replacementEntry.ino,
            };
          },
        });
        await assert.rejects(
          harness.workflow.commitSourceAsset(command),
          error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
        );
        assert.equal(typeof targetPath, 'string');
        assert.equal(await pathExists(targetPath), false);
        assert.equal(await readFile(outsideFile, 'utf8'), content);
        const retainedEntry = await lstat(stagingPath);
        assert.deepEqual(
          { dev: retainedEntry.dev, ino: retainedEntry.ino },
          replacementIdentity,
        );
        if (replacementKind === 'symlink') {
          assert.equal(retainedEntry.isSymbolicLink(), true);
          assert.equal(await readlink(stagingPath), outsideFile);
        } else {
          assert.equal(retainedEntry.isFile(), true);
          assert.equal(await readFile(stagingPath, 'utf8'), content);
        }
        assert.equal(
          (await getMapping(harness, command.idempotencyKey)).status,
          'recovery_required',
        );
      } finally {
        await closeHarness(harness);
      }
    });
  }
});

test('recovers finalize rollback, committed target damage, and proven recovery targets', async () => {
  const harness = await createHarness('source-asset-finalize-recovery');

  try {
    const finalizeFailure = await writeTemporarySource(harness, {
      content: 'finalize transaction bytes',
      idempotencyKey: 'finalize-failure',
    });
    let triggerInstalled = false;
    harness.workflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: (checkpoint) => {
        if (checkpoint !== 'published' || triggerInstalled)
          return;
        triggerInstalled = true;
        withDatabase(harness, (database) => {
          database.exec(`
            CREATE TRIGGER fail_source_asset_finalize
            BEFORE UPDATE OF status ON source_asset_commits
            WHEN NEW.status = 'committed'
            BEGIN
              SELECT RAISE(ABORT, 'injected finalize failure');
            END
          `);
        });
      },
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(finalizeFailure),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    const failedMapping = await getMapping(
      harness,
      finalizeFailure.idempotencyKey,
    );
    assert.equal(failedMapping.status, 'recovery_required');
    assert.equal(failedMapping.sourceAsset, undefined);
    assert.equal(
      await pathExists(absoluteTarget(harness, failedMapping)),
      true,
    );
    withDatabase(harness, database => database.exec(
      'DROP TRIGGER fail_source_asset_finalize',
    ));
    harness.workflow = new NodeProjectWorkflow(harness.context);
    await harness.workflow.commitSourceAsset(finalizeFailure);

    const unknownResult = await writeTemporarySource(harness, {
      content: 'committed but response failed',
      idempotencyKey: 'finalize-result-unknown',
    });
    harness.workflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: (checkpoint) => {
        if (checkpoint === 'finalize-result-unknown')
          throw new Error('injected committed response failure');
      },
    });
    const reconciled = await harness.workflow.commitSourceAsset(unknownResult);
    assert.equal(
      (await getMapping(harness, unknownResult.idempotencyKey)).status,
      'committed',
    );
    assert.equal(reconciled.contentHash, unknownResult.expectedContentHash);
    harness.workflow = new NodeProjectWorkflow(harness.context);

    const changedAfterFinalize = await writeTemporarySource(harness, {
      content: 'target proven before finalize',
      idempotencyKey: 'target-changed-after-finalize',
    });
    let changedAfterFinalizeTarget;
    harness.workflow = new NodeProjectWorkflow(harness.context, {
      sourceAssetCommitCheckpoint: async (checkpoint, context) => {
        if (checkpoint !== 'finalized')
          return;
        changedAfterFinalizeTarget = join(
          harness.context.projectDirectory,
          context.targetRelativePath,
        );
        await unlink(changedAfterFinalizeTarget);
        await writeFile(changedAfterFinalizeTarget, 'target changed after db');
      },
    });
    await assert.rejects(
      harness.workflow.commitSourceAsset(changedAfterFinalize),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    const changedAfterFinalizeMapping = await getMapping(
      harness,
      changedAfterFinalize.idempotencyKey,
    );
    assert.equal(changedAfterFinalizeMapping.status, 'recovery_required');
    assert.equal(
      await readFile(changedAfterFinalizeTarget, 'utf8'),
      'target changed after db',
    );
    assert.equal(
      await readFile(
        absolutePublishingTemporary(harness, changedAfterFinalizeMapping),
        'utf8',
      ),
      'target proven before finalize',
    );
    harness.workflow = new NodeProjectWorkflow(harness.context);

    const damaged = await writeTemporarySource(harness, {
      content: 'committed target bytes',
      idempotencyKey: 'committed-target-damaged',
    });
    const damagedRecord = await harness.workflow.commitSourceAsset(damaged);
    await writeFile(
      join(harness.context.projectDirectory, damagedRecord.relativePath),
      'damaged bytes',
    );
    await assert.rejects(
      harness.workflow.commitSourceAsset({
        ...damaged,
        temporarySource: { relativePath: 'tmp/no-longer-present.txt' },
      }),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
    const damagedMapping = await getMapping(harness, damaged.idempotencyKey);
    assert.equal(damagedMapping.status, 'recovery_required');
    await writeFile(
      absoluteTarget(harness, damagedMapping),
      'committed target bytes',
    );
    assert.deepEqual(
      await harness.workflow.commitSourceAsset({
        ...damaged,
        temporarySource: { relativePath: 'tmp/still-not-required.txt' },
      }),
      damagedRecord,
    );

    const provenRecovery = await writeTemporarySource(harness, {
      content: 'pre-proven recovery target',
      idempotencyKey: 'proven-recovery-target',
    });
    const provenMapping = await reserveMapping(harness, provenRecovery);
    await markRecovery(harness, provenRecovery.idempotencyKey, 'manual-proof');
    await mkdir(dirname(absoluteTarget(harness, provenMapping)), {
      recursive: true,
    });
    await writeFile(
      absoluteTarget(harness, provenMapping),
      'pre-proven recovery target',
    );
    await rm(absoluteTemporarySource(harness, provenRecovery));
    const provenRecord = await harness.workflow.commitSourceAsset(
      provenRecovery,
    );
    assert.equal(provenRecord.sourceAssetId, provenMapping.sourceAssetId);
  } finally {
    await closeHarness(harness);
  }
});

test('rejects symbolic project sessions and stale workflows before state access', async (t) => {
  await t.test('project root symlink at call start', async () => {
    const harness = await createHarness('source-asset-project-root-link');
    const projectDirectory = harness.context.projectDirectory;
    const movedProjectDirectory = `${projectDirectory}-physical`;
    const outsideDirectory = join(harness.parentDirectory, 'outside-root');
    let swapped = false;
    try {
      const command = await writeTemporarySource(harness, {
        content: 'project root link at start',
        idempotencyKey: 'project-root-link-at-start',
      });
      const inputsBefore = await readdir(join(projectDirectory, 'inputs'));
      await mkdir(outsideDirectory);
      await rename(projectDirectory, movedProjectDirectory);
      await symlink(outsideDirectory, projectDirectory);
      swapped = true;
      await assert.rejects(
        harness.workflow.commitSourceAsset(command),
        error => error?.code === 'PROJECT_STATE_CONFLICT',
      );
      assert.deepEqual(await readdir(outsideDirectory), []);
      await unlink(projectDirectory);
      await rename(movedProjectDirectory, projectDirectory);
      swapped = false;
      assert.equal(await getMapping(harness, command.idempotencyKey), undefined);
      assert.deepEqual(
        await readdir(join(projectDirectory, 'inputs')),
        inputsBefore,
      );
    } finally {
      if (swapped) {
        await rm(projectDirectory, { force: true });
        await rename(movedProjectDirectory, projectDirectory);
      }
      await closeHarness(harness);
    }
  });

  await t.test('project ancestor symlink at call start', async () => {
    const harness = await createHarness('source-asset-parent-link');
    const parentDirectory = harness.parentDirectory;
    const movedParentDirectory = `${parentDirectory}-physical`;
    let swapped = false;
    try {
      const command = await writeTemporarySource(harness, {
        content: 'project parent link at start',
        idempotencyKey: 'project-parent-link-at-start',
      });
      const inputsBefore = await readdir(
        join(harness.context.projectDirectory, 'inputs'),
      );
      await rename(parentDirectory, movedParentDirectory);
      await symlink(movedParentDirectory, parentDirectory);
      swapped = true;
      await assert.rejects(
        harness.workflow.commitSourceAsset(command),
        error => error?.code === 'PROJECT_STATE_CONFLICT',
      );
      await unlink(parentDirectory);
      await rename(movedParentDirectory, parentDirectory);
      swapped = false;
      assert.equal(await getMapping(harness, command.idempotencyKey), undefined);
      assert.deepEqual(
        await readdir(join(harness.context.projectDirectory, 'inputs')),
        inputsBefore,
      );
    } finally {
      if (swapped) {
        await rm(parentDirectory, { force: true });
        await rename(movedParentDirectory, parentDirectory);
      }
      await closeHarness(harness);
    }
  });

  for (const swapKind of ['project-root', 'project-ancestor']) {
    await t.test(`${swapKind} replacement after reservation`, async () => {
      const harness = await createHarness(`source-asset-${swapKind}-swap`);
      const originalPath = swapKind === 'project-root'
        ? harness.context.projectDirectory
        : harness.parentDirectory;
      const movedPath = `${originalPath}-physical`;
      let swapped = false;
      try {
        const command = await writeTemporarySource(harness, {
          content: `${swapKind} swap after reservation`,
          idempotencyKey: `${swapKind}-swap-after-reservation`,
        });
        const inputsBefore = await readdir(
          join(harness.context.projectDirectory, 'inputs'),
        );
        harness.workflow = new NodeProjectWorkflow(harness.context, {
          sourceAssetCommitCheckpoint: async (checkpoint) => {
            if (checkpoint !== 'before-inputs-write')
              return;
            await rename(originalPath, movedPath);
            await symlink(movedPath, originalPath);
            swapped = true;
          },
        });
        await assert.rejects(
          harness.workflow.commitSourceAsset(command),
          error => error?.code === 'PROJECT_STATE_CONFLICT',
        );
        await unlink(originalPath);
        await rename(movedPath, originalPath);
        swapped = false;
        assert.equal(
          (await getMapping(harness, command.idempotencyKey)).status,
          'reserved',
        );
        assert.deepEqual(
          await readdir(join(harness.context.projectDirectory, 'inputs')),
          inputsBefore,
        );
      } finally {
        if (swapped) {
          await rm(originalPath, { force: true });
          await rename(movedPath, originalPath);
        }
        await closeHarness(harness);
      }
    });
  }

  for (const checkpoint of [
    'before-inputs-write',
    'publishing-temporary-ready',
  ]) {
    await t.test(`project switch at ${checkpoint}`, async () => {
      const harness = await createHarness(
        `source-asset-session-switch-${checkpoint}`,
      );
      try {
        const command = await writeTemporarySource(harness, {
          content: `session switch at ${checkpoint}`,
          idempotencyKey: `session-switch-${checkpoint}`,
        });
        const oldContext = harness.context;
        const inputsBefore = await readdir(
          join(oldContext.projectDirectory, 'inputs'),
        );
        const oldWorkflow = new NodeProjectWorkflow(oldContext, {
          sourceAssetCommitCheckpoint: async (observedCheckpoint) => {
            if (observedCheckpoint !== checkpoint)
              return;
            await harness.workspace.closeProject(oldContext);
            harness.context = await harness.workspace.openProject({
              accessMode: 'read-write',
              projectDirectory: oldContext.projectDirectory,
            });
            harness.workflow = new NodeProjectWorkflow(harness.context);
          },
        });
        await assert.rejects(
          oldWorkflow.commitSourceAsset(command),
          error => error?.code === 'PROJECT_STATE_CONFLICT',
        );
        const mapping = await getMapping(harness, command.idempotencyKey);
        assert.equal(mapping.status, 'reserved');
        assert.equal(await pathExists(absoluteTarget(harness, mapping)), false);
        if (checkpoint === 'before-inputs-write') {
          assert.deepEqual(
            await readdir(join(harness.context.projectDirectory, 'inputs')),
            inputsBefore,
          );
          assert.equal(
            await pathExists(absolutePublishingTemporary(harness, mapping)),
            false,
          );
        } else {
          assert.equal(
            await readFile(
              absolutePublishingTemporary(harness, mapping),
              'utf8',
            ),
            `session switch at ${checkpoint}`,
          );
        }
        await harness.workflow.commitSourceAsset(command);
      } finally {
        await closeHarness(harness);
      }
    });
  }

  await t.test('closed workflow after a real project switch', async () => {
    const harness = await createHarness('source-asset-stale-session');
    try {
      const committedCommand = await writeTemporarySource(harness, {
        content: 'committed before project switch',
        idempotencyKey: 'committed-before-project-switch',
      });
      const committedRecord = await harness.workflow.commitSourceAsset(
        committedCommand,
      );
      const freshCommand = await writeTemporarySource(harness, {
        content: 'new command after project switch',
        idempotencyKey: 'new-after-project-switch',
      });
      const oldWorkflow = harness.workflow;
      const oldContext = harness.context;
      await harness.workspace.closeProject(oldContext);
      harness.context = await harness.workspace.openProject({
        accessMode: 'read-write',
        projectDirectory: oldContext.projectDirectory,
      });
      harness.workflow = new NodeProjectWorkflow(harness.context);
      const inputsBefore = await readdir(
        join(harness.context.projectDirectory, 'inputs'),
      );

      await assert.rejects(
        oldWorkflow.commitSourceAsset({
          ...committedCommand,
          temporarySource: { relativePath: 'tmp/not-required.txt' },
        }),
        error => error?.code === 'PROJECT_STATE_CONFLICT',
      );
      await assert.rejects(
        oldWorkflow.commitSourceAsset(freshCommand),
        error => error?.code === 'PROJECT_STATE_CONFLICT',
      );
      assert.equal(await getMapping(harness, freshCommand.idempotencyKey), undefined);
      assert.deepEqual(
        await readdir(join(harness.context.projectDirectory, 'inputs')),
        inputsBefore,
      );
      assert.deepEqual(
        await harness.workflow.commitSourceAsset(committedCommand),
        committedRecord,
      );
      await harness.workflow.commitSourceAsset(freshCommand);
    } finally {
      await closeHarness(harness);
    }
  });
});

test('isolates projects and leaves WorkflowRecoveryReport unchanged', async () => {
  const first = await createHarness('source-asset-project-a');
  const second = await createHarness('source-asset-project-b');

  try {
    const firstCommand = await writeTemporarySource(first, {
      content: 'same bytes in two projects',
      idempotencyKey: 'shared-project-key',
    });
    const secondCommand = await writeTemporarySource(second, {
      content: 'same bytes in two projects',
      idempotencyKey: 'shared-project-key',
    });
    const firstRecord = await first.workflow.commitSourceAsset(firstCommand);
    const secondRecord = await second.workflow.commitSourceAsset(secondCommand);
    assert.notEqual(firstRecord.sourceAssetId, secondRecord.sourceAssetId);

    const before = await first.workflow.recover();
    assert.deepEqual(Object.keys(before).sort(), [
      'interruptedStageRunIds',
      'interruptedTaskIds',
      'missingRevisionIds',
      'orphanArtifactPaths',
      'orphanTemporaryPaths',
      'restoredRevisionIds',
      'resumableTaskIds',
      'retryableTaskIds',
    ]);
    await unlink(join(first.context.projectDirectory, firstRecord.relativePath));
    const after = await first.workflow.recover();
    assert.deepEqual(after, before);
    assert.equal(
      (await getMapping(first, firstCommand.idempotencyKey)).status,
      'committed',
    );
    await assert.rejects(
      first.workflow.commitSourceAsset(firstCommand),
      error => error?.code === 'SOURCE_ASSET_COMMIT_RECOVERY_REQUIRED',
    );
  } finally {
    await closeHarness(first);
    await closeHarness(second);
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

async function reopenHarness(harness) {
  await harness.workspace.closeProject(harness.context);
  harness.context = await harness.workspace.openProject({
    accessMode: 'read-write',
    projectDirectory: harness.context.projectDirectory,
  });
  harness.workflow = new NodeProjectWorkflow(harness.context);
}

function crashingWorkflow(harness, crashCheckpoint) {
  return new NodeProjectWorkflow(harness.context, {
    sourceAssetCommitCheckpoint: (checkpoint) => {
      if (checkpoint === crashCheckpoint)
        throw new Error(`simulated crash: ${checkpoint}`);
    },
  });
}

async function writeTemporarySource(harness, options = {}) {
  const relativePath = options.relativePath
    ?? `tmp/source-${randomUUID()}.txt`;
  const content = options.content ?? 'source bytes';
  const path = join(harness.context.projectDirectory, relativePath);
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, content);
  return sourceAssetCommand({
    ...options,
    content,
    relativePath,
  });
}

function sourceAssetCommand(options = {}) {
  const content = Buffer.from(options.content ?? 'source bytes');
  return {
    temporarySource: {
      relativePath: options.relativePath ?? 'tmp/source.txt',
    },
    expectedContentHash: createHash('sha256').update(content).digest('hex'),
    expectedByteLength: content.byteLength,
    originalName: options.originalName ?? 'source.txt',
    sourceType: options.sourceType ?? 'text/plain',
    createdBy: options.createdBy ?? 'test-user',
    idempotencyKey: options.idempotencyKey ?? `commit-${randomUUID()}`,
  };
}

function absoluteTemporarySource(harness, command) {
  return join(
    harness.context.projectDirectory,
    command.temporarySource.relativePath,
  );
}

function absoluteTarget(harness, mapping) {
  return join(harness.context.projectDirectory, mapping.targetRelativePath);
}

function absolutePublishingTemporary(harness, mapping) {
  return join(
    harness.context.projectDirectory,
    PUBLISHING_DIRECTORY_RELATIVE_PATH,
    `${mapping.sourceAssetId}.tmp`,
  );
}

async function getMapping(harness, idempotencyKey) {
  return withStore(
    harness,
    store => store.getSourceAssetCommit(idempotencyKey),
  );
}

async function reserveMapping(harness, command) {
  const result = await withStore(
    harness,
    store => store.reserveSourceAssetCommit(command),
  );
  assert.equal(result.classification, 'new');
  return result.mapping;
}

async function markRecovery(harness, idempotencyKey, reason) {
  return withStore(
    harness,
    store => store.markSourceAssetCommitRecoveryRequired(idempotencyKey, reason),
  );
}

async function withStore(harness, operation) {
  const store = await NodeProjectStateStore.open({
    accessMode: harness.context.accessMode,
    projectDirectory: harness.context.projectDirectory,
    projectId: harness.context.manifest.projectId,
  });
  try {
    return await operation(store);
  } finally {
    store.close();
  }
}

function withDatabase(harness, operation) {
  const database = new DatabaseSync(join(
    harness.context.projectDirectory,
    PROJECT_STATE_RELATIVE_PATH,
  ));
  try {
    return operation(database);
  } finally {
    database.close();
  }
}

async function pathExists(path) {
  try {
    await lstat(path);
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT')
      return false;
    throw error;
  }
}
