import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash, randomUUID } from 'node:crypto';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rm,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { AppCoreService } from '../dist/index.js';

const SYNTHETIC_ASCII_TXT = [
  'Preface marker.',
  '',
  'Chapter 1 Start',
  '',
  '[ADVERTISEMENT] synthetic test marker',
  '',
  'Alpha body for the first chapter.',
  '',
  'Chapter 2 Continue',
  '',
  'Beta body for the second chapter.',
  '',
].join('\n');
const SYNTHETIC_NO_CHAPTER_TXT = [
  'Plain synthetic text without a chapter heading.',
  '',
  'A second paragraph keeps the block rerun path observable.',
  '',
].join('\n');
const REQUESTED_BY = 'operator:integration-test';

test('persists review metadata and commits precise revision impact across reopen', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-review-core-'));
  const appCore = new AppCoreService();

  try {
    const project = await appCore.createProject({
      displayName: 'Review Persistence',
      parentDirectory,
    });
    const imported = await importSyntheticTxt(appCore, project, 'review.txt');
    const bundle = await readBundle(project.projectDirectory, imported.artifact);
    const baseline = baselineFrom(imported.artifact, bundle);
    const query = reviewQuery(baseline);
    const initial = await appCore.novelImportReview.inspect(sessionRequest(
      project,
      { query },
    ));
    const proposal = initial.normalizationProposals.find(item =>
      item.beforeText.includes('[ADVERTISEMENT]'));
    assert.ok(proposal);
    assert.equal(initial.readOnly, false);
    assert.equal(initial.revisionHistory.length, 1);

    const rejected = await appCore.novelImportReview.execute(sessionRequest(
      project,
      {
        command: normalizationCommand(
          baseline,
          proposal.proposalId,
          'rejected',
          'synthetic metadata-only decision',
        ),
      },
    ));
    assert.equal(rejected.outcome, 'unchanged');
    assert.equal(
      rejected.snapshot.normalizationProposals.find(item =>
        item.proposalId === proposal.proposalId)?.reviewStatus,
      'rejected',
    );
    const metadataDirectory = join(
      project.projectDirectory,
      'logs',
      'novel-import-review',
      imported.artifact.artifactId,
      imported.artifact.revisionId,
    );
    assert.deepEqual(await readdir(metadataDirectory), ['000000000001.json']);
    assert.equal(
      (await readFile(join(metadataDirectory, '000000000001.json'), 'utf8'))
        .includes(project.projectDirectory),
      false,
    );

    await appCore.closeProject();
    const reopened = await appCore.openProject({
      projectDirectory: project.projectDirectory,
    });
    const persisted = await appCore.novelImportReview.inspect(sessionRequest(
      reopened,
      { query },
    ));
    assert.equal(
      persisted.normalizationProposals.find(item =>
        item.proposalId === proposal.proposalId)?.reviewStatus,
      'rejected',
    );

    const firstChapterId = persisted.chapters[0].chapterId;
    const consumer = await commitConsumer(
      appCore,
      reopened,
      imported.artifact,
      firstChapterId,
    );
    const impactBefore = await appCore.novelImportReview.previewStaleImpact(
      sessionRequest(reopened, {
        query: stalePreviewQuery(baseline, firstChapterId),
      }),
    );
    assert.equal(impactBefore.baselineStatus, 'current');
    assert.equal(impactBefore.canApply, true);
    assert.ok(impactBefore.impacts.some(item =>
      item.consumerArtifactId === consumer.artifactId));

    const approved = await appCore.novelImportReview.execute(sessionRequest(
      reopened,
      {
        command: normalizationCommand(
          baseline,
          proposal.proposalId,
          'approved',
        ),
      },
    ));
    assert.equal(approved.outcome, 'committed');
    assert.notEqual(approved.artifact.revisionId, imported.artifact.revisionId);
    assert.equal(approved.snapshot.revisionHistory.length, 2);
    assert.equal(
      approved.snapshot.normalizationProposals.find(item =>
        item.proposalId === proposal.proposalId)?.reviewStatus,
      'approved',
    );
    const staleConsumer = await appCore.workflow.getArtifactRevision({
      projectId: reopened.manifest.projectId,
      projectSessionId: reopened.projectSessionId,
      revisionId: consumer.revisionId,
    });
    assert.equal(staleConsumer?.validityStatus, 'stale');

    const impactAfter = await appCore.novelImportReview.previewStaleImpact(
      sessionRequest(reopened, {
        query: stalePreviewQuery(baseline, firstChapterId),
      }),
    );
    assert.equal(impactAfter.currentArtifactRevisionId, approved.artifact.revisionId);
    assert.equal(impactAfter.baselineStatus, 'stale');
    assert.equal(impactAfter.canApply, false);
    await assert.rejects(
      appCore.novelImportReview.execute(sessionRequest(reopened, {
        command: normalizationCommand(
          baseline,
          proposal.proposalId,
          'rejected',
        ),
      })),
      error => error?.code === 'NOVEL_IMPORT_REVIEW_REQUIRED'
        && error?.detailReason === 'baseline_revision_stale',
    );
    assert.deepEqual(await readdir(metadataDirectory), ['000000000001.json']);

    const activeBaseline = approved.snapshot.baselineRevision;
    const rerun = await appCore.novelImportReview.execute(sessionRequest(
      reopened,
      {
        command: {
          documentType: 'novel-import-review-command',
          schemaVersion: 1,
          commandType: 'rerun-selection',
          baselineRevision: activeBaseline,
          requestedBy: REQUESTED_BY,
          selector: { chapterIds: [firstChapterId] },
        },
      },
    ));
    assert.equal(rerun.outcome, 'unchanged');

    await appCore.closeProject();
    const reopenedAgain = await appCore.openProject({
      projectDirectory: project.projectDirectory,
    });
    const finalSnapshot = await appCore.novelImportReview.inspect(sessionRequest(
      reopenedAgain,
      { query: reviewQuery(activeBaseline) },
    ));
    assert.equal(finalSnapshot.revisionHistory.length, 2);
    assert.equal(
      finalSnapshot.baselineRevision.artifactRevisionId,
      approved.artifact.revisionId,
    );
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('enforces read-only access and rejects a switched project session', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-review-core-'));
  const appCore = new AppCoreService();

  try {
    const first = await appCore.createProject({
      displayName: 'Review Session First',
      parentDirectory,
    });
    const imported = await importSyntheticTxt(appCore, first, 'first.txt');
    const bundle = await readBundle(first.projectDirectory, imported.artifact);
    const baseline = baselineFrom(imported.artifact, bundle);
    await appCore.closeProject();
    const second = await appCore.createProject({
      displayName: 'Review Session Second',
      parentDirectory,
    });
    await appCore.closeProject();

    const readOnly = await appCore.openProject({
      accessMode: 'read-only',
      projectDirectory: first.projectDirectory,
    });
    const snapshot = await appCore.novelImportReview.inspect(sessionRequest(
      readOnly,
      { query: reviewQuery(baseline) },
    ));
    assert.equal(snapshot.readOnly, true);
    const proposal = snapshot.normalizationProposals[0];
    assert.ok(proposal);
    await assert.rejects(
      appCore.novelImportReview.execute(sessionRequest(readOnly, {
        command: normalizationCommand(
          baseline,
          proposal.proposalId,
          'rejected',
        ),
      })),
      error => error?.code === 'PROJECT_READ_ONLY',
    );

    await appCore.closeProject();
    const activeFirst = await appCore.openProject({
      projectDirectory: first.projectDirectory,
    });
    const staleRequest = sessionRequest(activeFirst, {
      query: reviewQuery(baseline),
    });
    await appCore.switchProject({ projectDirectory: second.projectDirectory });
    await assert.rejects(
      appCore.novelImportReview.inspect(staleRequest),
      error => error?.code === 'NOVEL_IMPORT_STALE_SESSION'
        && error?.detailReason === 'project_session_stale',
    );
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('does not follow a review metadata directory symlink', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-review-core-'));
  const appCore = new AppCoreService();

  try {
    const project = await appCore.createProject({
      displayName: 'Review Symlink Guard',
      parentDirectory,
    });
    const imported = await importSyntheticTxt(appCore, project, 'symlink.txt');
    const bundle = await readBundle(project.projectDirectory, imported.artifact);
    const baseline = baselineFrom(imported.artifact, bundle);
    const snapshot = await appCore.novelImportReview.inspect(sessionRequest(
      project,
      { query: reviewQuery(baseline) },
    ));
    const proposal = snapshot.normalizationProposals[0];
    assert.ok(proposal);

    const outsideDirectory = join(parentDirectory, 'outside-review-log');
    await mkdir(outsideDirectory);
    await symlink(
      outsideDirectory,
      join(project.projectDirectory, 'logs', 'novel-import-review'),
      'dir',
    );
    await assert.rejects(
      appCore.novelImportReview.execute(sessionRequest(project, {
        command: normalizationCommand(
          baseline,
          proposal.proposalId,
          'rejected',
        ),
      })),
    );
    assert.deepEqual(await readdir(outsideDirectory), []);
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('keeps a zero-chapter block-only rerun unchanged', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-review-core-'));
  const appCore = new AppCoreService();

  try {
    const project = await appCore.createProject({
      displayName: 'Review Zero Chapter',
      parentDirectory,
    });
    const imported = await importSyntheticTxt(
      appCore,
      project,
      'zero-chapter.txt',
      SYNTHETIC_NO_CHAPTER_TXT,
    );
    const bundle = await readBundle(project.projectDirectory, imported.artifact);
    assert.equal(bundle.chapterIndex.entries.length, 0);
    assert.equal(bundle.dependencySelector.chapterIds, undefined);
    const blockId = bundle.blockIndex.blocks[0].blockId;
    assert.ok(blockId);

    const rerun = await appCore.novelImportReview.execute(sessionRequest(
      project,
      {
        command: {
          documentType: 'novel-import-review-command',
          schemaVersion: 1,
          commandType: 'rerun-selection',
          baselineRevision: baselineFrom(imported.artifact, bundle),
          requestedBy: REQUESTED_BY,
          selector: { blockIds: [blockId] },
        },
      },
    ));
    assert.equal(rerun.outcome, 'unchanged');
    assert.equal(rerun.artifact.revisionId, imported.artifact.revisionId);
    assert.equal(rerun.snapshot.revisionHistory.length, 1);
    assert.equal(
      (await readdir(join(project.projectDirectory, 'artifacts', 'imported')))
        .length,
      1,
    );
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

async function importSyntheticTxt(
  appCore,
  project,
  originalName,
  content = SYNTHETIC_ASCII_TXT,
) {
  const bytes = Buffer.from(content, 'utf8');
  const temporaryRelativePath = `tmp/${originalName}`;
  await writeFile(
    join(project.projectDirectory, temporaryRelativePath),
    bytes,
    { flag: 'wx' },
  );
  return appCore.novelImport.importTxt({
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
    createdBy: REQUESTED_BY,
    source: {
      temporaryRelativePath,
      contentHash: sha256(bytes),
      byteLength: bytes.byteLength,
      originalName,
      idempotencyKey: `review:${originalName}:${sha256(bytes)}`,
    },
  });
}

async function commitConsumer(appCore, project, producer, chapterId) {
  const revisionId = randomUUID();
  const relativeOutput = `tmp/review-consumer-${revisionId}`;
  await mkdir(join(project.projectDirectory, relativeOutput));
  await writeFile(
    join(project.projectDirectory, relativeOutput, 'consumer.txt'),
    'synthetic downstream consumer\n',
    { flag: 'wx' },
  );
  return appCore.workflow.commitArtifactRevision({
    artifactId: randomUUID(),
    artifactType: 'review-consumer.v1',
    createdBy: REQUESTED_BY,
    dependencies: [{
      dependencyType: 'content',
      producerArtifactId: producer.artifactId,
      producerRevisionId: producer.revisionId,
      selector: { chapterIds: [chapterId] },
    }],
    inputFingerprint: sha256(Buffer.from('synthetic consumer input')),
    outputDirectory: relativeOutput,
    parameters: { schemaVersion: 1 },
    processorId: 'voxweaver.test.review-consumer',
    processorVersion: '1.0.0',
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
    revisionId,
    scope: { kind: 'chapter', identifiers: [chapterId] },
    storageKind: 'structure',
  });
}

function baselineFrom(artifact, bundle) {
  return {
    artifactId: artifact.artifactId,
    artifactRevisionId: artifact.revisionId,
    canonicalTextRevision: bundle.canonical.revision,
  };
}

function reviewQuery(baselineRevision) {
  return {
    documentType: 'novel-import-review-query',
    schemaVersion: 1,
    readOnly: true,
    baselineRevision,
  };
}

function stalePreviewQuery(baselineRevision, chapterId) {
  return {
    documentType: 'novel-import-stale-preview-query',
    schemaVersion: 1,
    readOnly: true,
    baselineRevision,
    changeKind: 'normalization-decision',
    changeSelector: { chapterIds: [chapterId] },
  };
}

function normalizationCommand(
  baselineRevision,
  proposalId,
  decision,
  note,
) {
  return {
    documentType: 'novel-import-review-command',
    schemaVersion: 1,
    commandType: 'decide-normalization-proposal',
    baselineRevision,
    requestedBy: REQUESTED_BY,
    proposalId,
    decision,
    ...(note === undefined ? {} : { note }),
  };
}

function sessionRequest(project, value) {
  return {
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
    ...value,
  };
}

async function readBundle(projectDirectory, artifact) {
  return JSON.parse(await readFile(
    join(projectDirectory, artifact.contentPath, 'bundle.json'),
    'utf8',
  ));
}

function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

async function closeIgnoringErrors(appCore) {
  try {
    await appCore.closeProject();
  } catch {
    // Test cleanup must not hide the assertion that failed.
  }
}
