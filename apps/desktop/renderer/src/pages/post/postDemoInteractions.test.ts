import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import { appPages } from '@/pages';
import WorkspacePostPage from '../workspace/WorkspacePostPage.vue';
import ChapterCoverPage from './ChapterCoverPage.vue';
import chapterCoverSource from './ChapterCoverPage.vue?raw';
import ChapterSummaryPage from './ChapterSummaryPage.vue';
import chapterSummarySource from './ChapterSummaryPage.vue?raw';
import LoudnessConsistencyPage from './LoudnessConsistencyPage.vue';
import loudnessSource from './LoudnessConsistencyPage.vue?raw';
import OfflinePlayerExportPage from './OfflinePlayerExportPage.vue';
import offlinePlayerSource from './OfflinePlayerExportPage.vue?raw';
import PostWorkbenchFrame from './PostWorkbenchFrame.vue';
import postWorkbenchSource from './PostWorkbenchFrame.vue?raw';
import TarExportPage from './TarExportPage.vue';
import tarExportSource from './TarExportPage.vue?raw';
import TimelineAlignmentPage from './TimelineAlignmentPage.vue';
import timelineSource from './TimelineAlignmentPage.vue?raw';

vi.mock('@/demo/useDemoFeedback', () => ({
  showDemoFeedback: vi.fn(),
}));

const routeComponent = { template: '<div />' };

async function createTestRouter(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: appPages.map(page => ({
      component: routeComponent,
      meta: {
        isDemoPreview: true,
        pageGroup: page.group,
        pageKind: page.kind,
        pageSlug: page.slug,
        pageTitle: page.title,
      },
      name: getDemoPageRouteName(page.slug),
      path: page.path,
    })),
  });

  await router.push(initialPath);
  await router.isReady();
  return router;
}

async function mountPage(component: Component, initialPath: string) {
  const router = await createTestRouter(initialPath);
  const wrapper = mount(component, {
    attachTo: document.body,
    global: {
      plugins: [router, ElementPlus],
    },
  });
  await flushPromises();
  return { router, wrapper };
}

function buttonByText(wrapper: ReturnType<typeof mount>, text: string) {
  const button = wrapper.findAll('button').find(candidate => candidate.text().includes(text));
  if (!button)
    throw new Error(`Missing button: ${text}`);
  return button;
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  Reflect.deleteProperty(window, 'voxweaver');
  document.head.querySelectorAll('style[data-page-style]').forEach(element => element.remove());
  document.body.className = '';
  document.body.innerHTML = '';
});

describe('post demo navigation', () => {
  it('整体页提供五个模块入口和五个后期侧栏入口', async () => {
    const { router, wrapper } = await mountPage(WorkspacePostPage, '/pages/overall-post');
    const moduleTargets = [
      ['文本整理', '/pages/overall-text'],
      ['角色管理', '/pages/overall-role'],
      ['音频生成', '/pages/overall-audio'],
      ['后期处理', '/pages/overall-post'],
      ['设置', '/pages/overall-settings'],
    ] as const;

    expect(wrapper.findAll('.activity-rail .demo-module-button')).toHaveLength(5);
    for (const [label, path] of moduleTargets) {
      await wrapper.get(`.activity-rail button[aria-label="${label}"]`).trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(path);
    }

    const pageTargets = [
      ['时间轴对齐', '/pages/timeline-alignment'],
      ['响度一致性', '/pages/loudness-consistency'],
      ['章节摘要生成', '/pages/chapter-summary'],
      ['章节封面生成', '/pages/chapter-cover'],
      ['导出 tar 包', '/pages/tar-export'],
    ] as const;

    expect(wrapper.findAll('.context-sidebar .demo-page-button')).toHaveLength(5);
    for (const [label, path] of pageTargets) {
      await buttonByText(wrapper, label).trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(path);
    }

    wrapper.unmount();
  });

  it('五个后期工作台共用五模块、五侧栏入口且不伪造章节音频合并路由', async () => {
    const { wrapper } = await mountPage(PostWorkbenchFrame, '/pages/timeline-alignment');

    expect(wrapper.findAll('.post-activity .demo-module-button')).toHaveLength(5);
    expect(wrapper.findAll('.post-sidebar .demo-page-button')).toHaveLength(5);
    expect(wrapper.get('.post-nav-item--group').text()).toContain('章节音频合并');
    expect(wrapper.find('.post-nav-item--group').attributes('aria-disabled')).toBe('true');

    wrapper.unmount();
  });
});

