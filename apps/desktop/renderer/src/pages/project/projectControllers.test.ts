import type {
  DesktopApi,
  NovelImportProbeDto,
  NovelImportReviewSnapshotDto,
  TaskSummaryDto,
  WorkspaceBootstrapDto,
} from '@voxweaver/contracts';

import { WORKSPACE_PAGE_KEYS } from '@voxweaver/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import ChapterSplittingPage from '@/pages/project/ChapterSplittingPage.vue';
import ProjectSettingsPage from '@/pages/project/ProjectSettingsPage.vue';
import TextExtractionPage from '@/pages/project/TextExtractionPage.vue';
import { createWorkspaceContext, workspaceContextKey } from '@/workspace/context';

const task: TaskSummaryDto = {
  taskId: 'task-1',
  taskType: 'novel-import',
  status: 'running',
  recoveryStatus: 'none',
  attempt: 1,
  progress: { completed: 0, total: 100, percent: 0, message: '准备导入' },
  canCancel: true,
  canRetry: false,
  createdAt: '2026-08-13T00:00:00.000Z',
  updatedAt: '2026-08-13T00:00:00.000Z',
};

const capabilities = Object.fromEntries(WORKSPACE_PAGE_KEYS.map(pageKey => [pageKey, {
  available: ['text-extraction', 'chapter-splitting', 'project-settings'].includes(pageKey),
  reason: ['text-extraction', 'chapter-splitting', 'project-settings'].includes(pageKey)
    ? 'available'
    : 'not-implemented',
  message: '测试能力',
}])) as WorkspaceBootstrapDto['capabilities'];

const bootstrap: WorkspaceBootstrapDto = {
  project: {
    projectId: '00000000-0000-4000-8000-000000000001',
    displayName: '真实项目',
    sourceFileName: 'novel.txt',
    createdAt: '2026-08-13T00:00:00.000Z',
    updatedAt: '2026-08-13T01:00:00.000Z',
    layoutVersion: 2,
  },
  sourceAsset: {
    id: '00000000-0000-4000-8000-000000000002',
    originalName: 'novel.txt',
    relativePath: 'inputs/source-assets/id/novel.txt',
    byteLength: 1024,
    sha256: 'a'.repeat(64),
  },
  stages: [{ stageId: '01', status: 'review-required', title: '小说导入', detail: '待复核' }],
  capabilities,
  recoverableTasks: [],
  recommendedPage: 'chapter-splitting',
  coreHealth: { status: 'healthy', canRestart: false, protocolVersion: 1 },
};

const probe: NovelImportProbeDto = {
  source: {
    sourceAssetId: bootstrap.sourceAsset.id,
    originalName: bootstrap.sourceAsset.originalName,
    byteLength: bootstrap.sourceAsset.byteLength,
    sha256: bootstrap.sourceAsset.sha256,
  },
  format: 'txt',
  encoding: {
    status: 'confirmed',
    encoding: 'utf-8',
    method: 'strict-utf8',
    sourceHash: bootstrap.sourceAsset.sha256,
  },
};

const reviewSnapshot: NovelImportReviewSnapshotDto = {
  revisionId: 'revision-1',
  baselineRevision: 1,
  source: probe.source,
  encoding: 'utf-8',
  encodingMethod: 'strict-utf8',
  textByteLength: 1024,
  candidates: [],
  chapters: [],
  coverage: {
    totalByteLength: 1024,
    classifiedByteLength: 1024,
    unclassifiedByteLength: 0,
    complete: true,
    segments: [],
    uncoveredRanges: [],
  },
  normalizationProposals: [],
  diff: [],
  revisionHistory: [],
  reviewStatus: 'pending',
  createdAt: '2026-08-13T00:00:00.000Z',
};

function createApi(): DesktopApi {
  return {
    startup: {
      selectProjectDirectory: vi.fn(),
      selectSourceFile: vi.fn(),
      createProject: vi.fn(),
      openProjectFromDialog: vi.fn(),
      openRecentProject: vi.fn(),
      confirmProjectOpen: vi.fn(),
      listRecentProjects: vi.fn(),
      removeRecentProject: vi.fn(),
    },
    project: {
      getBootstrap: vi.fn().mockResolvedValue({ ok: true, value: bootstrap }),
      recordLastPage: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
      close: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
    novelImport: {
      probe: vi.fn().mockResolvedValue({ ok: true, value: probe }),
      start: vi.fn().mockResolvedValue({ ok: true, value: task }),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      retryTask: vi.fn(),
      getReviewSnapshot: vi.fn().mockResolvedValue({ ok: true, value: reviewSnapshot }),
      getTextSlice: vi.fn(),
      previewReview: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          baselineRevision: 1,
          commandType: 'confirm-review',
          affected: [],
          requiresConfirmation: false,
        },
      }),
      applyReview: vi.fn().mockResolvedValue({ ok: true, value: {
        ...reviewSnapshot,
        reviewStatus: 'approved',
      } }),
      onEvent: vi.fn().mockReturnValue(vi.fn()),
    },
    system: {
      getCoreHealth: vi.fn(),
      restartCore: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
  } as DesktopApi;
}

