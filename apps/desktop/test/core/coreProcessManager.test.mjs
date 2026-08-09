/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import test from 'node:test';

import { startCoreRuntime } from '../.generated/core/coreRuntime.js';
import { verifyCoreRuntimeCapabilities } from '../.generated/core/runtimeCapabilityCheck.js';
import {
  CoreProcessManager,
  CoreProcessManagerError,
} from '../.generated/main/coreProcessManager.js';
import {
  CORE_INIT_MESSAGE_TYPE,
  CORE_REQUEST_MESSAGE_TYPE,
  createCoreWireRequest,
  createCoreWireResponse,
} from '../.generated/shared/coreTransport.js';

test('starts through a private port, health-checks Core, and forwards trusted context', async () => {
  const received = [];
  const launcher = new FakeCoreLauncher(({ message, port }) => {
    assert.equal(message.type, CORE_INIT_MESSAGE_TYPE);
    port.addEventListener('message', (event) => {
      const request = event.data;
      received.push(request);
      if (request.request.method === 'app.getHealth') {
        port.postMessage(createCoreWireResponse(
          request.messageId,
          healthyResponse(request.request.requestId),
        ));
        return;
      }
      port.postMessage(createCoreWireResponse(request.messageId, {
        ok: true,
        protocolVersion: '1',
        requestId: request.request.requestId,
        result: { healthy: true },
      }));
    });
  });
  const manager = new CoreProcessManager({
    healthTimeoutMs: 80,
    launcher,
    requestTimeoutMs: 80,
    userDataDirectory: '/private/voxweaver-user-data',
  });
  const statuses = [];
  manager.subscribe(change => statuses.push(change));

  await manager.start();
  const result = await manager.request({
    method: 'project.open',
    payload: { selectionToken: 'open-token' },
    protocolVersion: '1',
    requestId: 'renderer-request',
  }, {
    projectDirectory: '/private/voxweaver/project',
    selectionPurpose: 'open-project',
    selectionToken: 'open-token',
  });

  assert.deepEqual(statuses, [
    { canRestart: false, status: 'stopped' },
    { canRestart: false, status: 'starting' },
    { canRestart: false, status: 'ready' },
  ]);
  assert.equal(launcher.children.length, 1);
  assert.equal(launcher.children[0].initMessage.userDataDirectory, '/private/voxweaver-user-data');
  assert.equal(received[0].type, CORE_REQUEST_MESSAGE_TYPE);
  assert.equal(received[0].request.method, 'app.getHealth');
  assert.equal(received[1].trustedContext.projectDirectory, '/private/voxweaver/project');
  assert.equal(JSON.stringify(result).includes('/private/voxweaver/project'), false);
});

test('rejects pending work on a Core crash and permits one explicit restart only', async () => {
  const receivedByChild = [];
  const launcher = new FakeCoreLauncher(({ port, child }) => {
    port.addEventListener('message', (event) => {
      const request = event.data;
      receivedByChild.push({ child, request });
      if (request.request.method === 'app.getHealth') {
        port.postMessage(createCoreWireResponse(
          request.messageId,
          healthyResponse(request.request.requestId),
        ));
      }
    });
  });
  const manager = new CoreProcessManager({
    healthTimeoutMs: 80,
    launcher,
    requestTimeoutMs: 80,
    userDataDirectory: '/private/voxweaver-user-data',
  });

  await manager.start();
  assert.equal(manager.canRestart, false);
  const pending = manager.request({
    method: 'project.getSummary',
    payload: {},
    protocolVersion: '1',
    requestId: 'pending-request',
  });
  launcher.children[0].exit(1);

  await assert.rejects(
    pending,
    error => error instanceof CoreProcessManagerError
      && error.code === 'DESKTOP_CORE_UNAVAILABLE',
  );
  assert.equal(manager.status, 'unavailable');
  assert.equal(manager.canRestart, true);
  assert.equal(launcher.children.length, 1);

  await manager.restartOnce();
  assert.equal(manager.status, 'ready');
  assert.equal(manager.canRestart, false);
  assert.equal(launcher.children.length, 2);
  assert.deepEqual(
    receivedByChild
      .filter(({ child }) => child === launcher.children[1])
      .map(({ request }) => request.request.method),
    ['app.getHealth'],
  );
  await assert.rejects(
    manager.restartOnce(),
    error => error instanceof CoreProcessManagerError
      && error.code === 'DESKTOP_CORE_UNAVAILABLE',
  );
});

test('enforces a bounded Core request timeout without retrying', async () => {
  const launcher = new FakeCoreLauncher(({ port }) => {
    port.addEventListener('message', (event) => {
      const request = event.data;
      if (request.request.method === 'app.getHealth') {
        port.postMessage(createCoreWireResponse(
          request.messageId,
          healthyResponse(request.request.requestId),
        ));
      }
    });
  });
  const manager = new CoreProcessManager({
    healthTimeoutMs: 80,
    launcher,
    requestTimeoutMs: 20,
    userDataDirectory: '/private/voxweaver-user-data',
  });

  await manager.start();
  await assert.rejects(
    manager.request({
      method: 'project.listRecent',
      payload: {},
      protocolVersion: '1',
      requestId: 'timed-out-request',
    }),
    error => error instanceof CoreProcessManagerError
      && error.code === 'DESKTOP_CORE_TIMEOUT',
  );
  assert.equal(launcher.children.length, 1);
  assert.equal(manager.status, 'ready');
});

