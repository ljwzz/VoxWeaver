import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import {
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  rename,
  rm,
  stat,
  symlink,
  writeFile,
} from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import test from 'node:test';

import {
  NodeProjectWorkspace,
  PROJECT_LAYOUT_DIRECTORIES,
  ProjectWorkspaceError,
} from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';
const OTHER_PROJECT_ID = '973d5d51-4cbb-40c8-a67b-a18dd718c765';
const CREATED_AT = '2026-08-08T00:00:00.000Z';
const PROJECT_WRITE_LOCK_PATH = 'state/locks/project-write.lock';
const SESSION_ID_A = '11111111-1111-4111-8111-111111111111';
const SESSION_ID_B = '22222222-2222-4222-8222-222222222222';
const SESSION_ID_C = '33333333-3333-4333-8333-333333333333';
const SESSION_ID_D = '44444444-4444-4444-8444-444444444444';

function createWorkspace(options = {}) {
  const sessionIds = [SESSION_ID_A, SESSION_ID_B, SESSION_ID_C, SESSION_ID_D];
  let sessionIndex = 0;

  return new NodeProjectWorkspace({
    generateProjectId: () => PROJECT_ID,
    generateProjectSessionId: () => sessionIds[sessionIndex++],
    hostname: 'host-a',
    isProcessAlive: () => true,
    now: () => new Date(CREATED_AT),
    processId: 101,
    ...options,
  });
}

async function readProjectWriteLock(projectDirectory) {
  return JSON.parse(
    await readFile(join(projectDirectory, PROJECT_WRITE_LOCK_PATH), 'utf8'),
  );
}

