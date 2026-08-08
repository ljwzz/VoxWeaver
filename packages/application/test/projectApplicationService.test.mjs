import assert from 'node:assert/strict';
import test from 'node:test';

import { ProjectApplicationService } from '../dist/index.js';

const project = {
  projectDirectory: '/projects/demo',
  manifest: {
    schemaVersion: 1,
    layoutVersion: 1,
    projectId: '9451cf18-18c8-4ddd-98b2-28ab65fb85b5',
    displayName: 'Demo',
    directoryName: 'demo--9451cf18-18c8-4ddd-98b2-28ab65fb85b5',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  },
};

test('activates a created project and clears it after close', async () => {
  const closed = [];
  const service = new ProjectApplicationService({
    async closeProject(value) {
      closed.push(value);
    },
    async createProject() {
      return project;
    },
    async openProject() {
      return project;
    },
  });

  assert.equal(service.getActiveProject(), undefined);
  assert.equal(
    await service.createProject({ displayName: 'Demo', parentDirectory: '/projects' }),
    project,
  );
  assert.equal(service.getActiveProject(), project);

  await service.closeProject();

  assert.deepEqual(closed, [project]);
  assert.equal(service.getActiveProject(), undefined);
});

test('does not replace the active project when open fails', async () => {
  const service = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      return project;
    },
    async openProject() {
      throw new Error('invalid project');
    },
  });

  await service.createProject({ displayName: 'Demo', parentDirectory: '/projects' });

  await assert.rejects(
    service.openProject({ projectDirectory: '/projects/broken' }),
    /invalid project/,
  );
  assert.equal(service.getActiveProject(), project);
});
