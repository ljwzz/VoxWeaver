import assert from 'node:assert/strict';
import test from 'node:test';

import {
  ProjectApplicationError,
  ProjectApplicationService,
} from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';
const PROJECT_SESSION_ID = '348d6518-f31d-405a-bf8f-12e7c1b893c7';
const NEXT_PROJECT_ID = '973d5d51-4cbb-40c8-a67b-a18dd718c765';
const NEXT_PROJECT_SESSION_ID = '6a4ab824-dcab-4682-aea3-9c8958642c1a';
const READ_ONLY_PROJECT_SESSION_ID = 'ae181966-0313-465c-b378-fea05512de3f';

const project = {
  accessMode: 'read-write',
  projectDirectory: '/projects/demo',
  projectSessionId: PROJECT_SESSION_ID,
  manifest: {
    schemaVersion: 1,
    layoutVersion: 1,
    projectId: PROJECT_ID,
    displayName: 'Demo',
    directoryName: 'demo--9451cf18-18c8-4ddd-98b2-28ab65fb85b5',
    createdAt: '2026-08-08T00:00:00.000Z',
    updatedAt: '2026-08-08T00:00:00.000Z',
  },
};

const nextProject = {
  ...project,
  projectDirectory: '/projects/next',
  projectSessionId: NEXT_PROJECT_SESSION_ID,
  manifest: {
    ...project.manifest,
    projectId: NEXT_PROJECT_ID,
    displayName: 'Next',
    directoryName: `next--${NEXT_PROJECT_ID}`,
  },
};

const readOnlyProject = {
  ...project,
  accessMode: 'read-only',
  projectSessionId: READ_ONLY_PROJECT_SESSION_ID,
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
  const created = await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });
  assertProjectSnapshot(created, project);
  assert.equal(service.getActiveProject(), created);

  await service.closeProject();

  assert.deepEqual(closed, [project]);
  assert.equal(service.getActiveProject(), undefined);
});

test('isolates the active context from adapter and caller mutation', async () => {
  const adapterProject = {
    ...project,
    manifest: {
      ...project.manifest,
      futureField: {
        flags: [{ enabled: true }],
      },
    },
  };
  const service = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      return adapterProject;
    },
    async openProject() {
      return adapterProject;
    },
  });

  const activeProject = await service.openProject({
    projectDirectory: adapterProject.projectDirectory,
  });
  assertProjectSnapshot(activeProject, adapterProject);

  adapterProject.accessMode = 'read-only';
  adapterProject.projectSessionId = NEXT_PROJECT_SESSION_ID;
  adapterProject.manifest.projectId = NEXT_PROJECT_ID;
  adapterProject.manifest.futureField.flags[0].enabled = false;

  assert.equal(activeProject.accessMode, 'read-write');
  assert.equal(activeProject.projectSessionId, PROJECT_SESSION_ID);
  assert.equal(activeProject.manifest.projectId, PROJECT_ID);
  assert.equal(activeProject.manifest.futureField.flags[0].enabled, true);
  assert.throws(
    () => Object.assign(activeProject, { accessMode: 'read-only' }),
    TypeError,
  );
  assert.throws(
    () => Object.assign(activeProject.manifest, { projectId: NEXT_PROJECT_ID }),
    TypeError,
  );
  assert.throws(
    () => Object.assign(
      activeProject.manifest.futureField.flags[0],
      { enabled: false },
    ),
    TypeError,
  );
  assert.equal(Object.isFrozen(activeProject.manifest.futureField), true);
  assert.equal(Object.isFrozen(activeProject.manifest.futureField.flags), true);
  assert.equal(
    Object.isFrozen(activeProject.manifest.futureField.flags[0]),
    true,
  );
  assert.equal(
    service.assertActiveProjectSession({
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_ID,
      requiredAccess: 'write',
    }),
    activeProject,
  );
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

  const activeProject = await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });

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
  assert.equal(service.getActiveProject(), activeProject);
});

