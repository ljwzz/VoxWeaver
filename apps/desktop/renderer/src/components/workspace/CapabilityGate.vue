<script setup lang="ts">
import type { CapabilityGateReason, WorkspacePageKey } from '@voxweaver/contracts';

import { computed, onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useWorkspaceContext } from '@/workspace/context';
import { getProjectPageRouteName } from '@/workspace/navigation';

const props = defineProps<{
  pageKey: WorkspacePageKey;
}>();

const router = useRouter();
const workspace = useWorkspaceContext();
const capability = computed(() => {
  const coreHealth = workspace.coreHealth.value;
  if (coreHealth && coreHealth.status !== 'healthy') {
    return {
      available: false,
      reason: 'core-unavailable' as const,
      message: 'Core 当前不可用；项目数据保持不变，可执行一次受控重启。',
    };
  }
  return workspace.bootstrap.value?.capabilities[props.pageKey];
});
const reasonLabels: Record<Exclude<CapabilityGateReason, 'available'>, string> = {
  'prerequisite': '前置阶段尚未完成',
  'not-implemented': '能力尚未实现',
  'core-unavailable': 'Core 当前不可用',
};

const blockedReason = computed(() => {
  const reason = capability.value?.reason;
  return reason && reason !== 'available' ? reason : undefined;
});

onMounted(() => {
  void workspace.ensureBootstrap();
});

function goToPrerequisite(): void {
  const pageKey = capability.value?.prerequisitePageKey;
  if (pageKey)
    void router.push({ name: getProjectPageRouteName(pageKey) });
}

function reload(): void {
  void workspace.ensureBootstrap(true);
}

function restartCore(): void {
  void workspace.restartCore();
}
</script>

<template>
  <div v-if="workspace.loadState.value === 'loading' || workspace.loadState.value === 'idle'" class="capability-state">
    <span class="capability-spinner" aria-hidden="true" />
    <strong>正在读取项目能力…</strong>
  </div>

  <ElResult
    v-else-if="workspace.loadError.value"
    icon="error"
    title="无法读取项目能力"
    :sub-title="workspace.loadError.value.message"
  >
    <template #extra>
      <ElButton v-if="workspace.loadError.value.code !== 'CORE_UNAVAILABLE'" @click="reload">
        重试
      </ElButton>
      <ElButton
        v-if="workspace.loadError.value.code === 'CORE_UNAVAILABLE' && workspace.coreHealth.value?.canRestart"
        type="primary"
        @click="restartCore"
      >
        重启 Core
      </ElButton>
    </template>
  </ElResult>

  <slot v-else-if="capability?.available" />

  <ElResult
    v-else
    icon="warning"
    :title="blockedReason ? reasonLabels[blockedReason] : '能力状态缺失'"
    :sub-title="capability?.message ?? 'Core 未返回此页面的能力状态。'"
  >
    <template #extra>
      <div class="gate-actions">
        <ElTag v-if="capability?.requiredStage" effect="plain" type="warning">
          需要阶段 {{ capability.requiredStage }}
        </ElTag>
        <ElButton
          v-if="capability?.prerequisitePageKey"
          type="primary"
          @click="goToPrerequisite"
        >
          返回前置页面
        </ElButton>
        <ElButton
          v-if="blockedReason === 'core-unavailable' && workspace.coreHealth.value?.canRestart"
          type="primary"
          @click="restartCore"
        >
          重启 Core
        </ElButton>
      </div>
    </template>
  </ElResult>
</template>

<style scoped>
.capability-state {
  display: grid;
  min-height: 280px;
  place-content: center;
  justify-items: center;
  gap: 12px;
  color: #6a726e;
}

.capability-spinner {
  width: 26px;
  height: 26px;
  border: 3px solid #d9ddd7;
  border-top-color: #2f6f68;
  border-radius: 50%;
  animation: capability-spin 800ms linear infinite;
}

@keyframes capability-spin {
  to {
    transform: rotate(360deg);
  }
}

.gate-actions {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 10px;
}
</style>
