<script setup lang="ts">
import type { AppPage, PageGroup } from '@/pages';

import { computed } from 'vue';
import { appPages, pageGroupLabels } from '@/pages';

const groupOrder: PageGroup[] = [
  'startup',
  'overall',
  'workbench',
  'text',
  'role',
  'audio',
  'post',
  'settings',
];

const groupedPages = computed(() => groupOrder.map(group => ({
  group,
  label: pageGroupLabels[group],
  pages: appPages.filter(page => page.group === group),
})));

function viewportLabel(page: AppPage): string {
  const renderWidth = page.renderWidth ?? page.width;
  const renderHeight = page.renderHeight ?? page.height;

  if (renderWidth === page.width && renderHeight === page.height)
    return `${page.width}×${page.height}`;

  return `${page.width}×${page.height} · 渲染 ${renderWidth}×${renderHeight}`;
}
</script>

<template>
  <main class="page-catalog">
    <header class="page-catalog-header">
      <div>
        <p class="page-catalog-eyebrow">
          VoxWeaver / Project Pages
        </p>
        <h1>页面目录</h1>
        <p>48 个展示状态已转换为 45 个 Vue 页面组件，可通过独立路由直接加载。</p>
      </div>
      <ElTag effect="plain" type="success">
        固定本地数据
      </ElTag>
    </header>

    <section v-for="section in groupedPages" :key="section.group" class="page-catalog-section">
      <header class="page-catalog-section-header">
        <h2>{{ section.label }}</h2>
        <span>{{ section.pages.length }} 个页面状态</span>
      </header>

      <div class="page-catalog-grid">
        <RouterLink
          v-for="page in section.pages"
          :key="page.slug"
          class="page-card"
          :to="page.path"
        >
          <span class="page-card-title">{{ page.title }}</span>
          <span class="page-card-meta">
            <span>{{ viewportLabel(page) }}</span>
            <ElTag effect="plain" size="small">{{ page.kind }}</ElTag>
          </span>
        </RouterLink>
      </div>
    </section>
  </main>
</template>
