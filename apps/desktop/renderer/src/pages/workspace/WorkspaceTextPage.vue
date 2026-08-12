<script setup lang="ts">
import type { ProjectSummary } from '@voxweaver/contracts';

import { AudioLines, FileText, Info, Settings, SlidersHorizontal, UsersRound, X } from '@lucide/vue';
import { onMounted, shallowRef } from 'vue';
import PageDocument from '@/components/PageDocument.vue';
import pageStyles from './styles.css?inline';

const bodyClasses = ['workspace-view', 'workspace-view--project'] as const;
const styleSheets = [pageStyles] as const;
const project = shallowRef<ProjectSummary>();
const errorMessage = shallowRef('');
const isClosing = shallowRef(false);

async function loadProjectContext(): Promise<void> {
  const result = await window.voxweaver.getWindowContext();
  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }

  if (result.value.kind !== 'project') {
    errorMessage.value = '当前窗口没有已打开的项目。';
    return;
  }

  project.value = result.value.project;
  document.title = `VoxWeaver · ${result.value.project.displayName}`;
}

async function closeProject(): Promise<void> {
  if (isClosing.value)
    return;
  isClosing.value = true;
  const result = await window.voxweaver.closeCurrentProject();
  if (!result.ok) {
    isClosing.value = false;
    errorMessage.value = result.error.message;
  }
}

onMounted(() => {
  void loadProjectContext();
});
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="project-workspace" aria-label="VoxWeaver 项目工作台">
      <header class="project-titlebar">
        <p>{{ project ? `VoxWeaver · ${project.displayName}` : 'VoxWeaver · 项目工作台' }}</p>
        <span>项目工作台</span>
        <button type="button" :disabled="isClosing" title="关闭当前项目窗口" @click="closeProject">
          <X :size="15" aria-hidden="true" />
          {{ isClosing ? '正在关闭' : '关闭项目' }}
        </button>
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
