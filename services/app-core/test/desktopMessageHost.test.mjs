import assert from 'node:assert/strict';
import test from 'node:test';

import { DesktopMessageHost } from '../dist/index.js';

test('routes concurrent messages to a handler and sends each response', async () => {
  const connection = new FakeConnection();
  const host = new DesktopMessageHost(connection, async (message) => {
    await Promise.resolve();
    return { echoed: message };
  });
  host.start();

  connection.emit('first');
  connection.emit('second');
  await waitForMicrotasks();

  assert.deepEqual(connection.sent, [
    { echoed: 'first' },
    { echoed: 'second' },
  ]);
  host.stop();
  assert.equal(connection.listener, undefined);
});

test('isolates handler failures and does not send after stop', async () => {
  const connection = new FakeConnection();
  const errors = [];
  let resolvePending;
  const host = new DesktopMessageHost(
    connection,
    message => message === 'failure'
      ? Promise.reject(new Error('handler failed'))
      : new Promise((resolve) => {
          resolvePending = resolve;
        }),
    { onUnhandledError: error => errors.push(error) },
  );
  host.start();

  connection.emit('failure');
  connection.emit('pending');
  await waitForMicrotasks();
  host.stop();
  resolvePending?.('late response');
  await waitForMicrotasks();

  assert.equal(errors.length, 1);
  assert.match(errors[0].message, /handler failed/);
  assert.deepEqual(connection.sent, []);
});

class FakeConnection {
  listener;
  sent = [];

  receive = (listener) => {
    this.listener = listener;
    return () => {
      if (this.listener === listener)
        this.listener = undefined;
    };
  };

  send = message => this.sent.push(message);

  emit(message) {
    this.listener?.(message);
  }
}

async function waitForMicrotasks() {
  await new Promise(resolve => setImmediate(resolve));
}
