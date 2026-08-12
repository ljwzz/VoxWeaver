<script setup lang="ts">
import type { RecentProjectSummary } from '@voxweaver/contracts';

import { FolderOpen, FolderPlus, Info, Settings, X } from '@lucide/vue';
import { computed, nextTick, onBeforeUnmount, onMounted, shallowRef, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import PageDocument from '@/components/PageDocument.vue';
import pageStyles from './styles.css?inline';

type RecentProjectsState = 'failed' | 'loading' | 'ready';

const bodyClasses = ['startup-screen', 'startup-screen--home'] as const;
const styleSheets = [pageStyles] as const;
const router = useRouter();
const route = useRoute();

const recentProjects = shallowRef<RecentProjectSummary[]>([]);
const recentProjectsState = shallowRef<RecentProjectsState>('loading');
const recentProjectList = shallowRef<HTMLElement>();
const fadedProjectId = shallowRef<string>();
const activeProjectId = shallowRef<string>();
const isOpeningDialog = shallowRef(false);
const statusMessage = shallowRef('');
const statusKind = shallowRef<'error' | 'info'>('info');
const isRecentProjectsEmpty = computed(() => recentProjectsState.value === 'ready' && recentProjects.value.length === 0);

let recentProjectListObserver: ResizeObserver | undefined;

function setFailure(message: string): void {
  statusKind.value = 'error';
  statusMessage.value = message;
}

function setWarnings(warnings?: string[]): void {
  if (!warnings?.length)
    return;
  statusKind.value = 'info';
  statusMessage.value = warnings.join(' ');
}

async function loadRecentProjects(): Promise<void> {
  recentProjectsState.value = 'loading';
  const result = await window.voxweaver.listRecentProjects();
  if (!result.ok) {
    recentProjectsState.value = 'failed';
    setFailure(result.error.message);
    return;
  }

  recentProjects.value = result.value;
  recentProjectsState.value = 'ready';
}

function updateFadedProject(): void {
  const list = recentProjectList.value;
  if (!list
    || list.scrollHeight <= list.clientHeight + 1
    || list.scrollTop + list.clientHeight >= list.scrollHeight - 1) {
    fadedProjectId.value = undefined;
    return;
  }

  const listRect = list.getBoundingClientRect();
  const viewportTop = listRect.top + list.clientTop;
  const viewportBottom = viewportTop + list.clientHeight;
  const rows = list.querySelectorAll<HTMLElement>('.recent-project-row');
  let bottomVisibleProjectId: string | undefined;

  for (const row of rows) {
    const rowRect = row.getBoundingClientRect();
    if (rowRect.top >= viewportBottom)
      break;
    if (rowRect.bottom > viewportTop)
      bottomVisibleProjectId = row.dataset.projectId;
  }

  fadedProjectId.value = bottomVisibleProjectId;
}

function queueFadeUpdate(): void {
  void nextTick(updateFadedProject);
}

function createProject(): void {
  void router.push('/new-project');
}

async function openProjectFromDialog(): Promise<void> {
  if (isOpeningDialog.value)
    return;

  isOpeningDialog.value = true;
  statusMessage.value = '';
  try {
    const result = await window.voxweaver.openProjectFromDialog();
    if (!result.ok) {
      setFailure(result.error.message);
      return;
    }

    setWarnings(result.warnings);
    if (result.value)
      await loadRecentProjects();
  } finally {
    isOpeningDialog.value = false;
  }
}

async function openRecentProject(project: RecentProjectSummary): Promise<void> {
  if (project.availability !== 'available' || activeProjectId.value)
    return;

  activeProjectId.value = project.projectId;
  statusMessage.value = '';
  try {
    const result = await window.voxweaver.openRecentProject(project.projectId);
    if (!result.ok) {
      setFailure(result.error.message);
      await loadRecentProjects();
      return;
    }

    setWarnings(result.warnings);
    await loadRecentProjects();
  } finally {
    activeProjectId.value = undefined;
  }
}

async function removeRecentProject(projectId: string): Promise<void> {
  const result = await window.voxweaver.removeRecentProject(projectId);
  if (!result.ok) {
    setFailure(result.error.message);
    return;
  }

  recentProjects.value = recentProjects.value.filter(project => project.projectId !== projectId);
}

function availabilityLabel(availability: RecentProjectSummary['availability']): string {
  if (availability === 'missing')
    return '目录不存在';
  if (availability === 'invalid')
    return '项目无效';
  return '';
}

onMounted(() => {
  if (typeof route.query.notice === 'string') {
    statusKind.value = 'info';
    statusMessage.value = route.query.notice;
    void router.replace('/startup');
  }
  void loadRecentProjects();
});

watch(recentProjectList, (list) => {
  recentProjectListObserver?.disconnect();
  if (!list) {
    fadedProjectId.value = undefined;
    return;
  }

  if (typeof ResizeObserver !== 'undefined') {
    recentProjectListObserver ??= new ResizeObserver(updateFadedProject);
    recentProjectListObserver.observe(list);
  }
  queueFadeUpdate();
}, { flush: 'post' });

watch(recentProjects, queueFadeUpdate, { flush: 'post' });

onBeforeUnmount(() => {
  recentProjectListObserver?.disconnect();
});
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="startup-shell" aria-label="VoxWeaver 项目启动窗口">
      <header class="native-titlebar">
        <span>VoxWeaver</span>
      </header>

      <div
        class="startup-content"
        :class="{
          'startup-content--loading': recentProjectsState === 'loading',
          'startup-content--empty': isRecentProjectsEmpty,
        }"
        :aria-busy="recentProjectsState === 'loading'"
      >
        <section class="startup-hero" aria-labelledby="product-name">
          <img src="./assets/logo-waveform.svg" width="28" height="28" alt="">
          <div>
            <h1 id="product-name">VoxWeaver</h1>
            <p>为文字赋予情感</p>
          </div>
        </section>

        <section class="startup-actions" aria-label="项目操作">
          <button class="startup-action startup-action--primary" type="button" @click="createProject">
            <FolderPlus :size="24" aria-hidden="true" />
            <span><strong>新建项目</strong><small>名称、目录与源文件</small></span>
          </button>
          <button class="startup-action" type="button" :disabled="isOpeningDialog" @click="openProjectFromDialog">
            <FolderOpen :size="24" aria-hidden="true" />
            <span><strong>{{ isOpeningDialog ? '正在打开…' : '打开项目' }}</strong><small>选择项目目录</small></span>
          </button>
          <button class="startup-action" type="button" disabled title="后续实现">
            <Settings :size="24" aria-hidden="true" />
            <span><strong>软件设置</strong><small>后续实现</small></span>
          </button>
        </section>

        <section v-if="recentProjects.length" class="recent-projects" aria-labelledby="recent-projects-title">
          <header class="recent-projects-header">
            <h2 id="recent-projects-title">最近项目</h2>
            <span>{{ recentProjects.length }} 个</span>
          </header>

          <div ref="recentProjectList" class="recent-project-list" @scroll.passive="updateFadedProject">
            <article
              v-for="project in recentProjects"
              :key="project.projectId"
              class="recent-project-row"
              :class="{
                'recent-project-row--unavailable': project.availability !== 'available',
                'recent-project-row--fade': project.projectId === fadedProjectId,
              }"
              :data-project-id="project.projectId"
            >
              <button
                class="recent-project-open"
                type="button"
                :disabled="project.availability !== 'available' || Boolean(activeProjectId)"
                @click="openRecentProject(project)"
              >
                <span class="recent-project-name">{{ project.displayName }}</span>
                <span class="recent-project-directory" :title="project.directoryPath">{{ project.directoryPath }}</span>
                <span v-if="project.availability !== 'available'" class="recent-project-state">
                  {{ availabilityLabel(project.availability) }}
                </span>
              </button>
              <button
                class="recent-project-remove"
                type="button"
                :aria-label="`从最近项目移除 ${project.displayName}`"
                title="仅移除最近记录"
                @click="removeRecentProject(project.projectId)"
              >
                <X :size="15" aria-hidden="true" />
              </button>
            </article>
          </div>
        </section>

        <p v-if="statusMessage" class="startup-status" :class="`startup-status--${statusKind}`" role="status">
          <Info :size="14" aria-hidden="true" />
          <span>{{ statusMessage }}</span>
        </p>
      </div>
    </main>
  </PageDocument>
</template>
