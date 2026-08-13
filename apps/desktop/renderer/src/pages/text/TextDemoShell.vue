<script setup lang="ts">
import type { DemoSidebarPageSlug } from '@/demo/navigation';

import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';

const props = defineProps<{
  currentPage: DemoSidebarPageSlug;
  editorAriaLabel: string;
  label: string;
  sidebarSubtitleCompact?: string;
  toolbarDetail: string;
  toolbarDetailCompact?: string;
  toolbarTitle: string;
}>();

const sidebarItems = [
  {
    count: '1',
    label: '文本提取',
    pageSlug: 'text-extraction',
    stateClass: 'sidebar-item--default',
    stateLabel: '默认',
    stateSymbol: '',
  },
  {
    count: '36',
    label: '章节切割',
    pageSlug: 'chapter-splitting',
    stateClass: 'sidebar-item--processing',
    stateLabel: '处理中',
    stateSymbol: '◔',
  },
  {
    count: '12',
    label: '错别字与标点',
    pageSlug: 'proofreading',
    stateClass: 'sidebar-item--review',
    stateLabel: '待复核',
    stateSymbol: '!',
  },
  {
    count: '2',
    label: '角色提取',
    pageSlug: 'character-extraction',
    stateClass: 'sidebar-item--failed',
    stateLabel: '失败',
    stateSymbol: '×',
  },
  {
    count: '3',
    label: '剧本管理',
    pageSlug: 'script-management',
    stateClass: 'sidebar-item--stale',
    stateLabel: '已失效',
    stateSymbol: '↻',
  },
] as const;

function sidebarItemClass(pageSlug: DemoSidebarPageSlug, stateClass: string): string {
  return pageSlug === props.currentPage ? 'sidebar-item--selected' : stateClass;
}
</script>

<template>
  <main class="workspace" :aria-label="label">
    <header class="window-titlebar">
      <img
        class="window-controls"
        src="./assets/window-controls.svg"
        width="42"
        height="10"
        alt=""
        aria-hidden="true"
      >
      <p class="window-title">VoxWeaver · 示例小说</p>
      <p class="window-context">项目工作台</p>
    </header>

    <div class="workspace-body">
      <aside class="activity-rail" aria-label="功能分组导航">
        <div class="activity-list">
          <DemoModuleButton
            class="activity-item activity-item--selected"
            module-key="text"
          >
            <span class="activity-glyph">文</span>
            <span class="selection-bar" aria-hidden="true"></span>
          </DemoModuleButton>
          <DemoModuleButton
            class="activity-item activity-item--role activity-item--review"
            module-key="role"
          >
            <span class="activity-glyph">角</span>
            <span class="activity-marker" aria-hidden="true">!</span>
          </DemoModuleButton>
          <DemoModuleButton
            class="activity-item activity-item--audio activity-item--processing"
            module-key="audio"
          >
            <span class="activity-glyph">音</span>
            <span class="activity-marker" aria-hidden="true">◔</span>
          </DemoModuleButton>
          <DemoModuleButton
            class="activity-item activity-item--post activity-item--stale"
            module-key="post"
          >
            <span class="activity-glyph">后</span>
            <span class="activity-marker" aria-hidden="true">↻</span>
          </DemoModuleButton>
        </div>
        <DemoModuleButton class="activity-item" module-key="settings">
          <span class="activity-glyph">设</span>
        </DemoModuleButton>
      </aside>

      <aside class="context-sidebar" aria-label="文本整理子功能导航">
        <div class="sidebar-content">
          <div class="sidebar-top">
            <header class="sidebar-header">
              <div class="sidebar-heading-row">
                <h1>文本整理</h1>
                <span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span>
              </div>
              <p class="sidebar-subtitle" :class="[{ 'sidebar-subtitle--wide': sidebarSubtitleCompact }]">
                5 个子功能 · 12 项待复核
              </p>
              <p v-if="sidebarSubtitleCompact" class="sidebar-subtitle sidebar-subtitle--compact">
                {{ sidebarSubtitleCompact }}
              </p>
            </header>

            <DemoPageButton
              v-for="item in sidebarItems"
              :key="item.pageSlug"
              :aria-label="`${item.label}，${item.pageSlug === currentPage ? '当前选中' : item.stateLabel}`"
              class="sidebar-item" :class="[sidebarItemClass(item.pageSlug, item.stateClass)]"
              :page-slug="item.pageSlug"
            >
              <span class="sidebar-state" aria-hidden="true">
                {{ item.pageSlug === currentPage ? '✓' : item.stateSymbol }}
              </span>
              <span class="sidebar-label">{{ item.label }}</span>
              <span class="sidebar-count">{{ item.count }}</span>
            </DemoPageButton>
          </div>

          <section class="sidebar-summary" aria-label="项目摘要">
            <h2>示例小说</h2>
            <p>36 章 · 总进度 62%</p>
          </section>
        </div>
        <div class="resize-handle" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true">
          <span aria-hidden="true"></span>
        </div>
      </aside>

      <section class="editor" :aria-label="editorAriaLabel">
        <header class="editor-toolbar">
          <div class="toolbar-context">
            <strong>{{ toolbarTitle }}</strong>
            <span>·</span>
            <span :class="{ 'toolbar-context--wide': toolbarDetailCompact }">{{ toolbarDetail }}</span>
            <span v-if="toolbarDetailCompact" class="toolbar-context--compact">{{ toolbarDetailCompact }}</span>
          </div>
          <div class="toolbar-actions" aria-label="编辑区操作">
            <slot name="toolbar-actions" />
          </div>
        </header>

        <slot />
      </section>
    </div>
  </main>
</template>
