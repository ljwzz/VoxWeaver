/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import test from 'node:test';

import { startCoreRuntime } from '../.generated/core/coreRuntime.js';
import { CoreProcessManager } from '../.generated/main/coreProcessManager.js';
import {
  CORE_EVENT_MESSAGE_TYPE,
  createCoreWireEvent,
  createCoreWireResponse,
} from '../.generated/shared/coreTransport.js';

test('Core runtime registers and exactly unregisters its private event source', async () => {
  const { mainPort, corePort } = createPortPair();
  const received = [];
  let listener;
  let releases = 0;
  mainPort.addEventListener('message', event => received.push(event.data));
  const runtime = startCoreRuntime({
    dispatcher: {
      async dispatch() { return undefined; },
      subscribe(nextListener) {
        listener = nextListener;
        return () => {
          if (listener === nextListener)
            listener = undefined;
          releases += 1;
        };
      },
    },
    port: corePort,
    userDataDirectory: '/private/voxweaver-user-data',
  });

  listener(progressEvent(1));
  await waitFor(() => received.length === 1);
  assert.equal(received[0].type, CORE_EVENT_MESSAGE_TYPE);
  assert.deepEqual(received[0], createCoreWireEvent(progressEvent(1)));

  runtime.stop();
  assert.equal(releases, 1);
  assert.equal(listener, undefined);
});

test('CoreProcessManager ignores unknown and obsolete-generation events and unregisters listeners', async () => {
  const launcher = new FakeCoreLauncher(({ port, child }) => {
    child.corePort = port;
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
    requestTimeoutMs: 80,
    userDataDirectory: '/private/voxweaver-user-data',
  });
  const received = [];
  manager.subscribeEvents(() => {
    throw new Error('isolated observer');
  });
  manager.subscribeEvents(event => received.push(event));
  let releasedCalls = 0;
  const unsubscribe = manager.subscribeEvents(() => {
    releasedCalls += 1;
  });
  unsubscribe();

  await manager.start();
  launcher.children[0].corePort.postMessage({ type: 'unknown', event: progressEvent(1) });
  launcher.children[0].corePort.postMessage(createCoreWireEvent(progressEvent(1)));
  await waitFor(() => received.length === 1);
  assert.deepEqual(received, [progressEvent(1)]);
  assert.equal(releasedCalls, 0);

  launcher.children[0].corePort.postMessage(createCoreWireEvent(progressEvent(2)));
  await waitFor(() => received.length === 2);

  launcher.children[0].exit(1);
  await manager.restartOnce();
  launcher.children[0].corePort.postMessage(createCoreWireEvent(progressEvent(3)));
  await nextTurn();
  assert.equal(received.length, 2);
  launcher.children[1].corePort.postMessage(createCoreWireEvent(progressEvent(1)));
  await waitFor(() => received.length === 3);
});

function healthyResponse(requestId) {
  return {
    ok: true,
    protocolVersion: '1',
    requestId,
    result: { healthy: true },
  };
}

function progressEvent(sequence) {
  return {
    contractVersion: '1',
    eventId: uuid(100 + sequence),
    eventType: 'novelImport.taskProgress',
    occurredAt: '2026-08-10T00:00:00.000Z',
    projectId: uuid(1),
    projectSessionId: uuid(2),
    sequence,
    task: {
      attempt: 1,
      createdAt: '2026-08-10T00:00:00.000Z',
      executionStatus: 'running',
      recoveryStatus: 'retryable',
      startedAt: '2026-08-10T00:00:00.000Z',
      taskId: uuid(3),
      updatedAt: '2026-08-10T00:00:00.000Z',
    },
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
    this.onInit({ child: this, message, port: transfer?.[0] });
  }

  exit(exitCode) {
    for (const listener of this.exitListeners)
      listener(exitCode);
  }
}

class FakePort {
  listeners = new Map();

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

async function nextTurn() {
  await new Promise(resolve => setTimeout(resolve, 5));
}

async function waitFor(predicate) {
  for (let attempt = 0; attempt < 40; attempt += 1) {
    if (predicate())
      return;
    await nextTurn();
  }
  throw new Error('Timed out waiting for the expected event.');
}

function uuid(value) {
  return `00000000-0000-4000-8000-${String(value).padStart(12, '0')}`;
}
