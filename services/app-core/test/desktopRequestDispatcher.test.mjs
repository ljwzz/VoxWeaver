import assert from 'node:assert/strict';
import test from 'node:test';
import { DESKTOP_PROTOCOL_VERSION } from '@voxweaver/contracts';

import { DesktopRequestDispatcher } from '../dist/index.js';

const PROJECT_ID = '9451cf18-18c8-4ddd-98b2-28ab65fb85b5';
const PROJECT_SESSION_ID = '348d6518-f31d-405a-bf8f-12e7c1b893c7';
const PRIVATE_DIRECTORY = '/private/voxweaver/sample-project';

test('validates envelopes and method payloads before dispatching', async () => {
  const { core, calls } = createCore();
  const dispatcher = new DesktopRequestDispatcher({
    core,
    recentProjects: createRecentProjects(),
  });

  assert.deepEqual(
    await dispatcher.dispatch(createRequest('app.getHealth', {})),
    {
      ok: true,
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId: 'request-1',
      result: { healthy: true },
    },
  );

  const unknown = await dispatcher.dispatch(createRequest('unknown.method', {}));
  assert.equal(unknown.ok, false);
  assert.equal(unknown.error.code, 'DESKTOP_METHOD_NOT_FOUND');

  const malformed = await dispatcher.dispatch({
    method: 'app.getHealth',
    payload: {},
    protocolVersion: DESKTOP_PROTOCOL_VERSION,
    requestId: '',
  });
  assert.equal(malformed.ok, false);
  assert.equal(malformed.requestId, 'invalid-request');
  assert.equal(malformed.error.code, 'DESKTOP_PAYLOAD_INVALID');
  assert.deepEqual(calls, []);
});

test('creates projects only from a matching main-validated selection', async () => {
  const { core, calls } = createCore();
  const recentProjects = createRecentProjects();
  const dispatcher = new DesktopRequestDispatcher({ core, recentProjects });
  const request = createRequest('project.create', {
    displayName: 'Sample project',
    selectionToken: 'create-token',
  });

  const response = await dispatcher.dispatch(request, {
    projectDirectory: '/private/voxweaver',
    selectionPurpose: 'create-project-parent',
    selectionToken: 'create-token',
  });

  assert.equal(response.ok, true);
  assert.deepEqual(calls, [{
    command: {
      displayName: 'Sample project',
      parentDirectory: '/private/voxweaver',
    },
    operation: 'create',
  }]);
  assert.equal(recentProjects.records.get(PROJECT_ID)?.projectDirectory, PRIVATE_DIRECTORY);
  assert.equal(JSON.stringify(response).includes(PRIVATE_DIRECTORY), false);

  const invalid = await dispatcher.dispatch(request, {
    projectDirectory: '/private/voxweaver',
    selectionPurpose: 'open-project',
    selectionToken: 'create-token',
  });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.error.code, 'DESKTOP_SELECTION_INVALID');
});

