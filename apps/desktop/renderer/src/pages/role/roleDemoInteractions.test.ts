import type { Component } from 'vue';

import { flushPromises, mount } from '@vue/test-utils';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { defineComponent, h } from 'vue';
import { createMemoryHistory, createRouter } from 'vue-router';
import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import { getDemoPageRouteName } from '@/demo/navigation';
import { appPages } from '@/pages';
import WorkspaceRolePage from '../workspace/WorkspaceRolePage.vue';
import CharacterVoiceRefinementPage from './CharacterVoiceRefinementPage.vue';
import CrowdVoicePoolPage from './CrowdVoicePoolPage.vue';
import PrimaryCharacterMarkingPage from './PrimaryCharacterMarkingPage.vue';

const { showDemoFeedback } = vi.hoisted(() => ({ showDemoFeedback: vi.fn() }));

vi.mock('@/demo/useDemoFeedback', () => ({ showDemoFeedback }));

const ElInputStub = defineComponent({
  name: 'ElInput',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    modelValue: { default: '' },
    placeholder: String,
  },
  emits: ['input', 'update:modelValue'],
  setup(props, { attrs, emit }) {
    return () => h('input', {
      ...attrs,
      disabled: props.disabled,
      placeholder: props.placeholder,
      value: String(props.modelValue ?? ''),
      onInput: (event: Event) => {
        const value = (event.target as HTMLInputElement).value;
        emit('update:modelValue', value);
        emit('input', value);
      },
    });
  },
});

const ElSelectStub = defineComponent({
  name: 'ElSelect',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    modelValue: { default: '' },
  },
  emits: ['change', 'update:modelValue'],
  setup(props, { attrs, emit, slots }) {
    return () => h('select', {
      ...attrs,
      disabled: props.disabled,
      value: String(props.modelValue ?? ''),
      onChange: (event: Event) => {
        const value = (event.target as HTMLSelectElement).value;
        emit('update:modelValue', value);
        emit('change', value);
      },
    }, slots.default?.());
  },
});

const ElOptionStub = defineComponent({
  name: 'ElOption',
  props: {
    disabled: Boolean,
    label: { required: true, type: String },
    value: { required: true, type: String },
  },
  setup(props) {
    return () => h('option', {
      disabled: props.disabled,
      value: props.value,
    }, props.label);
  },
});

const ElButtonStub = defineComponent({
  name: 'ElButton',
  inheritAttrs: false,
  props: {
    disabled: Boolean,
    type: String,
  },
  setup(props, { attrs, slots }) {
    return () => h('button', {
      ...attrs,
      disabled: props.disabled,
      type: 'button',
    }, slots.default?.());
  },
});

const ElDialogStub = defineComponent({
  name: 'ElDialog',
  inheritAttrs: false,
  props: {
    modelValue: Boolean,
    title: String,
  },
  setup(props, { attrs, slots }) {
    return () => props.modelValue
      ? h('section', { ...attrs, role: 'dialog' }, [
          h('h2', props.title),
          slots.default?.(),
          h('footer', slots.footer?.()),
        ])
      : null;
  },
});

function passthroughStub(name: string, tag = 'div') {
  return defineComponent({
    name,
    setup(_, { attrs, slots }) {
      return () => h(tag, attrs, slots.default?.());
    },
  });
}

const elementPlusStubs = {
  ElButton: ElButtonStub,
  ElDialog: ElDialogStub,
  ElDropdown: passthroughStub('ElDropdown'),
  ElDropdownItem: passthroughStub('ElDropdownItem'),
  ElDropdownMenu: passthroughStub('ElDropdownMenu'),
  ElInput: ElInputStub,
  ElOption: ElOptionStub,
  ElSelect: ElSelectStub,
  ElTag: passthroughStub('ElTag', 'span'),
  ElTooltip: passthroughStub('ElTooltip', 'span'),
};

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

async function mountRolePage(component: Component, initialPath: string) {
  const router = await createTestRouter(initialPath);
  const wrapper = mount(component, {
    attachTo: document.body,
    global: {
      components: elementPlusStubs,
      plugins: [router],
    },
  });
  await flushPromises();
  return { router, wrapper };
}

beforeEach(() => {
  showDemoFeedback.mockReset();
});

