/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopNovelImportEventBridge } from '../.generated/main/desktopNovelImportEventBridge.js';
import { loadDesktopMainModule } from './loadDesktopMainModules.mjs';

const PROJECT_ID = uuid(1);
const PROJECT_SESSION_ID = uuid(2);
const OTHER_PROJECT_ID = uuid(3);
const OTHER_PROJECT_SESSION_ID = uuid(4);
const TASK_ID = uuid(5);
const ARTIFACT_ID = uuid(6);
const ARTIFACT_REVISION_ID = uuid(7);
const TEXT_REVISION_ID = uuid(8);

test('forwards only known, strictly increasing events for a lifecycle-bound session', () => {
  const sent = [];
  const bridge = new DesktopNovelImportEventBridge({
    send: (...args) => sent.push(args),
  });
  bridge.bindWindowSession(7, session());

  assert.equal(bridge.publish(progressEvent(1)), 1);
  assert.equal(bridge.publish(progressEvent(1)), 0);
  assert.equal(bridge.publish(progressEvent(0)), 0);
  assert.equal(bridge.publish({ ...progressEvent(2), eventType: 'unknown' }), 0);
  assert.equal(bridge.publish({ ...progressEvent(2), sourceFilePath: '/private/source.txt' }), 0);
  assert.equal(bridge.publish(progressEvent(3)), 1);

  assert.equal(sent.length, 2);
  assert.equal(sent[0][0], 7);
  assert.equal(sent[0][1], 'voxweaver:novelImport.taskProgress');
  assert.deepEqual(sent[0][2], {
    event: progressEvent(1),
    messageKind: 'event',
  });
  assert.equal(JSON.stringify(sent).includes('/private/source.txt'), false);
});

test('suspends lifecycle transitions, restores failures, and prevents stale restoration', () => {
  const sent = [];
  const bridge = new DesktopNovelImportEventBridge({
    send: (...args) => sent.push(args),
  });
  bridge.bindWindowSession(7, session());
  assert.equal(bridge.publish(progressEvent(1)), 1);

  const restoreFailedSwitch = bridge.suspendWindow(7);
  assert.equal(bridge.publish(progressEvent(2)), 0);
  restoreFailedSwitch();
  assert.equal(bridge.publish(progressEvent(2)), 1);

  const staleRestore = bridge.suspendWindow(7);
  bridge.bindWindowSession(7, session(OTHER_PROJECT_ID, OTHER_PROJECT_SESSION_ID));
  staleRestore();
  assert.equal(bridge.publish(progressEvent(3)), 0);
  assert.equal(
    bridge.publish(progressEvent(1, OTHER_PROJECT_ID, OTHER_PROJECT_SESSION_ID)),
    1,
  );

  bridge.clearWindowSession(7);
  assert.equal(
    bridge.publish(progressEvent(2, OTHER_PROJECT_ID, OTHER_PROJECT_SESSION_ID)),
    0,
  );
  assert.equal(sent.length, 3);
});

test('routes completed, failed, and retry events only to their exact narrow channels', () => {
  const sent = [];
  const bridge = new DesktopNovelImportEventBridge({
    send: (...args) => sent.push(args),
  });
  bridge.bindWindowSession(7, session());
  bridge.bindWindowSession(7, {
    projectId: 'invalid-project',
    projectSessionId: 'invalid-session',
  });
  bridge.bindWindowSession(8, {
    projectId: 'invalid-project',
    projectSessionId: 'invalid-session',
  });

  const events = [completedEvent(1), failedEvent(2), retryEvent(3)];
  for (const event of events)
    assert.equal(bridge.publish(event), 1);

  assert.deepEqual(
    sent.map(([, channel]) => channel),
    [
      'voxweaver:novelImport.taskCompleted',
      'voxweaver:novelImport.taskFailed',
      'voxweaver:novelImport.taskRetryScheduled',
    ],
  );
  assert.deepEqual(sent.map(([windowId]) => windowId), [7, 7, 7]);
  assert.deepEqual(sent.map(([, , envelope]) => envelope.event), events);
});