async function mountPage(component: Parameters<typeof mount>[0], api: DesktopApi) {
  Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
  const context = createWorkspaceContext();
  context.bootstrap.value = bootstrap;
  context.loadState.value = 'ready';
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      { path: '/', component: { template: '<div />' } },
      { path: '/review', name: 'project-chapter-splitting', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();

  return {
    context,
    wrapper: mount(component, {
      global: {
        plugins: [ElementPlus, router],
        provide: { [workspaceContextKey as symbol]: context },
      },
    }),
  };
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('project workspace controllers', () => {
  it('文本提取只调用真实 probe/start API，不请求外部文件选择', async () => {
    const api = createApi();
    const { wrapper } = await mountPage(TextExtractionPage, api);
    await flushPromises();

    expect(api.novelImport.probe).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('项目不可变 SourceAsset');
    expect(wrapper.text()).toContain('novel.txt');

    const startButton = wrapper.findAll('button').find(button => button.text().includes('开始文本提取'));
    expect(startButton).toBeDefined();
    await startButton?.trigger('click');
    await flushPromises();

    expect(api.novelImport.start).toHaveBeenCalledWith({});
    expect(api.startup.selectSourceFile).not.toHaveBeenCalled();
    wrapper.unmount();
  });

  it('章节确认严格执行 previewReview 再 applyReview', async () => {
    const api = createApi();
    const { context, wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const confirmButton = wrapper.findAll('button').find(button => button.text().includes('确认阶段 01'));
    expect(confirmButton).toBeDefined();
    await confirmButton?.trigger('click');
    await flushPromises();

    const command = { commandType: 'confirm-review', baselineRevision: 1 };
    expect(api.novelImport.previewReview).toHaveBeenCalledWith(command);
    expect(api.novelImport.applyReview).toHaveBeenCalledWith(command);
    expect(api.project.getBootstrap).toHaveBeenCalledTimes(1);
    expect(context.bootstrap.value?.project.projectId).toBe(bootstrap.project.projectId);
    wrapper.unmount();
  });

  it('导入完成事件会刷新工作台能力状态', async () => {
    const api = createApi();
    let emitEvent: Parameters<DesktopApi['novelImport']['onEvent']>[0] | undefined;
    vi.mocked(api.novelImport.onEvent).mockImplementation((callback) => {
      emitEvent = callback;
      return vi.fn();
    });
    const { wrapper } = await mountPage(TextExtractionPage, api);
    await flushPromises();

    emitEvent?.({
      eventType: 'task-completed',
      sequence: 1,
      occurredAt: '2026-08-13T00:00:01.000Z',
      task: {
        ...task,
        status: 'succeeded',
        progress: { completed: 100, total: 100, percent: 100, message: '导入完成' },
        canCancel: false,
      },
    });
    await flushPromises();

    expect(api.project.getBootstrap).toHaveBeenCalledTimes(1);
    wrapper.unmount();
  });

  it('core 受控重启后重新探测并清除旧错误', async () => {
    const api = createApi();
    vi.mocked(api.novelImport.probe)
      .mockResolvedValueOnce({
        ok: false,
        error: {
          code: 'CORE_UNAVAILABLE',
          message: 'The application core is unavailable.',
          retryable: true,
        },
      })
      .mockResolvedValueOnce({ ok: true, value: probe });

    const { context, wrapper } = await mountPage(TextExtractionPage, api);
    await flushPromises();
    expect(wrapper.text()).toContain('The application core is unavailable.');

    context.coreHealth.value = { status: 'unavailable', canRestart: true, protocolVersion: 1 };
    await flushPromises();
    context.coreHealth.value = { status: 'healthy', canRestart: false, protocolVersion: 1 };
    await flushPromises();

    expect(api.novelImport.probe).toHaveBeenCalledTimes(2);
    expect(wrapper.text()).not.toContain('The application core is unavailable.');
    expect(wrapper.text()).toContain('项目不可变 SourceAsset');
    wrapper.unmount();
  });

  it('项目设置仅展示 bootstrap 中的真实项目和源资产状态', async () => {
    const api = createApi();
    const { wrapper } = await mountPage(ProjectSettingsPage, api);
    await flushPromises();

    expect(wrapper.text()).toContain('真实项目');
    expect(wrapper.text()).toContain('inputs/source-assets/id/novel.txt');
    expect(wrapper.text()).toContain('layout v2');
    wrapper.unmount();
  });
});
