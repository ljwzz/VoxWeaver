import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { createHash } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NodeProjectWorkspace } from '@voxweaver/project-workspace';

import { AppCoreService } from '../dist/index.js';

const PROJECT_IDS = [
  '9451cf18-18c8-4ddd-98b2-28ab65fb85b5',
  'f413f2f8-8da9-4a05-9a7d-68ce1c24456d',
];
const PROJECT_SESSION_IDS = [
  '348d6518-f31d-405a-bf8f-12e7c1b893c7',
  '6a4ab824-dcab-4682-aea3-9c8958642c1a',
  'ae181966-0313-465c-b378-fea05512de3f',
  '1e478bf5-49cc-4c26-8ab0-0a2d9eb3ebaa',
];
const SYNTHETIC_TXT = [
  '第一章 起点',
  '',
  '这是用于 App Core 集成测试的合成正文。',
  '',
  '第二章 延续',
  '',
  '第二段合成正文保持来源与章节边界可验证。',
  '',
].join('\n');

test('imports a synthetic TXT immediately after project creation', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-import-core-'));
  const appCore = createAppCore();

  try {
    const project = await appCore.createProject({
      displayName: 'Created Import',
      parentDirectory,
    });
    const command = await stageTxt(project, 'created-import.txt', SYNTHETIC_TXT);

    const result = await appCore.novelImport.importTxt(command);

    assert.equal(result.reused, false);
    assert.equal(result.artifact.artifactType, 'novel-import-bundle.v1');
    assert.equal(result.artifact.storageKind, 'imported');
    assert.equal(result.artifact.scope.kind, 'novel-import');
    const task = await appCore.workflow.getTask({
      projectId: project.manifest.projectId,
      projectSessionId: project.projectSessionId,
      taskId: result.taskId,
    });
    assert.equal(task?.executionStatus, 'succeeded');
    assert.equal(task?.resultRevisionId, result.artifact.revisionId);

    const bundle = await readBundle(project.projectDirectory, result.artifact);
    assert.equal(bundle.documentType, 'novel-import-bundle');
    assert.equal(bundle.schemaVersion, 1);
    assert.equal(bundle.sourceAsset.contentHash, command.source.contentHash);
    assert.equal(bundle.selectedEncoding.sourceEncoding, 'utf-8');
    assert.equal(bundle.chapterIndex.entries.length, 2);
    assert.equal(bundle.canonical.text.includes('第一章 起点'), true);
    assert.equal(
      await readFile(
        join(project.projectDirectory, bundle.sourceAsset.relativePath),
        'utf8',
      ),
      SYNTHETIC_TXT,
    );
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('queries the committed import task and artifact after reopening', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-import-core-'));
  const appCore = createAppCore();

  try {
    const created = await appCore.createProject({
      displayName: 'Reopen Import',
      parentDirectory,
    });
    const command = await stageTxt(created, 'reopen-import.txt', SYNTHETIC_TXT);
    const imported = await appCore.novelImport.importTxt(command);
    assert.equal(imported.reused, false);

    await appCore.closeProject();
    const reopened = await appCore.openProject({
      projectDirectory: created.projectDirectory,
    });
    const artifact = await appCore.workflow.getArtifactRevision({
      projectId: reopened.manifest.projectId,
      projectSessionId: reopened.projectSessionId,
      revisionId: imported.artifact.revisionId,
    });
    const task = await appCore.workflow.getTask({
      projectId: reopened.manifest.projectId,
      projectSessionId: reopened.projectSessionId,
      taskId: imported.taskId,
    });

    assert.deepEqual(artifact, imported.artifact);
    assert.equal(task?.executionStatus, 'succeeded');
    assert.equal(task?.resultRevisionId, imported.artifact.revisionId);
    const bundle = await readBundle(reopened.projectDirectory, artifact);
    assert.equal(bundle.inputFingerprint, imported.inputFingerprint);
    assert.equal(bundle.sourceAsset.sourceAssetId, artifact.scope.identifiers[0]);
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('persists a failed task without a formal artifact for invalid TXT', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-import-core-'));
  const appCore = createAppCore();

  try {
    const project = await appCore.createProject({
      displayName: 'Failed Import',
      parentDirectory,
    });
    const command = await stageTxt(
      project,
      'empty-import.txt',
      Buffer.alloc(0),
    );

    await assert.rejects(
      appCore.novelImport.importTxt(command),
      error => (
        error?.code === 'NOVEL_IMPORT_INVALID_SOURCE'
        && error?.detailReason === 'empty_source'
      ),
    );

    assert.deepEqual(
      await readdir(join(project.projectDirectory, 'artifacts', 'imported')),
      [],
    );
    const taskId = await readOnlyTaskId(project.projectDirectory);
    const task = await appCore.workflow.getTask({
      projectId: project.manifest.projectId,
      projectSessionId: project.projectSessionId,
      taskId,
    });
    assert.equal(task?.executionStatus, 'failed');
    assert.equal(task?.errorCode, 'NOVEL_IMPORT_INVALID_SOURCE');
    assert.equal(task?.resultRevisionId, undefined);
    assert.deepEqual(
      await readdir(join(project.projectDirectory, 'tmp', taskId, 'output')),
      [],
    );
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects TXT import from a read-only project session', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-import-core-'));
  const appCore = createAppCore();

  try {
    const created = await appCore.createProject({
      displayName: 'Read Only Import',
      parentDirectory,
    });
    await appCore.closeProject();
    const readOnly = await appCore.openProject({
      accessMode: 'read-only',
      projectDirectory: created.projectDirectory,
    });
    const command = importCommand(
      readOnly,
      'tmp/read-only-import.txt',
      'read-only-import.txt',
      Buffer.from(SYNTHETIC_TXT),
    );

    await assert.rejects(
      appCore.novelImport.importTxt(command),
      error => error?.code === 'PROJECT_READ_ONLY',
    );
    assert.deepEqual(
      await readdir(join(readOnly.projectDirectory, 'artifacts', 'imported')),
      [],
    );
    assert.deepEqual(await readdir(join(readOnly.projectDirectory, 'tmp')), []);
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects the old project session after switching projects', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-import-core-'));
  const appCore = createAppCore();

  try {
    const first = await appCore.createProject({
      displayName: 'First Import Project',
      parentDirectory,
    });
    await appCore.closeProject();
    const second = await appCore.createProject({
      displayName: 'Second Import Project',
      parentDirectory,
    });
    await appCore.closeProject();

    const activeFirst = await appCore.openProject({
      projectDirectory: first.projectDirectory,
    });
    const staleCommand = importCommand(
      activeFirst,
      'tmp/stale-import.txt',
      'stale-import.txt',
      Buffer.from(SYNTHETIC_TXT),
    );
    const activeSecond = await appCore.switchProject({
      projectDirectory: second.projectDirectory,
    });

    await assert.rejects(
      appCore.novelImport.importTxt(staleCommand),
      error => (
        error?.code === 'NOVEL_IMPORT_STALE_SESSION'
        && error?.detailReason === 'project_session_stale'
      ),
    );
    assert.equal(appCore.getActiveProject(), activeSecond);
    assert.deepEqual(await readdir(join(first.projectDirectory, 'tmp')), []);
    assert.deepEqual(await readdir(join(second.projectDirectory, 'tmp')), []);
  } finally {
    await closeIgnoringErrors(appCore);
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

function createAppCore() {
  let projectIndex = 0;
  let sessionIndex = 0;
  return new AppCoreService({
    projectWorkspace: new NodeProjectWorkspace({
      generateProjectId: () => PROJECT_IDS[projectIndex++],
      generateProjectSessionId: () => PROJECT_SESSION_IDS[sessionIndex++],
      now: () => new Date('2026-08-09T00:00:00.000Z'),
    }),
  });
}

async function stageTxt(project, originalName, content) {
  const bytes = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  const temporaryRelativePath = `tmp/${originalName}`;
  await writeFile(join(project.projectDirectory, temporaryRelativePath), bytes, {
    flag: 'wx',
  });
  return importCommand(
    project,
    temporaryRelativePath,
    originalName,
    bytes,
  );
}

function importCommand(project, temporaryRelativePath, originalName, bytes) {
  const contentHash = createHash('sha256').update(bytes).digest('hex');
  return {
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
    createdBy: 'operator:integration-test',
    source: {
      temporaryRelativePath,
      contentHash,
      byteLength: bytes.byteLength,
      originalName,
      idempotencyKey: `novel-import:${originalName}:${contentHash}`,
    },
  };
}

async function readBundle(projectDirectory, artifact) {
  return JSON.parse(
    await readFile(
      join(projectDirectory, artifact.contentPath, 'bundle.json'),
      'utf8',
    ),
  );
}

async function readOnlyTaskId(projectDirectory) {
  const entries = await readdir(join(projectDirectory, 'tmp'), {
    withFileTypes: true,
  });
  const taskDirectories = entries.filter(entry => entry.isDirectory());
  assert.equal(taskDirectories.length, 1);
  const input = JSON.parse(
    await readFile(
      join(
        projectDirectory,
        'tmp',
        taskDirectories[0].name,
        'task-input.json',
      ),
      'utf8',
    ),
  );
  return input.taskId;
}

async function closeIgnoringErrors(appCore) {
  try {
    await appCore.closeProject();
  } catch {
    // Test cleanup must not hide the assertion that failed.
  }
}
