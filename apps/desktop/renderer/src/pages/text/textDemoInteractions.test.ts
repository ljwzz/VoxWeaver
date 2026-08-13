import type { DesktopApi, ProjectSummary, WorkspaceBootstrapDto } from '@voxweaver/contracts';
import type { Component } from 'vue';

import { success, WORKSPACE_PAGE_KEYS } from '@voxweaver/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import { appPages } from '@/pages';
import WorkspaceAudioPage from '@/pages/workspace/WorkspaceAudioPage.vue';
import WorkspacePostPage from '@/pages/workspace/WorkspacePostPage.vue';
import WorkspaceRolePage from '@/pages/workspace/WorkspaceRolePage.vue';
import WorkspaceSettingsPage from '@/pages/workspace/WorkspaceSettingsPage.vue';
import WorkspaceTextPage from '@/pages/workspace/WorkspaceTextPage.vue';
import ChapterSplittingPage from './ChapterSplittingPage.vue';
import CharacterExtractionPage from './CharacterExtractionPage.vue';
import OverlayDownstreamStalePage from './OverlayDownstreamStalePage.vue';
import ProofreadingPage from './ProofreadingPage.vue';
import ScriptManagementPage from './ScriptManagementPage.vue';
import TextExtractionPage from './TextExtractionPage.vue';

vi.mock('@/demo/useDemoFeedback', () => ({
  showDemoFeedback: vi.fn(),
}));

const project: ProjectSummary = {
  createdAt: '2026-08-12T00:00:00.000Z',
  displayName: '雨夜来信',
  projectId: 'project-text-demo-test',
  sourceFileName: 'download-18472.txt',
  updatedAt: '2026-08-12T00:00:00.000Z',
  layoutVersion: 2,
};

const workspaceBootstrap: WorkspaceBootstrapDto = {
  project,
  sourceAsset: {
    id: 'b35c5b86-21de-4d85-9ad2-20cd6aa2e818',
    originalName: project.sourceFileName,
    relativePath: 'inputs/source-assets/b35c5b86-21de-4d85-9ad2-20cd6aa2e818/download-18472.txt',
    byteLength: 128,
    sha256: 'b'.repeat(64),
  },
  stages: [],
  capabilities: Object.fromEntries(WORKSPACE_PAGE_KEYS.map(pageKey => [pageKey, {
    available: false,
    reason: 'not-implemented',
    message: '后续实现。',
  }])) as WorkspaceBootstrapDto['capabilities'],
  recoverableTasks: [],
  recommendedPage: 'text-extraction',
  coreHealth: {
    status: 'healthy',
    canRestart: false,
    protocolVersion: 1,
  },
};

const testDemoComponents = [
  ['overall-text', WorkspaceTextPage],
  ['overall-role', WorkspaceRolePage],
  ['overall-audio', WorkspaceAudioPage],
  ['overall-post', WorkspacePostPage],
  ['overall-settings', WorkspaceSettingsPage],
  ['text-extraction', TextExtractionPage],
  ['chapter-splitting', ChapterSplittingPage],
  ['proofreading', ProofreadingPage],
  ['character-extraction', CharacterExtractionPage],
  ['script-management', ScriptManagementPage],
  ['text-downstream-stale-dialog', OverlayDownstreamStalePage],
] as const satisfies readonly (readonly [string, Component])[];

const demoComponentBySlug = new Map<string, Component>(testDemoComponents);
const demoRoutes = appPages.map(page => ({
  component: demoComponentBySlug.get(page.slug) ?? { template: '<main />' },
  meta: {
    isDemoPreview: true,
    pageGroup: page.group,
    pageKind: page.kind,
    pageSlug: page.slug,
    pageTitle: page.title,
  },
  name: getDemoPageRouteName(page.slug),
  path: page.path,
}));

function createApi(): DesktopApi {
  return {
    startup: {
      selectProjectDirectory: vi.fn(),
      selectSourceFile: vi.fn(),
      createProject: vi.fn(),
      openProjectFromDialog: vi.fn(),
      openRecentProject: vi.fn(),
      confirmProjectOpen: vi.fn(),
      listRecentProjects: vi.fn(async () => success([])),
      removeRecentProject: vi.fn(),
    },
    project: {
      getBootstrap: vi.fn(async () => success(workspaceBootstrap)),
      recordLastPage: vi.fn(async () => success(undefined)),
      close: vi.fn(async () => success(undefined)),
    },
    novelImport: {
      probe: vi.fn(),
      start: vi.fn(),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      retryTask: vi.fn(),
      getReviewSnapshot: vi.fn(),
      getTextSlice: vi.fn(),
      previewReview: vi.fn(),
      applyReview: vi.fn(),
      onEvent: vi.fn(() => () => {}),
    },
    system: {
      getCoreHealth: vi.fn(async () => success(workspaceBootstrap.coreHealth)),
      restartCore: vi.fn(async () => success(undefined)),
    },
  };
}

