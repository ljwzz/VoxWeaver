import assert from 'node:assert/strict';
import { mkdtemp, readdir, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import {
  NodeProjectWorkspace,
  PROJECT_LAYOUT_DIRECTORIES,
  ProjectWorkspaceError,
} from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';
const CREATED_AT = '2026-08-08T00:00:00.000Z';

function createWorkspace() {
  return new NodeProjectWorkspace({
    generateProjectId: () => PROJECT_ID,
    now: () => new Date(CREATED_AT),
  });
}

test('creates a complete project and reopens it from disk', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-workspace-'));

  try {
    const workspace = createWorkspace();
    const created = await workspace.createProject({
      displayName: '示例 Project',
      parentDirectory,
    });
    const reopened = await workspace.openProject({
      projectDirectory: created.projectDirectory,
    });

    assert.deepEqual(reopened, created);
    assert.equal(created.manifest.createdAt, CREATED_AT);
    assert.equal(created.manifest.updatedAt, CREATED_AT);

    const manifest = JSON.parse(
      await readFile(join(created.projectDirectory, 'project.json'), 'utf8'),
    );
    assert.deepEqual(manifest, created.manifest);

    for (const relativePath of PROJECT_LAYOUT_DIRECTORIES) {
      const children = await readdir(join(created.projectDirectory, relativePath));
      assert.deepEqual(children, []);
    }

    assert.deepEqual(await readdir(parentDirectory), [created.manifest.directoryName]);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
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
