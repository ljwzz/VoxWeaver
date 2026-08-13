// @vitest-environment node

import type {
  CoreProcessExitListener,
  CoreProcessHandle,
  CoreProcessMessageListener,
} from '../shared/coreTransport.ts';

import {
  CORE_METHODS,
  CORE_PROTOCOL_VERSION,
} from '@voxweaver/contracts';
import { describe, expect, it } from 'vitest';
import {
  createCoreSuccessResponse,
} from '../shared/coreTransport.ts';
import {
  CoreProcessManager,
} from './coreProcessManager.ts';

const HEALTHY_RESULT = {
  status: 'healthy',
  canRestart: false,
  protocolVersion: CORE_PROTOCOL_VERSION,
} as const;

describe('coreProcessManager', () => {
  it('使用 numeric protocol 1 完成健康检查并关联请求响应', async () => {
    const launcher = new FakeCoreLauncher((child, message) => {
      if (message.method === CORE_METHODS.getHealth) {
        child.respond(createCoreSuccessResponse(message.requestId, HEALTHY_RESULT));
        return;
      }

      child.respond(createCoreSuccessResponse(message.requestId, { projects: [] }));
    });
    const statuses: unknown[] = [];
    const manager = createManager(launcher);
    manager.subscribeStatus(change => statuses.push(change));

    await manager.start();
    const response = await manager.request({
      method: CORE_METHODS.listRecentProjects,
      payload: {},
      trustedContext: startupContext(7),
    });

    expect(response).toEqual(createCoreSuccessResponse('request-2', { projects: [] }));
    expect(launcher.children).toHaveLength(1);
    expect(launcher.children[0]?.messages).toEqual([
      {
        protocolVersion: 1,
        requestId: 'request-1',
        method: CORE_METHODS.getHealth,
        trustedContext: startupContext(0),
        payload: {},
      },
      {
        protocolVersion: 1,
        requestId: 'request-2',
        method: CORE_METHODS.listRecentProjects,
        trustedContext: startupContext(7),
        payload: {},
      },
    ]);
    expect(statuses).toEqual([
      { canRestart: false, status: 'stopped' },
      { canRestart: false, status: 'starting' },
      { canRestart: false, status: 'ready' },
    ]);
  });

  it('健康检查超时后终止子进程并进入 unavailable', async () => {
    const launcher = new FakeCoreLauncher(() => {});
    const manager = createManager(launcher, { healthTimeoutMs: 15 });
    const statuses: unknown[] = [];
    manager.subscribeStatus(change => statuses.push(change));

    await expect(manager.start()).rejects.toMatchObject({ code: 'CORE_TIMEOUT' });

    expect(manager.status).toBe('unavailable');
    expect(manager.canRestart).toBe(true);
    expect(launcher.children[0]?.killed).toBe(true);
    expect(statuses.at(-1)).toEqual({ canRestart: true, status: 'unavailable' });
  });

  it('普通请求独立超时且不会自动重启健康进程', async () => {
    const launcher = healthOnlyLauncher();
    const manager = createManager(launcher, { requestTimeoutMs: 15 });
    await manager.start();

    await expect(manager.request({
      method: CORE_METHODS.listRecentProjects,
      payload: {},
      trustedContext: startupContext(3),
    })).rejects.toMatchObject({ code: 'CORE_TIMEOUT' });

    expect(manager.status).toBe('ready');
    expect(launcher.children).toHaveLength(1);
  });

  it('只转发通过 contracts 校验的 Core event', async () => {
    const launcher = healthOnlyLauncher();
    const manager = createManager(launcher);
    const events: unknown[] = [];
    manager.subscribeEvents(event => events.push(event));
    await manager.start();

    launcher.children[0]?.respond({
      protocolVersion: '1',
      eventId: 'invalid-event',
      eventType: 'novelImport.progress',
      occurredAt: '2026-08-13T08:00:00.000Z',
      projectId: 'project-1',
      projectSessionId: 'session-1',
      payload: { percent: 10 },
    });
    launcher.children[0]?.respond({
      protocolVersion: CORE_PROTOCOL_VERSION,
      eventId: 'valid-event',
      eventType: 'novelImport.progress',
      occurredAt: '2026-08-13T08:00:01.000Z',
      projectId: 'project-1',
      projectSessionId: 'session-1',
      payload: { percent: 20 },
    });
    await Promise.resolve();

    expect(events).toEqual([{
      protocolVersion: 1,
      eventId: 'valid-event',
      eventType: 'novelImport.progress',
      occurredAt: '2026-08-13T08:00:01.000Z',
      projectId: 'project-1',
      projectSessionId: 'session-1',
      payload: { percent: 20 },
    }]);
  });

  it('core 崩溃清理 pending，并发重启只创建一个进程且最多使用一次', async () => {
    const launcher = healthOnlyLauncher();
    const manager = createManager(launcher);
    await manager.start();

    const pending = manager.request({
      method: CORE_METHODS.listRecentProjects,
      payload: {},
      trustedContext: startupContext(4),
    });
    launcher.children[0]?.exit(1);

    await expect(pending).rejects.toMatchObject({ code: 'CORE_UNAVAILABLE' });
    expect(manager.status).toBe('unavailable');
    expect(manager.canRestart).toBe(true);

    await Promise.all([manager.restartOnce(), manager.restartOnce()]);
    expect(launcher.children).toHaveLength(2);
    expect(manager.status).toBe('ready');

    launcher.children[1]?.exit(1);
    await expect(manager.restartOnce()).rejects.toMatchObject({
      code: 'CORE_UNAVAILABLE',
      message: expect.stringContaining('limit'),
    });
    expect(launcher.children).toHaveLength(2);
  });

  it('畸形 response 拒绝对应 pending 并立即清理 timeout', async () => {
    const launcher = new FakeCoreLauncher((child, message) => {
      if (message.method === CORE_METHODS.getHealth) {
        child.respond(createCoreSuccessResponse(message.requestId, HEALTHY_RESULT));
        return;
      }

      child.respond({
        protocolVersion: '1',
        requestId: message.requestId,
        ok: true,
        result: {},
      });
    });
    const manager = createManager(launcher, { requestTimeoutMs: 200 });
    await manager.start();

    await expect(manager.request({
      method: CORE_METHODS.listRecentProjects,
      payload: {},
      trustedContext: startupContext(5),
    })).rejects.toEqual(expect.objectContaining({
      code: 'CORE_PROTOCOL_MISMATCH',
    }));
    expect(manager.status).toBe('ready');
  });

  it('stop 会拒绝并清空全部 pending', async () => {
    const launcher = healthOnlyLauncher();
    const manager = createManager(launcher);
    await manager.start();
    const first = manager.request({
      method: CORE_METHODS.listRecentProjects,
      payload: {},
      trustedContext: startupContext(6),
    });
    const second = manager.request({
      method: CORE_METHODS.removeRecentProject,
      payload: { projectId: 'project-1' },
      trustedContext: startupContext(6),
    });

    manager.stop();

    await expect(first).rejects.toMatchObject({ code: 'CORE_UNAVAILABLE' });
    await expect(second).rejects.toMatchObject({ code: 'CORE_UNAVAILABLE' });
    expect(manager.status).toBe('stopped');
    expect(launcher.children[0]?.killed).toBe(true);
  });
});

