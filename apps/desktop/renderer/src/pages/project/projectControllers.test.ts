import type {
  DesktopApi,
  NovelImportProbeDto,
  NovelImportReviewCommandInput,
  NovelImportReviewSnapshotDto,
  TaskSummaryDto,
  TextSliceRequest,
  WorkspaceBootstrapDto,
  WorkspacePageKey,
} from '@voxweaver/contracts';

import { WORKSPACE_PAGE_KEYS } from '@voxweaver/contracts';
import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import ChapterSplittingPage from '@/pages/project/ChapterSplittingPage.vue';
import GatedWorkspacePage from '@/pages/project/GatedWorkspacePage.vue';
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

const reviewChapterBlocks = [
  { title: '第一章 雨夜', prefix: '雨夜' },
  { title: '第二章 旧信', prefix: '旧信' },
  { title: '第三章 门影', prefix: '门影' },
  { title: '第四章 清晨', prefix: '清晨' },
] as const;
const automaticGapText = '这一行将自动归入第二章';
const reviewText = `${reviewChapterBlocks.map((block, blockIndex) => [
  block.title,
  ...Array.from({ length: 12 }, (_, index) => `${block.prefix}正文 ${index + 1}`),
  ...(blockIndex === 0 ? [automaticGapText] : []),
].join('\n')).join('\n')}\n`;
const reviewBytes = new TextEncoder().encode(reviewText);

function byteOffset(characterOffset: number): number {
  return new TextEncoder().encode(reviewText.slice(0, characterOffset)).byteLength;
}

function utf8Range(startByte: number, endByte: number) {
  return { offsetUnit: 'utf8-byte' as const, startByte, endByte };
}

const reviewChapterStarts = reviewChapterBlocks.map(block => byteOffset(reviewText.indexOf(block.title)));
const gapStartByte = byteOffset(reviewText.indexOf(automaticGapText));
const reviewChapters = reviewChapterBlocks.map((block, index) => {
  const headingStartByte = reviewChapterStarts[index]!;
  const headingEndByte = headingStartByte + new TextEncoder().encode(block.title).byteLength;
  return {
    chapterId: `chapter-${index + 1}`,
    order: index + 1,
    title: block.title,
    headingKind: 'source' as const,
    headingRange: utf8Range(headingStartByte, headingEndByte),
    contentRange: utf8Range(
      headingEndByte + 1,
      index === 0
        ? gapStartByte
        : (reviewChapterStarts[index + 1] ?? reviewBytes.byteLength),
    ),
    reviewStatus: 'pending' as const,
    lengthAnomalyAccepted: false,
  };
});

const reviewSnapshot: NovelImportReviewSnapshotDto = {
  revisionId: 'revision-1',
  baselineRevision: 1,
  source: probe.source,
  encoding: 'utf-8',
  encodingMethod: 'strict-utf8',
  textByteLength: reviewBytes.byteLength,
  chapters: reviewChapters,
  coverage: {
    totalByteLength: reviewBytes.byteLength,
    classifiedByteLength: reviewBytes.byteLength,
    unclassifiedByteLength: 0,
    complete: true,
    segments: [
      {
        classification: 'chapter',
        range: utf8Range(0, reviewChapters[0]!.contentRange.endByte),
        chapterId: 'chapter-1',
      },
      {
        classification: 'chapter',
        range: utf8Range(reviewChapters[0]!.contentRange.endByte, reviewChapters[1]!.headingRange.startByte),
        chapterId: 'chapter-2',
        reason: 'uncovered-to-next',
      },
      ...reviewChapters.slice(1).map(chapter => ({
        classification: 'chapter' as const,
        range: utf8Range(chapter.headingRange.startByte, chapter.contentRange.endByte),
        chapterId: chapter.chapterId,
      })),
    ],
    uncoveredRanges: [],
  },
  revisionHistory: [],
  reviewStatus: 'pending',
  createdAt: '2026-08-13T00:00:00.000Z',
};

