import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProjectApplicationError,
  ProjectApplicationService,
} from '../dist/index.js';

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

test('rejects create and open when a project is already active', async () => {
  let createCalls = 0;
  let openCalls = 0;
  const service = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      createCalls += 1;
      return project;
    },
    async openProject() {
      openCalls += 1;
      return project;
    },
  });

  await service.createProject({ displayName: 'Demo', parentDirectory: '/projects' });

  await assertApplicationError(
    service.createProject({ displayName: 'Other', parentDirectory: '/projects' }),
    'PROJECT_ALREADY_ACTIVE',
  );
  await assertApplicationError(
    service.openProject({ projectDirectory: '/projects/other' }),
    'PROJECT_ALREADY_ACTIVE',
  );

  assert.equal(createCalls, 1);
  assert.equal(openCalls, 0);
  assert.equal(service.getActiveProject(), project);
});

test('occupies the operation before awaiting project creation', async () => {
  const create = createDeferred();
  let createCalls = 0;
  let openCalls = 0;
  let closeCalls = 0;
  const service = new ProjectApplicationService({
    async closeProject() {
      closeCalls += 1;
    },
    async createProject() {
      createCalls += 1;
      return create.promise;
    },
    async openProject() {
      openCalls += 1;
      return project;
    },
  });

  const creating = service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });

  assert.equal(service.getActiveProject(), undefined);
  await assertApplicationError(
    service.createProject({ displayName: 'Other', parentDirectory: '/projects' }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  await assertApplicationError(
    service.openProject({ projectDirectory: '/projects/other' }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  await assertApplicationError(
    service.closeProject(),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  assert.equal(createCalls, 1);
  assert.equal(openCalls, 0);
  assert.equal(closeCalls, 0);

  create.resolve(project);
  assert.equal(await creating, project);
  assert.equal(service.getActiveProject(), project);
});

test('occupies the operation before awaiting project open', async () => {
  const open = createDeferred();
  let openCalls = 0;
  const service = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      return project;
    },
    async openProject() {
      openCalls += 1;
      return open.promise;
    },
  });

  const opening = service.openProject({ projectDirectory: '/projects/demo' });

  assert.equal(service.getActiveProject(), undefined);
  await assertApplicationError(
    service.createProject({ displayName: 'Other', parentDirectory: '/projects' }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  await assertApplicationError(
    service.openProject({ projectDirectory: '/projects/other' }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  await assertApplicationError(
    service.closeProject(),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  assert.equal(openCalls, 1);

  open.resolve(project);
  assert.equal(await opening, project);
  assert.equal(service.getActiveProject(), project);
});

test('keeps the active project while close is in progress', async () => {
  const close = createDeferred();
  let closeCalls = 0;
  const service = new ProjectApplicationService({
    async closeProject() {
      closeCalls += 1;
      return close.promise;
    },
    async createProject() {
      return project;
    },
    async openProject() {
      return project;
    },
  });

  await service.createProject({ displayName: 'Demo', parentDirectory: '/projects' });
  const closing = service.closeProject();

  assert.equal(service.getActiveProject(), project);
  await assertApplicationError(
    service.createProject({ displayName: 'Other', parentDirectory: '/projects' }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  await assertApplicationError(
    service.openProject({ projectDirectory: '/projects/other' }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  await assertApplicationError(
    service.closeProject(),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
  assert.equal(closeCalls, 1);

  close.resolve();
  await closing;
  assert.equal(service.getActiveProject(), undefined);
});

test('keeps the active project when close fails and permits retry', async () => {
  let closeCalls = 0;
  const service = new ProjectApplicationService({
    async closeProject() {
      closeCalls += 1;
      if (closeCalls === 1)
        throw new Error('close failed');
    },
    async createProject() {
      return project;
    },
    async openProject() {
      return project;
    },
  });

  await service.createProject({ displayName: 'Demo', parentDirectory: '/projects' });

  await assert.rejects(service.closeProject(), /close failed/);
  assert.equal(service.getActiveProject(), project);

  await service.closeProject();
  assert.equal(closeCalls, 2);
  assert.equal(service.getActiveProject(), undefined);
});

test('releases the operation when project activation fails', async () => {
  let createCalls = 0;
  const service = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      createCalls += 1;
      if (createCalls === 1)
        throw new Error('create failed');
      return project;
    },
    async openProject() {
      return project;
    },
  });

  await assert.rejects(
    service.createProject({ displayName: 'Demo', parentDirectory: '/projects' }),
    /create failed/,
  );
  assert.equal(service.getActiveProject(), undefined);

  assert.equal(
    await service.createProject({ displayName: 'Demo', parentDirectory: '/projects' }),
    project,
  );
});

async function assertApplicationError(promise, code) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof ProjectApplicationError, true);
    assert.equal(error.code, code);
    return true;
  });
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });

  return { promise, reject, resolve };
}