test('returns workspace-owned contexts when switch and close release sessions', async () => {
  const issuedContexts = new WeakSet();
  const closed = [];
  const service = new ProjectApplicationService({
    async closeProject(value) {
      assert.equal(issuedContexts.has(value), true);
      closed.push(value);
    },
    async createProject() {
      issuedContexts.add(project);
      return project;
    },
    async openProject() {
      issuedContexts.add(nextProject);
      return nextProject;
    },
  });

  const activeProject = await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });
  assert.notEqual(activeProject, project);

  const activeNextProject = await service.switchProject({
    projectDirectory: nextProject.projectDirectory,
  });
  assert.notEqual(activeNextProject, nextProject);
  assert.deepEqual(closed, [project]);

  await service.closeProject();
  assert.deepEqual(closed, [project, nextProject]);
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
  const activeProject = await creating;
  assertProjectSnapshot(activeProject, project);
  assert.equal(service.getActiveProject(), activeProject);
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
  const activeProject = await opening;
  assertProjectSnapshot(activeProject, project);
  assert.equal(service.getActiveProject(), activeProject);
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

  const activeProject = await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });
  const closing = service.closeProject();

  assert.equal(service.getActiveProject(), activeProject);
  assertApplicationErrorSync(
    () => service.assertActiveProjectSession({
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_ID,
      requiredAccess: 'read',
    }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
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

  const activeProject = await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });

  await assert.rejects(service.closeProject(), /close failed/);
  assert.equal(service.getActiveProject(), activeProject);

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

  const activeProject = await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });
  assertProjectSnapshot(activeProject, project);
});

test('asserts active project session identity and required access', async () => {
  const service = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      return project;
    },
    async openProject(command) {
      return command.accessMode === 'read-only' ? readOnlyProject : project;
    },
  });
  const activeSession = {
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
    requiredAccess: 'read',
  };

  assertApplicationErrorSync(
    () => service.assertActiveProjectSession(activeSession),
    'PROJECT_SESSION_STALE',
  );

  const activeProject = await service.openProject({
    projectDirectory: project.projectDirectory,
  });

  assertApplicationErrorSync(
    () => service.assertActiveProjectSession({
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_ID,
    }),
    'PROJECT_SESSION_ACCESS_INVALID',
  );
  assertApplicationErrorSync(
    () => service.assertActiveProjectSession({
      ...activeSession,
      requiredAccess: 'admin',
    }),
    'PROJECT_SESSION_ACCESS_INVALID',
  );
  assert.equal(service.assertActiveProjectSession(activeSession), activeProject);
  assert.equal(
    service.assertActiveProjectSession({ ...activeSession, requiredAccess: 'read' }),
    activeProject,
  );
  assert.equal(
    service.assertActiveProjectSession({ ...activeSession, requiredAccess: 'write' }),
    activeProject,
  );
  assertApplicationErrorSync(
    () => service.assertActiveProjectSession({
      ...activeSession,
      projectId: NEXT_PROJECT_ID,
    }),
    'PROJECT_SESSION_STALE',
  );
  assertApplicationErrorSync(
    () => service.assertActiveProjectSession({
      ...activeSession,
      projectSessionId: NEXT_PROJECT_SESSION_ID,
    }),
    'PROJECT_SESSION_STALE',
  );

  await service.closeProject();
  const activeReadOnlyProject = await service.openProject({
    accessMode: 'read-only',
    projectDirectory: project.projectDirectory,
  });

  assertApplicationErrorSync(
    () => service.assertActiveProjectSession(activeSession),
    'PROJECT_SESSION_STALE',
  );
  const readOnlySession = {
    ...activeSession,
    projectSessionId: READ_ONLY_PROJECT_SESSION_ID,
  };
  assert.equal(
    service.assertActiveProjectSession({
      ...readOnlySession,
      requiredAccess: 'read',
    }),
    activeReadOnlyProject,
  );
  assertApplicationErrorSync(
    () => service.assertActiveProjectSession({
      ...readOnlySession,
      requiredAccess: 'write',
    }),
    'PROJECT_READ_ONLY',
  );
});