const emptyChapterText = reviewText.slice(
  0,
  reviewText.indexOf(reviewChapterBlocks[3].title) + reviewChapterBlocks[3].title.length,
);
const emptyChapterBytes = new TextEncoder().encode(emptyChapterText);
const emptyChapterSnapshot: NovelImportReviewSnapshotDto = {
  ...reviewSnapshot,
  revisionId: 'empty-chapter-revision',
  textByteLength: emptyChapterBytes.byteLength,
  chapters: reviewChapters.map((chapter, index) => index === 3
    ? {
        ...chapter,
        contentRange: utf8Range(emptyChapterBytes.byteLength, emptyChapterBytes.byteLength),
      }
    : chapter),
  coverage: {
    totalByteLength: emptyChapterBytes.byteLength,
    classifiedByteLength: emptyChapterBytes.byteLength,
    unclassifiedByteLength: 0,
    complete: true,
    segments: [],
    uncoveredRanges: [],
  },
};

const unassignedRange = utf8Range(
  reviewChapters[0]!.contentRange.startByte,
  reviewChapters[0]!.contentRange.startByte + new TextEncoder().encode('雨夜正文 1').byteLength,
);
const unassignedReviewSnapshot: NovelImportReviewSnapshotDto = {
  ...reviewSnapshot,
  revisionId: 'unassigned-revision',
  coverage: {
    ...reviewSnapshot.coverage,
    classifiedByteLength: reviewBytes.byteLength
      - (unassignedRange.endByte - unassignedRange.startByte),
    unclassifiedByteLength: unassignedRange.endByte - unassignedRange.startByte,
    complete: false,
    segments: [],
    uncoveredRanges: [unassignedRange],
  },
};

const thirdChapterUnassignedRange = utf8Range(
  reviewChapters[2]!.headingRange.startByte,
  reviewChapters[2]!.contentRange.endByte,
);
const twoAnomalyReviewSnapshot: NovelImportReviewSnapshotDto = {
  ...emptyChapterSnapshot,
  revisionId: 'two-anomaly-revision',
  coverage: {
    ...emptyChapterSnapshot.coverage,
    classifiedByteLength: emptyChapterBytes.byteLength
      - (thirdChapterUnassignedRange.endByte - thirdChapterUnassignedRange.startByte),
    unclassifiedByteLength:
      thirdChapterUnassignedRange.endByte - thirdChapterUnassignedRange.startByte,
    complete: false,
    uncoveredRanges: [thirdChapterUnassignedRange],
  },
};

function createApi(
  initialSnapshot: NovelImportReviewSnapshotDto = reviewSnapshot,
  initialTextBytes: Uint8Array = reviewBytes,
): DesktopApi {
  let currentSnapshot = initialSnapshot;
  let currentTextBytes = initialTextBytes;
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
      getSourcePreview: vi.fn().mockResolvedValue({
        ok: true,
        value: {
          sourceHash: probe.source.sha256,
          sourceEncoding: 'utf-8',
          startByte: 0,
          endByte: 31,
          text: '第一章 雨夜\n雨落在旧车站。\n',
          completeLineCount: 2,
          done: true,
        },
      }),
      start: vi.fn().mockResolvedValue({ ok: true, value: task }),
      getTask: vi.fn(),
      cancelTask: vi.fn(),
      retryTask: vi.fn(),
      getReviewSnapshot: vi.fn().mockImplementation(async () => ({
        ok: true,
        value: currentSnapshot,
      })),
      getTextSlice: vi.fn().mockImplementation(async (input: TextSliceRequest) => ({
        ok: true,
        value: {
          revisionId: input.revisionId,
          range: utf8Range(input.startByte, input.endByte),
          text: new TextDecoder().decode(currentTextBytes.slice(input.startByte, input.endByte)),
          done: input.endByte === currentTextBytes.byteLength,
        },
      })),
      previewReview: vi.fn().mockImplementation(async (command: NovelImportReviewCommandInput) => ({
        ok: true,
        value: {
          baselineRevision: command.baselineRevision,
          commandType: command.commandType,
          affected: [],
          requiresConfirmation: false,
        },
      })),
      applyReview: vi.fn().mockImplementation(async (command: NovelImportReviewCommandInput) => {
        if (command.commandType === 'update-chapter-structure') {
          currentTextBytes = insertLineFeeds(currentTextBytes, command.insertionPoints);
          const unclassifiedByteLength = command.unassignedRanges.reduce(
            (total, range) => total + range.endByte - range.startByte,
            0,
          );
          currentSnapshot = {
            ...currentSnapshot,
            revisionId: `revision-${currentSnapshot.baselineRevision + 1}`,
            baselineRevision: currentSnapshot.baselineRevision + 1,
            textByteLength: currentTextBytes.byteLength,
            chapters: command.chapters.map((chapter, index) => ({
              chapterId: chapter.existingChapterId ?? `new-chapter-${index + 1}`,
              order: index + 1,
              title: chapter.title,
              headingKind: chapter.headingKind,
              ...(chapter.headingRange ? { headingRange: chapter.headingRange } : {}),
              contentRange: chapter.contentRange,
              reviewStatus: 'pending',
              lengthAnomalyAccepted: chapter.lengthAnomalyAccepted,
            })),
            coverage: {
              totalByteLength: currentTextBytes.byteLength,
              classifiedByteLength: currentTextBytes.byteLength - unclassifiedByteLength,
              unclassifiedByteLength,
              complete: command.unassignedRanges.length === 0,
              segments: [],
              uncoveredRanges: command.unassignedRanges,
            },
            reviewStatus: 'pending',
          };
        } else {
          currentSnapshot = {
            ...currentSnapshot,
            reviewStatus: 'approved',
          };
        }
        return { ok: true, value: currentSnapshot };
      }),
      onEvent: vi.fn().mockReturnValue(vi.fn()),
    },
    system: {
      getCoreHealth: vi.fn(),
      restartCore: vi.fn().mockResolvedValue({ ok: true, value: undefined }),
    },
  } as DesktopApi;
}