test('rejects a health response with a mismatched desktop request ID', async () => {
  const launcher = new FakeCoreLauncher(({ port }) => {
    port.addEventListener('message', (event) => {
      const request = event.data;
      port.postMessage(createCoreWireResponse(request.messageId, {
        ok: true,
        protocolVersion: '1',
        requestId: 'another-request',
        result: { healthy: true },
      }));
    });
  });
  const manager = new CoreProcessManager({
    healthTimeoutMs: 80,
    launcher,
    userDataDirectory: '/private/voxweaver-user-data',
  });

  await assert.rejects(
    manager.start(),
    error => error instanceof CoreProcessManagerError
      && error.code === 'DESKTOP_CORE_UNAVAILABLE',
  );
  assert.equal(manager.status, 'unavailable');
});

test('Core runtime dispatches private requests through DesktopMessageHost', async () => {
  const { mainPort, corePort } = createPortPair();
  const requests = [];
  const responses = [];
  mainPort.addEventListener('message', event => responses.push(event.data));
  const runtime = startCoreRuntime({
    dispatcher: {
      async dispatch(request, trustedContext) {
        requests.push({ request, trustedContext });
        return {
          ok: true,
          protocolVersion: '1',
          requestId: request.requestId,
          result: { healthy: true },
        };
      },
    },
    port: corePort,
    userDataDirectory: '/private/voxweaver-user-data',
  });

  mainPort.postMessage(createCoreWireRequest('runtime-request', {
    method: 'app.getHealth',
    payload: {},
    protocolVersion: '1',
    requestId: 'runtime-desktop-request',
  }, {
    projectDirectory: '/private/voxweaver/project',
    selectionPurpose: 'open-project',
    selectionToken: 'private-token',
  }));
  await waitFor(() => responses.length === 1);

  assert.equal(requests.length, 1);
  assert.equal(requests[0].trustedContext.projectDirectory, '/private/voxweaver/project');
  assert.deepEqual(responses[0], createCoreWireResponse('runtime-request', {
    ok: true,
    protocolVersion: '1',
    requestId: 'runtime-desktop-request',
    result: { healthy: true },
  }));
  runtime.stop();
});

test('validates the Node 24.18 SQLite capabilities required by packaged Core', async () => {
  const directory = await mkdtemp('/private/tmp/voxweaver-core-capability-');
  try {
    await verifyCoreRuntimeCapabilities(directory);
  } finally {
    await rm(directory, { force: true, recursive: true });
  }
});

function healthyResponse(requestId) {
  return {
    ok: true,
    protocolVersion: '1',
    requestId,
    result: { healthy: true },
  };
}

class FakeCoreLauncher {
  children = [];

  constructor(onInit) {
    this.onInit = onInit;
  }

  createMessageChannel() {
    const { mainPort, corePort } = createPortPair();
    return { port1: mainPort, port2: corePort };
  }

  fork() {
    const child = new FakeCoreChild(this.onInit);
    this.children.push(child);
    return child;
  }
}

class FakeCoreChild {
  exitListeners = new Set();
  initMessage;
  killed = false;

  constructor(onInit) {
    this.onInit = onInit;
  }

  kill() {
    this.killed = true;
    return true;
  }

  off(event, listener) {
    if (event === 'exit')
      this.exitListeners.delete(listener);
  }

  on(event, listener) {
    if (event === 'exit')
      this.exitListeners.add(listener);
  }

  postMessage(message, transfer) {
    this.initMessage = message;
    this.onInit({ child: this, message, port: transfer?.[0] });
  }

  exit(exitCode) {
    for (const listener of this.exitListeners)
      listener(exitCode);
  }
}

class FakePort {
  listeners = new Map();
  peer;

  addEventListener(type, listener) {
    const listeners = this.listeners.get(type) ?? new Set();
    listeners.add(listener);
    this.listeners.set(type, listeners);
  }

  close() {
    this.#dispatch('close', { data: undefined });
  }

  postMessage(message) {
    queueMicrotask(() => this.peer.#dispatch('message', { data: message }));
  }

  removeEventListener(type, listener) {
    this.listeners.get(type)?.delete(listener);
  }

  #dispatch(type, event) {
    for (const listener of this.listeners.get(type) ?? [])
      listener(event);
  }
}

function createPortPair() {
  const mainPort = new FakePort();
  const corePort = new FakePort();
  mainPort.peer = corePort;
  corePort.peer = mainPort;
  return { corePort, mainPort };
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate())
      return;
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  throw new Error('Timed out waiting for the expected port response.');
}