test('switches from an active project while occupying the switching operation', async () => {
  const close = createDeferred();
  const open = createDeferred();
  const openStarted = createDeferred();
  const closed = [];
  const opened = [];
  const service = new ProjectApplicationService({
    async closeProject(value) {
      closed.push(value);
      return close.promise;
    },
    async createProject() {
      return project;
    },
    async openProject(command) {
      opened.push(command);
      openStarted.resolve();
      return open.promise;
    },
  });
  const command = {
    accessMode: 'read-write',
    projectDirectory: nextProject.projectDirectory,
  };

  const activeProject = await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });
  const switching = service.switchProject(command);

  assert.equal(service.getActiveProject(), activeProject);
  await assertSwitchingRejectsConcurrentOperations(service);
  assert.deepEqual(closed, [project]);
  assert.deepEqual(opened, []);

  close.resolve();
  await openStarted.promise;

  assert.equal(service.getActiveProject(), undefined);
  await assertSwitchingRejectsConcurrentOperations(service);
  assert.deepEqual(opened, [command]);

  open.resolve(nextProject);
  const activeNextProject = await switching;
  assertProjectSnapshot(activeNextProject, nextProject);
  assert.equal(service.getActiveProject(), activeNextProject);
});

test('switches without an active project by opening the requested project', async () => {
  const opened = [];
  const service = new ProjectApplicationService({
    async closeProject() {
      assert.fail('closeProject must not be called without an active project');
    },
    async createProject() {
      return project;
    },
    async openProject(command) {
      opened.push(command);
      return nextProject;
    },
  });
  const command = {
    accessMode: 'read-write',
    projectDirectory: nextProject.projectDirectory,
  };

  const activeProject = await service.switchProject(command);
  assertProjectSnapshot(activeProject, nextProject);
  assert.deepEqual(opened, [command]);
  assert.equal(service.getActiveProject(), activeProject);
});

test('keeps the old context when switch close fails', async () => {
  let closeCalls = 0;
  let openCalls = 0;
  const service = new ProjectApplicationService({
    async closeProject() {
      closeCalls += 1;
      throw new Error('close failed');
    },
    async createProject() {
      return project;
    },
    async openProject() {
      openCalls += 1;
      return nextProject;
    },
  });

  const activeProject = await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });

  await assert.rejects(
    service.switchProject({ projectDirectory: nextProject.projectDirectory }),
    /close failed/,
  );
  assert.equal(closeCalls, 1);
  assert.equal(openCalls, 0);
  assert.equal(service.getActiveProject(), activeProject);
});

test('leaves no active context when switch open fails', async () => {
  let openCalls = 0;
  const openError = new Error('open failed');
  const service = new ProjectApplicationService({
    async closeProject() {},
    async createProject() {
      return project;
    },
    async openProject() {
      openCalls += 1;
      if (openCalls === 1)
        throw openError;
      return nextProject;
    },
  });

  await service.createProject({
    displayName: 'Demo',
    parentDirectory: '/projects',
  });

  await assertApplicationError(
    service.switchProject({ projectDirectory: nextProject.projectDirectory }),
    'PROJECT_SWITCH_OPEN_FAILED',
    openError,
  );
  assert.equal(service.getActiveProject(), undefined);
  assertApplicationErrorSync(
    () => service.assertActiveProjectSession({
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_ID,
      requiredAccess: 'read',
    }),
    'PROJECT_SESSION_STALE',
  );

  const activeNextProject = await service.openProject({
    projectDirectory: nextProject.projectDirectory,
  });
  assertProjectSnapshot(activeNextProject, nextProject);
});

async function assertApplicationError(promise, code, cause) {
  await assert.rejects(promise, (error) => {
    assert.equal(error instanceof ProjectApplicationError, true);
    assert.equal(error.code, code);
    if (cause !== undefined)
      assert.equal(error.cause, cause);
    return true;
  });
}

function assertApplicationErrorSync(callback, code) {
  assert.throws(callback, (error) => {
    assert.equal(error instanceof ProjectApplicationError, true);
    assert.equal(error.code, code);
    return true;
  });
}

async function assertSwitchingRejectsConcurrentOperations(service) {
  assertApplicationErrorSync(
    () => service.assertActiveProjectSession({
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_ID,
      requiredAccess: 'read',
    }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
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
  await assertApplicationError(
    service.switchProject({ projectDirectory: '/projects/other' }),
    'PROJECT_OPERATION_IN_PROGRESS',
  );
}

function assertProjectSnapshot(actual, expected) {
  assert.notEqual(actual, expected);
  assert.notEqual(actual.manifest, expected.manifest);
  assert.deepEqual(actual, expected);
  assert.equal(Object.isFrozen(actual), true);
  assert.equal(Object.isFrozen(actual.manifest), true);
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
