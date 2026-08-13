import type { DesktopApi, WorkspaceBootstrapDto } from '@voxweaver/contracts';

import { beforeEach, describe, expect, it, vi } from 'vitest';
import { createWorkspaceContext } from '@/workspace/context';

const bootstrap = {
  project: {
    projectId: '00000000-0000-4000-8000-000000000001',
    displayName: '测试项目',
    sourceFileName: 'novel.txt',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    layoutVersion: 2,
  },
  sourceAsset: {
    id: '00000000-0000-4000-8000-000000000002',
    originalName: 'novel.txt',
    relativePath: 'inputs/source-assets/id/novel.txt',
    byteLength: 12,
    sha256: 'a'.repeat(64),
  },
  stages: [],
  capabilities: {},
  recoverableTasks: [],
  recommendedPage: 'text-extraction',
  coreHealth: { status: 'healthy', canRestart: false, protocolVersion: 1 },
} as unknown as WorkspaceBootstrapDto;

beforeEach(() => {
  const getBootstrap = vi.fn<DesktopApi['project']['getBootstrap']>()
    .mockResolvedValue({ ok: true, value: bootstrap });
  const restartCore = vi.fn<DesktopApi['system']['restartCore']>()
    .mockResolvedValue({ ok: true, value: undefined });
  const getCoreHealth = vi.fn<DesktopApi['system']['getCoreHealth']>()
    .mockResolvedValue({ ok: true, value: bootstrap.coreHealth });

  Object.defineProperty(window, 'voxweaver', {
    configurable: true,
    value: {
      project: { getBootstrap },
      system: { getCoreHealth, restartCore },
    },
  });
});

describe('workspace context', () => {
  it('并发请求共享一次 bootstrap，并缓存成功结果', async () => {
    const context = createWorkspaceContext();
    const first = context.ensureBootstrap();
    const second = context.ensureBootstrap();

    await expect(first).resolves.toBe(bootstrap);
    await expect(second).resolves.toBe(bootstrap);
    await expect(context.ensureBootstrap()).resolves.toBe(bootstrap);
    expect(window.voxweaver.project.getBootstrap).toHaveBeenCalledTimes(1);
    expect(context.loadState.value).toBe('ready');
  });

  it('core 重启成功后强制刷新 bootstrap', async () => {
    const context = createWorkspaceContext();
    await context.ensureBootstrap();
    await expect(context.restartCore()).resolves.toBe(true);

    expect(window.voxweaver.system.restartCore).toHaveBeenCalledTimes(1);
    expect(window.voxweaver.project.getBootstrap).toHaveBeenCalledTimes(2);
  });

  it('bootstrap 返回 CORE_UNAVAILABLE 时读取可重启健康状态', async () => {
    vi.mocked(window.voxweaver.project.getBootstrap).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'CORE_UNAVAILABLE',
        message: 'Core 不可用。',
        retryable: true,
      },
    });
    vi.mocked(window.voxweaver.system.getCoreHealth).mockResolvedValueOnce({
      ok: true,
      value: { status: 'unavailable', canRestart: true, protocolVersion: 1 },
    });
    const context = createWorkspaceContext();

    await expect(context.ensureBootstrap()).resolves.toBeUndefined();
    expect(context.loadError.value?.code).toBe('CORE_UNAVAILABLE');
    expect(context.coreHealth.value).toEqual({
      status: 'unavailable',
      canRestart: true,
      protocolVersion: 1,
    });
  });
});
