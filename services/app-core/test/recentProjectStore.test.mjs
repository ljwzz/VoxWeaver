import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { NodeRecentProjectStore } from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';

test('records project paths privately while returning path-free summaries', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voxweaver-recent-projects-'));
  const projectDirectory = join(root, 'sample-project');
  await mkdir(projectDirectory);

  try {
    const store = new NodeRecentProjectStore(root, {
      now: () => new Date('2026-08-09T00:00:00.000Z'),
    });
    await store.record(createProjectContext(projectDirectory, 'First name'));
    await store.record(createProjectContext(projectDirectory, 'Current name'));

    assert.deepEqual(await store.list(), [{
      availability: 'available',
      displayName: 'Current name',
      lastOpenedAt: '2026-08-09T00:00:00.000Z',
      projectId: PROJECT_ID,
    }]);
    assert.equal(JSON.stringify(await store.list()).includes(projectDirectory), false);
    assert.equal((await store.get(PROJECT_ID))?.projectDirectory, projectDirectory);

    const registryPath = join(root, 'recent-projects.v1.json');
    assert.equal((await stat(registryPath)).mode & 0o777, 0o600);
    assert.match(await readFile(registryPath, 'utf8'), /"schemaVersion": 1/);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test('does not block startup for corrupt registries and marks missing projects', async () => {
  const root = await mkdtemp(join(tmpdir(), 'voxweaver-recent-projects-'));
  const projectDirectory = join(root, 'sample-project');
  await mkdir(projectDirectory);

  try {
    const store = new NodeRecentProjectStore(root);
    await writeFile(join(root, 'recent-projects.v1.json'), '{not-json');
    assert.deepEqual(await store.list(), []);

    await store.record(createProjectContext(projectDirectory, 'Sample'));
    await rm(projectDirectory, { recursive: true });
    assert.equal((await store.list())[0]?.availability, 'missing');

    assert.equal(await store.remove(PROJECT_ID), true);
    assert.equal(await store.remove(PROJECT_ID), false);
    assert.deepEqual(await store.list(), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

function createProjectContext(projectDirectory, displayName) {
  return {
    accessMode: 'read-write',
    manifest: {
      createdAt: '2026-08-08T00:00:00.000Z',
      directoryName: 'sample-project',
      displayName,
      layoutVersion: 2,
      projectId: PROJECT_ID,
      schemaVersion: 1,
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
    projectDirectory,
    projectSessionId: '348d6518-f31d-405a-bf8f-12e7c1b893c7',
  };
}
