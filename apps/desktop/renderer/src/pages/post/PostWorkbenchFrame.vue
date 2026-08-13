<script setup lang="ts">
import type { DemoModuleKey, DemoSidebarPageSlug } from '@/demo/navigation';

import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

defineProps<{
  editorLabel: string;
}>();

const bodyClasses = ['post-page'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;

const primaryModules: readonly { key: DemoModuleKey; label: string }[] = [
  { key: 'text', label: '文' },
  { key: 'role', label: '角' },
  { key: 'audio', label: '音' },
  { key: 'post', label: '后' },
];

const postSidebarItems: readonly {
  child?: boolean;
  count: string;
  label: string;
  slug: DemoSidebarPageSlug;
}[] = [
  { child: true, count: '3', label: '时间轴对齐', slug: 'timeline-alignment' },
  { child: true, count: '4', label: '响度一致性', slug: 'loudness-consistency' },
  { count: '1', label: '章节摘要生成', slug: 'chapter-summary' },
  { count: '2', label: '章节封面生成', slug: 'chapter-cover' },
  { count: '2', label: '导出 tar 包', slug: 'tar-export' },
];
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main aria-label="VoxWeaver 后期处理假交互预览">
      <header class="post-titlebar">
        <img src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
        <strong>VoxWeaver · 示例小说</strong>
        <span>项目工作台</span>
      </header>

      <div class="post-shell">
        <aside class="post-activity" aria-label="功能分组导航">
          <div class="activity-stack">
            <DemoModuleButton
              v-for="module in primaryModules"
              :key="module.key"
              class="post-activity-item"
              :module-key="module.key"
            >
              {{ module.label }}
            </DemoModuleButton>
          </div>
          <DemoModuleButton class="post-activity-item" module-key="settings">
            设
          </DemoModuleButton>
        </aside>

        <aside class="post-sidebar" aria-label="后期处理导航">
          <div class="post-sidebar-main">
            <header class="post-sidebar-header">
              <div class="post-sidebar-heading">
                <h1>后期处理</h1>
                <span class="post-sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span>
              </div>
              <p>章节后期处理 · 导出</p>
            </header>

            <p class="post-nav-group">章节后期处理</p>
            <div class="post-nav-item post-nav-item--group" aria-disabled="true">
              <span class="post-nav-mark is-empty" aria-hidden="true">•</span>
              <span class="post-nav-label">▾ 章节音频合并</span>
              <span class="post-nav-count">2</span>
            </div>
            <template v-for="item in postSidebarItems" :key="item.slug">
              <div v-if="item.slug === 'tar-export'" class="post-nav-divider"></div>
              <p v-if="item.slug === 'tar-export'" class="post-nav-group">导出</p>
              <DemoPageButton
                class="post-nav-item"
                :class="{ 'is-child': item.child }"
                :page-slug="item.slug"
              >
                <span class="post-nav-mark" aria-hidden="true">✓</span>
                <span class="post-nav-label">{{ item.label }}</span>
                <span class="post-nav-count">{{ item.count }}</span>
              </DemoPageButton>
            </template>

            <div class="post-sidebar-spacer"></div>
            <div class="post-sidebar-summary">
              <span>第 12 章 · 38 个有效片段</span>
              <span>2 缺失 · 1 已失效</span>
            </div>
          </div>
          <div class="post-resize-handle" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"></div>
        </aside>

        <section class="post-editor" :aria-label="editorLabel">
          <slot />
        </section>
      </div>
    </main>
  </PageDocument>
</template>