test('DesktopMainController binds only successful lifecycle results and restores failed switch/close', async () => {
  const { DesktopMainController } = await loadDesktopMainModule('controller');
  const { SelectionTokenRegistry } = await loadDesktopMainModule('registry');
  const lifecycle = createLifecycleRegistry();
  const selectionTokens = new SelectionTokenRegistry();
  const responses = [];
  const controller = new DesktopMainController({
    coreClient: {
      async dispatch(request) {
        const response = responses.shift();
        if (response instanceof Error)
          throw response;
        return response ?? desktopFailure(request.requestId);
      },
    },
    directoryPicker: { async selectDirectory() { return undefined; } },
    novelImportEventSessions: lifecycle,
    selectionTokens,
  });

  const createSelection = selectionTokens.issue({
    projectDirectory: '/private/projects',
    purpose: 'create-project-parent',
    windowId: 7,
  });
  responses.push(desktopSuccess('create-1', projectSummary()));
  await controller.dispatch(7, desktopRequest(
    'create-1',
    'project.create',
    { displayName: 'Synthetic', selectionToken: createSelection.selectionToken },
  ));
  assert.deepEqual(lifecycle.current, lifecycleSession());

  const switchSelection = selectionTokens.issue({
    projectDirectory: '/private/other-project',
    purpose: 'switch-project',
    windowId: 7,
  });
  responses.push(desktopFailure('switch-1'));
  await controller.dispatch(7, desktopRequest(
    'switch-1',
    'project.switch',
    { selectionToken: switchSelection.selectionToken },
  ));
  assert.deepEqual(lifecycle.current, lifecycleSession());
  assert.equal(lifecycle.suspended, false);

  responses.push(desktopFailure('close-1'));
  await controller.dispatch(7, desktopRequest('close-1', 'project.close', {}));
  assert.deepEqual(lifecycle.current, lifecycleSession());
  assert.equal(lifecycle.suspended, false);

  responses.push(desktopSuccess('close-2', null));
  await controller.dispatch(7, desktopRequest('close-2', 'project.close', {}));
  assert.equal(lifecycle.current, undefined);
});

test('clears the old event session when switch closed it before target open failed', async () => {
  const { DesktopMainController } = await loadDesktopMainModule('controller');
  const { SelectionTokenRegistry } = await loadDesktopMainModule('registry');
  const lifecycle = createLifecycleRegistry();
  const selectionTokens = new SelectionTokenRegistry();
  const responses = [
    desktopSuccess('create-switch-open-failure', projectSummary()),
    desktopFailure('switch-open-failure', 'PROJECT_SWITCH_OPEN_FAILED'),
  ];
  const controller = new DesktopMainController({
    coreClient: {
      async dispatch() {
        return responses.shift();
      },
    },
    directoryPicker: { async selectDirectory() { return undefined; } },
    novelImportEventSessions: lifecycle,
    selectionTokens,
  });

  const createSelection = selectionTokens.issue({
    projectDirectory: '/private/projects',
    purpose: 'create-project-parent',
    windowId: 7,
  });
  await controller.dispatch(7, desktopRequest(
    'create-switch-open-failure',
    'project.create',
    { displayName: 'Synthetic', selectionToken: createSelection.selectionToken },
  ));
  assert.deepEqual(lifecycle.current, lifecycleSession());

  const switchSelection = selectionTokens.issue({
    projectDirectory: '/private/unopenable-project',
    purpose: 'switch-project',
    windowId: 7,
  });
  const response = await controller.dispatch(7, desktopRequest(
    'switch-open-failure',
    'project.switch',
    { selectionToken: switchSelection.selectionToken },
  ));

  assert.equal(response.ok, false);
  assert.equal(response.error.code, 'PROJECT_SWITCH_OPEN_FAILED');
  assert.equal(lifecycle.current, undefined);
  assert.equal(lifecycle.suspended, false);
});

test('event-session observer failures do not alter successful lifecycle responses', async () => {
  const { DesktopMainController } = await loadDesktopMainModule('controller');
  const { SelectionTokenRegistry } = await loadDesktopMainModule('registry');
  const selectionTokens = new SelectionTokenRegistry();
  const responses = [
    desktopSuccess('create-observer', projectSummary()),
    desktopSuccess('switch-observer', projectSummary()),
    desktopSuccess('close-observer', null),
  ];
  const controller = new DesktopMainController({
    coreClient: {
      async dispatch() {
        return responses.shift();
      },
    },
    directoryPicker: { async selectDirectory() { return undefined; } },
    novelImportEventSessions: {
      bindWindowSession() { throw new Error('bind observer failed'); },
      clearWindowSession() { throw new Error('clear observer failed'); },
      suspendWindow() { throw new Error('suspend observer failed'); },
    },
    selectionTokens,
  });

  const createSelection = selectionTokens.issue({
    projectDirectory: '/private/projects',
    purpose: 'create-project-parent',
    windowId: 7,
  });
  const created = await controller.dispatch(7, desktopRequest(
    'create-observer',
    'project.create',
    { displayName: 'Synthetic', selectionToken: createSelection.selectionToken },
  ));
  assert.deepEqual(created, desktopSuccess('create-observer', projectSummary()));

  const switchSelection = selectionTokens.issue({
    projectDirectory: '/private/other-project',
    purpose: 'switch-project',
    windowId: 7,
  });
  const switched = await controller.dispatch(7, desktopRequest(
    'switch-observer',
    'project.switch',
    { selectionToken: switchSelection.selectionToken },
  ));
  assert.deepEqual(switched, desktopSuccess('switch-observer', projectSummary()));

  const closed = await controller.dispatch(
    7,
    desktopRequest('close-observer', 'project.close', {}),
  );
  assert.deepEqual(closed, desktopSuccess('close-observer', null));
  assert.doesNotThrow(() => controller.handleWindowClosed(7));
});

