import type {
  DesktopApi,
  ProjectOpenOutcomeDto,
  ProjectSummary,
  RecentProjectSummary,
  WorkspaceBootstrapDto,
} from '@voxweaver/contracts';

import { failure, success, WORKSPACE_PAGE_KEYS } from '@voxweaver/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import NewProjectPage from './startup/NewProjectPage.vue';
import StartupHomePage from './startup/StartupHomePage.vue';
import WorkspaceTextPage from './workspace/WorkspaceTextPage.vue';

const project: ProjectSummary = {
  projectId: '43f7ced7-98dd-44c1-9b3b-204510d9910d',
  displayName: '雨夜来信',
  sourceFileName: 'download-18472.txt',
  createdAt: '2026-08-12T08:00:00.000Z',
  updatedAt: '2026-08-12T08:00:00.000Z',
  layoutVersion: 2,
};

const recentProject: RecentProjectSummary = {
  ...project,
  directoryPath: '/Users/example/Documents/very/long/path/that/needs/to/be/truncated/project',
  lastOpenedAt: '2026-08-12T09:00:00.000Z',
  availability: 'available',
};

const secondRecentProject: RecentProjectSummary = {
  projectId: '1e4048d4-1dff-4e5c-8ac8-278d883f22ac',
  displayName: '星海旧梦',
  sourceFileName: 'novel.txt',
  createdAt: '2026-08-11T08:00:00.000Z',
  updatedAt: '2026-08-11T08:00:00.000Z',
  layoutVersion: 2,
  directoryPath: '/Users/example/Documents/star-sea',
  lastOpenedAt: '2026-08-11T09:00:00.000Z',
  availability: 'available',
};

const thirdRecentProject: RecentProjectSummary = {
  projectId: 'c34b4ac5-f7a5-4764-a567-59425e81c4f8',
  displayName: '山城回声',
  sourceFileName: 'echo.txt',
  createdAt: '2026-08-10T08:00:00.000Z',
  updatedAt: '2026-08-10T08:00:00.000Z',
  layoutVersion: 2,
  directoryPath: '/Users/example/Documents/mountain-echo',
  lastOpenedAt: '2026-08-10T09:00:00.000Z',
  availability: 'available',
};

function createDeferred<T>() {
  let resolve!: (value: T | PromiseLike<T>) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });

  return { promise, resolve };
}

function elementRect(top: number, height: number): DOMRect {
  return {
    bottom: top + height,
    height,
    left: 0,
    right: 560,
    top,
    width: 560,
    x: 0,
    y: top,
    toJSON: () => ({}),
  };
}

