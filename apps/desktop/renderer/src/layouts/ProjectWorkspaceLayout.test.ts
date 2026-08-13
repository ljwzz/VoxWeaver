import type {
  DesktopApi,
  TaskSummaryDto,
  WorkspaceBootstrapDto,
} from '@voxweaver/contracts';

import { success, WORKSPACE_PAGE_KEYS } from '@voxweaver/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import ProjectWorkspaceLayout from '@/layouts/ProjectWorkspaceLayout.vue';
import layoutSource from '@/layouts/ProjectWorkspaceLayout.vue?raw';
import {
  getProjectPageRouteName,
  workspacePages,
} from '@/workspace/navigation';

const capabilities = Object.fromEntries(WORKSPACE_PAGE_KEYS.map(pageKey => [pageKey, {
  available: true,
  reason: 'available',
  message: '测试能力',
}])) as WorkspaceBootstrapDto['capabilities'];

const bootstrap: WorkspaceBootstrapDto = {
  project: {
    projectId: '00000000-0000-4000-8000-000000000001',
    displayName: '雨夜来信',
    sourceFileName: 'novel.txt',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T00:00:00.000Z',
    layoutVersion: 2,
  },
  sourceAsset: {
    id: '00000000-0000-4000-8000-000000000002',
    originalName: 'novel.txt',
    relativePath: 'inputs/source-assets/id/novel.txt',
    byteLength: 128,
    sha256: 'a'.repeat(64),
  },
  stages: [],
  capabilities,
  recoverableTasks: [],
  recommendedPage: 'text-extraction',
  coreHealth: {
    status: 'healthy',
    canRestart: false,
    protocolVersion: 1,
  },
};

const novelImportTask: TaskSummaryDto = {
  taskId: '00000000-0000-4000-8000-000000000003',
  taskType: 'novel-import',
  status: 'running',
  recoveryStatus: 'resumable',
  attempt: 1,
  progress: {
    completed: 35,
    total: 100,
    percent: 35,
    message: '校验项目源资产',
  },
  canCancel: true,
  canRetry: false,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:01.000Z',
  startedAt: '2026-08-13T00:00:01.000Z',
};

function createApi(bootstrapValue: WorkspaceBootstrapDto): DesktopApi {
  return {
    project: {
      getBootstrap: vi.fn(async () => success(bootstrapValue)),
      recordLastPage: vi.fn(async () => success(undefined)),
    },
    system: {
      getCoreHealth: vi.fn(async () => success(bootstrapValue.coreHealth)),
    },
  } as unknown as DesktopApi;
}

async function mountLayout(bootstrapValue: WorkspaceBootstrapDto = bootstrap) {
  const api = createApi(bootstrapValue);
  Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
  const router = createRouter({
    history: createMemoryHistory(),
    routes: workspacePages.map(page => ({
      component: { template: '<div />' },
      meta: {
        workspaceModuleKey: page.moduleKey,
        workspacePageKey: page.key,
      },
      name: getProjectPageRouteName(page.key),
      path: `/${page.key}`,
    })),
  });
  await router.push('/text-extraction');
  await router.isReady();

  const wrapper = mount(ProjectWorkspaceLayout, {
    global: {
      plugins: [router],
      stubs: {
        RouterView: { template: '<div />' },
      },
    },
  });
  await flushPromises();
  return { api, wrapper };
}

function styleRule(selector: string): string {
  const escapedSelector = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = layoutSource.match(new RegExp(`${escapedSelector}\\s*\\{([^}]*)\\}`));
  if (!match?.[1])
    throw new Error(`Missing style rule: ${selector}`);
  return match[1];
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
  document.title = '';
});

describe('project workspace locked chrome contract', () => {
  it('标题栏只显示项目标题，四个主模块与设置分组固定', async () => {
    const { wrapper } = await mountLayout();

    const titlebar = wrapper.get('.project-window-titlebar');
    expect(titlebar.element.children).toHaveLength(1);
    expect(titlebar.text()).toBe('VoxWeaver · 雨夜来信');
    expect(document.title).toBe('VoxWeaver · 雨夜来信');
    expect(wrapper.text()).not.toContain('关闭项目');

    expect(wrapper.get('.project-primary-modules').findAll('.project-activity-link').map(link => link.text()))
      .toEqual(['文本', '角色', '音频', '后期']);
    const settingsGroup = wrapper.get('.project-settings-entry');
    expect(settingsGroup.element.tagName).toBe('DIV');
    expect(settingsGroup.get('.project-activity-link').text()).toBe('设置');
    wrapper.unmount();
  });

  it('全局状态栏横跨工作台底部并移除设置旁状态入口', async () => {
    const { wrapper } = await mountLayout();

    const rootChildren = Array.from(wrapper.get('.project-workspace-layout').element.children)
      .map(element => element.className);
    expect(rootChildren).toEqual([
      'project-window-titlebar',
      'project-workspace-body',
      'workspace-status-bar',
    ]);
    expect(wrapper.get('[data-region="application"]').text()).toBe('Core: 正常');
    expect(wrapper.get('[data-region="project"]').text()).toBe('');
    expect(wrapper.find('.project-settings-status').exists()).toBe(false);
    expect(wrapper.find('.project-runtime-status-light').exists()).toBe(false);
    expect(wrapper.find('.project-runtime-status-card').exists()).toBe(false);
    expect(wrapper.find('.project-popover-stub').exists()).toBe(false);
    wrapper.unmount();
  });

  it('将全局任务从侧栏迁入状态栏右侧', async () => {
    const { wrapper } = await mountLayout({
      ...bootstrap,
      currentTask: novelImportTask,
    });

    expect(wrapper.find('.project-task-card').exists()).toBe(false);
    const projectStatus = wrapper.get('[data-region="project"]');
    expect(projectStatus.text()).toBe('小说导入: 校验项目源资产 · 35%');
    expect(projectStatus.get('[data-status-key^="project-task:"]').element.tagName).toBe('SPAN');
    wrapper.unmount();
  });

  it('锁定主导航分组布局', () => {
    const railRule = styleRule('.project-activity-rail');
    expect(railRule).toMatch(/display:\s*flex;/);
    expect(railRule).toMatch(/justify-content:\s*space-between;/);
  });
});