test('creates a locked project, releases it, and reopens it from disk', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: '示例 Project',
      parentDirectory,
    });
    assert.equal(created.accessMode, 'read-write');
    assert.equal(created.projectSessionId, SESSION_ID_A);
    assert.equal(created.manifest.createdAt, CREATED_AT);
    assert.equal(created.manifest.updatedAt, CREATED_AT);

    const manifest = JSON.parse(
      await readFile(join(created.projectDirectory, 'project.json'), 'utf8'),
    );
    assert.deepEqual(manifest, created.manifest);

    for (const relativePath of PROJECT_LAYOUT_DIRECTORIES) {
      const children = await readdir(join(created.projectDirectory, relativePath));
      assert.deepEqual(
        children,
        relativePath === 'state/locks' ? ['project-write.lock'] : [],
      );
    }

    const lockPath = join(created.projectDirectory, PROJECT_WRITE_LOCK_PATH);
    const lock = JSON.parse(await readFile(lockPath, 'utf8'));
    assert.deepEqual(lock, {
      schemaVersion: 1,
      projectId: PROJECT_ID,
      projectSessionId: SESSION_ID_A,
      processId: 101,
      hostname: 'host-a',
      acquiredAt: CREATED_AT,
    });
    if (process.platform !== 'win32')
      assert.equal((await stat(lockPath)).mode & 0o777, 0o600);
    if (process.platform !== 'win32') {
      assert.equal(
        (await stat(join(created.projectDirectory, 'state/project.sqlite')))
          .mode & 0o777,
        0o600,
      );
    }

    await workspace.closeProject(created);
    assert.deepEqual(await readdir(join(created.projectDirectory, 'state/locks')), []);

    const reopened = await workspace.openProject({
      projectDirectory: created.projectDirectory,
    });
    assert.equal(reopened.accessMode, 'read-write');
    assert.equal(reopened.projectSessionId, SESSION_ID_B);
    assert.equal(reopened.projectDirectory, created.projectDirectory);
    assert.deepEqual(reopened.manifest, created.manifest);

    assert.deepEqual(await readdir(parentDirectory), [created.manifest.directoryName]);
    await workspace.closeProject(reopened);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('inspects an openable project without changing workspace files', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Inspection target',
      parentDirectory,
    });
    await workspace.closeProject(created);
    const manifestPath = join(created.projectDirectory, 'project.json');
    const databasePath = join(created.projectDirectory, 'state/project.sqlite');
    const before = {
      backups: await readdir(join(created.projectDirectory, 'state/backups')),
      database: await readFile(databasePath),
      locks: await readdir(join(created.projectDirectory, 'state/locks')),
      manifest: await readFile(manifestPath, 'utf8'),
      stateEntries: await readdir(join(created.projectDirectory, 'state')),
    };

    const preview = await workspace.inspectProject({
      projectDirectory: created.projectDirectory,
    });

    assert.deepEqual(preview, {
      displayName: 'Inspection target',
      layoutVersion: 2,
      migrationRequired: false,
      projectId: PROJECT_ID,
      writeLock: {
        recoveryAvailable: false,
        status: 'available',
      },
    });
    assert.equal(Object.hasOwn(preview, 'projectDirectory'), false);
    assert.equal(JSON.stringify(preview).includes(parentDirectory), false);
    assert.equal(Object.isFrozen(preview), true);
    assert.equal(Object.isFrozen(preview.writeLock), true);
    assert.deepEqual(
      {
        backups: await readdir(join(created.projectDirectory, 'state/backups')),
        database: await readFile(databasePath),
        locks: await readdir(join(created.projectDirectory, 'state/locks')),
        manifest: await readFile(manifestPath, 'utf8'),
        stateEntries: await readdir(join(created.projectDirectory, 'state')),
      },
      before,
    );
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('reports write-lock recovery without taking over or backing up the lock', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const owner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_A,
      processId: 101,
    });
    const created = await owner.createProject({
      displayName: 'Locked inspection',
      parentDirectory,
    });
    const lockBefore = await readFile(
      join(created.projectDirectory, PROJECT_WRITE_LOCK_PATH),
      'utf8',
    );
    const liveContender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
      isProcessAlive: () => true,
      processId: 202,
    });
    const staleContender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_C,
      isProcessAlive: processId => processId !== 101,
      processId: 303,
    });

    assert.deepEqual(
      (await liveContender.inspectProject({
        projectDirectory: created.projectDirectory,
      })).writeLock,
      { recoveryAvailable: false, status: 'locked' },
    );
    assert.deepEqual(
      (await staleContender.inspectProject({
        projectDirectory: created.projectDirectory,
      })).writeLock,
      { recoveryAvailable: true, status: 'recoverable' },
    );
    assert.equal(
      await readFile(
        join(created.projectDirectory, PROJECT_WRITE_LOCK_PATH),
        'utf8',
      ),
      lockBefore,
    );
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/backups')),
      [],
    );
    await owner.closeProject(created);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('does not recover a stale lock before migration confirmation', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const owner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_A,
      processId: 101,
    });
    const created = await owner.createProject({
      displayName: 'Confirmation before recovery',
      parentDirectory,
    });
    const manifestPath = join(created.projectDirectory, 'project.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.layoutVersion = 1;
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');
    const lockPath = join(created.projectDirectory, PROJECT_WRITE_LOCK_PATH);
    const lockBefore = await readFile(lockPath, 'utf8');
    const contender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
      isProcessAlive: processId => processId !== 101,
      processId: 202,
    });

    await assert.rejects(
      contender.openProject({
        projectDirectory: created.projectDirectory,
        recoverStaleWriteLock: true,
      }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
    );
    assert.equal(await readFile(lockPath, 'utf8'), lockBefore);
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/backups')),
      [],
    );
    await owner.closeProject(created);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('previews layout migration without creating state or backups', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Migration inspection',
      parentDirectory,
    });
    await workspace.closeProject(created);
    const manifestPath = join(created.projectDirectory, 'project.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.layoutVersion = 1;
    const legacyManifest = `${JSON.stringify(manifest)}\n`;
    await writeFile(manifestPath, legacyManifest, 'utf8');
    const databasePath = join(created.projectDirectory, 'state/project.sqlite');
    await Promise.all([
      rm(databasePath, { force: true }),
      rm(`${databasePath}-shm`, { force: true }),
      rm(`${databasePath}-wal`, { force: true }),
    ]);

    const preview = await workspace.inspectProject({
      projectDirectory: created.projectDirectory,
    });

    assert.equal(preview.layoutVersion, 1);
    assert.equal(preview.migrationRequired, true);
    assert.equal(await readFile(manifestPath, 'utf8'), legacyManifest);
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/backups')),
      [],
    );
    await assert.rejects(readFile(databasePath), error => error?.code === 'ENOENT');
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('publishes a write lock only after its temporary file is complete', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));
  let continuePublish;
  let creating;
  let observedPaths;
  let publishReady;
  const ready = new Promise((resolve) => {
    publishReady = resolve;
  });
  const publishBarrier = new Promise((resolve) => {
    continuePublish = resolve;
  });

  try {
    const workspace = createWorkspace({
      beforeWriteLockPublish: async (paths) => {
        observedPaths = paths;
        publishReady();
        await publishBarrier;
      },
      generateProjectSessionId: () => SESSION_ID_A,
    });
    creating = workspace.createProject({
      displayName: 'Atomic publish',
      parentDirectory,
    });
    await ready;

    await assert.rejects(
      readFile(observedPaths.lockPath, 'utf8'),
      error => error?.code === 'ENOENT',
    );
    const temporaryLock = JSON.parse(
      await readFile(observedPaths.temporaryPath, 'utf8'),
    );
    assert.equal(temporaryLock.projectId, PROJECT_ID);
    assert.equal(temporaryLock.projectSessionId, SESSION_ID_A);

    continuePublish();
    const created = await creating;
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/locks')),
      ['project-write.lock'],
    );
    assert.deepEqual(
      await readProjectWriteLock(created.projectDirectory),
      temporaryLock,
    );
    await workspace.closeProject(created);
  } finally {
    continuePublish?.();
    await creating?.catch(() => {});
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('preserves a reserved target and competing marker in a recovery container', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace({
      beforeWriteLockPublish: async ({ lockPath }) => {
        const projectDirectory = dirname(dirname(dirname(lockPath)));
        await writeFile(join(projectDirectory, 'competitor.marker'), 'preserve');
        throw new Error('Injected failure after target reservation.');
      },
      generateProjectSessionId: () => SESSION_ID_A,
    });

    await assert.rejects(
      workspace.createProject({ displayName: 'Recovery', parentDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCK_ACQUIRE_FAILED',
    );

    const entries = await readdir(parentDirectory);
    assert.equal(entries.length, 1);
    assert.match(entries[0], /\.creating-.+\.reserved-/u);
    const recoveredProject = join(parentDirectory, entries[0], 'project');
    assert.equal(
      await readFile(join(recoveredProject, 'competitor.marker'), 'utf8'),
      'preserve',
    );
    assert.deepEqual(await readdir(join(recoveredProject, 'state/locks')), []);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('leaves a replacement target in place when reservation identity changes', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));
  let replacementDirectory;
  const displacedDirectory = join(parentDirectory, 'displaced-reservation');

  try {
    const workspace = createWorkspace({
      beforeWriteLockPublish: async ({ lockPath }) => {
        replacementDirectory = dirname(dirname(dirname(lockPath)));
        await rename(replacementDirectory, displacedDirectory);
        await mkdir(replacementDirectory);
        await writeFile(
          join(replacementDirectory, 'competitor.marker'),
          'replacement',
        );
        throw new Error('Injected reservation replacement.');
      },
      generateProjectSessionId: () => SESSION_ID_A,
    });

    await assert.rejects(
      workspace.createProject({ displayName: 'Replacement', parentDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCK_ACQUIRE_FAILED',
    );

    assert.equal(
      await readFile(join(replacementDirectory, 'competitor.marker'), 'utf8'),
      'replacement',
    );
    assert.ok((await stat(displacedDirectory)).isDirectory());
    assert.equal(
      (await readdir(parentDirectory)).some(entry => entry.includes('.reserved-')),
      false,
    );
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects a second writer while the first write session is active', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const owner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_A,
      processId: 101,
    });
    const contender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
      processId: 202,
    });
    const created = await owner.createProject({
      displayName: 'Demo',
      parentDirectory,
    });

    await assert.rejects(
      contender.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCKED',
    );
    assert.equal(
      (await readProjectWriteLock(created.projectDirectory)).projectSessionId,
      SESSION_ID_A,
    );

    await owner.closeProject(created);
    const reopened = await contender.openProject({
      projectDirectory: created.projectDirectory,
    });
    assert.equal(reopened.projectSessionId, SESSION_ID_B);
    await contender.closeProject(reopened);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('allows multiple read-only sessions alongside one writer', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const owner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_A,
    });
    const readerOneWorkspace = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
    });
    const readerTwoWorkspace = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_C,
    });
    const created = await owner.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    const [readerOne, readerTwo] = await Promise.all([
      readerOneWorkspace.openProject({
        accessMode: 'read-only',
        projectDirectory: created.projectDirectory,
      }),
      readerTwoWorkspace.openProject({
        accessMode: 'read-only',
        projectDirectory: created.projectDirectory,
      }),
    ]);

    assert.equal(readerOne.accessMode, 'read-only');
    assert.equal(readerTwo.accessMode, 'read-only');
    assert.notEqual(readerOne.projectSessionId, readerTwo.projectSessionId);
    assert.equal(
      (await readProjectWriteLock(created.projectDirectory)).projectSessionId,
      SESSION_ID_A,
    );

    await Promise.all([
      readerOneWorkspace.closeProject(readerOne),
      readerTwoWorkspace.closeProject(readerTwo),
    ]);
    assert.equal(
      (await readProjectWriteLock(created.projectDirectory)).projectSessionId,
      SESSION_ID_A,
    );
    await owner.closeProject(created);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('does not release a write lock for a non-owner context or adapter', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const owner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_A,
    });
    const nonOwner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
    });
    const created = await owner.createProject({
      displayName: 'Demo',
      parentDirectory,
    });

    await nonOwner.closeProject(created);
    await owner.closeProject({
      ...created,
      projectSessionId: SESSION_ID_B,
    });
    assert.equal(
      (await readProjectWriteLock(created.projectDirectory)).projectSessionId,
      SESSION_ID_A,
    );

    await owner.closeProject(created);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('single-flights concurrent closes without deleting a successor lock', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));
  let continueRelease;
  let firstClose;
  let releaseReady;
  let secondClose;
  const releaseStarted = new Promise((resolve) => {
    releaseReady = resolve;
  });
  const releaseBarrier = new Promise((resolve) => {
    continueRelease = resolve;
  });

  try {
    let releaseCount = 0;
    const owner = createWorkspace({
      afterWriteLockUnlink: async () => {
        releaseCount += 1;
        releaseReady();
        await releaseBarrier;
      },
      generateProjectSessionId: () => SESSION_ID_A,
    });
    const contender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
    });
    const created = await owner.createProject({
      displayName: 'Concurrent close',
      parentDirectory,
    });

    firstClose = owner.closeProject(created);
    secondClose = owner.closeProject(created);
    assert.strictEqual(secondClose, firstClose);
    await releaseStarted;
    assert.equal(releaseCount, 1);

    await assert.rejects(
      owner.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCKED',
    );

    await assert.rejects(
      contender.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCKED',
    );
    continueRelease();
    await Promise.all([firstClose, secondClose]);
    const successor = await contender.openProject({
      projectDirectory: created.projectDirectory,
    });
    assert.equal(
      (await readProjectWriteLock(created.projectDirectory)).projectSessionId,
      SESSION_ID_B,
    );
    await contender.closeProject(successor);
  } finally {
    continueRelease?.();
    await Promise.allSettled([firstClose, secondClose].filter(Boolean));
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('retains write ownership when close rejects so release can be retried', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    let rejectRelease = true;
    const workspace = createWorkspace({
      beforeWriteLockRelease: () => {
        if (rejectRelease) {
          rejectRelease = false;
          throw new Error('Injected release failure.');
        }
      },
      generateProjectSessionId: () => SESSION_ID_A,
    });
    const created = await workspace.createProject({
      displayName: 'Retry close',
      parentDirectory,
    });
    const failedClose = workspace.closeProject(created);

    await assert.rejects(
      failedClose,
      error => error?.message === 'Injected release failure.',
    );
    assert.equal(
      (await readProjectWriteLock(created.projectDirectory)).projectSessionId,
      SESSION_ID_A,
    );

    const retriedClose = workspace.closeProject(created);
    assert.notStrictEqual(retriedClose, failedClose);
    await retriedClose;
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/locks')),
      [],
    );
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('does not reject after an owned lock is unlinked if an observation hook fails', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace({
      afterWriteLockUnlink: () => {
        throw new Error('Injected post-unlink observation failure.');
      },
    });
    const created = await workspace.createProject({
      displayName: 'Post-unlink failure',
      parentDirectory,
    });

    await workspace.closeProject(created);
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/locks')),
      [],
    );

    const reopened = await workspace.openProject({
      projectDirectory: created.projectDirectory,
    });
    await workspace.closeProject(reopened);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('closes locally after write-lock ownership is missing or invalid', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    const lockPath = join(created.projectDirectory, PROJECT_WRITE_LOCK_PATH);

    await rm(lockPath);
    await workspace.closeProject(created);

    const invalidLockOwner = await workspace.openProject({
      projectDirectory: created.projectDirectory,
    });
    await writeFile(lockPath, '{invalid', 'utf8');
    await workspace.closeProject(invalidLockOwner);
    assert.equal(await readFile(lockPath, 'utf8'), '{invalid');

    await rm(lockPath);
    const foreignLockOwner = await workspace.openProject({
      projectDirectory: created.projectDirectory,
    });
    const foreignLock = {
      schemaVersion: 1,
      projectId: OTHER_PROJECT_ID,
      projectSessionId: SESSION_ID_D,
      processId: 404,
      hostname: 'host-a',
      acquiredAt: CREATED_AT,
    };
    await writeFile(lockPath, `${JSON.stringify(foreignLock)}\n`, 'utf8');
    await workspace.closeProject(foreignLockOwner);
    assert.deepEqual(await readProjectWriteLock(created.projectDirectory), foreignLock);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('treats every existing write-lock path as locked without deleting it', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));
  const externalDirectory = await mkdtemp(
    join(tmpdir(), 'voxweaver-external-lock-'),
  );

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    await workspace.closeProject(created);
    const lockPath = join(created.projectDirectory, PROJECT_WRITE_LOCK_PATH);
    await writeFile(lockPath, '{invalid', { encoding: 'utf8', mode: 0o600 });

    await assert.rejects(
      workspace.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCKED',
    );
    assert.equal(await readFile(lockPath, 'utf8'), '{invalid');

    await rm(lockPath);
    const externalLockPath = join(externalDirectory, 'external.lock');
    await writeFile(externalLockPath, '{}', 'utf8');
    await symlink(externalLockPath, lockPath, 'file');

    await assert.rejects(
      workspace.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCKED',
    );
    assert.equal(await readFile(externalLockPath, 'utf8'), '{}');
  } finally {
    await Promise.all([
      rm(parentDirectory, { force: true, recursive: true }),
      rm(externalDirectory, { force: true, recursive: true }),
    ]);
  }
});

