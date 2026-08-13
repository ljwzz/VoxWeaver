import { readFile } from 'node:fs/promises';
import path from 'node:path';

import { flushPromises, mount } from '@vue/test-utils';
import ElementPlus from 'element-plus';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { nextTick } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import { appPages } from '@/pages';
import WorkspaceAudioPage from '../workspace/WorkspaceAudioPage.vue';
import AsrLowMatchReviewPage from './AsrLowMatchReviewPage.vue';
import ChapterGenerationStatusPage from './ChapterGenerationStatusPage.vue';
import ChapterParametersPage from './ChapterParametersPage.vue';
import OverlayAudioStaleConfirmPage from './OverlayAudioStaleConfirmPage.vue';
import OverlayCancelGenerationPage from './OverlayCancelGenerationPage.vue';
import SelectionRequirementsPage from './SelectionRequirementsPage.vue';
import SplitStalePropagationPage from './SplitStalePropagationPage.vue';

vi.mock('@/demo/useDemoFeedback', () => ({
  showDemoFeedback: vi.fn(),
}));

const testPage = { template: '<div />' };
const selectStub = {
  name: 'ElSelect',
  inheritAttrs: false,
  props: ['modelValue'],
  emits: ['update:modelValue'],
  template: `
    <select
      v-bind="$attrs"
      :value="modelValue"
      @change="$emit('update:modelValue', $event.target.value)"
    >
      <slot />
    </select>
  `,
};
const optionStub = {
  name: 'ElOption',
  props: ['label', 'value'],
  template: '<option :value="value">{{ label }}</option>',
};
const audioComponents = [
  WorkspaceAudioPage,
  ChapterParametersPage,
  SelectionRequirementsPage,
  AsrLowMatchReviewPage,
  ChapterGenerationStatusPage,
  SplitStalePropagationPage,
] as const;