function createLifecycleRegistry() {
  const registry = {
    current: undefined,
    suspended: false,
    bindWindowSession(_windowId, selectedSession) {
      registry.current = { ...selectedSession };
      registry.suspended = false;
    },
    clearWindowSession() {
      registry.current = undefined;
      registry.suspended = false;
    },
    suspendWindow() {
      const previous = registry.current;
      registry.suspended = true;
      registry.current = undefined;
      return () => {
        registry.current = previous;
        registry.suspended = false;
      };
    },
  };
  return registry;
}

function desktopRequest(requestId, method, payload) {
  return {
    method,
    payload,
    protocolVersion: '1',
    requestId,
  };
}

function desktopSuccess(requestId, result) {
  return { ok: true, protocolVersion: '1', requestId, result };
}

function desktopFailure(requestId, code = 'DESKTOP_CORE_UNAVAILABLE') {
  return {
    ok: false,
    protocolVersion: '1',
    requestId,
    error: {
      code,
      message: 'The application core is unavailable.',
      retryable: code === 'DESKTOP_CORE_UNAVAILABLE',
    },
  };
}

function projectSummary() {
  return {
    accessMode: 'read-write',
    displayName: 'Synthetic',
    layoutVersion: 2,
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
  };
}

function progressEvent(
  sequence,
  projectId = PROJECT_ID,
  projectSessionId = PROJECT_SESSION_ID,
) {
  return {
    ...session(projectId, projectSessionId),
    eventId: uuid(100 + Math.max(sequence, 0)),
    eventType: 'novelImport.taskProgress',
    occurredAt: '2026-08-10T00:00:00.000Z',
    sequence,
    task: {
      attempt: 1,
      createdAt: '2026-08-10T00:00:00.000Z',
      executionStatus: 'running',
      recoveryStatus: 'retryable',
      startedAt: '2026-08-10T00:00:00.000Z',
      taskId: TASK_ID,
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
  };
}

function completedEvent(sequence) {
  return {
    ...progressEvent(sequence),
    baselineRevision: {
      artifactId: ARTIFACT_ID,
      artifactRevisionId: ARTIFACT_REVISION_ID,
      canonicalTextRevision: {
        byteLength: 20,
        contentHash: 'a'.repeat(64),
        textLayer: 'canonical',
        textRevisionId: TEXT_REVISION_ID,
      },
    },
    eventType: 'novelImport.taskCompleted',
    task: terminalTask('succeeded'),
  };
}

function failedEvent(sequence) {
  return {
    ...progressEvent(sequence),
    error: {
      code: 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE',
      contractVersion: '1',
      message: 'The novel import request could not be completed.',
      projectId: PROJECT_ID,
      projectSessionId: PROJECT_SESSION_ID,
      retryable: true,
      taskId: TASK_ID,
    },
    eventType: 'novelImport.taskFailed',
    task: terminalTask('failed'),
  };
}

function retryEvent(sequence) {
  return {
    ...progressEvent(sequence),
    eventType: 'novelImport.taskRetryScheduled',
    previousAttempt: 1,
    task: {
      attempt: 2,
      createdAt: '2026-08-10T00:00:00.000Z',
      executionStatus: 'pending',
      recoveryStatus: 'retryable',
      taskId: TASK_ID,
      updatedAt: '2026-08-10T00:00:01.000Z',
    },
  };
}

function terminalTask(executionStatus) {
  return {
    attempt: 1,
    createdAt: '2026-08-10T00:00:00.000Z',
    ...(executionStatus === 'failed'
      ? { errorCode: 'NOVEL_IMPORT_DEPENDENCY_UNAVAILABLE' }
      : { resultArtifactRevisionId: ARTIFACT_REVISION_ID }),
    executionStatus,
    finishedAt: '2026-08-10T00:00:02.000Z',
    recoveryStatus: executionStatus === 'failed' ? 'retryable' : 'none',
    startedAt: '2026-08-10T00:00:01.000Z',
    taskId: TASK_ID,
    updatedAt: '2026-08-10T00:00:02.000Z',
  };
}

function session(
  projectId = PROJECT_ID,
  projectSessionId = PROJECT_SESSION_ID,
) {
  return {
    contractVersion: '1',
    projectId,
    projectSessionId,
  };
}

function lifecycleSession() {
  return {
    projectId: PROJECT_ID,
    projectSessionId: PROJECT_SESSION_ID,
  };
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