function insertLineFeeds(bytes: Uint8Array, insertionPoints: readonly number[]): Uint8Array {
  if (insertionPoints.length === 0)
    return bytes;
  const next = new Uint8Array(bytes.byteLength + insertionPoints.length);
  let sourceOffset = 0;
  let targetOffset = 0;
  for (const insertionPoint of [...insertionPoints].sort((left, right) => left - right)) {
    const part = bytes.slice(sourceOffset, insertionPoint);
    next.set(part, targetOffset);
    targetOffset += part.byteLength;
    next[targetOffset] = 0x0A;
    targetOffset += 1;
    sourceOffset = insertionPoint;
  }
  next.set(bytes.slice(sourceOffset), targetOffset);
  return next;
}

async function mountPage(
  component: Parameters<typeof mount>[0],
  api: DesktopApi,
  pageKey?: WorkspacePageKey,
) {
  Object.defineProperty(window, 'voxweaver', { configurable: true, value: api });
  const context = createWorkspaceContext();
  context.bootstrap.value = bootstrap;
  context.loadState.value = 'ready';
  const router = createRouter({
    history: createMemoryHistory(),
    routes: [
      {
        path: '/',
        component: { template: '<div />' },
        meta: { workspacePageKey: pageKey ?? 'text-extraction' },
      },
      { path: '/review', name: 'project-chapter-splitting', component: { template: '<div />' } },
      { path: '/proofreading', name: 'project-proofreading', component: { template: '<div />' } },
    ],
  });
  await router.push('/');
  await router.isReady();

  return {
    context,
    router,
    wrapper: mount(component, {
      attachTo: document.body,
      global: {
        plugins: [ElementPlus, router],
        provide: { [workspaceContextKey as symbol]: context },
      },
    }),
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  document.body.innerHTML = '';
});