async function createTestRouter(initialPath: string) {
  const router = createRouter({
    history: createMemoryHistory(),
    routes: appPages.map(page => ({
      component: testPage,
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

async function mountAudioPage(
  component: (typeof audioComponents)[number] | typeof OverlayAudioStaleConfirmPage | typeof OverlayCancelGenerationPage,
  initialPath: string,
) {
  const router = await createTestRouter(initialPath);
  const wrapper = mount(component, {
    attachTo: document.body,
    global: {
      plugins: [router, ElementPlus],
      stubs: {
        ElOption: optionStub,
        ElSelect: selectStub,
        teleport: true,
        transition: false,
      },
    },
  });
  await flushPromises();
  return { router, wrapper };
}

function buttonByText(root: ParentNode, text: string): HTMLButtonElement {
  const button = [...root.querySelectorAll('button')]
    .find(candidate => candidate.textContent?.includes(text));
  if (!(button instanceof HTMLButtonElement))
    throw new Error(`Missing button: ${text}`);
  return button;
}

afterEach(() => {
  vi.restoreAllMocks();
  document.head.querySelectorAll('style[data-page-style]').forEach(element => element.remove());
  document.body.replaceChildren();
  document.body.className = '';
});

describe('audio demo navigation', () => {
  it('整体页和五个详情页都复用五模块及五个音频子页面导航', async () => {
    const paths = [
      '/pages/overall-audio',
      '/pages/audio-chapter-parameters',
      '/pages/audio-selection-requirements',
      '/pages/audio-asr-review',
      '/pages/audio-chapter-generation',
      '/pages/audio-stale-propagation',
    ];

    for (const [index, component] of audioComponents.entries()) {
      const { wrapper } = await mountAudioPage(component, paths[index]!);
      expect(wrapper.findAll('[data-module-key]')).toHaveLength(5);
      expect(wrapper.findAll('[data-page-slug]')).toHaveLength(5);
      wrapper.unmount();
      document.body.replaceChildren();
    }
  });

  it('五模块按钮和五个音频子页面按钮进入对应预览路由', async () => {
    const { router, wrapper } = await mountAudioPage(
      ChapterParametersPage,
      '/pages/audio-chapter-parameters',
    );
    const moduleTargets = {
      audio: '/pages/overall-audio',
      post: '/pages/overall-post',
      role: '/pages/overall-role',
      settings: '/pages/overall-settings',
      text: '/pages/overall-text',
    } as const;

    for (const [moduleKey, path] of Object.entries(moduleTargets)) {
      await wrapper.get(`[data-module-key="${moduleKey}"]`).trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(path);
    }

    const pageSlugs = [
      'audio-chapter-parameters',
      'audio-selection-requirements',
      'audio-asr-review',
      'audio-chapter-generation',
      'audio-stale-propagation',
    ] as const;
    for (const slug of pageSlugs) {
      await wrapper.get(`[data-page-slug="${slug}"]`).trigger('click');
      await flushPromises();
      expect(router.currentRoute.value.path).toBe(`/pages/${slug}`);
    }

    wrapper.unmount();
  });
});

describe('chapter parameters interactions', () => {
  it('搜索、状态和范围筛选章节，并允许选择可见章节', async () => {
    const { wrapper } = await mountAudioPage(
      ChapterParametersPage,
      '/pages/audio-chapter-parameters',
    );
    const search = wrapper.get('input[data-testid="audio-chapter-search"]');
    await search.setValue('旧园');
    expect(wrapper.findAll('.chapter-card')).toHaveLength(1);
    expect(wrapper.get('.chapter-card').text()).toContain('第 10 章');

    await search.setValue('');
    const selects = wrapper.findAll('select');
    expect(selects).toHaveLength(2);
    await selects[0]!.setValue('complete');
    expect(wrapper.findAll('.chapter-card')).toHaveLength(1);
    expect(wrapper.get('.chapter-card').text()).toContain('第 13 章');

    await selects[0]!.setValue('all');
    await selects[1]!.setValue('current');
    expect(wrapper.findAll('.chapter-card')).toHaveLength(1);
    expect(wrapper.get('.chapter-card').attributes('data-chapter-id')).toBe('12');

    await selects[1]!.setValue('volume');
    await wrapper.get('[data-chapter-id="13"]').trigger('click');
    expect(wrapper.get('.chapter-context').text()).toContain('第 13 章');
    expect(wrapper.get('.chapter-context').text()).toContain('灯下问答');
    wrapper.unmount();
  });

  it('播放视觉状态互斥，再次点击当前行会暂停', async () => {
    const { wrapper } = await mountAudioPage(
      ChapterParametersPage,
      '/pages/audio-chapter-parameters-1280',
    );
    const row18 = wrapper.get('[data-row-id="para_12_018"]');
    const row21 = wrapper.get('[data-row-id="para_12_021"]');
    expect(wrapper.get('[data-page-slug="audio-chapter-parameters"]').classes())
      .toContain('audio-page-link--equivalent');
    expect(row21.classes()).toContain('audio-row--playing');

    await row18.get('.play-control').trigger('click');
    expect(row18.classes()).toContain('audio-row--playing');
    expect(row21.classes()).not.toContain('audio-row--playing');

    await row18.get('.play-control').trigger('click');
    expect(row18.classes()).not.toContain('audio-row--playing');
    wrapper.unmount();
  });

  it('inspector 可折叠和重新展开', async () => {
    const { wrapper } = await mountAudioPage(
      ChapterParametersPage,
      '/pages/audio-chapter-parameters',
    );
    expect(wrapper.find('.audio-inspector').exists()).toBe(true);
    await wrapper.get('[aria-label="折叠章节参数"]').trigger('click');
    expect(wrapper.find('.audio-inspector').exists()).toBe(false);
    expect(wrapper.find('.audio-inspector-collapsed').exists()).toBe(true);
    await wrapper.get('[aria-label="展开章节参数"]').trigger('click');
    expect(wrapper.find('.audio-inspector').exists()).toBe(true);
    wrapper.unmount();
  });
});

describe('selection and ASR review interactions', () => {
  it('显示取消选区状态，并由现有恢复入口和 Esc 返回章节参数', async () => {
    const first = await mountAudioPage(
      SelectionRequirementsPage,
      '/pages/audio-selection-requirements',
    );
    await first.wrapper.get('.selection-preset-bar button:nth-of-type(3)').trigger('click');
    expect(first.wrapper.get('[data-selection-state="none"]').text()).toContain('选区已取消');
    await buttonByText(first.wrapper.element, '取消选择 · 恢复章节参数').click();
    await flushPromises();
    expect(first.router.currentRoute.value.path).toBe('/pages/audio-chapter-parameters');
    first.wrapper.unmount();
    document.body.replaceChildren();

    const second = await mountAudioPage(
      SelectionRequirementsPage,
      '/pages/audio-selection-requirements',
    );
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await flushPromises();
    expect(second.router.currentRoute.value.path).toBe('/pages/audio-chapter-parameters');
    second.wrapper.unmount();
  });

  it('asr 低匹配详情可收起，并可人工确认成显式已确认状态', async () => {
    const { wrapper } = await mountAudioPage(
      AsrLowMatchReviewPage,
      '/pages/audio-asr-review',
    );
    const lowMatchRow = wrapper.get('[data-row-id="para_12_018"]');
    expect(lowMatchRow.text()).toContain('⚠ 转写结果不一致，待复核');
    expect(lowMatchRow.text()).toContain('82%');
    expect(lowMatchRow.classes()).toContain('audio-row--low-match');

    buttonByText(wrapper.element, '收起').click();
    await nextTick();
    expect(wrapper.get('.asr-diff-panel').classes()).toContain('asr-diff-panel--collapsed');
    buttonByText(wrapper.element, '展开').click();
    await nextTick();
    buttonByText(wrapper.element, '人工确认').click();
    await nextTick();

    expect(lowMatchRow.text()).toContain('已人工确认');
    expect(lowMatchRow.classes()).toContain('audio-row--success');
    expect(lowMatchRow.classes()).not.toContain('audio-row--low-match');
    expect(wrapper.find('.asr-diff-panel').exists()).toBe(false);
    expect(lowMatchRow.text()).not.toContain('发音错误');
    expect(wrapper.text()).toContain('不把 ASR 证据改写成“发音错误”');
    wrapper.unmount();
  });
});

describe('generation and overlay interactions', () => {
  it('失败行重试不改变成功行', async () => {
    const { wrapper } = await mountAudioPage(
      ChapterGenerationStatusPage,
      '/pages/audio-chapter-generation',
    );
    const successRow = wrapper.get('[data-row-id="para_12_021"]');
    const failedRow = wrapper.get('[data-row-id="para_12_022"]');
    expect(successRow.classes()).toContain('audio-row--success');
    expect(failedRow.classes()).toContain('audio-row--generation-failed');
    expect(failedRow.text()).toContain('生成失败');

    buttonByText(failedRow.element, '重试本行').click();
    await nextTick();
    expect(wrapper.get('[data-row-id="para_12_022"]').text()).toContain('排队');
    expect(wrapper.get('[data-row-id="para_12_021"]').classes()).toContain('audio-row--success');
    expect(wrapper.get('[data-row-id="para_12_021"]').text()).toContain('高匹配');
    wrapper.unmount();
  });

  it('重试失败项清空失败计数且不回退成功行', async () => {
    const { wrapper } = await mountAudioPage(
      ChapterGenerationStatusPage,
      '/pages/audio-chapter-generation',
    );
    const taskSummary = wrapper.get('.task-card');
    buttonByText(taskSummary.element, '重试失败项').click();
    await nextTick();

    expect(taskSummary.text()).toContain('失败 0');
    expect(taskSummary.text()).toContain('本地重试 2');
    expect(wrapper.get('[data-row-id="para_12_022"]').text()).toContain('排队');
    expect(wrapper.get('[data-row-id="para_12_021"]').classes()).toContain('audio-row--success');
    wrapper.unmount();
  });

  it('取消生成只停止排队和生成中行并保留完成结果', async () => {
    const { wrapper } = await mountAudioPage(
      ChapterGenerationStatusPage,
      '/pages/audio-chapter-generation',
    );
    await buttonByText(wrapper.element, '取消').click();
    await nextTick();
    await buttonByText(document.body, '确认取消').click();
    await flushPromises();

    expect(wrapper.text()).toContain('已完成 17 条结果保留');
    expect(wrapper.get('[data-row-id="para_12_018"]').text()).toContain('已停止');
    expect(wrapper.get('[data-row-id="para_12_019"]').text()).toContain('已停止');
    expect(wrapper.get('[data-row-id="para_12_021"]').classes()).toContain('audio-row--success');
    expect(wrapper.get('[data-row-id="para_12_021"]').text()).toContain('高匹配');
    wrapper.unmount();
  });

  it('失效 Overlay 取消和确认都返回来源页并保持历史与新段落语义', async () => {
    const cancelled = await mountAudioPage(
      OverlayAudioStaleConfirmPage,
      '/pages/audio-stale-confirm-dialog',
    );
    expect(cancelled.wrapper.text()).toContain('历史记录不会删除');
    expect(cancelled.wrapper.text()).toContain('需要重新生成');
    await buttonByText(cancelled.wrapper.element, '取消').click();
    await flushPromises();
    expect(cancelled.router.currentRoute.value.path).toBe('/pages/audio-stale-propagation');
    cancelled.wrapper.unmount();
    document.body.replaceChildren();

    const confirmed = await mountAudioPage(
      OverlayAudioStaleConfirmPage,
      '/pages/audio-stale-confirm-dialog',
    );
    await buttonByText(confirmed.wrapper.element, '确认并返回').click();
    await flushPromises();
    expect(confirmed.router.currentRoute.value.path).toBe('/pages/audio-stale-propagation');
    confirmed.wrapper.unmount();
  });

  it('取消生成 Overlay 的两个动作返回整章页并区分取消语义', async () => {
    const continued = await mountAudioPage(
      OverlayCancelGenerationPage,
      '/pages/audio-cancel-generation-dialog',
    );
    await buttonByText(continued.wrapper.element, '继续生成').click();
    await flushPromises();
    expect(continued.router.currentRoute.value.fullPath).toBe('/pages/audio-chapter-generation');
    continued.wrapper.unmount();
    document.body.replaceChildren();

    const cancelled = await mountAudioPage(
      OverlayCancelGenerationPage,
      '/pages/audio-cancel-generation-dialog',
    );
    await buttonByText(cancelled.wrapper.element, '确认取消').click();
    await flushPromises();
    expect(cancelled.router.currentRoute.value.path).toBe('/pages/audio-chapter-generation');
    expect(cancelled.router.currentRoute.value.query.preview).toBe('cancelled');
    cancelled.wrapper.unmount();
  });
});

describe('local-only boundary', () => {
  it('源码和挂载过程不调用 IPC、fetch、storage、Provider 接口或真实 Audio', async () => {
    const audioDirectory = path.resolve(process.cwd(), 'renderer/src/pages/audio');
    const targetFiles = [
      'AsrLowMatchReviewPage.vue',
      'ChapterGenerationStatusPage.vue',
      'ChapterParametersPage.vue',
      'OverlayAudioStaleConfirmPage.vue',
      'OverlayCancelGenerationPage.vue',
      'SelectionRequirementsPage.vue',
      'SplitStalePropagationPage.vue',
      'components/AudioActivityRail.vue',
      'components/AudioChapterSidebar.vue',
      'components/AudioInspectorPanel.vue',
      'components/AudioParagraphRow.vue',
      'components/AudioWorkspaceShell.vue',
      '../workspace/WorkspaceAudioPage.vue',
    ];
    const sources = await Promise.all(targetFiles.map(file => readFile(path.resolve(audioDirectory, file), 'utf8')));
    const combinedSource = sources.join('\n');

    expect(combinedSource).not.toMatch(/window\.voxweaver|ipcRenderer|\bfetch\s*\(|\bnew\s+Audio\s*\(|<audio\b/i);
    expect(combinedSource).not.toMatch(/localStorage|sessionStorage|indexedDB|navigator\.storage/i);
    expect(combinedSource).not.toMatch(/from\s+['"][^'"]*(?:app-core|application|provider|mock|fixture|fake-data)[^'"]*['"]/i);
    expect(audioDirectory).toMatch(/\/pages\/audio$/);

    const originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn();
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: fetchSpy,
    });
    const getItemSpy = vi.spyOn(Storage.prototype, 'getItem');
    const setItemSpy = vi.spyOn(Storage.prototype, 'setItem');
    const ipcGetter = vi.fn();
    Object.defineProperty(window, 'voxweaver', {
      configurable: true,
      get: ipcGetter,
    });
    const originalAudio = globalThis.Audio;
    const audioConstructor = vi.fn();
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: audioConstructor,
    });

    for (const [index, component] of audioComponents.entries()) {
      const path = [
        '/pages/overall-audio',
        '/pages/audio-chapter-parameters',
        '/pages/audio-selection-requirements',
        '/pages/audio-asr-review',
        '/pages/audio-chapter-generation',
        '/pages/audio-stale-propagation',
      ][index]!;
      const { wrapper } = await mountAudioPage(component, path);
      wrapper.unmount();
      document.body.replaceChildren();
    }

    expect(fetchSpy).not.toHaveBeenCalled();
    expect(getItemSpy).not.toHaveBeenCalled();
    expect(setItemSpy).not.toHaveBeenCalled();
    expect(ipcGetter).not.toHaveBeenCalled();
    expect(audioConstructor).not.toHaveBeenCalled();
    Object.defineProperty(globalThis, 'Audio', {
      configurable: true,
      value: originalAudio,
    });
    Object.defineProperty(globalThis, 'fetch', {
      configurable: true,
      value: originalFetch,
    });
  });
});