describe('timeline alignment interactions', () => {
  it('片段、刻度和剧本文本同步选择并更新当前时间', async () => {
    const { wrapper } = await mountPage(TimelineAlignmentPage, '/pages/timeline-alignment');

    await wrapper.get('[data-clip-id="P-018"]').trigger('click');
    expect(wrapper.get('[data-testid="current-clip-id"]').text()).toBe('P-018');
    expect(wrapper.get('[data-testid="timeline-current-time"]').text()).toContain('00:00.000');

    await wrapper.get('[data-tick-id="P-021"]').trigger('click');
    expect(wrapper.get('[data-testid="current-clip-id"]').text()).toBe('P-021');
    expect(wrapper.get('[data-testid="timeline-current-time"]').text()).toContain('00:19.800');

    await wrapper.get('[data-script-id="P-024"]').trigger('click');
    expect(wrapper.get('[data-testid="current-clip-id"]').text()).toBe('P-024');
    expect(wrapper.get('[data-clip-id="P-024"]').classes()).toContain('is-selected');
    expect(wrapper.text()).toContain('P-024 已定位；有效状态保持不变');

    wrapper.unmount();
  });

  it('播放、磁吸和缩放仅改变视觉且缩放受限', async () => {
    const { wrapper } = await mountPage(TimelineAlignmentPage, '/pages/timeline-alignment');
    const playButton = wrapper.get('[data-testid="timeline-play"]');

    expect(playButton.attributes('aria-pressed')).toBe('true');
    await playButton.trigger('click');
    expect(playButton.attributes('aria-pressed')).toBe('false');
    expect(wrapper.text()).toContain('已暂停（视觉）');

    await wrapper.get('[data-testid="snap-switch"]').trigger('click');
    expect(wrapper.text()).toContain('磁吸：关闭');

    for (let index = 0; index < 6; index += 1)
      await wrapper.get('[data-testid="zoom-in"]').trigger('click');
    expect(wrapper.get('[data-testid="zoom-value"]').text()).toBe('缩放 150%');
    expect(wrapper.get('[data-testid="zoom-in"]').attributes('disabled')).toBeDefined();

    for (let index = 0; index < 6; index += 1)
      await wrapper.get('[data-testid="zoom-out"]').trigger('click');
    expect(wrapper.get('[data-testid="zoom-value"]').text()).toBe('缩放 75%');
    expect(wrapper.get('[data-testid="zoom-out"]').attributes('disabled')).toBeDefined();

    wrapper.unmount();
  });
});

describe('loudness interactions', () => {
  it('选择候选后经确认 Dialog 切换为已应用演示状态', async () => {
    const { wrapper } = await mountPage(LoudnessConsistencyPage, '/pages/loudness-consistency');

    await wrapper.get('[data-candidate-id="P-018"]').trigger('click');
    expect(wrapper.get('[data-testid="selected-loudness"]').text()).toContain('P-018');
    await wrapper.get('[data-testid="apply-loudness"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="loudness-apply-dialog"]').isVisible()).toBe(true);

    await wrapper.get('[data-testid="confirm-loudness-apply"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-candidate-id="P-018"]').text()).toContain('已应用演示状态');
    expect(wrapper.text()).toContain('响度目标、真峰值与输出标准尚未确认');

    wrapper.unmount();
  });
});

