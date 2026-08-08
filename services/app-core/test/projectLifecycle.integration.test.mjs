import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { NodeProjectWorkspace } from '@voxweaver/project-workspace';

import { AppCoreService } from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';

test('creates, closes, and reopens an empty project through app core', async () => {
  const parentDirectory = await mkdtemp(join(tmpdir(), 'voxweaver-app-core-'));

  try {
    const projectWorkspace = new NodeProjectWorkspace({
      generateProjectId: () => PROJECT_ID,
      now: () => new Date('2026-08-08T00:00:00.000Z'),
    });
    const appCore = new AppCoreService({ projectWorkspace });

    const created = await appCore.createProject({
      displayName: 'MVP Sample',
      parentDirectory,
    });
    assert.equal(appCore.getActiveProject(), created);

    await appCore.closeProject();
    assert.equal(appCore.getActiveProject(), undefined);

    const reopened = await appCore.openProject({
      projectDirectory: created.projectDirectory,
    });
    assert.deepEqual(reopened, created);
    assert.equal(appCore.getActiveProject(), reopened);
  } finally {
    await rm(parentDirectory, { force: true, recursive: true });
  }
});
