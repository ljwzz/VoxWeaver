<script setup lang="ts">
import type { Component } from 'vue';
import type {
  WorkspaceStatusBarItem,
  WorkspaceStatusIcon,
} from '@/workspace/statusBar';

import { Circle, LoaderCircle, X } from '@lucide/vue';
import { computed } from 'vue';
import { groupWorkspaceStatusBarItems } from '@/workspace/statusBar';

const props = defineProps<{
  items: readonly WorkspaceStatusBarItem[];
}>();

const emit = defineEmits<{
  activate: [key: string];
}>();

const iconComponents: Readonly<Record<WorkspaceStatusIcon, Component>> = {
  error: X,
  loading: LoaderCircle,
  ok: Circle,
};

const groups = computed(() => groupWorkspaceStatusBarItems(props.items));

function activate(item: WorkspaceStatusBarItem): void {
  if (item.interactive)
    emit('activate', item.key);
}

function iconComponent(icon: WorkspaceStatusIcon | undefined): Component | undefined {
  return icon ? iconComponents[icon] : undefined;
}
</script>

<template>
  <!-- 产品已锁定的工作台全局状态栏；仅在明确的新需求下调整几何与配色。 -->
  <footer
    class="workspace-status-bar"
    aria-label="工作台状态"
    aria-live="polite"
  >
    <div
      class="workspace-status-bar__group workspace-status-bar__group--application"
      data-region="application"
    >
      <component
        :is="item.interactive ? 'button' : 'span'"
        v-for="item in groups.application"
        :key="item.key"
        class="workspace-status-bar__item"
        :class="{ 'workspace-status-bar__item--interactive': item.interactive }"
        :data-status-key="item.key"
        :title="item.title"
        :type="item.interactive ? 'button' : undefined"
        @click="activate(item)"
      >
        <component
          :is="iconComponent(item.icon)"
          v-if="item.icon"
          class="workspace-status-bar__icon"
          :class="`workspace-status-bar__icon--${item.icon}`"
          :fill="item.icon === 'ok' ? 'currentColor' : 'none'"
          :size="16"
          :stroke-width="2"
          aria-hidden="true"
        />
        <span class="workspace-status-bar__text">{{ item.label }}: {{ item.value }}</span>
      </component>
    </div>

    <div
      class="workspace-status-bar__group workspace-status-bar__group--project"
      data-region="project"
    >
      <component
        :is="item.interactive ? 'button' : 'span'"
        v-for="item in groups.project"
        :key="item.key"
        class="workspace-status-bar__item"
        :class="{ 'workspace-status-bar__item--interactive': item.interactive }"
        :data-status-key="item.key"
        :title="item.title"
        :type="item.interactive ? 'button' : undefined"
        @click="activate(item)"
      >
        <component
          :is="iconComponent(item.icon)"
          v-if="item.icon"
          class="workspace-status-bar__icon"
          :class="`workspace-status-bar__icon--${item.icon}`"
          :fill="item.icon === 'ok' ? 'currentColor' : 'none'"
          :size="16"
          :stroke-width="2"
          aria-hidden="true"
        />
        <span class="workspace-status-bar__text">{{ item.label }}: {{ item.value }}</span>
      </component>
    </div>
  </footer>
</template>

<style scoped>
.workspace-status-bar {
  display: flex;
  box-sizing: border-box;
  width: 100%;
  height: 22px;
  min-height: 22px;
  flex: 0 0 22px;
  align-items: stretch;
  justify-content: space-between;
  overflow: hidden;
  border-top: 1px solid #343a37;
  color: #d9ddd7;
  background: #202522;
  font-size: 12px;
  line-height: 22px;
}

.workspace-status-bar__group {
  display: flex;
  min-width: 0;
  height: 100%;
  align-items: stretch;
}

.workspace-status-bar__group--project {
  justify-content: flex-end;
}

.workspace-status-bar__item {
  display: inline-flex;
  min-width: 0;
  height: 100%;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  border: 0;
  color: inherit;
  background: transparent;
  font: inherit;
  white-space: nowrap;
}

.workspace-status-bar__item--interactive {
  cursor: pointer;
}

.workspace-status-bar__item--interactive:hover,
.workspace-status-bar__item--interactive:focus-visible {
  outline: none;
  background: #343a37;
}

.workspace-status-bar__icon {
  width: 16px;
  height: 16px;
  flex: 0 0 16px;
  color: inherit;
}

.workspace-status-bar__icon--loading {
  animation: workspace-status-loading 800ms linear infinite;
}

.workspace-status-bar__text {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@keyframes workspace-status-loading {
  to {
    transform: rotate(360deg);
  }
}

@media (prefers-reduced-motion: reduce) {
  .workspace-status-bar__icon--loading {
    animation: none;
  }
}
</style>