describe('chapter summary interactions', () => {
  it('编辑摘要时更新字数和本地草稿状态，确认后更新版本标签', async () => {
    const { wrapper } = await mountPage(ChapterSummaryPage, '/pages/chapter-summary');
    const textarea = wrapper.get('textarea[data-testid="summary-input"]');

    await textarea.setValue('雨夜来客。');
    expect(wrapper.get('[data-testid="summary-count"]').text()).toBe('5 / 360 字');
    expect(wrapper.text()).toContain('本地草稿 · 已保存到当前页面');

    await wrapper.get('[data-testid="show-summary-difference"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-testid="summary-difference-drawer"]').isVisible()).toBe(true);

    await wrapper.get('[data-history-version="v2"]').trigger('click');
    expect(wrapper.get('[data-testid="history-preview"]').text()).toContain('不能恢复为当前有效输入');
    expect((textarea.element as HTMLTextAreaElement).value).toBe('雨夜来客。');

    await wrapper.get('[data-testid="confirm-summary"]').trigger('click');
    expect(wrapper.get('[data-testid="summary-version-label"]').text()).toBe('v3 · 本地已确认');

    wrapper.unmount();
  });
});

describe('chapter cover interactions', () => {
  it('候选选择同步 Inspector，已失效候选不能确认，正常候选经确认更新标签', async () => {
    const { wrapper } = await mountPage(ChapterCoverPage, '/pages/chapter-cover');

    await wrapper.get('[data-cover-id="01"]').trigger('click');
    expect(wrapper.get('[data-testid="selected-cover-label"]').text()).toContain('候选 01');

    await wrapper.get('[data-cover-id="03"]').trigger('click');
    expect(wrapper.get('[data-testid="confirm-cover"]').attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="selected-cover-label"]').text()).toContain('已失效');
    expect(wrapper.text()).toContain('不可确认');

    await wrapper.get('[data-cover-id="04"]').trigger('click');
    await wrapper.get('[data-testid="retry-cover"]').trigger('click');
    expect(wrapper.get('[data-cover-id="04"]').text()).toContain('重试演示就绪');
    expect(wrapper.get('[data-testid="confirm-cover"]').attributes('disabled')).toBeDefined();

    await wrapper.get('[data-cover-id="01"]').trigger('click');
    await wrapper.get('[data-testid="confirm-cover"]').trigger('click');
    await flushPromises();
    await wrapper.get('[data-testid="confirm-cover-dialog"]').trigger('click');
    await flushPromises();
    expect(wrapper.get('[data-cover-id="01"]').text()).toContain('本地已确认');

    wrapper.unmount();
  });
});

describe('tar export and offline player interactions', () => {
  it('缺失或已失效产物保持导出门禁，并从 tar 入口进入离线播放器', async () => {
    const { router, wrapper } = await mountPage(TarExportPage, '/pages/tar-export');

    expect(wrapper.get('[data-testid="export-tar"]').attributes('disabled')).toBeDefined();
    expect(wrapper.text()).toContain('存在 2 项缺失或已失效产物，不能导出');
    await wrapper.get('[data-testid="recheck-artifacts"]').trigger('click');
    expect(wrapper.get('[data-testid="export-check-message"]').text()).toContain('2 项阻塞');

    await buttonByText(wrapper, '打开离线播放器预览').trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/pages/offline-player-export');

    wrapper.unmount();
  });

  it('离线播放器的节点、剧本文本、标题摘要和时间保持同步', async () => {
    const { wrapper } = await mountPage(OfflinePlayerExportPage, '/pages/offline-player-export');

    await wrapper.get('[data-node-id="P-018"]').trigger('click');
    expect(wrapper.get('[data-testid="offline-title-summary"]').text()).toContain('P-018 · 雨夜旧宅');
    expect(wrapper.get('[data-testid="offline-current-time"]').text()).toContain('00:00.000');

    await wrapper.get('[data-transcript-id="P-024"]').trigger('click');
    expect(wrapper.get('[data-node-id="P-024"]').classes()).toContain('is-current');
    expect(wrapper.get('[data-transcript-id="P-024"]').classes()).toContain('is-current');
    expect(wrapper.get('[data-testid="offline-title-summary"]').text()).toContain('P-024 · 让开门');

    const playButton = wrapper.get('[data-testid="offline-play"]');
    await playButton.trigger('click');
    expect(wrapper.get('[data-testid="offline-title-summary"]').text()).toContain('已暂停');

    wrapper.unmount();
  });
});

