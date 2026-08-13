import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, describe, expect, it } from 'vitest';
import { createMemoryHistory, createRouter } from 'vue-router';
import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import { getDemoPageRouteName } from '@/demo/navigation';
import { appPages } from '@/pages';

const testPage = { template: '<div />' };

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

afterEach(() => {
  document.body.className = '';
});

describe('demoModuleButton', () => {
  it('从任意模块页面进入目标落地页并保留 slot 与 class', async () => {
    const router = await createTestRouter('/pages/audio-cancel-generation-dialog');
    const currentWrapper = mount(DemoModuleButton, {
      attrs: { class: 'existing-activity-button' },
      global: { plugins: [router] },
      props: { moduleKey: 'audio' },
      slots: { default: '<span class="existing-icon">音频状态</span>' },
    });

    expect(currentWrapper.element.tagName).toBe('BUTTON');
    expect(currentWrapper.attributes('type')).toBe('button');
    expect(currentWrapper.classes()).toContain('existing-activity-button');
    expect(currentWrapper.get('.existing-icon').text()).toBe('音频状态');
    expect(currentWrapper.attributes('aria-label')).toBe('音频生成');
    expect(currentWrapper.attributes('title')).toBe('音频生成');
    expect(currentWrapper.attributes('aria-current')).toBe('true');

    const targetWrapper = mount(DemoModuleButton, {
      global: { plugins: [router] },
      props: { moduleKey: 'post' },
      slots: { default: '后期' },
    });

    expect(targetWrapper.attributes('aria-current')).toBeUndefined();
    await targetWrapper.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/pages/overall-post');
    expect(targetWrapper.attributes('aria-current')).toBe('true');
    currentWrapper.unmount();
    targetWrapper.unmount();
  });
});

describe('demoPageButton', () => {
  it('进入指定侧栏页面并标记当前页面', async () => {
    const router = await createTestRouter('/pages/audio-chapter-parameters');
    const wrapper = mount(DemoPageButton, {
      attrs: { class: 'existing-sidebar-button' },
      global: { plugins: [router] },
      props: { pageSlug: 'audio-asr-review' },
      slots: { default: '<span class="existing-label">ASR 复核</span>' },
    });

    expect(wrapper.element.tagName).toBe('BUTTON');
    expect(wrapper.attributes('type')).toBe('button');
    expect(wrapper.classes()).toContain('existing-sidebar-button');
    expect(wrapper.get('.existing-label').text()).toBe('ASR 复核');
    expect(wrapper.attributes('aria-current')).toBeUndefined();

    await wrapper.trigger('click');
    await flushPromises();

    expect(router.currentRoute.value.path).toBe('/pages/audio-asr-review');
    expect(wrapper.attributes('aria-current')).toBe('page');
    wrapper.unmount();
  });
});