async function createTextRouter(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        component: WorkspaceTextPage,
        meta: { isDemoPreview: false, pageTitle: 'VoxWeaver · 项目工作台' },
        name: 'project',
        path: '/project',
      },
      ...demoRoutes,
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  return router;
}

async function mountRoute(initialPath: string) {
  const router = await createTextRouter(initialPath);
  const component = router.currentRoute.value.matched.at(-1)?.components?.default as Component;
  const wrapper = mount(component, {
    attachTo: document.body,
    global: {
      plugins: [router, ElementPlus],
    },
  });
  await flushPromises();
  return { router, wrapper };
}

function textButton(wrapper: Awaited<ReturnType<typeof mountRoute>>['wrapper'], text: string) {
  const button = wrapper.findAll('button').find(candidate => candidate.text().trim() === text);
  if (!button)
    throw new Error(`Missing button: ${text}`);
  return button;
}

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubGlobal('indexedDB', { open: vi.fn() });
  Object.defineProperty(window, 'localStorage', {
    configurable: true,
    value: {
      clear: vi.fn(),
      getItem: vi.fn(),
      key: vi.fn(),
      length: 0,
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
  });
  Object.defineProperty(window, 'sessionStorage', {
    configurable: true,
    value: {
      clear: vi.fn(),
      getItem: vi.fn(),
      key: vi.fn(),
      length: 0,
      removeItem: vi.fn(),
      setItem: vi.fn(),
    },
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  document.body.className = '';
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('text demo workspace and navigation', () => {
  it('预览入口不调用窗口上下文，正式 /project 保持真实上下文和禁用入口', async () => {
    const api = createApi();
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });

    const preview = await mountRoute('/pages/overall-text');
    expect(api.project.getBootstrap).not.toHaveBeenCalled();
    expect(preview.wrapper.text()).toContain('示例小说');
    expect(preview.wrapper.findAll('.demo-module-button')).toHaveLength(5);
    expect(preview.wrapper.findAll('.context-sidebar .demo-page-button')).toHaveLength(5);
    preview.wrapper.unmount();

    const production = await mountRoute('/project');
    await flushPromises();
    expect(api.project.getBootstrap).toHaveBeenCalledOnce();
    expect(production.wrapper.text()).toContain('雨夜来信');
    expect(production.wrapper.text()).toContain('download-18472.txt');
    expect(production.wrapper.text()).toContain('后续处理尚未实现');
    expect(production.wrapper.get('.project-ready-state > button').attributes('disabled')).toBeDefined();
    production.wrapper.unmount();
  });

  it('模块和五个文本侧栏按钮按公共导航切换路由', async () => {
    const { router, wrapper } = await mountRoute('/pages/text-extraction');
    const proofreadingButton = wrapper.findAll('.demo-page-button').find(button => button.text().includes('错别字与标点'));
    expect(proofreadingButton).toBeDefined();
    await proofreadingButton!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/pages/proofreading');

    const roleButton = wrapper.findAll('.demo-module-button').find(button => button.attributes('aria-label') === '角色管理');
    expect(roleButton).toBeDefined();
    await roleButton!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/pages/overall-role');
    wrapper.unmount();
  });

  it('正式与预览路由切换使用独立 PageDocument 生命周期且预览不读取 IPC', async () => {
    const api = createApi();
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTextRouter('/project');
    const host = mount({ template: '<RouterView />' }, {
      attachTo: document.body,
      global: { plugins: [router, ElementPlus] },
    });
    await flushPromises();
    expect(api.project.getBootstrap).toHaveBeenCalledOnce();

    await router.push('/pages/overall-text');
    await flushPromises();
    expect(api.project.getBootstrap).toHaveBeenCalledOnce();
    expect(host.text()).toContain('继续整理《示例小说》');
    expect(document.body.classList.contains('workspace-view--project')).toBe(false);
    expect(document.body.classList.contains('workspace-view--text')).toBe(true);
    expect(document.body.classList.contains('text-page')).toBe(true);

    await router.push('/project');
    await flushPromises();
    expect(api.project.getBootstrap).toHaveBeenCalledTimes(2);
    expect(host.text()).toContain('雨夜来信');
    expect(document.body.classList.contains('workspace-view--project')).toBe(true);
    expect(document.body.classList.contains('workspace-view--text')).toBe(false);
    expect(document.body.classList.contains('text-page')).toBe(false);
    host.unmount();
  });
});

describe('text demo local interactions', () => {
  it('查看警告打开包含现有两项警告的 Element Plus 弹窗', async () => {
    const { wrapper } = await mountRoute('/pages/text-extraction');
    await wrapper.get('[data-testid="view-extraction-warnings"]').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('文本提取警告');
    expect(document.body.querySelectorAll('.demo-warning-list li')).toHaveLength(2);
    wrapper.unmount();
  });

  it('提取重试状态只由用户操作按默认、处理中、失败、完成循环切换', async () => {
    const { wrapper } = await mountRoute('/pages/text-extraction');
    const retryButton = wrapper.get('[data-testid="retry-extraction-stage"]');
    for (const expected of ['失败', '完成', '默认', '处理中']) {
      await retryButton.trigger('click');
      expect(wrapper.get('.page-heading .status-badge').text()).toContain(expected);
    }
    wrapper.unmount();
  });

  it('章节结构存在问题时确认保持禁用，处理问题后才可确认', async () => {
    const { wrapper } = await mountRoute('/pages/chapter-splitting');
    const confirm = wrapper.get('[data-testid="confirm-chapter-structure"]');
    expect(confirm.attributes('disabled')).toBeDefined();
    await textButton(wrapper, '演示处理全部问题').trigger('click');
    expect(confirm.attributes('disabled')).toBeUndefined();
    wrapper.unmount();
  });

  it('校对接受和保留只更新当前问题状态与计数', async () => {
    const { wrapper } = await mountRoute('/pages/proofreading');
    await wrapper.get('[data-testid="accept-proofreading-suggestion"]').trigger('click');
    expect(wrapper.get('[data-testid="current-proofreading-issue"]').text()).toContain('已完成');
    expect(wrapper.text()).toContain('已处理 19');

    await wrapper.get('[data-testid="next-proofreading-issue"]').trigger('click');
    await wrapper.get('[data-testid="keep-proofreading-original"]').trigger('click');
    expect(wrapper.get('[data-testid="current-proofreading-issue"]').text()).toContain('已保留');
    expect(wrapper.text()).toContain('已处理 20');
    wrapper.unmount();
  });

  it('角色候选单项确认更新为已完成，证据不足项仍保持冲突', async () => {
    const { wrapper } = await mountRoute('/pages/character-extraction');
    await wrapper.get('[data-testid="confirm-character-footer"]').trigger('click');
    expect(wrapper.get('[data-testid="character-candidate-su-he"]').text()).toContain('已完成');

    await wrapper.get('[data-testid="character-candidate-su-he"]').trigger('click');
    await wrapper.get('[data-testid="character-candidate-a-man"]').trigger('click');
    await wrapper.get('[data-testid="confirm-character-footer"]').trigger('click');
    expect(wrapper.get('[data-testid="character-candidate-a-man"]').text()).toContain('失败');
    expect(wrapper.text()).toContain('含冲突或证据不足项，仍待复核');
    wrapper.unmount();
  });

  it('已引用段落拆分进入 Overlay，取消和确认都返回剧本管理', async () => {
    const first = await mountRoute('/pages/script-management');
    await first.wrapper.get('[data-testid="split-script-paragraph"]').trigger('click');
    await flushPromises();
    expect(first.router.currentRoute.value.path).toBe('/pages/text-downstream-stale-dialog');
    first.wrapper.unmount();

    const cancel = await mountRoute('/pages/text-downstream-stale-dialog');
    await cancel.wrapper.get('[data-testid="cancel-downstream-stale"]').trigger('click');
    await flushPromises();
    expect(cancel.router.currentRoute.value.path).toBe('/pages/script-management');
    cancel.wrapper.unmount();

    const confirm = await mountRoute('/pages/text-downstream-stale-dialog');
    await confirm.wrapper.get('[data-testid="confirm-downstream-stale"]').trigger('click');
    await flushPromises();
    expect(confirm.router.currentRoute.value.path).toBe('/pages/script-management');
    confirm.wrapper.unmount();
  });

  it('全部演示操作不调用 IPC、fetch 或浏览器存储', async () => {
    const api = createApi();
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });

    const extraction = await mountRoute('/pages/text-extraction');
    await extraction.wrapper.get('[data-testid="start-extraction"]').trigger('click');
    await extraction.wrapper.get('[data-testid="retry-extraction-stage"]').trigger('click');
    extraction.wrapper.unmount();

    const proofreading = await mountRoute('/pages/proofreading');
    await proofreading.wrapper.get('[data-testid="accept-proofreading-suggestion"]').trigger('click');
    proofreading.wrapper.unmount();

    const character = await mountRoute('/pages/character-extraction');
    await character.wrapper.get('[data-testid="confirm-character-footer"]').trigger('click');
    character.wrapper.unmount();

    const script = await mountRoute('/pages/script-management');
    await textButton(script.wrapper, '保存剧本版本').trigger('click');
    script.wrapper.unmount();

    expect(Object.values(api).every(value => !('mock' in value) || value.mock.calls.length === 0)).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(indexedDB.open).not.toHaveBeenCalled();
    expect(localStorage.getItem).not.toHaveBeenCalled();
    expect(localStorage.setItem).not.toHaveBeenCalled();
    expect(sessionStorage.getItem).not.toHaveBeenCalled();
    expect(sessionStorage.setItem).not.toHaveBeenCalled();
  });
});