interface ManagerOverrides {
  readonly healthTimeoutMs?: number;
  readonly requestTimeoutMs?: number;
}

function createManager(
  launcher: FakeCoreLauncher,
  overrides: ManagerOverrides = {},
): CoreProcessManager {
  let nextRequestId = 0;
  return new CoreProcessManager({
    appInstanceId: 'app-instance-1',
    createRequestId: () => `request-${++nextRequestId}`,
    healthTimeoutMs: overrides.healthTimeoutMs ?? 100,
    launcher,
    requestTimeoutMs: overrides.requestTimeoutMs ?? 100,
  });
}

function healthOnlyLauncher(): FakeCoreLauncher {
  return new FakeCoreLauncher((child, message) => {
    if (message.method === CORE_METHODS.getHealth)
      child.respond(createCoreSuccessResponse(message.requestId, HEALTHY_RESULT));
  });
}

function startupContext(webContentsId: number) {
  return {
    appInstanceId: 'app-instance-1',
    webContentsId,
    windowKind: 'startup' as const,
  };
}

interface PostedRequest {
  readonly method: string;
  readonly requestId: string;
}

class FakeCoreLauncher {
  readonly children: FakeCoreProcess[] = [];

  constructor(
    private readonly onPostMessage: (
      child: FakeCoreProcess,
      message: PostedRequest,
    ) => void,
  ) {}

  fork = (): FakeCoreProcess => {
    const child = new FakeCoreProcess(this.onPostMessage);
    this.children.push(child);
    return child;
  };
}

class FakeCoreProcess implements CoreProcessHandle {
  readonly messages: PostedRequest[] = [];
  readonly #exitListeners = new Set<CoreProcessExitListener>();
  readonly #messageListeners = new Set<CoreProcessMessageListener>();

  killed = false;

  constructor(
    private readonly onPostMessage: (
      child: FakeCoreProcess,
      message: PostedRequest,
    ) => void,
  ) {}

  readonly kill = (): boolean => {
    this.killed = true;
    return true;
  };

  readonly off = (
    event: 'exit' | 'message',
    listener: CoreProcessExitListener | CoreProcessMessageListener,
  ): void => {
    if (event === 'exit')
      this.#exitListeners.delete(listener as CoreProcessExitListener);
    else
      this.#messageListeners.delete(listener as CoreProcessMessageListener);
  };

  readonly on = (
    event: 'exit' | 'message',
    listener: CoreProcessExitListener | CoreProcessMessageListener,
  ): void => {
    if (event === 'exit')
      this.#exitListeners.add(listener as CoreProcessExitListener);
    else
      this.#messageListeners.add(listener as CoreProcessMessageListener);
  };

  readonly postMessage = (message: unknown): void => {
    const request = message as PostedRequest;
    this.messages.push(request);
    this.onPostMessage(this, request);
  };

  exit(exitCode: number): void {
    for (const listener of this.#exitListeners)
      listener(exitCode);
  }

  respond(message: unknown): void {
    queueMicrotask(() => {
      for (const listener of this.#messageListeners)
        listener(message);
    });
  }
}