describe('post demo side-effect boundary', () => {
  it('源码不包含 IPC、网络、存储、媒体、生成或文件导出调用', () => {
    const sources = [
      timelineSource,
      loudnessSource,
      chapterSummarySource,
      chapterCoverSource,
      tarExportSource,
      offlinePlayerSource,
      postWorkbenchSource,
    ].join('\n');

    const forbiddenPatterns = [
      /\bfetch\s*\(/u,
      /\bXMLHttpRequest\b/u,
      /\bWebSocket\b/u,
      /\bipcRenderer\b/u,
      /window\.voxweaver/u,
      /\blocalStorage\b/u,
      /\bsessionStorage\b/u,
      /\bnavigator\.storage\b/u,
      /\bnew\s+Audio\b/u,
      /\bMediaSource\b/u,
      /\bcreateObjectURL\s*\(/u,
      /\bshowOpenFilePicker\s*\(/u,
      /\b(?:generateImage|generateSummary|exportTar|writeFile|openPath)\s*\(/u,
      /from\s+['"][^'"]*(?:mock|fixture|fake-data)[^'"]*['"]/u,
      /\bsetTimeout\s*\(/u,
      /\bsetInterval\s*\(/u,
    ];

    for (const pattern of forbiddenPatterns)
      expect(sources).not.toMatch(pattern);
  });

  it('运行交互不访问桌面桥、fetch、storage、Audio 或 MediaSource', async () => {
    const fetchSpy = vi.fn();
    const audioConstructor = vi.fn();
    const mediaSourceConstructor = vi.fn();
    const desktopAccess = vi.fn();
    const storageGet = vi.spyOn(Storage.prototype, 'getItem');
    const storageSet = vi.spyOn(Storage.prototype, 'setItem');

    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Audio', audioConstructor);
    vi.stubGlobal('MediaSource', mediaSourceConstructor);
    Object.defineProperty(window, 'voxweaver', {
      configurable: true,
      value: new Proxy({}, {
        get: (_target, property) => {
          desktopAccess(property);
          return vi.fn();
        },
      }),
    });

    const pages: readonly [Component, string, string][] = [
      [TimelineAlignmentPage, '/pages/timeline-alignment', '[data-testid="timeline-play"]'],
      [LoudnessConsistencyPage, '/pages/loudness-consistency', '[data-candidate-id="P-018"]'],
      [ChapterSummaryPage, '/pages/chapter-summary', '[data-testid="regenerate-summary"]'],
      [ChapterCoverPage, '/pages/chapter-cover', '[data-cover-id="01"]'],
      [TarExportPage, '/pages/tar-export', '[data-testid="recheck-artifacts"]'],
      [OfflinePlayerExportPage, '/pages/offline-player-export', '[data-node-id="P-018"]'],
    ];

    for (const [component, path, selector] of pages) {
      const { wrapper } = await mountPage(component, path);
      await wrapper.get(selector).trigger('click');
      await flushPromises();
      wrapper.unmount();
    }

    expect(desktopAccess).not.toHaveBeenCalled();
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(storageGet).not.toHaveBeenCalled();
    expect(storageSet).not.toHaveBeenCalled();
    expect(audioConstructor).not.toHaveBeenCalled();
    expect(mediaSourceConstructor).not.toHaveBeenCalled();
  });
});
