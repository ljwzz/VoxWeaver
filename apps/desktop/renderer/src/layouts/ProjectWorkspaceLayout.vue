<script setup lang="ts">
import type { WorkspaceModuleKey, WorkspacePageKey } from '@voxweaver/contracts';
import type { Component } from 'vue';
import type { NavigationFailure } from 'vue-router';
import type {
  WorkspaceStatusBarItem,
} from '@/workspace/statusBar';

import {
  AudioLines,
  FileText,
  Settings,
  SlidersHorizontal,
  UsersRound,
} from '@lucide/vue';
import { computed, onMounted, onUnmounted, provide, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import WorkspaceStatusBar from '@/components/workspace/WorkspaceStatusBar.vue';
import { WORKSPACE_CORE_HEALTH_POLL_INTERVAL_MS } from '@/workspace/config';
import {
  createWorkspaceContext,
  workspaceContextKey,
} from '@/workspace/context';
import {
  getProjectPageRouteName,
  getWorkspaceModule,
  workspaceModules,
} from '@/workspace/navigation';
import {
  getWorkspaceCoreStatusPresentation,
  WORKSPACE_APPLICATION_STATUS_ORDER,
  WORKSPACE_PROJECT_STATUS_ORDER,
} from '@/workspace/statusBar';

const route = useRoute();
const workspace = createWorkspaceContext();
const actionError = shallowRef('');
const lastRecordedPage = shallowRef<WorkspacePageKey>();
const contextSidebarVisible = shallowRef(true);
let coreHealthInterval: ReturnType<typeof setInterval> | undefined;

provide(workspaceContextKey, workspace);

const moduleIcons: Record<WorkspaceModuleKey, Component> = {
  text: FileText,
  role: UsersRound,
  audio: AudioLines,
  post: SlidersHorizontal,
  settings: Settings,
};

const activeModuleKey = computed<WorkspaceModuleKey>(() => (
  route.meta.workspaceModuleKey ?? 'text'
));
const activeModule = computed(() => getWorkspaceModule(activeModuleKey.value));
const project = computed(() => workspace.bootstrap.value?.project);
const workspaceTitle = computed(() => project.value
  ? `VoxWeaver · ${project.value.displayName}`
  : '');
const globalTask = computed(() => workspace.bootstrap.value?.currentTask
  ?? workspace.bootstrap.value?.recoverableTasks[0]);
const primaryWorkspaceModules = workspaceModules.filter(module => module.key !== 'settings');
const settingsWorkspaceModule = getWorkspaceModule('settings');
const coreStatusPresentation = computed(() => (
  getWorkspaceCoreStatusPresentation(workspace.coreHealth.value?.status)
));
const statusBarItems = computed<readonly WorkspaceStatusBarItem[]>(() => {
  const items: WorkspaceStatusBarItem[] = [{
    key: 'core',
    region: 'application',
    order: WORKSPACE_APPLICATION_STATUS_ORDER.core,
    label: 'Core',
    value: coreStatusPresentation.value.value,
    icon: coreStatusPresentation.value.icon,
  }];

  const task = globalTask.value;
  if (task) {
    items.push({
      key: `project-task:${task.taskId}`,
      region: 'project',
      order: WORKSPACE_PROJECT_STATUS_ORDER.novelImport,
      label: '小说导入',
      value: `${task.progress.message} · ${task.progress.percent}%`,
    });
  }

  return items;
});

onMounted(() => {
  void workspace.ensureBootstrap();
  coreHealthInterval = setInterval(() => {
    void workspace.refreshCoreHealth();
  }, WORKSPACE_CORE_HEALTH_POLL_INTERVAL_MS);
});

onUnmounted(() => {
  if (coreHealthInterval)
    clearInterval(coreHealthInterval);
});

watch(workspaceTitle, (value) => {
  if (value)
    document.title = value;
}, { immediate: true });

watch(
  () => route.meta.workspacePageKey,
  (pageKey) => {
    if (!pageKey || pageKey === lastRecordedPage.value)
      return;

    lastRecordedPage.value = pageKey;
    void window.voxweaver.project.recordLastPage(pageKey).then((result) => {
      if (!result.ok)
        actionError.value = `无法记录最后页面：${result.error.message}`;
    });
  },
  { immediate: true },
);

function moduleTarget(moduleKey: WorkspaceModuleKey): { name: string } {
  return { name: getProjectPageRouteName(getWorkspaceModule(moduleKey).defaultPageKey) };
}

function pageTarget(pageKey: WorkspacePageKey): { name: string } {
  return { name: getProjectPageRouteName(pageKey) };
}

function capabilityClass(pageKey: WorkspacePageKey): string {
  const capability = workspace.bootstrap.value?.capabilities[pageKey];
  if (!capability)
    return 'unknown';
  return capability.available ? 'available' : capability.reason;
}

function handleModuleClick(
  event: MouseEvent,
  moduleKey: WorkspaceModuleKey,
  navigate: (event?: MouseEvent) => Promise<void | NavigationFailure>,
): void {
  if (moduleKey === activeModuleKey.value) {
    event.preventDefault();
    contextSidebarVisible.value = !contextSidebarVisible.value;
    return;
  }

  contextSidebarVisible.value = true;
  void navigate(event);
}
</script>

<template>
  <main class="project-workspace-layout" aria-label="VoxWeaver 项目工作台">
    <header class="project-window-titlebar">
      <span v-if="workspaceTitle">{{ workspaceTitle }}</span>
    </header>

    <div
      class="project-workspace-body"
      :class="{ 'project-workspace-body--sidebar-hidden': !contextSidebarVisible }"
    >
      <nav class="project-activity-rail" aria-label="主模块">
        <div class="project-primary-modules">
          <RouterLink
            v-for="workspaceModule in primaryWorkspaceModules"
            v-slot="{ href, navigate }"
            :key="workspaceModule.key"
            custom
            :to="moduleTarget(workspaceModule.key)"
          >
            <a
              class="project-activity-link"
              :class="{ 'project-activity-link--current': workspaceModule.key === activeModuleKey }"
              :aria-current="workspaceModule.key === activeModuleKey ? 'page' : undefined"
              aria-controls="project-context-sidebar"
              :aria-expanded="workspaceModule.key === activeModuleKey ? contextSidebarVisible : false"
              :href="href"
              :title="workspaceModule.label"
              @click="handleModuleClick($event, workspaceModule.key, navigate)"
            >
              <component :is="moduleIcons[workspaceModule.key]" :size="20" aria-hidden="true" />
              <span>{{ workspaceModule.shortLabel }}</span>
            </a>
          </RouterLink>
        </div>

        <div class="project-settings-entry">
          <RouterLink
            v-slot="{ href, navigate }"
            custom
            :to="moduleTarget(settingsWorkspaceModule.key)"
          >
            <a
              class="project-activity-link"
              :class="{ 'project-activity-link--current': settingsWorkspaceModule.key === activeModuleKey }"
              :aria-current="settingsWorkspaceModule.key === activeModuleKey ? 'page' : undefined"
              aria-controls="project-context-sidebar"
              :aria-expanded="settingsWorkspaceModule.key === activeModuleKey ? contextSidebarVisible : false"
              :href="href"
              :title="settingsWorkspaceModule.label"
              @click="handleModuleClick($event, settingsWorkspaceModule.key, navigate)"
            >
              <component :is="moduleIcons[settingsWorkspaceModule.key]" :size="20" aria-hidden="true" />
              <span>{{ settingsWorkspaceModule.shortLabel }}</span>
            </a>
          </RouterLink>
        </div>
      </nav>

      <aside
        v-show="contextSidebarVisible"
        id="project-context-sidebar"
        class="project-context-sidebar"
      >
        <nav class="project-page-navigation" :aria-label="`${activeModule.label}页面`">
          <RouterLink
            v-for="page in activeModule.pages"
            :key="page.key"
            class="project-page-link"
            :class="{ 'project-page-link--current': route.meta.workspacePageKey === page.key }"
            :aria-current="route.meta.workspacePageKey === page.key ? 'page' : undefined"
            :to="pageTarget(page.key)"
          >
            <span class="project-page-label">{{ page.label }}</span>
            <span
              class="project-capability-dot"
              :class="`project-capability-dot--${capabilityClass(page.key)}`"
              aria-hidden="true"
            />
            <small v-if="page.stageId">{{ page.stageId }}</small>
          </RouterLink>
        </nav>

        <p v-if="actionError" class="project-action-error" role="alert">
          {{ actionError }}
        </p>
      </aside>

      <section class="project-editor-area">
        <RouterView />
      </section>
    </div>

    <WorkspaceStatusBar :items="statusBarItems" />
  </main>
</template>

<style scoped>
.project-workspace-layout {
  --workspace-border: #d9ddd7;
  --workspace-text: #202522;
  --workspace-muted: #6a726e;
  --workspace-accent: #2f6f68;

  display: flex;
  width: 100%;
  min-width: 840px;
  height: 100%;
  min-height: 560px;
  flex-direction: column;
  overflow: hidden;
  color: var(--workspace-text);
  background: #fbfcfa;
}

.project-window-titlebar {
  display: flex;
  height: 32px;
  flex: 0 0 32px;
  align-items: center;
  justify-content: center;
  padding: 0 12px 0 78px;
  border-bottom: 1px solid var(--workspace-border);
  color: var(--workspace-muted);
  background: #fff;
  font-size: 12px;
  app-region: drag;
}

.project-workspace-body {
  display: grid;
  min-width: 0;
  min-height: 0;
  flex: 1;
  grid-template-columns: 52px 252px minmax(0, 1fr);
  overflow: hidden;
}

.project-workspace-body--sidebar-hidden {
  grid-template-columns: 52px minmax(0, 1fr);
}

.project-activity-rail {
  display: flex;
  min-height: 0;
  flex-direction: column;
  align-items: center;
  justify-content: space-between;
  padding: 8px 6px;
  background: #202522;
}

.project-primary-modules {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.project-settings-entry {
  display: flex;
}

.project-activity-link {
  display: flex;
  width: 40px;
  min-height: 48px;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  gap: 2px;
  border: 1px solid transparent;
  border-radius: 6px;
  color: #aeb6b1;
  font-size: 9px;
  line-height: 12px;
}

.project-activity-link:hover,
.project-activity-link:focus-visible {
  border-color: #65827c;
  outline: none;
  color: #fff;
}

.project-activity-link--current {
  border-color: #76a49b;
  color: #fff;
  background: #30423e;
}

.project-context-sidebar {
  display: flex;
  min-width: 0;
  min-height: 0;
  flex-direction: column;
  overflow: hidden;
  border-right: 1px solid var(--workspace-border);
  background: #f5f6f3;
}

.project-page-navigation {
  min-height: 0;
  flex: 1;
  padding: 8px;
  overflow-y: auto;
}

.project-page-link {
  display: grid;
  min-height: 36px;
  align-items: center;
  grid-template-columns: minmax(0, 1fr) auto auto;
  gap: 7px;
  margin-bottom: 2px;
  padding: 0 9px;
  border-radius: 6px;
  color: #414744;
  font-size: 12px;
}

.project-page-link:hover,
.project-page-link:focus-visible {
  outline: none;
  background: #e8ebe7;
}

.project-page-link--current {
  color: #245e57;
  background: #e2efed;
  font-weight: 600;
}

.project-page-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.project-page-link small {
  color: #8a918d;
  font-size: 9px;
}

.project-capability-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #b7bcb8;
}

.project-capability-dot--available {
  background: #3f8068;
}

.project-capability-dot--prerequisite,
.project-capability-dot--not-implemented {
  background: #b37a1d;
}

.project-capability-dot--core-unavailable {
  background: #b34444;
}

.project-action-error {
  margin: 0 8px 8px;
  color: #9c3838;
  font-size: 11px;
  line-height: 16px;
}

.project-editor-area {
  min-width: 0;
  min-height: 0;
  overflow: auto;
  background: #fff;
}
</style>
