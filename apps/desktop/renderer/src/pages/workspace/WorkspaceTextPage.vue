<script setup lang="ts">
import type { ProjectSummary } from '@voxweaver/contracts';

import { AudioLines, FileText, Info, Settings, SlidersHorizontal, UsersRound } from '@lucide/vue';
import { computed, inject, shallowRef, watch } from 'vue';
import { routeLocationKey } from 'vue-router';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import PageDocument from '@/components/PageDocument.vue';
import TextDemoShell from '@/pages/text/TextDemoShell.vue';
import textPageStyles from '../text/styles.css?inline';
import pageStyles from './styles.css?inline';

const projectBodyClasses = ['workspace-view', 'workspace-view--project'] as const;
const projectStyleSheets = [pageStyles] as const;
const previewBodyClasses = ['workspace-view', 'workspace-view--text', 'text-page'] as const;
const previewStyleSheets = [pageStyles, textPageStyles] as const;
const route = inject(routeLocationKey, undefined);
const isDemoPreview = computed(() => route?.meta.isDemoPreview === true);
const project = shallowRef<ProjectSummary>();
const errorMessage = shallowRef('');

async function loadProjectContext(): Promise<void> {
  errorMessage.value = '';
  const result = await window.voxweaver.project.getBootstrap();
  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }

  project.value = result.value.project;
  document.title = `VoxWeaver · ${result.value.project.displayName}`;
}

watch(isDemoPreview, (demoPreview) => {
  if (demoPreview) {
    project.value = undefined;
    errorMessage.value = '';
    return;
  }

  void loadProjectContext();
}, { immediate: true });
</script>

<template>
  <PageDocument
    v-if="isDemoPreview"
    key="text-demo-preview"
    :body-classes="previewBodyClasses"
    :style-sheets="previewStyleSheets"
  >
    <TextDemoShell
      current-page="text-extraction"
      editor-aria-label="文本提取编辑区"
      label="VoxWeaver 项目工作台预览"
      sidebar-subtitle-compact="1280×800 · 5 个子功能"
      toolbar-detail="示例小说.epub · EPUB / UTF-8"
      toolbar-detail-compact="1280×800 紧凑视口"
      toolbar-title="文本提取"
    >
      <template #toolbar-actions>
        <span class="icon-button" aria-disabled="true">⋯</span>
        <DemoPageButton class="toolbar-button toolbar-button--secondary" page-slug="proofreading">
          查看问题
        </DemoPageButton>
        <DemoPageButton class="toolbar-button toolbar-button--primary" page-slug="text-extraction">
          提取文本
        </DemoPageButton>
      </template>

      <div class="editor-content">
        <p class="eyebrow">项目工作台</p>
        <h2>继续整理《示例小说》</h2>
        <p class="editor-description">当前停留在第 3 章。工作台壳层用于承载导航、状态和上下文，不替代具体业务页面。</p>

        <section class="state-summary" aria-label="项目状态摘要">
          <article class="summary-card"><p>当前章节</p><strong>第 3 章 · 雨夜</strong></article>
          <article class="summary-card"><p>总进度</p><strong>62% · 22 / 36 章</strong></article>
          <article class="summary-card"><p>待复核</p><strong>12 项</strong></article>
          <article class="summary-card"><p>已失效</p><strong>3 项</strong></article>
        </section>

        <DemoPageButton
          class="continue-card"
          page-slug="chapter-splitting"
          aria-label="继续章节切割演示"
        >
          <h3>继续上次工作</h3>
          <p>章节切割 · 第 3 章边界待确认</p>
        </DemoPageButton>
      </div>
    </TextDemoShell>
  </PageDocument>

  <PageDocument
    v-else
    key="project-context"
    :body-classes="projectBodyClasses"
    :style-sheets="projectStyleSheets"
  >
    <main class="project-workspace" aria-label="VoxWeaver 项目工作台">
      <header class="project-titlebar">
        <span>{{
          project
            ? `VoxWeaver · ${project.displayName}`
            : "VoxWeaver · 项目工作台"
        }}</span>
      </header>

      <div class="project-workspace-body">
        <aside class="project-activity-rail" aria-label="项目功能">
          <div>
            <button class="project-activity-button project-activity-button--current" type="button" disabled title="文本整理后续实现">
              <FileText :size="21" aria-hidden="true" />
              <span>文本</span>
            </button>
            <button class="project-activity-button" type="button" disabled title="角色管理后续实现">
              <UsersRound :size="21" aria-hidden="true" />
              <span>角色</span>
            </button>
            <button class="project-activity-button" type="button" disabled title="音频生成后续实现">
              <AudioLines :size="21" aria-hidden="true" />
              <span>音频</span>
            </button>
            <button class="project-activity-button" type="button" disabled title="后期处理后续实现">
              <SlidersHorizontal :size="21" aria-hidden="true" />
              <span>后期</span>
            </button>
          </div>
          <button class="project-activity-button" type="button" disabled title="项目设置后续实现">
            <Settings :size="21" aria-hidden="true" />
            <span>设置</span>
          </button>
        </aside>

        <aside class="project-summary-sidebar">
          <p class="project-sidebar-eyebrow">当前项目</p>
          <h1>{{ project?.displayName ?? '正在读取项目…' }}</h1>
          <dl v-if="project">
            <div>
              <dt>源文件</dt>
              <dd :title="project.sourceFileName">{{ project.sourceFileName }}</dd>
            </div>
            <div>
              <dt>创建时间</dt>
              <dd>{{ new Date(project.createdAt).toLocaleString() }}</dd>
            </div>
          </dl>
          <p class="project-sidebar-note">项目名称来自创建时的明确输入，不依赖源文件名。</p>
        </aside>

        <section class="project-empty-workbench">
          <div v-if="errorMessage" class="project-context-error" role="alert">
            <Info :size="28" aria-hidden="true" />
            <h2>无法读取项目</h2>
            <p>{{ errorMessage }}</p>
          </div>
          <div v-else class="project-ready-state">
            <span class="project-ready-icon"><FileText :size="30" aria-hidden="true" /></span>
            <p class="project-ready-eyebrow">项目已打开</p>
            <h2>{{ project?.displayName ?? '正在载入…' }}</h2>
            <p>项目清单、状态库和源文件副本已通过校验。</p>
            <div class="project-next-step">
              <Info :size="16" aria-hidden="true" />
              <span>文本提取、章节分析和其他后续处理尚未实现。</span>
            </div>
            <button type="button" disabled>开始文本处理 · 后续实现</button>
          </div>
        </section>
      </div>
    </main>
  </PageDocument>
</template>
