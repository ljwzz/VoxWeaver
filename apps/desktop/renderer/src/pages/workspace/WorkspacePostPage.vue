<script setup lang="ts">
import type { DemoModuleKey, DemoSidebarPageSlug } from '@/demo/navigation';

import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import PageDocument from '@/components/PageDocument.vue';
import pageStyles from './styles.css?inline';

const bodyClasses = ['workspace-view', 'workspace-view--post'] as const;
const styleSheets = [pageStyles] as const;

const primaryModules: readonly { key: DemoModuleKey; label: string }[] = [
  { key: 'text', label: '文' },
  { key: 'role', label: '角' },
  { key: 'audio', label: '音' },
  { key: 'post', label: '后' },
];

const postPages: readonly {
  count: string;
  label: string;
  slug: DemoSidebarPageSlug;
  stateClass: string;
  stateMark: string;
}[] = [
  { count: '3', label: '时间轴对齐', slug: 'timeline-alignment', stateClass: 'sidebar-item--selected', stateMark: '✓' },
  { count: '4', label: '响度一致性', slug: 'loudness-consistency', stateClass: 'sidebar-item--review', stateMark: '!' },
  { count: '1', label: '章节摘要生成', slug: 'chapter-summary', stateClass: 'sidebar-item--processing', stateMark: '◔' },
  { count: '2', label: '章节封面生成', slug: 'chapter-cover', stateClass: 'sidebar-item--stale', stateMark: '↻' },
  { count: '2', label: '导出 tar 包', slug: 'tar-export', stateClass: 'sidebar-item--failed', stateMark: '×' },
];
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="workspace" aria-label="VoxWeaver 后期处理整体工作台假交互预览">
      <header class="window-titlebar">
        <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
        <p class="window-title">VoxWeaver · 示例小说</p>
        <p class="window-context">项目工作台</p>
      </header>

      <div class="workspace-body">
        <aside class="activity-rail" aria-label="功能分组导航">
          <div class="activity-list">
            <DemoModuleButton
              v-for="module in primaryModules"
              :key="module.key"
              class="activity-item"
              :module-key="module.key"
            >
              <span class="activity-glyph">{{ module.label }}</span>
              <span v-if="module.key === 'post'" class="selection-bar" aria-hidden="true"></span>
            </DemoModuleButton>
          </div>
          <DemoModuleButton class="activity-item" module-key="settings">
            <span class="activity-glyph">设</span>
          </DemoModuleButton>
        </aside>

        <aside class="context-sidebar" aria-label="后期处理上下文侧栏">
          <div class="sidebar-content">
            <div class="sidebar-top">
              <header class="sidebar-header">
                <div class="sidebar-heading-row"><h1>后期处理</h1><span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span></div>
                <p class="sidebar-subtitle">5 个工作台 · 3 项已失效</p>
              </header>

              <DemoPageButton
                v-for="page in postPages"
                :key="page.slug"
                class="sidebar-item"
                :class="page.stateClass"
                :page-slug="page.slug"
              >
                <span class="sidebar-state" aria-hidden="true">{{ page.stateMark }}</span>
                <span class="sidebar-label">{{ page.label }}</span>
                <span class="sidebar-count">{{ page.count }}</span>
              </DemoPageButton>
            </div>
            <section class="sidebar-summary" aria-label="项目摘要"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
          </div>
          <div class="resize-handle" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"><span aria-hidden="true"></span></div>
        </aside>

        <section class="editor" aria-label="后期处理概览">
          <header class="editor-toolbar">
            <div class="toolbar-context"><strong>后期处理</strong><span>·</span><span>第 12 章 · 固定预览状态</span></div>
            <div class="toolbar-actions" aria-label="编辑区说明"><ElTag effect="plain" type="warning">3 项门禁待处理</ElTag></div>
          </header>
          <div class="editor-content editor-content--overview">
            <p class="eyebrow">项目工作台</p>
            <h2>后期处理</h2>
            <p class="editor-description">从左侧进入时间轴、响度、摘要、封面与 tar 导出工作台。所有操作仅更新页面内演示状态。</p>
            <section class="state-summary" aria-label="后期处理状态摘要">
              <article class="summary-card"><p>有效片段</p><strong>38</strong></article>
              <article class="summary-card"><p>缺失 / 重复</p><strong>2 / 1</strong></article>
              <article class="summary-card"><p>待复核候选</p><strong>7</strong></article>
              <article class="summary-card"><p>导出阻塞</p><strong>2</strong></article>
            </section>
            <section class="context-state context-state--error" aria-label="包含失败或已失效结果">
              <h3 class="context-state-title"><span class="context-state-icon" aria-hidden="true">×</span><span>包含失败或已失效结果</span></h3>
              <p>不会自动删除或修复历史结果；缺失、重复、未审核与已失效状态不会因假交互自动变为有效。</p>
            </section>
          </div>
        </section>
      </div>
    </main>
  </PageDocument>
</template>