const workspaceBootstrap: WorkspaceBootstrapDto = {
  project,
  sourceAsset: {
    id: '65f39bbd-dc44-45d5-8cf4-f58bd7af4373',
    originalName: project.sourceFileName,
    relativePath: 'inputs/source-assets/65f39bbd-dc44-45d5-8cf4-f58bd7af4373/download-18472.txt',
    byteLength: 128,
    sha256: 'a'.repeat(64),
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

interface ApiOverrides {
  readonly startup?: Partial<DesktopApi['startup']>;
  readonly project?: Partial<DesktopApi['project']>;
}

function createApi(overrides: ApiOverrides = {}): DesktopApi {
  return {
    startup: {
      selectProjectDirectory: vi.fn(async () => success(null)),
      selectSourceFile: vi.fn(async () => success(null)),
      createProject: vi.fn(async () => success(project)),
      openProjectFromDialog: vi.fn(async () => success({ kind: 'cancelled' as const })),
      listRecentProjects: vi.fn(async () => success([])),
      openRecentProject: vi.fn(async () => success({ kind: 'opened' as const, project })),
      confirmProjectOpen: vi.fn(async () => success({ kind: 'opened' as const, project })),
      removeRecentProject: vi.fn(async () => success(undefined)),
      ...overrides.startup,
    },
    project: {
      getBootstrap: vi.fn(async () => success(workspaceBootstrap)),
      recordLastPage: vi.fn(async () => success(undefined)),
      close: vi.fn(async () => success(undefined)),
      ...overrides.project,
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

async function createTestRouter(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/startup', component: StartupHomePage },
      { path: '/new-project', component: NewProjectPage },
      { path: '/project', component: WorkspaceTextPage },
    ],
  });
  await router.push(initialPath);
  await router.isReady();
  return router;
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find(candidate => candidate.text().includes(text));
  if (!button)
    throw new Error(`Missing button: ${text}`);
  return button;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll('style[data-page-style]').forEach(element => element.remove());
  document.body.innerHTML = '';
  document.body.className = '';
});

describe('new project page', () => {
  it('三个输入全部有效后才能创建，并提交显式项目名称', async () => {
    const api = createApi({ startup: {
      selectProjectDirectory: vi.fn(async () => success({
        selectionId: 'directory-token',
        name: 'empty-project',
        displayPath: '/projects/empty-project',
      })),
      selectSourceFile: vi.fn(async () => success({
        selectionId: 'source-token',
        name: 'download-18472.txt',
        displayPath: '/downloads/download-18472.txt',
      })),
    } });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTestRouter('/new-project');
    const wrapper = mount(NewProjectPage, { global: { plugins: [router] } });

    expect(wrapper.text()).toContain('当前仅支持 .txt');
    const createButton = buttonByText(wrapper, '创建并打开项目');
    expect(createButton.attributes('disabled')).toBeDefined();
    await wrapper.get('#project-name').setValue('  雨夜来信  ');
    await buttonByText(wrapper, '选择目录').trigger('click');
    await flushPromises();
    await buttonByText(wrapper, '选择文件').trigger('click');
    await flushPromises();
    expect(createButton.attributes('disabled')).toBeUndefined();

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(api.startup.createProject).toHaveBeenCalledWith({
      displayName: '雨夜来信',
      directorySelectionId: 'directory-token',
      sourceSelectionId: 'source-token',
    });
    expect(router.currentRoute.value.path).toBe('/startup');
    wrapper.unmount();
  });

  it('创建失败后保留三个输入并允许重试', async () => {
    const createProject = vi.fn<DesktopApi['startup']['createProject']>()
      .mockResolvedValueOnce(failure<ProjectSummary>({
        code: 'PROJECT_DIRECTORY_NOT_EMPTY',
        message: '项目目录不是空目录。',
        retryable: true,
      }))
      .mockResolvedValueOnce(success(project));
    const api = createApi({ startup: {
      createProject,
      selectProjectDirectory: vi.fn(async () => success({
        selectionId: 'directory-token',
        name: 'empty-project',
        displayPath: '/projects/empty-project',
      })),
      selectSourceFile: vi.fn(async () => success({
        selectionId: 'source-token',
        name: 'download-18472.txt',
        displayPath: '/downloads/download-18472.txt',
      })),
    } });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTestRouter('/new-project');
    const wrapper = mount(NewProjectPage, { global: { plugins: [router] } });

    await wrapper.get('#project-name').setValue('雨夜来信');
    await buttonByText(wrapper, '选择目录').trigger('click');
    await buttonByText(wrapper, '选择文件').trigger('click');
    await flushPromises();
    await wrapper.get('form').trigger('submit');
    await flushPromises();

    expect(wrapper.text()).toContain('项目目录不是空目录。');
    expect(wrapper.get('#project-name').element).toHaveProperty('value', '雨夜来信');
    expect(buttonByText(wrapper, '创建并打开项目').attributes('disabled')).toBeUndefined();

    await wrapper.get('form').trigger('submit');
    await flushPromises();
    expect(createProject).toHaveBeenCalledTimes(2);
    expect(router.currentRoute.value.path).toBe('/startup');
    wrapper.unmount();
  });
});

describe('startup home page', () => {
  it('首次查询完成前保持加载态，不误显示空状态', async () => {
    const pending = createDeferred<Awaited<ReturnType<DesktopApi['startup']['listRecentProjects']>>>();
    const api = createApi({ startup: {
      listRecentProjects: vi.fn(() => pending.promise),
    } });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTestRouter('/startup');
    const wrapper = mount(StartupHomePage, { global: { plugins: [router] } });

    expect(wrapper.find('.startup-content--loading').exists()).toBe(true);
    expect(wrapper.find('.startup-content--empty').exists()).toBe(false);
    expect(wrapper.find('.recent-projects').exists()).toBe(false);
    expect(wrapper.text()).not.toContain('暂无最近项目');

    pending.resolve(success([]));
    await flushPromises();
    expect(wrapper.find('.startup-content--loading').exists()).toBe(false);
    expect(wrapper.find('.startup-content--empty').exists()).toBe(true);
    expect(wrapper.find('.recent-projects').exists()).toBe(false);
    wrapper.unmount();
  });

  it('移除最后一个最近项目后进入空状态且不渲染最近区', async () => {
    const api = createApi({ startup: {
      listRecentProjects: vi.fn(async () => success([recentProject])),
    } });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTestRouter('/startup');
    const wrapper = mount(StartupHomePage, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.get('.recent-project-name').text()).toBe('雨夜来信');
    expect(wrapper.get('.recent-project-directory').attributes('title')).toBe(recentProject.directoryPath);
    expect(wrapper.find('.lucide-settings').exists()).toBe(true);
    const remove = wrapper.get('[aria-label="从最近项目移除 雨夜来信"]');
    await remove.trigger('click');
    await flushPromises();
    expect(api.startup.removeRecentProject).toHaveBeenCalledWith(project.projectId);
    expect(wrapper.find('.recent-projects').exists()).toBe(false);
    expect(wrapper.find('.startup-content--empty').exists()).toBe(true);
    expect(wrapper.text()).not.toContain('暂无最近项目');
    wrapper.unmount();
  });

  it('显示全部最近项目总数，并在成功打开后采用后端刷新顺序', async () => {
    const listRecentProjects = vi.fn<DesktopApi['startup']['listRecentProjects']>()
      .mockResolvedValueOnce(success([recentProject, secondRecentProject]))
      .mockResolvedValueOnce(success([secondRecentProject, recentProject]));
    const api = createApi({ startup: { listRecentProjects } });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTestRouter('/startup');
    const wrapper = mount(StartupHomePage, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.get('.recent-projects-header').text()).toContain('2 个');
    expect(wrapper.findAll('.recent-project-name').map(item => item.text())).toEqual(['雨夜来信', '星海旧梦']);

    const secondProjectButton = wrapper.findAll('.recent-project-open').at(1);
    if (!secondProjectButton)
      throw new Error('Missing second recent project button');
    await secondProjectButton.trigger('click');
    await flushPromises();
    expect(api.startup.openRecentProject).toHaveBeenCalledWith(secondRecentProject.projectId);
    expect(listRecentProjects).toHaveBeenCalledTimes(2);
    expect(wrapper.findAll('.recent-project-name').map(item => item.text())).toEqual(['星海旧梦', '雨夜来信']);
    wrapper.unmount();
  });

  it('仅渐隐当前可视区末行，滚动到底后取消渐隐', async () => {
    const api = createApi({ startup: {
      listRecentProjects: vi.fn(async () => success([recentProject, secondRecentProject, thirdRecentProject])),
    } });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTestRouter('/startup');
    const wrapper = mount(StartupHomePage, { global: { plugins: [router] } });
    await flushPromises();

    const list = wrapper.get('.recent-project-list');
    const listElement = list.element as HTMLElement;
    Object.defineProperties(listElement, {
      clientHeight: { configurable: true, value: 72 },
      scrollHeight: { configurable: true, value: 108 },
      scrollTop: { configurable: true, value: 0, writable: true },
    });
    vi.spyOn(listElement, 'getBoundingClientRect').mockReturnValue(elementRect(0, 72));
    const rows = wrapper.findAll('.recent-project-row');
    rows.forEach((row, index) => {
      vi.spyOn(row.element, 'getBoundingClientRect')
        .mockImplementation(() => elementRect(index * 36 - listElement.scrollTop, 36));
    });

    await list.trigger('scroll');
    await flushPromises();
    expect(rows.map(row => row.classes().includes('recent-project-row--fade'))).toEqual([false, true, false]);

    listElement.scrollTop = 36;
    await list.trigger('scroll');
    await flushPromises();
    expect(rows.some(row => row.classes().includes('recent-project-row--fade'))).toBe(false);
    wrapper.unmount();
  });

  it('保留目录省略与独立滚动容器所需的结构契约', async () => {
    const api = createApi({ startup: {
      listRecentProjects: vi.fn(async () => success([recentProject])),
    } });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTestRouter('/startup');
    const wrapper = mount(StartupHomePage, { global: { plugins: [router] } });
    await flushPromises();

    expect(wrapper.get('.recent-project-list').element.tagName).toBe('DIV');
    const directory = wrapper.get('.recent-project-directory');
    expect(directory.element.tagName).toBe('SPAN');
    expect(directory.attributes('title')).toBe(recentProject.directoryPath);
    expect(directory.text()).toBe(recentProject.directoryPath);
    wrapper.unmount();
  });

  it('迁移或失效锁必须通过 Element Plus 确认框显式确认', async () => {
    const confirmationToken = 'confirmation-token';
    const api = createApi({ startup: {
      listRecentProjects: vi.fn(async () => success([recentProject])),
      openRecentProject: vi.fn(async () => success({
        kind: 'confirmation-required',
        confirmationToken,
        expiresAt: '2026-08-12T10:05:00.000Z',
        operations: ['migrate-v1'],
        project,
        riskSummary: ['将备份旧文件并迁移到 layout v2。'],
      } satisfies ProjectOpenOutcomeDto)),
    } });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const router = await createTestRouter('/startup');
    const wrapper = mount(StartupHomePage, {
      attachTo: document.body,
      global: { plugins: [router, ElementPlus] },
    });
    await flushPromises();

    await wrapper.get('.recent-project-open').trigger('click');
    await flushPromises();
    expect(document.body.textContent).toContain('打开项目前需要确认');
    expect(document.body.textContent).toContain('将备份旧文件并迁移到 layout v2。');
    const confirmButton = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('确认并打开')) as HTMLButtonElement | undefined;
    expect(confirmButton).toBeDefined();
    confirmButton?.click();
    await flushPromises();
    expect(api.startup.confirmProjectOpen).toHaveBeenCalledWith(confirmationToken);
    wrapper.unmount();
  });
});

describe('workspace text page', () => {
  it('工作台只显示真实项目上下文和禁用的后续入口', async () => {
    const api = createApi({
      project: { getBootstrap: vi.fn(async () => success(workspaceBootstrap)) },
    });
    Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
    const wrapper = mount(WorkspaceTextPage);
    await flushPromises();

    expect(wrapper.text()).toContain('雨夜来信');
    expect(wrapper.text()).toContain('download-18472.txt');
    expect(wrapper.text()).toContain('后续处理尚未实现');
    expect(wrapper.text()).not.toContain('示例小说');
    expect(wrapper.find('.lucide-settings').exists()).toBe(true);
    expect(wrapper.get('.project-ready-state > button').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });
});