test('treats a cross-project write-lock document as locked on open', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    await workspace.closeProject(created);
    const lockPath = join(created.projectDirectory, PROJECT_WRITE_LOCK_PATH);
    const foreignLock = {
      schemaVersion: 1,
      projectId: OTHER_PROJECT_ID,
      projectSessionId: SESSION_ID_B,
      processId: 101,
      hostname: 'host-a',
      acquiredAt: CREATED_AT,
    };
    await writeFile(lockPath, `${JSON.stringify(foreignLock)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
    });

    await assert.rejects(
      workspace.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCKED',
    );
    assert.deepEqual(await readProjectWriteLock(created.projectDirectory), foreignLock);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects invalid access modes and generated project session IDs', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));
  const invalidCreateParent = await mkdtemp(
    join(tmpdir(), 'voxweaver-invalid-session-'),
  );

  try {
    const owner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_A,
    });
    const created = await owner.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    await owner.closeProject(created);

    await assert.rejects(
      owner.openProject({
        accessMode: 'writer',
        projectDirectory: created.projectDirectory,
      }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_ACCESS_MODE_INVALID',
    );

    const invalidSessionWorkspace = createWorkspace({
      generateProjectSessionId: () => 'not-a-uuid',
    });
    await assert.rejects(
      invalidSessionWorkspace.openProject({
        accessMode: 'read-only',
        projectDirectory: created.projectDirectory,
      }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_SESSION_ID_INVALID',
    );
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/locks')),
      [],
    );

    await assert.rejects(
      invalidSessionWorkspace.createProject({
        displayName: 'Invalid session',
        parentDirectory: invalidCreateParent,
      }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_SESSION_ID_INVALID',
    );
    assert.deepEqual(await readdir(invalidCreateParent), []);
  } finally {
    await Promise.all([
      rm(parentDirectory, { force: true, recursive: true }),
      rm(invalidCreateParent, { force: true, recursive: true }),
    ]);
  }
});

test('does not merge with or overwrite an existing project directory', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    const markerPath = join(created.projectDirectory, 'keep.txt');
    await writeFile(markerPath, 'preserve', 'utf8');

    await assert.rejects(
      workspace.createProject({ displayName: 'Demo', parentDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_ALREADY_EXISTS',
    );
    assert.equal(await readFile(markerPath, 'utf8'), 'preserve');
    assert.deepEqual(await readdir(parentDirectory), [created.manifest.directoryName]);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('does not overwrite a target created during the commit window and cleans staging', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));
  const directoryName = `demo--${PROJECT_ID}`;
  const projectDirectory = join(parentDirectory, directoryName);

  try {
    const workspace = new NodeProjectWorkspace({
      generateProjectId: () => PROJECT_ID,
      now: () => {
        mkdirSync(projectDirectory);
        writeFileSync(join(projectDirectory, 'keep.txt'), 'competitor', 'utf8');
        return new Date(CREATED_AT);
      },
    });

    await assert.rejects(
      workspace.createProject({ displayName: 'Demo', parentDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_ALREADY_EXISTS',
    );

    assert.equal(
      await readFile(join(projectDirectory, 'keep.txt'), 'utf8'),
      'competitor',
    );
    assert.deepEqual(await readdir(parentDirectory), [directoryName]);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects a NUL display name before creating a workspace', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    await assert.rejects(
      createWorkspace().createProject({
        displayName: 'Demo\0Project',
        parentDirectory,
      }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_NAME_INVALID',
    );
    assert.deepEqual(await readdir(parentDirectory), []);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects a project with an invalid manifest', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    await writeFile(
      join(created.projectDirectory, 'project.json'),
      '{"schemaVersion":2}',
      'utf8',
    );

    await assert.rejects(
      workspace.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_MANIFEST_INVALID',
    );
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects a manifest whose directory name does not end with its project ID', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    const manifestPath = join(created.projectDirectory, 'project.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.projectId = '973d5d51-4cbb-40c8-a67b-a18dd718c765';
    await writeFile(manifestPath, `${JSON.stringify(manifest)}\n`, 'utf8');

    await assert.rejects(
      workspace.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_MANIFEST_INVALID',
    );
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects a project with an incomplete physical layout', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    await rm(join(created.projectDirectory, 'logs'), { recursive: true });

    await assert.rejects(
      workspace.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_LAYOUT_INCOMPLETE',
    );
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects symbolic links inside the required project layout', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    const logsDirectory = join(created.projectDirectory, 'logs');
    await rm(logsDirectory, { recursive: true });
    await symlink(parentDirectory, logsDirectory, 'dir');

    await assert.rejects(
      workspace.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_LAYOUT_INCOMPLETE',
    );
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('rejects a symbolic link in an ancestor of required layout directories', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));
  const externalStateDirectory = await mkdtemp(
    join(tmpdir(), 'voxweaver-external-state-'),
  );

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Demo',
      parentDirectory,
    });
    await rm(join(created.projectDirectory, 'state'), { recursive: true });
    await Promise.all([
      mkdir(join(externalStateDirectory, 'backups')),
      mkdir(join(externalStateDirectory, 'locks')),
    ]);
    await symlink(
      externalStateDirectory,
      join(created.projectDirectory, 'state'),
      'dir',
    );

    await assert.rejects(
      workspace.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_LAYOUT_INCOMPLETE',
    );
  } finally {
    await Promise.all([
      rm(parentDirectory, { force: true, recursive: true }),
      rm(externalStateDirectory, { force: true, recursive: true }),
    ]);
  }
});

test('recovers a stale same-host write lock only when explicitly requested', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const owner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_A,
      processId: 101,
    });
    const created = await owner.createProject({
      displayName: 'Stale lock',
      parentDirectory,
    });
    const contender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
      isProcessAlive: processId => processId !== 101,
      processId: 202,
    });

    await assert.rejects(
      contender.openProject({ projectDirectory: created.projectDirectory }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_WRITE_LOCKED',
    );

    const recovered = await contender.openProject({
      projectDirectory: created.projectDirectory,
      recoverStaleWriteLock: true,
    });
    assert.equal(recovered.projectSessionId, SESSION_ID_B);
    assert.equal(
      (await readProjectWriteLock(created.projectDirectory)).processId,
      202,
    );
    assert.equal(
      (await readdir(join(created.projectDirectory, 'state/backups')))
        .some(name => name.startsWith(`stale-write-lock-${SESSION_ID_A}-`)),
      true,
    );

    await owner.closeProject(created);
    assert.equal(
      (await readProjectWriteLock(created.projectDirectory)).projectSessionId,
      SESSION_ID_B,
    );
    await contender.closeProject(recovered);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('does not recover a live or different-host write lock', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const owner = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_A,
      processId: 101,
    });
    const created = await owner.createProject({
      displayName: 'Active lock',
      parentDirectory,
    });
    const liveContender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
      isProcessAlive: () => true,
      processId: 202,
    });
    const remoteContender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_C,
      hostname: 'host-b',
      isProcessAlive: () => false,
      processId: 303,
    });

    for (const workspace of [liveContender, remoteContender]) {
      await assert.rejects(
        workspace.openProject({
          projectDirectory: created.projectDirectory,
          recoverStaleWriteLock: true,
        }),
        error =>
          error instanceof ProjectWorkspaceError
          && error.code === 'PROJECT_WRITE_LOCKED',
      );
    }
    await owner.closeProject(created);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('recovers a stale mutation guard left by a stopped local process', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const owner = createWorkspace({ generateProjectSessionId: () => SESSION_ID_A });
    const created = await owner.createProject({
      displayName: 'Mutation recovery',
      parentDirectory,
    });
    await owner.closeProject(created);
    await writeFile(
      join(created.projectDirectory, 'state/locks/project-write.mutation'),
      `${JSON.stringify({
        schemaVersion: 1,
        projectId: PROJECT_ID,
        projectSessionId: SESSION_ID_A,
        processId: 101,
        hostname: 'host-a',
        acquiredAt: CREATED_AT,
      })}\n`,
      { encoding: 'utf8', flag: 'wx' },
    );

    const contender = createWorkspace({
      generateProjectSessionId: () => SESSION_ID_B,
      isProcessAlive: processId => processId !== 101,
      processId: 202,
    });
    const reopened = await contender.openProject({
      projectDirectory: created.projectDirectory,
    });
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/locks')),
      ['project-write.lock'],
    );
    await contender.closeProject(reopened);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('migrates a layout-v1 project after backup and blocks read-only migration', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'Layout migration',
      parentDirectory,
    });
    await workspace.closeProject(created);
    const manifestPath = join(created.projectDirectory, 'project.json');
    const manifest = JSON.parse(await readFile(manifestPath, 'utf8'));
    manifest.layoutVersion = 1;
    const legacyManifest = `${JSON.stringify(manifest)}\n`;
    await writeFile(manifestPath, legacyManifest, 'utf8');
    const databasePath = join(created.projectDirectory, 'state/project.sqlite');
    await Promise.all([
      rm(databasePath, { force: true }),
      rm(`${databasePath}-shm`, { force: true }),
      rm(`${databasePath}-wal`, { force: true }),
    ]);

    await assert.rejects(
      workspace.openProject({
        projectDirectory: created.projectDirectory,
      }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
    );
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/locks')),
      [],
    );
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/backups')),
      [],
    );
    assert.equal(await readFile(manifestPath, 'utf8'), legacyManifest);
    await assert.rejects(readFile(databasePath), error => error?.code === 'ENOENT');

    await assert.rejects(
      workspace.openProject({
        accessMode: 'read-only',
        confirmMigration: true,
        projectDirectory: created.projectDirectory,
      }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_MIGRATION_REQUIRED',
    );

    const migrated = await workspace.openProject({
      confirmMigration: true,
      projectDirectory: created.projectDirectory,
    });
    assert.equal(migrated.manifest.layoutVersion, 2);
    assert.equal((await stat(databasePath)).isFile(), true);
    assert.equal(
      (await readdir(join(created.projectDirectory, 'state/backups')))
        .some(name => name.startsWith('project-manifest-layout-v1-')),
      true,
    );
    await workspace.closeProject(migrated);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

test('backs up and migrates the recognized state schema v0', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: 'State migration',
      parentDirectory,
    });
    await workspace.closeProject(created);
    const databasePath = join(created.projectDirectory, 'state/project.sqlite');
    await Promise.all([
      rm(databasePath, { force: true }),
      rm(`${databasePath}-shm`, { force: true }),
      rm(`${databasePath}-wal`, { force: true }),
    ]);
    createLegacyProjectStateFixture(
      created.projectDirectory,
      PROJECT_ID,
      CREATED_AT,
    );

    const databaseBeforeInspection = await readFile(databasePath);
    const stateEntriesBeforeInspection = await readdir(
      join(created.projectDirectory, 'state'),
    );
    const preview = await workspace.inspectProject({
      projectDirectory: created.projectDirectory,
    });
    assert.equal(preview.migrationRequired, true);
    assert.deepEqual(await readFile(databasePath), databaseBeforeInspection);
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state')),
      stateEntriesBeforeInspection,
    );
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/backups')),
      [],
    );

    await assert.rejects(
      workspace.openProject({
        projectDirectory: created.projectDirectory,
      }),
      error =>
        error instanceof ProjectWorkspaceError
        && error.code === 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
    );
    assert.deepEqual(await readFile(databasePath), databaseBeforeInspection);
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/locks')),
      [],
    );
    assert.deepEqual(
      await readdir(join(created.projectDirectory, 'state/backups')),
      [],
    );

    await assert.rejects(
      workspace.openProject({
        accessMode: 'read-only',
        confirmMigration: true,
        projectDirectory: created.projectDirectory,
      }),
      error => error?.code === 'PROJECT_STATE_MIGRATION_REQUIRED',
    );
    const migrated = await workspace.openProject({
      confirmMigration: true,
      projectDirectory: created.projectDirectory,
    });
    assert.equal(
      (await readdir(join(created.projectDirectory, 'state/backups')))
        .some(name => name.startsWith('project-v0-')),
      true,
    );
    await workspace.closeProject(migrated);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});

function createLegacyProjectStateFixture(
  projectDirectory,
  projectId,
  createdAt,
) {
  const database = new DatabaseSync(
    join(projectDirectory, 'state/project.sqlite'),
  );
  try {
    database.exec(`
      CREATE TABLE legacy_project_metadata (
        project_id TEXT PRIMARY KEY,
        created_at TEXT NOT NULL
      ) STRICT;
      PRAGMA user_version = 0;
    `);
    database.prepare(`
      INSERT INTO legacy_project_metadata(project_id, created_at)
      VALUES (?, ?)
    `).run(projectId, createdAt);
  } finally {
    database.close();
  }
}
