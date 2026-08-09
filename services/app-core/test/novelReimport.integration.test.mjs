import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AppCoreService } from '../dist/index.js';

const REQUESTED_BY = 'operator:integration-test';
const ORIGINAL_NAME = 'synthetic-reimport.txt';
const TEXT_A = Buffer.from([
  'Chapter 1 Start',
  'Synthetic variant A.',
  'Stable first chapter tail.',
  'Chapter 2 Continue',
  'Stable second chapter body.',
  '',
].join('\n'), 'utf8');
const TEXT_B = Buffer.from([
  'Chapter 1 Start',
  'Synthetic variant B.',
  'Stable first chapter tail.',
  'Chapter 2 Continue',
  'Stable second chapter body.',
  '',
].join('\n'), 'utf8');
const TEXT_C = Buffer.from([
  'Chapter 1 Start',
  'Synthetic variant C.',
  'Stable first chapter tail.',
  'Chapter 2 Continue',
  'Stable second chapter body.',
  '',
].join('\n'), 'utf8');

test('persists exact reimport stale causes and reactivates duplicate historical source', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-reimport-core-'));
  const appCore = new AppCoreService();

  try {
    const project = await appCore.createProject({
      displayName: 'Reimport Integration',
      parentDirectory,
    });
    const initial = await importTxt(
      appCore,
      project,
      TEXT_A,
      'initial-a',
    );
    assert.equal(initial.reused, false);
    const initialBundle = await readBundle(
      project.projectDirectory,
      initial.artifact,
    );
    assert.equal(initialBundle.chapterIndex.entries.length, 2);
    const [changedChapter, unchangedChapter] = initialBundle.chapterIndex.entries;
    assert.ok(changedChapter);
    assert.ok(unchangedChapter);
    const changedConsumer = await commitChapterConsumer(
      appCore,
      project,
      initial.artifact,
      changedChapter.chapterId,
      'changed-chapter',
    );
    const unchangedConsumer = await commitChapterConsumer(
      appCore,
      project,
      initial.artifact,
      unchangedChapter.chapterId,
      'unchanged-chapter',
    );

    const changed = await reimportTxt(
      appCore,
      project,
      TEXT_B,
      'change-b',
      baselineFrom(initial.artifact, initialBundle),
    );
    assert.equal(changed.outcome, 'committed');
    assert.equal(changed.impactSelectors.length, 1);
    assert.equal(changed.impactSelectors[0].changeScope, 'content');
    assert.deepEqual(
      changed.impactSelectors[0].selector.chapterIds,
      [changedChapter.chapterId],
    );
    assert.equal(
      (await readArtifact(appCore, project, changedConsumer.revisionId))
        .validityStatus,
      'stale',
    );
    assert.equal(
      (await readArtifact(appCore, project, unchangedConsumer.revisionId))
        .validityStatus,
      'current',
    );

    const changedBundle = await readBundle(
      project.projectDirectory,
      changed.artifact,
    );
    const changedAgain = await reimportTxt(
      appCore,
      project,
      TEXT_C,
      'change-c',
      baselineFrom(changed.artifact, changedBundle),
    );
    assert.equal(changedAgain.outcome, 'committed');
    assert.equal(changedAgain.impactSelectors.length, 1);
    assert.deepEqual(
      changedAgain.impactSelectors[0].selector.chapterIds,
      [changedChapter.chapterId],
    );

    const twoCauses = await listStaleCauses(
      appCore,
      project,
      changedConsumer.revisionId,
    );
    assert.equal(twoCauses.length, 2);
    assert.deepEqual(
      new Set(twoCauses.map(cause => cause.currentProducerRevisionId)),
      new Set([
        changed.artifact.revisionId,
        changedAgain.artifact.revisionId,
      ]),
    );
    assert.ok(twoCauses.every(cause => cause.status === 'active'));
    assert.deepEqual(
      await listStaleCauses(
        appCore,
        project,
        unchangedConsumer.revisionId,
      ),
      [],
    );

    const firstCause = twoCauses.find(cause =>
      cause.currentProducerRevisionId === changed.artifact.revisionId);
    assert.ok(firstCause);
    await appCore.workflow.resolveStaleCause(sessionRequest(project, {
      staleCauseId: firstCause.staleCauseId,
    }));
    const oneActiveCause = await listStaleCauses(
      appCore,
      project,
      changedConsumer.revisionId,
    );
    assert.equal(
      oneActiveCause.filter(cause => cause.status === 'active').length,
      1,
    );
    assert.equal(
      (await readArtifact(appCore, project, changedConsumer.revisionId))
        .validityStatus,
      'stale',
    );

    const inputDirectoriesBeforeRestore = await sourceAssetDirectories(project);
    assert.equal(inputDirectoriesBeforeRestore.length, 3);
    const importRevisionDirectoriesBeforeRestore = (await readdir(join(
      project.projectDirectory,
      'artifacts',
      'imported',
    ))).toSorted();
    assert.equal(importRevisionDirectoriesBeforeRestore.length, 3);
    const changedAgainBundle = await readBundle(
      project.projectDirectory,
      changedAgain.artifact,
    );
    const restored = await reimportTxt(
      appCore,
      project,
      TEXT_A,
      'restore-a-with-new-idempotency-key',
      baselineFrom(changedAgain.artifact, changedAgainBundle),
    );
    assert.equal(restored.outcome, 'reactivated-history');
    assert.equal(restored.reused, true);
    assert.equal(restored.artifact.revisionId, initial.artifact.revisionId);
    assert.equal(
      restored.previousActiveRevisionId,
      changedAgain.artifact.revisionId,
    );
    assert.deepEqual(
      await sourceAssetDirectories(project),
      inputDirectoriesBeforeRestore,
    );
    assert.deepEqual(
      (await readdir(join(
        project.projectDirectory,
        'artifacts',
        'imported',
      ))).toSorted(),
      importRevisionDirectoriesBeforeRestore,
    );

    const resolvedCauses = await listStaleCauses(
      appCore,
      project,
      changedConsumer.revisionId,
    );
    assert.equal(resolvedCauses.length, 2);
    assert.ok(resolvedCauses.every(cause => cause.status === 'resolved'));
    assert.equal(
      (await readArtifact(appCore, project, changedConsumer.revisionId))
        .validityStatus,
      'current',
    );
    assert.equal(
      (await readArtifact(appCore, project, unchangedConsumer.revisionId))
        .validityStatus,
      'current',
    );

    for (const artifact of [
      initial.artifact,
      changed.artifact,
      changedAgain.artifact,
    ]) {
      assert.ok(await readArtifact(appCore, project, artifact.revisionId));
      assert.equal(
        (await readBundle(project.projectDirectory, artifact)).schemaVersion,
        1,
      );
    }

    await appCore.closeProject();
    const reopened = await appCore.openProject({
      projectDirectory: project.projectDirectory,
    });
    const reopenedCurrent = await readArtifact(
      appCore,
      reopened,
      initial.artifact.revisionId,
    );
    assert.equal(reopenedCurrent.validityStatus, 'current');
    assert.equal(
      (await readArtifact(appCore, reopened, changed.artifact.revisionId))
        .validityStatus,
      'superseded',
    );
    assert.equal(
      (await readArtifact(appCore, reopened, changedAgain.artifact.revisionId))
        .validityStatus,
      'superseded',
    );
    assert.deepEqual(
      await listStaleCauses(
        appCore,
        reopened,
        changedConsumer.revisionId,
      ),
      resolvedCauses,
    );
    assert.equal(
      (await readArtifact(appCore, reopened, changedConsumer.revisionId))
        .validityStatus,
      'current',
    );

    const snapshot = await appCore.novelImportReview.inspect(sessionRequest(
      reopened,
      {
        query: {
          documentType: 'novel-import-review-query',
          schemaVersion: 1,
          readOnly: true,
          baselineRevision: baselineFrom(initial.artifact, initialBundle),
        },
      },
    ));
    assert.equal(snapshot.revisionHistory.length, 3);
    assert.deepEqual(
      new Set(snapshot.revisionHistory.map(item => item.artifactRevisionId)),
      new Set([
        initial.artifact.revisionId,
        changed.artifact.revisionId,
        changedAgain.artifact.revisionId,
      ]),
    );
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

async function importTxt(appCore, project, bytes, idempotencyKey) {
  return appCore.novelImport.importTxt(await stageTxt(
    project,
    bytes,
    idempotencyKey,
  ));
}

async function reimportTxt(
  appCore,
  project,
  bytes,
  idempotencyKey,
  baselineRevision,
) {
  return appCore.novelImport.reimportTxt({
    ...await stageTxt(project, bytes, idempotencyKey),
    baselineRevision,
  });
}

async function stageTxt(project, bytes, idempotencyKey) {
  const temporaryRelativePath = `tmp/reimport-${idempotencyKey}.txt`;
  await writeFile(
    join(project.projectDirectory, temporaryRelativePath),
    bytes,
    { flag: 'wx' },
  );
  return {
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
    createdBy: REQUESTED_BY,
    source: {
      temporaryRelativePath,
      contentHash: sha256(bytes),
      byteLength: bytes.byteLength,
      originalName: ORIGINAL_NAME,
      idempotencyKey,
    },
  };
}

async function commitChapterConsumer(
  appCore,
  project,
  producer,
  chapterId,
  label,
) {
  const artifactId = randomUUID();
  const revisionId = randomUUID();
  const outputDirectory = `tmp/reimport-consumer-${revisionId}`;
  await mkdir(join(project.projectDirectory, outputDirectory));
  await writeFile(
    join(project.projectDirectory, outputDirectory, 'consumer.txt'),
    `Synthetic downstream ${label}.\n`,
    { flag: 'wx' },
  );
  return appCore.workflow.commitArtifactRevision(sessionRequest(project, {
    artifactId,
    artifactType: 'novel-reimport-consumer.v1',
    createdBy: REQUESTED_BY,
    dependencies: [{
      dependencyType: 'content',
      producerArtifactId: producer.artifactId,
      producerRevisionId: producer.revisionId,
      selector: { chapterIds: [chapterId] },
    }],
    inputFingerprint: sha256(Buffer.from(`consumer:${label}`, 'utf8')),
    outputDirectory,
    parameters: { schemaVersion: 1, label },
    processorId: 'voxweaver.test.novel-reimport-consumer',
    processorVersion: '1.0.0',
    revisionId,
    scope: { kind: 'chapter', identifiers: [chapterId] },
    storageKind: 'structure',
  }));
}

function baselineFrom(artifact, bundle) {
  return {
    artifactId: artifact.artifactId,
    artifactRevisionId: artifact.revisionId,
    canonicalTextRevision: bundle.canonical.revision,
  };
}

async function readArtifact(appCore, project, revisionId) {
  const artifact = await appCore.workflow.getArtifactRevision(sessionRequest(
    project,
    { revisionId },
  ));
  assert.ok(artifact);
  return artifact;
}

function listStaleCauses(appCore, project, revisionId) {
  return appCore.workflow.listStaleCauses(sessionRequest(project, {
    revisionId,
  }));
}

function sessionRequest(project, value) {
  return {
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
    ...value,
  };
}

async function sourceAssetDirectories(project) {
  return (await readdir(join(
    project.projectDirectory,
    'inputs',
    'source-assets',
  ))).toSorted();
}

async function readBundle(projectDirectory, artifact) {
  return JSON.parse(await readFile(
    join(projectDirectory, artifact.contentPath, 'bundle.json'),
    'utf8',
  ));
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

async function closeIgnoringErrors(appCore) {
  try {
    await appCore.closeProject();
  } catch {
    // Test cleanup must not hide the assertion that failed.
  }
}