afterEach(() => {
  document.body.className = '';
  document.body.replaceChildren();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('角色管理演示导航', () => {
  it.each([
    ['工作台', WorkspaceRolePage, '/pages/overall-role'],
    ['主要角色标记', PrimaryCharacterMarkingPage, '/pages/primary-character-marking'],
    ['路人声音池', CrowdVoicePoolPage, '/pages/crowd-voice-pool'],
    ['角色声音精修', CharacterVoiceRefinementPage, '/pages/character-voice-refinement'],
  ])('%s 接入五个模块入口和三个角色详情入口', async (_, component, initialPath) => {
    const { router, wrapper } = await mountRolePage(component, initialPath);

    expect(wrapper.findAllComponents(DemoModuleButton)).toHaveLength(5);
    expect(wrapper.findAllComponents(DemoPageButton)).toHaveLength(3);
    expect(wrapper.findAllComponents(DemoPageButton).map(button => button.props('pageSlug'))).toEqual([
      'primary-character-marking',
      'crowd-voice-pool',
      'character-voice-refinement',
    ]);

    const crowdVoiceButton = wrapper.findAllComponents(DemoPageButton)
      .find(button => button.props('pageSlug') === 'crowd-voice-pool');
    expect(crowdVoiceButton).toBeDefined();
    await crowdVoiceButton!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/pages/crowd-voice-pool');

    const postButton = wrapper.findAllComponents(DemoModuleButton)
      .find(button => button.props('moduleKey') === 'post');
    expect(postButton).toBeDefined();
    await postButton!.trigger('click');
    await flushPromises();
    expect(router.currentRoute.value.path).toBe('/pages/overall-post');
    wrapper.unmount();
  });
});

describe('主要角色标记假交互', () => {
  it('搜索和筛选只派生固定角色列表', async () => {
    const { wrapper } = await mountRolePage(PrimaryCharacterMarkingPage, '/pages/primary-character-marking');

    await wrapper.get('[data-testid="role-search"]').setValue('王熙凤');
    expect(wrapper.findAll('.character-row')).toHaveLength(1);
    expect(wrapper.get('.character-row').text()).toContain('王熙凤');

    await wrapper.get('[data-testid="role-search"]').setValue('');
    await wrapper.get('[data-testid="confirmation-filter"]').setValue('pending');
    expect(wrapper.findAll('.character-row')).toHaveLength(1);
    expect(wrapper.get('.character-row').text()).toContain('刘姥姥');

    await wrapper.get('[data-testid="confirmation-filter"]').setValue('all');
    await wrapper.get('[data-testid="voice-filter"]').setValue('candidate');
    expect(wrapper.findAll('.character-row')).toHaveLength(1);
    expect(wrapper.get('.character-row').text()).toContain('明快女声 · 候选');
    wrapper.unmount();
  });

  it('本地标记切换产生 dirty，保存后清除 dirty 但保留冲突', async () => {
    const { wrapper } = await mountRolePage(PrimaryCharacterMarkingPage, '/pages/primary-character-marking');
    const saveButton = wrapper.get('[data-testid="save-main-marks"]');

    expect(saveButton.attributes('disabled')).toBeDefined();
    expect(wrapper.get('[data-testid="mark-status"]').text()).toContain('已保存于当前预览');

    await wrapper.get('[data-testid="toggle-main-wang-xifeng"]').trigger('click');
    expect(wrapper.get('[data-testid="mark-status"]').text()).toContain('有未保存更改');
    expect(saveButton.attributes('disabled')).toBeUndefined();

    await saveButton.trigger('click');
    expect(wrapper.get('[data-testid="mark-status"]').text()).toContain('已保存于当前预览');
    expect(showDemoFeedback).toHaveBeenCalledWith('主要角色标记已保存到当前预览', 'success');

    await wrapper.get('[data-testid="check-conflicts"]').trigger('click');
    expect(wrapper.findAll('.character-row')).toHaveLength(2);
    expect(wrapper.text()).toContain('现有冲突保持待复核');
    expect(wrapper.text()).toContain('声音冲突 2');
    wrapper.unmount();
  });
});

describe('路人声音池假交互', () => {
  it('搜索和三组筛选仅影响固定声音列表', async () => {
    const { wrapper } = await mountRolePage(CrowdVoicePoolPage, '/pages/crowd-voice-pool');

    await wrapper.get('[data-testid="voice-search"]').setValue('贾母');
    expect(wrapper.findAll('.voice-card')).toHaveLength(1);
    expect(wrapper.get('.voice-card').text()).toContain('沉钟');

    await wrapper.get('[data-testid="voice-search"]').setValue('');
    await wrapper.get('[data-testid="age-filter"]').setValue('成熟');
    await wrapper.get('[data-testid="tone-filter"]').setValue('清亮');
    await wrapper.get('[data-testid="voice-status-filter"]').setValue('available');
    expect(wrapper.findAll('.voice-card')).toHaveLength(1);
    expect(wrapper.get('.voice-card').text()).toContain('青砚');
    wrapper.unmount();
  });

  it('播放视觉状态互斥且再次点击会暂停', async () => {
    const { wrapper } = await mountRolePage(CrowdVoicePoolPage, '/pages/crowd-voice-pool');

    expect(wrapper.get('[data-voice-id="chenzhong"]').text()).toContain('正在播放');
    await wrapper.get('[data-testid="play-qingyan"]').trigger('click');
    expect(wrapper.get('[data-voice-id="qingyan"]').text()).toContain('正在播放');
    expect(wrapper.get('[data-voice-id="chenzhong"]').text()).toContain('可播放');

    await wrapper.get('[data-testid="play-qingyan"]').trigger('click');
    expect(wrapper.get('[data-voice-id="qingyan"]').text()).toContain('可播放');
    wrapper.unmount();
  });

  it('临时候选分配不改变永久绑定，声音候选关闭后不进入列表', async () => {
    const { wrapper } = await mountRolePage(CrowdVoicePoolPage, '/pages/crowd-voice-pool');
    const permanentBinding = wrapper.get('[data-testid="permanent-binding-qingyan"]');

    expect(permanentBinding.text()).toBe('未占用 · 可用于临时角色');
    await wrapper.get('[data-testid="assign-temporary"]').trigger('click');
    expect(wrapper.get('[data-testid="assignment-state"]').text()).toContain('已分配为临时候选');
    expect(permanentBinding.text()).toBe('未占用 · 可用于临时角色');

    await wrapper.get('[data-testid="open-candidate-dialog"]').trigger('click');
    expect(wrapper.get('[data-testid="candidate-dialog"]').attributes('role')).toBe('dialog');
    await wrapper.get('[data-testid="candidate-name"]').setValue('纸鸢');
    await wrapper.get('[data-testid="preview-candidate"]').trigger('click');
    expect(wrapper.find('[data-testid="candidate-dialog"]').exists()).toBe(false);
    expect(wrapper.findAll('.voice-card')).toHaveLength(2);
    expect(wrapper.text()).not.toContain('纸鸢');
    wrapper.unmount();
  });
});

describe('角色声音精修假交互', () => {
  it('角色、基础声音和试听短句按正向与反向键盘顺序移动', async () => {
    const { wrapper } = await mountRolePage(CharacterVoiceRefinementPage, '/pages/character-voice-refinement');
    const characterSelect = wrapper.get('[data-testid="character-select"]');
    const baseVoiceSelect = wrapper.get('[data-testid="base-voice-select"]');
    const sentenceSelect = wrapper.get('[data-testid="sentence-select"]');

    await characterSelect.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('当前基础声音');
    await baseVoiceSelect.trigger('keydown', { key: 'Tab' });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('试听短句');
    await sentenceSelect.trigger('keydown', { key: 'Tab', shiftKey: true });
    expect(document.activeElement?.getAttribute('aria-label')).toBe('当前基础声音');
    wrapper.unmount();
  });

  it('保存候选不激活配置，历史和已失效版本保持可见', async () => {
    const { wrapper } = await mountRolePage(CharacterVoiceRefinementPage, '/pages/character-voice-refinement');

    await wrapper.get('[data-version-id="version-b"]').trigger('click');
    expect(wrapper.get('[data-testid="save-version-b"]').text()).toBe('保存为候选');
    await wrapper.get('[data-testid="save-candidate"]').trigger('click');
    expect(wrapper.get('[data-version-id="version-a"]').text()).toContain('当前激活');
    expect(wrapper.get('[data-version-id="version-b"]').text()).toContain('候选');
    expect(wrapper.get('[data-testid="save-version-b"]').text()).toBe('已保存为候选');
    expect(wrapper.find('[data-testid="activated-impact"]').exists()).toBe(false);
    expect(wrapper.text()).toContain('历史 · v2');
    expect(wrapper.text()).toContain('已失效 · v1');
    wrapper.unmount();
  });

  it('激活配置必须先确认，确认后只切换激活标签并显示影响提示', async () => {
    const { wrapper } = await mountRolePage(CharacterVoiceRefinementPage, '/pages/character-voice-refinement');

    await wrapper.get('[data-version-id="version-b"]').trigger('click');
    await wrapper.get('[data-testid="request-activation"]').trigger('click');
    expect(wrapper.get('[data-testid="activation-dialog"]').attributes('role')).toBe('dialog');
    expect(wrapper.get('[data-version-id="version-a"]').text()).toContain('当前激活');
    expect(wrapper.get('[data-version-id="version-b"]').text()).not.toContain('当前激活');

    await wrapper.get('[data-testid="confirm-activation"]').trigger('click');
    expect(wrapper.find('[data-testid="activation-dialog"]').exists()).toBe(false);
    expect(wrapper.get('[data-version-id="version-b"]').text()).toContain('当前激活');
    expect(wrapper.get('[data-testid="activated-impact"]').text()).toContain('仅影响 12 个引用段落');
    expect(wrapper.text()).toContain('历史 · v2');
    expect(wrapper.text()).toContain('已失效 · v1');
    wrapper.unmount();
  });
});

describe('角色页面静态边界', () => {
  it('交互不读取 IPC，不调用 fetch、存储或真实 Audio API', async () => {
    const apiReads: PropertyKey[] = [];
    const fetchSpy = vi.fn();
    const audioSpy = vi.fn();
    const localStorageGetSpy = vi.spyOn(Storage.prototype, 'getItem');
    const localStorageSetSpy = vi.spyOn(Storage.prototype, 'setItem');
    const sessionStorageGetSpy = vi.spyOn(sessionStorage, 'getItem');
    const sessionStorageSetSpy = vi.spyOn(sessionStorage, 'setItem');
    vi.stubGlobal('fetch', fetchSpy);
    vi.stubGlobal('Audio', audioSpy);
    Object.defineProperty(window, 'voxweaver', {
      configurable: true,
      value: new Proxy({}, {
        get(_, property) {
          apiReads.push(property);
          return vi.fn();
        },
      }),
    });

    const primary = await mountRolePage(PrimaryCharacterMarkingPage, '/pages/primary-character-marking');
    await primary.wrapper.get('[data-testid="toggle-main-wang-xifeng"]').trigger('click');
    await primary.wrapper.get('[data-testid="save-main-marks"]').trigger('click');
    primary.wrapper.unmount();

    const pool = await mountRolePage(CrowdVoicePoolPage, '/pages/crowd-voice-pool');
    await pool.wrapper.get('[data-testid="play-qingyan"]').trigger('click');
    await pool.wrapper.get('[data-testid="assign-temporary"]').trigger('click');
    pool.wrapper.unmount();

    const refinement = await mountRolePage(CharacterVoiceRefinementPage, '/pages/character-voice-refinement');
    await refinement.wrapper.get('[data-version-id="version-b"]').trigger('click');
    await refinement.wrapper.get('[data-testid="save-candidate"]').trigger('click');
    await refinement.wrapper.get('[data-testid="request-activation"]').trigger('click');
    await refinement.wrapper.get('[data-testid="confirm-activation"]').trigger('click');
    refinement.wrapper.unmount();

    expect(apiReads).toEqual([]);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(audioSpy).not.toHaveBeenCalled();
    expect(localStorageGetSpy).not.toHaveBeenCalled();
    expect(localStorageSetSpy).not.toHaveBeenCalled();
    expect(sessionStorageGetSpy).not.toHaveBeenCalled();
    expect(sessionStorageSetSpy).not.toHaveBeenCalled();
  });
});