test('requires a no-write migration confirmation before opening', async () => {
  const { core, calls, setPreview } = createCore({
    migrationRequired: true,
  });
  const dispatcher = new DesktopRequestDispatcher({
    core,
    recentProjects: createRecentProjects(),
  });
  const request = createRequest('project.open', {
    selectionToken: 'open-token',
  });
  const trustedContext = {
    projectDirectory: PRIVATE_DIRECTORY,
    selectionPurpose: 'open-project',
    selectionToken: 'open-token',
  };

  const confirmation = await dispatcher.dispatch(request, trustedContext);
  assert.equal(confirmation.ok, false);
  assert.equal(confirmation.error.code, 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED');
  assert.equal(confirmation.error.retryable, true);
  assert.deepEqual(calls, [{
    command: { projectDirectory: PRIVATE_DIRECTORY },
    operation: 'inspect',
  }]);

  setPreview({ migrationRequired: false, writeLock: { recoveryAvailable: true, status: 'recoverable' } });
  const lockConfirmation = await dispatcher.dispatch(request, trustedContext);
  assert.equal(lockConfirmation.ok, false);
  assert.equal(lockConfirmation.error.code, 'PROJECT_WRITE_LOCK_RECOVERY_REQUIRED');

  const opened = await dispatcher.dispatch(createRequest('project.open', {
    confirmMigration: true,
    recoverStaleWriteLock: true,
    selectionToken: 'open-token',
  }), trustedContext);
  assert.equal(opened.ok, true);
  assert.deepEqual(calls.at(-1), {
    command: {
      accessMode: undefined,
      confirmMigration: true,
      projectDirectory: PRIVATE_DIRECTORY,
      recoverStaleWriteLock: true,
    },
    operation: 'open',
  });
  assert.equal(JSON.stringify(opened).includes(PRIVATE_DIRECTORY), false);
});

test('blocks read-only migration before requesting a confirmation', async () => {
  const { core, calls } = createCore({ migrationRequired: true });
  const dispatcher = new DesktopRequestDispatcher({
    core,
    recentProjects: createRecentProjects(),
  });

  const response = await dispatcher.dispatch(createRequest('project.open', {
    accessMode: 'read-only',
    confirmMigration: true,
    selectionToken: 'open-token',
  }), {
    projectDirectory: PRIVATE_DIRECTORY,
    selectionPurpose: 'open-project',
    selectionToken: 'open-token',
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROJECT_MIGRATION_REQUIRED');
  assert.equal(response.error.retryable, false);
  assert.deepEqual(calls.map(call => call.operation), ['inspect']);
});

test('resolves recent projects inside Core and returns a path-free summary', async () => {
  const { core, calls } = createCore();
  const recentProjects = createRecentProjects([
    createRecentRecord({ projectDirectory: '/private/recent-project' }),
  ]);
  const dispatcher = new DesktopRequestDispatcher({ core, recentProjects });

  const response = await dispatcher.dispatch(createRequest('project.switch', {
    accessMode: 'read-only',
    recentProjectId: PROJECT_ID,
  }));

  assert.equal(response.ok, true);
  assert.deepEqual(calls, [
    {
      command: { projectDirectory: '/private/recent-project' },
      operation: 'inspect',
    },
    {
      command: {
        accessMode: 'read-only',
        confirmMigration: undefined,
        projectDirectory: '/private/recent-project',
        recoverStaleWriteLock: undefined,
      },
      operation: 'switch',
    },
  ]);
  assert.equal(JSON.stringify(response).includes('/private/recent-project'), false);
});

test('maps Core errors without exposing file-system paths', async () => {
  const { core } = createCore({
    inspectError: Object.assign(
      new Error(`Cannot inspect ${PRIVATE_DIRECTORY}`),
      { code: 'PROJECT_DIRECTORY_INVALID' },
    ),
  });
  const dispatcher = new DesktopRequestDispatcher({
    core,
    recentProjects: createRecentProjects(),
  });

  const response = await dispatcher.dispatch(createRequest('project.open', {
    selectionToken: 'open-token',
  }), {
    projectDirectory: PRIVATE_DIRECTORY,
    selectionPurpose: 'open-project',
    selectionToken: 'open-token',
  });

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROJECT_DIRECTORY_INVALID');
  assert.equal(JSON.stringify(response).includes(PRIVATE_DIRECTORY), false);
});

test('does not close an active project when a switch target is locked', async () => {
  const activeProject = createProjectContext();
  const { core, calls } = createCore({
    project: activeProject,
    writeLock: { recoveryAvailable: false, status: 'locked' },
  });
  const dispatcher = new DesktopRequestDispatcher({
    core,
    recentProjects: createRecentProjects([
      createRecentRecord({ projectDirectory: '/private/locked-project' }),
    ]),
  });

  const response = await dispatcher.dispatch(createRequest('project.switch', {
    recentProjectId: PROJECT_ID,
  }, activeProject));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROJECT_WRITE_LOCKED');
  assert.equal(response.error.retryable, false);
  assert.deepEqual(calls.map(call => call.operation), ['assert', 'inspect']);
  assert.equal(core.getActiveProject(), activeProject);
});

test('keeps a successful Core session usable when recent-project persistence fails', async () => {
  const { core } = createCore();
  const dispatcher = new DesktopRequestDispatcher({
    core,
    recentProjects: createRecentProjects([], { recordError: new Error('disk unavailable') }),
  });

  const created = await dispatcher.dispatch(createRequest('project.create', {
    displayName: 'Sample project',
    selectionToken: 'create-token',
  }), {
    projectDirectory: '/private/voxweaver',
    selectionPurpose: 'create-project-parent',
    selectionToken: 'create-token',
  });
  assert.equal(created.ok, true);
  assert.equal((await dispatcher.dispatch(createRequest('project.getSummary', {}))).ok, true);
  assert.equal(
    (await dispatcher.dispatch(createRequest('project.close', {}, core.getActiveProject()))).ok,
    true,
  );

  const opened = await dispatcher.dispatch(createRequest('project.open', {
    selectionToken: 'open-token',
  }), {
    projectDirectory: PRIVATE_DIRECTORY,
    selectionPurpose: 'open-project',
    selectionToken: 'open-token',
  });
  assert.equal(opened.ok, true);
  assert.equal(
    (await dispatcher.dispatch(createRequest('project.close', {}, core.getActiveProject()))).ok,
    true,
  );

  const switched = await dispatcher.dispatch(createRequest('project.switch', {
    selectionToken: 'switch-token',
  }), {
    projectDirectory: PRIVATE_DIRECTORY,
    selectionPurpose: 'switch-project',
    selectionToken: 'switch-token',
  });
  assert.equal(switched.ok, true);
  assert.equal(
    (await dispatcher.dispatch(createRequest('project.close', {}, core.getActiveProject()))).ok,
    true,
  );
});

test('requires the active project context for close operations', async () => {
  const { core, calls } = createCore({ project: createProjectContext() });
  const dispatcher = new DesktopRequestDispatcher({
    core,
    recentProjects: createRecentProjects(),
  });

  const response = await dispatcher.dispatch(createRequest('project.close', {}));
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'DESKTOP_PAYLOAD_INVALID');
  assert.deepEqual(calls, []);
});

test('rejects invalid Core results before serializing a response', async () => {
  const { core } = createCore({
    project: {
      ...createProjectContext(),
      manifest: {
        ...createProjectContext().manifest,
        layoutVersion: 0,
      },
    },
  });
  const dispatcher = new DesktopRequestDispatcher({
    core,
    recentProjects: createRecentProjects(),
  });

  const response = await dispatcher.dispatch(
    createRequest('project.getSummary', {}),
  );
  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'DESKTOP_CORE_UNAVAILABLE');
});

function createRequest(method, payload, project) {
  const request = {
    method,
    payload,
    protocolVersion: DESKTOP_PROTOCOL_VERSION,
    requestId: 'request-1',
  };
  if (project) {
    request.projectContext = {
      projectId: project.manifest.projectId,
      projectSessionId: project.projectSessionId,
    };
  }
  return request;
}

function createCore(options = {}) {
  const calls = [];
  let activeProject = options.project;
  let preview = {
    displayName: 'Sample project',
    layoutVersion: 2,
    migrationRequired: options.migrationRequired ?? false,
    projectId: PROJECT_ID,
    writeLock: options.writeLock ?? { recoveryAvailable: false, status: 'available' },
  };
  const project = createProjectContext();
  const core = {
    assertActiveProjectSession(command) {
      const active = activeProject;
      if (
        !active
        || command.projectId !== active.manifest.projectId
        || command.projectSessionId !== active.projectSessionId
      ) {
        throw Object.assign(new Error('stale project session'), {
          code: 'PROJECT_SESSION_STALE',
        });
      }
      calls.push({ command, operation: 'assert' });
      return active;
    },
    async closeProject() {
      calls.push({ operation: 'close' });
      activeProject = undefined;
    },
    async createProject(command) {
      calls.push({ command, operation: 'create' });
      activeProject = project;
      return project;
    },
    getActiveProject() {
      return activeProject;
    },
    async inspectProject(command) {
      calls.push({ command, operation: 'inspect' });
      if (options.inspectError) {
        throw options.inspectError;
      }
      return preview;
    },
    async openProject(command) {
      calls.push({ command, operation: 'open' });
      activeProject = project;
      return project;
    },
    async switchProject(command) {
      calls.push({ command, operation: 'switch' });
      activeProject = project;
      return project;
    },
  };
  return {
    calls,
    core,
    setPreview(next) {
      preview = { ...preview, ...next };
    },
  };
}

function createRecentProjects(records = [], options = {}) {
  const indexedRecords = new Map(records.map(record => [record.projectId, record]));
  return {
    records: indexedRecords,
    async get(projectId) {
      return indexedRecords.get(projectId);
    },
    async list() {
      return [...indexedRecords.values()].map(record => ({
        availability: 'available',
        displayName: record.displayName,
        lastOpenedAt: record.lastOpenedAt,
        projectId: record.projectId,
      }));
    },
    async record(project) {
      if (options.recordError)
        throw options.recordError;
      indexedRecords.set(project.manifest.projectId, {
        displayName: project.manifest.displayName,
        lastOpenedAt: '2026-08-09T00:00:00.000Z',
        projectDirectory: project.projectDirectory,
        projectId: project.manifest.projectId,
      });
    },
    async remove(projectId) {
      return indexedRecords.delete(projectId);
    },
  };
}

function createRecentRecord(overrides = {}) {
  return {
    displayName: 'Sample project',
    lastOpenedAt: '2026-08-09T00:00:00.000Z',
    projectDirectory: PRIVATE_DIRECTORY,
    projectId: PROJECT_ID,
    ...overrides,
  };
}

function createProjectContext() {
  return {
    accessMode: 'read-write',
    manifest: {
      createdAt: '2026-08-08T00:00:00.000Z',
      directoryName: `sample-project--${PROJECT_ID}`,
      displayName: 'Sample project',
      layoutVersion: 2,
      projectId: PROJECT_ID,
      schemaVersion: 1,
      updatedAt: '2026-08-08T00:00:00.000Z',
    },
    projectDirectory: PRIVATE_DIRECTORY,
    projectSessionId: PROJECT_SESSION_ID,
  };
}