describe('project workspace controllers', () => {
  it('文本提取确认后在任务成功时自动进入章节复核', async () => {
    const api = createApi();
    let emitEvent: Parameters<DesktopApi['novelImport']['onEvent']>[0] | undefined;
    vi.mocked(api.novelImport.onEvent).mockImplementation((callback) => {
      emitEvent = callback;
      return vi.fn();
    });
    const { router, wrapper } = await mountPage(TextExtractionPage, api);
    await flushPromises();

    expect(api.novelImport.probe).toHaveBeenCalledTimes(1);
    expect(api.novelImport.getSourcePreview).toHaveBeenCalledWith({
      sourceHash: probe.source.sha256,
      sourceEncoding: 'utf-8',
      startByte: 0,
      targetLineCount: 100,
    });
    expect(wrapper.text()).toContain('novel.txt');
    expect(wrapper.text()).toContain('1.0 KiB');
    expect(wrapper.text()).not.toContain('SHA-256');
    expect(wrapper.text()).not.toContain('加载更多');
    expect(wrapper.find('.workspace-page-header').exists()).toBe(false);
    expect(wrapper.get('.text-extraction-action-bar').element.tagName).toBe('FOOTER');
    expect(wrapper.get('.source-info').text()).toContain('novel.txt');
    expect(wrapper.get('.source-info').text()).toContain('1.0 KiB');
    expect(wrapper.get('.source-controls').text()).toContain('重新检测');

    const startButton = wrapper.findAll('button').find(button => (
      button.text().includes('确定文本解析正确并进入章节复核')
    ));
    expect(startButton).toBeDefined();
    await startButton?.trigger('click');
    await flushPromises();

    expect(api.novelImport.start).toHaveBeenCalledWith({});
    expect(api.startup.selectSourceFile).not.toHaveBeenCalled();

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
    expect(router.currentRoute.value.name).toBe('project-chapter-splitting');
    wrapper.unmount();
  });

  it('即使没有边界修改也使用 update 命令保存一个 revision', async () => {
    const api = createApi();
    const { context, router, wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const confirmButton = wrapper.get('[data-testid="confirm-chapter-cut"]');
    expect(wrapper.find('.workspace-page-header').exists()).toBe(false);
    expect(wrapper.get('[data-testid="next-proofreading"]').attributes('disabled')).toBeDefined();
    await confirmButton.trigger('click');
    await flushPromises();

    expect(api.novelImport.previewReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.applyReview).toHaveBeenCalledTimes(1);
    const structureCommand = vi.mocked(api.novelImport.previewReview).mock.calls[0]?.[0];
    expect(structureCommand).toMatchObject({
      commandType: 'update-chapter-structure',
      baselineRevision: 1,
      insertionPoints: [],
      unassignedRanges: [],
    });
    expect(api.novelImport.applyReview).toHaveBeenCalledWith(structureCommand);
    expect(api.novelImport.getTextSlice).toHaveBeenLastCalledWith({
      revisionId: 'revision-2',
      startByte: 0,
      endByte: reviewBytes.byteLength,
    });
    expect(wrapper.get('[data-testid="chapter-operation-count"]').text()).toContain('0');

    const nextButton = wrapper.get('[data-testid="next-proofreading"]');
    expect(nextButton.attributes('disabled')).toBeUndefined();
    await nextButton.trigger('click');
    await flushPromises();

    const command = { commandType: 'confirm-review', baselineRevision: 2 };
    expect(api.novelImport.previewReview).toHaveBeenCalledWith(command);
    expect(api.novelImport.applyReview).toHaveBeenCalledWith(command);
    expect(api.project.getBootstrap).toHaveBeenCalledTimes(1);
    expect(context.bootstrap.value?.project.projectId).toBe(bootstrap.project.projectId);
    expect(router.currentRoute.value.name).toBe('project-proofreading');
    wrapper.unmount();
  });

  it('通过 CodeMirror 只读正文和行内 widget 展示章节边界', async () => {
    const api = createApi();
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const editor = wrapper.get('[data-testid="chapter-code-mirror-editor"]');
    const content = editor.get('[aria-label="章节切割正文编辑器"]');
    expect(content.attributes('contenteditable')).toBe('true');
    expect(content.attributes('aria-readonly')).toBe('true');
    expect(wrapper.get('[data-testid="chapter-count"]').text()).toBe('4 章');
    expect(wrapper.get('[data-testid="previous-chapter-anomaly"]')
      .attributes('disabled')).toBeDefined();

    const firstWidget = editor.get('.cm-chapter-widget[data-chapter-id="chapter-1"]');
    expect(firstWidget.attributes('aria-label')).toBe('章节 1：第一章 雨夜');
    const firstUpperButtons = wrapper.findAll(
      '.cm-chapter-widget[data-chapter-id="chapter-1"] [aria-label="上边界"] button',
    );
    expect(firstUpperButtons).toHaveLength(4);
    expect(firstUpperButtons.every(button => button.attributes('disabled') !== undefined)).toBe(true);

    const secondWidget = editor.get('.cm-chapter-widget[data-chapter-id="chapter-2"]');
    expect(secondWidget.get('.cm-chapter-widget__title').text()).toBe('第二章 旧信');
    expect(secondWidget.find('.cm-chapter-widget__warning').exists()).toBe(false);
    expect(secondWidget.findAll('.cm-chapter-widget__button')).toHaveLength(8);
    wrapper.unmount();
  });

  it('精确显示异常数/章节总数并循环导航未确认异常', async () => {
    const api = createApi(twoAnomalyReviewSnapshot, emptyChapterBytes);
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const count = wrapper.get('[data-testid="chapter-anomaly-count"]');
    expect(count.text()).toBe('2/4 章');
    expect(count.get('.chapter-structure-header__anomaly-count').text()).toBe('2');
    expect(count.get('.chapter-structure-header__anomaly-count').classes())
      .toContain('chapter-structure-header__anomaly-count');

    const next = wrapper.get('[data-testid="next-chapter-anomaly"]');
    const previous = wrapper.get('[data-testid="previous-chapter-anomaly"]');
    expect(next.attributes('disabled')).toBeUndefined();
    expect(previous.attributes('disabled')).toBeUndefined();

    await next.trigger('click');
    await flushPromises();
    expect((document.activeElement as HTMLElement).dataset.chapterId).toBe('chapter-3');

    await next.trigger('click');
    await flushPromises();
    expect((document.activeElement as HTMLElement).dataset.chapterId).toBe('chapter-4');

    await next.trigger('click');
    await flushPromises();
    expect((document.activeElement as HTMLElement).dataset.chapterId).toBe('chapter-3');

    await previous.trigger('click');
    await flushPromises();
    expect((document.activeElement as HTMLElement).dataset.chapterId).toBe('chapter-4');
    wrapper.unmount();
  });

  it('范围控制与删除识别位于标题行，标题行不再显示“第 x 行”', async () => {
    const api = createApi();
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const secondWidget = wrapper.get('.cm-chapter-widget[data-chapter-id="chapter-2"]');
    const header = secondWidget.get('.cm-chapter-widget__header');
    expect(header.find('.cm-chapter-widget__controls').exists()).toBe(true);
    expect(header.find('.cm-chapter-widget__line').exists()).toBe(false);
    expect(header.findAll('.cm-chapter-widget__structure-action').at(-1)?.text())
      .toBe('删除章节识别');

    const gutterLineNumbers = wrapper.findAll('.cm-lineNumbers .cm-gutterElement')
      .filter(item => !item.attributes('style')?.includes('visibility: hidden'))
      .map(item => item.text());
    expect(wrapper.get('.cm-chapter-fold__expand-all').text()).toContain('隐藏 2 行');
    expect(gutterLineNumbers.slice(0, 15)).toEqual([
      ...Array.from({ length: 7 }, (_, index) => String(index + 1)),
      ...Array.from({ length: 8 }, (_, index) => String(index + 10)),
    ]);
    wrapper.unmount();
  });

  it('边界图标只修改本地草稿，Footer 确认后才批量提交', async () => {
    const api = createApi();
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const moveForward = wrapper.get(
      '.cm-chapter-widget[data-chapter-id="chapter-1"] [aria-label="下边界"] button[aria-label="进"]',
    );
    expect(moveForward.attributes('disabled')).toBeUndefined();
    await moveForward.trigger('click');
    await flushPromises();

    expect(api.novelImport.previewReview).not.toHaveBeenCalled();
    expect(api.novelImport.applyReview).not.toHaveBeenCalled();
    expect(wrapper.get('[data-testid="next-proofreading"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="chapter-operation-count"]').text()).toContain('1');
    expect(wrapper.get('[data-testid="chapter-structure-status"]').text()).toBe('草稿尚未保存');

    await wrapper.get('[data-testid="confirm-chapter-cut"]').trigger('click');
    await flushPromises();
    expect(api.novelImport.previewReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.applyReview).toHaveBeenCalledTimes(1);
    const command = vi.mocked(api.novelImport.applyReview).mock.calls[0]?.[0];
    expect(command?.commandType).toBe('update-chapter-structure');
    if (command?.commandType === 'update-chapter-structure') {
      expect(command.insertionPoints).toEqual([]);
      expect(command.unassignedRanges).toEqual([]);
      expect(command.chapters).toHaveLength(reviewChapters.length);
      expect(command.chapters[0]?.existingChapterId).toBe('chapter-1');
      expect(command.chapters[0]?.contentRange).not.toEqual(reviewChapters[0]?.contentRange);
    }
    expect(vi.mocked(api.novelImport.previewReview).mock.calls[0]?.[0]).toBe(command);
    expect(wrapper.get('[data-testid="chapter-operation-count"]').text()).toContain('0');
    wrapper.unmount();
  });

  it('空章异常只提示，保存后不阻塞进入文本校对', async () => {
    const api = createApi(emptyChapterSnapshot, emptyChapterBytes);
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    expect(wrapper.get('[data-testid="chapter-anomaly-count"]').text()).toBe('1/4 章');
    await wrapper.get('[data-testid="next-chapter-anomaly"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('.cm-chapter-widget[data-chapter-id="chapter-4"]')
      .get('.cm-chapter-widget__anomaly-reason').text()).toContain('无正文');
    expect(wrapper.get('[data-testid="next-proofreading"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-testid="confirm-chapter-cut"]').trigger('click');
    await flushPromises();

    expect(api.novelImport.previewReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.applyReview).toHaveBeenCalledTimes(1);
    expect(wrapper.get('[data-testid="chapter-anomaly-count"]').text()).toBe('1/4 章');
    expect(wrapper.get('[data-testid="next-proofreading"]').attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="chapter-structure-status"]').text()).toBe('章节切割已确认');
    wrapper.unmount();
  });

  it('未归属范围允许保存并进入文本校对', async () => {
    const api = createApi(unassignedReviewSnapshot);
    const { router, wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    expect(wrapper.get('[data-testid="confirm-chapter-cut"]').attributes('disabled')).toBeUndefined();
    await wrapper.get('[data-testid="confirm-chapter-cut"]').trigger('click');
    await flushPromises();

    expect(api.novelImport.applyReview).toHaveBeenCalledTimes(1);
    const command = vi.mocked(api.novelImport.applyReview).mock.calls[0]?.[0];
    expect(command?.commandType).toBe('update-chapter-structure');
    if (command?.commandType === 'update-chapter-structure')
      expect(command.unassignedRanges).toEqual([unassignedRange]);
    const nextButton = wrapper.get('[data-testid="next-proofreading"]');
    expect(nextButton.attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="chapter-structure-status"]').text())
      .toBe('仍有未归属正文');

    await nextButton.trigger('click');
    await flushPromises();

    expect(api.novelImport.previewReview).toHaveBeenLastCalledWith({
      commandType: 'confirm-review',
      baselineRevision: 2,
    });
    expect(api.novelImport.applyReview).toHaveBeenLastCalledWith({
      commandType: 'confirm-review',
      baselineRevision: 2,
    });
    expect(router.currentRoute.value.name).toBe('project-proofreading');
    wrapper.unmount();
  });

  it('直接删除章节识别并将原文转为未归属范围', async () => {
    const api = createApi();
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const firstWidget = wrapper.get('.cm-chapter-widget[data-chapter-id="chapter-1"]');
    const deleteButton = firstWidget.findAll('.cm-chapter-widget__structure-action')
      .find(button => button.text() === '删除章节识别');
    expect(deleteButton).toBeDefined();
    await deleteButton?.trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="chapter-count"]').text()).toBe('3 章');
    expect(wrapper.get('[data-testid="chapter-operation-count"]').text()).toContain('1');
    expect(wrapper.find('.cm-chapter-unassigned').exists()).toBe(true);
    expect(wrapper.get('[data-testid="next-proofreading"]').attributes('disabled')).toBeDefined();
    wrapper.unmount();
  });

  it('批量保存有下游影响时等待二次确认，且只 apply 一次', async () => {
    const api = createApi();
    vi.mocked(api.novelImport.previewReview).mockImplementation(async command => ({
      ok: true,
      value: {
        baselineRevision: command.baselineRevision,
        commandType: command.commandType,
        affected: command.commandType === 'update-chapter-structure'
          ? [{ artifactType: 'structure', artifactId: 'structure:1', reason: '边界改变' }]
          : [],
        requiresConfirmation: command.commandType === 'update-chapter-structure',
      },
    }));
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    await wrapper.get(
      '.cm-chapter-widget[data-chapter-id="chapter-1"] [aria-label="下边界"] button[aria-label="进"]',
    ).trigger('click');
    await wrapper.get('[data-testid="confirm-chapter-cut"]').trigger('click');
    await flushPromises();

    expect(api.novelImport.previewReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.applyReview).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('确认下游影响');
    expect(document.body.textContent).toContain('structure:1');
    expect(wrapper.findAll('.cm-chapter-widget__button').every(
      button => button.attributes('disabled') !== undefined,
    )).toBe(true);
    const confirmSave = [...document.body.querySelectorAll('button')]
      .find(button => button.textContent?.includes('确认保存'));
    expect(confirmSave).toBeDefined();
    confirmSave?.click();
    await flushPromises();

    expect(api.novelImport.applyReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.applyReview).toHaveBeenCalledWith(
      vi.mocked(api.novelImport.previewReview).mock.calls[0]?.[0],
    );
    expect(vi.mocked(api.novelImport.applyReview).mock.calls[0]?.[0])
      .toBe(vi.mocked(api.novelImport.previewReview).mock.calls[0]?.[0]);
    wrapper.unmount();
  });

  it('baseline 冲突保留草稿并禁止继续修改或重提，直到显式刷新', async () => {
    const api = createApi();
    vi.mocked(api.novelImport.applyReview).mockResolvedValueOnce({
      ok: false,
      error: {
        code: 'NOVEL_IMPORT_CONFLICT',
        message: '章节基线已更改，请刷新。',
        retryable: true,
      },
    });
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    await wrapper.get(
      '.cm-chapter-widget[data-chapter-id="chapter-1"] [aria-label="下边界"] button[aria-label="进"]',
    ).trigger('click');
    await wrapper.get('[data-testid="confirm-chapter-cut"]').trigger('click');
    await flushPromises();

    expect(api.novelImport.previewReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.applyReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.getReviewSnapshot).toHaveBeenCalledTimes(1);
    expect(wrapper.text()).toContain('章节基线已更改，请刷新。');
    expect(wrapper.get('[data-testid="chapter-operation-count"]').text()).toContain('1');
    expect(wrapper.get('[data-testid="confirm-chapter-cut"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="next-proofreading"]').attributes('disabled')).toBeDefined();
    expect(wrapper.findAll('.cm-chapter-widget__button').every(
      button => button.attributes('disabled') !== undefined,
    )).toBe(true);

    await wrapper.get('[data-testid="confirm-chapter-cut"]').trigger('click');
    await flushPromises();
    expect(api.novelImport.previewReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.applyReview).toHaveBeenCalledTimes(1);
    expect(api.novelImport.getReviewSnapshot).toHaveBeenCalledTimes(1);

    vi.mocked(api.novelImport.getReviewSnapshot).mockResolvedValueOnce({
      ok: true,
      value: {
        ...reviewSnapshot,
        revisionId: 'revision-after-conflict',
        baselineRevision: 2,
      },
    });
    await wrapper.get('[data-testid="refresh-conflicted-chapter-draft"]').trigger('click');
    await flushPromises();

    expect(api.novelImport.getReviewSnapshot).toHaveBeenCalledTimes(2);
    expect(wrapper.find('[data-testid="refresh-conflicted-chapter-draft"]').exists()).toBe(false);
    expect(wrapper.get('[data-testid="chapter-operation-count"]').text()).toContain('0');
    wrapper.unmount();
  });

  it('已 approved 的 revision 不重复提交并直接进入文本校对', async () => {
    const api = createApi();
    vi.mocked(api.novelImport.getReviewSnapshot).mockResolvedValue({
      ok: true,
      value: { ...reviewSnapshot, reviewStatus: 'approved' },
    });
    const { router, wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const nextButton = wrapper.get('[data-testid="next-proofreading"]');
    expect(nextButton.attributes('disabled')).toBeUndefined();
    await nextButton.trigger('click');
    await flushPromises();

    expect(api.novelImport.previewReview).not.toHaveBeenCalled();
    expect(api.novelImport.applyReview).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('project-proofreading');
    wrapper.unmount();
  });

  it('已 approved 的 revision 仍允许标记正常和使用结构操作，修改后要求重新保存', async () => {
    const approvedSnapshot: NovelImportReviewSnapshotDto = {
      ...emptyChapterSnapshot,
      reviewStatus: 'approved',
      chapters: emptyChapterSnapshot.chapters.map(chapter => ({
        ...chapter,
        reviewStatus: 'approved',
      })),
    };
    const api = createApi(approvedSnapshot, emptyChapterBytes);
    const { wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    await wrapper.get('[data-testid="next-chapter-anomaly"]').trigger('click');
    await flushPromises();
    const anomalyWidget = wrapper.get('.cm-chapter-widget[data-chapter-id="chapter-4"]');
    const acceptButton = anomalyWidget.get<HTMLButtonElement>('.cm-chapter-widget__accept-anomaly');
    expect(acceptButton.element.disabled).toBe(false);
    await acceptButton.trigger('click');
    await flushPromises();

    expect(wrapper.find('.cm-chapter-widget__accept-anomaly').exists()).toBe(false);
    expect(wrapper.get('[data-testid="chapter-operation-count"]').text()).toContain('1');
    expect(wrapper.get('[data-testid="next-proofreading"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="confirm-chapter-cut"]').attributes('disabled')).toBeUndefined();

    const deleteButton = anomalyWidget.findAll('.cm-chapter-widget__structure-action')
      .find(button => button.text() === '删除章节识别');
    expect(deleteButton).toBeDefined();
    await deleteButton?.trigger('click');
    await flushPromises();

    expect(wrapper.get('[data-testid="chapter-count"]').text()).toBe('3 章');
    expect(wrapper.get('[data-testid="chapter-operation-count"]').text()).toContain('2');
    wrapper.unmount();
  });

  it('已 approved 的 revision 有未归属范围时仍可直接进入文本校对', async () => {
    const api = createApi({
      ...unassignedReviewSnapshot,
      chapters: unassignedReviewSnapshot.chapters.map(chapter => ({
        ...chapter,
        reviewStatus: 'approved',
      })),
      reviewStatus: 'approved',
    });
    const { router, wrapper } = await mountPage(ChapterSplittingPage, api);
    await flushPromises();

    const nextButton = wrapper.get('[data-testid="next-proofreading"]');
    expect(nextButton.attributes('disabled')).toBeUndefined();
    expect(wrapper.get('[data-testid="chapter-structure-status"]').text())
      .toBe('仍有未归属正文');

    await nextButton.trigger('click');
    await flushPromises();

    expect(api.novelImport.previewReview).not.toHaveBeenCalled();
    expect(api.novelImport.applyReview).not.toHaveBeenCalled();
    expect(router.currentRoute.value.name).toBe('project-proofreading');
    wrapper.unmount();
  });

  it('文本校对、剧本管理和角色提取不显示页级 Header', async () => {
    const api = createApi();
    const pageKeys = ['proofreading', 'script-management', 'character-extraction'] as const;

    for (const pageKey of pageKeys) {
      const { wrapper } = await mountPage(GatedWorkspacePage, api, pageKey);
      await flushPromises();
      expect(wrapper.find('.workspace-page-header').exists()).toBe(false);
      wrapper.unmount();
    }
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
    expect(wrapper.text()).toContain('novel.txt');
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
