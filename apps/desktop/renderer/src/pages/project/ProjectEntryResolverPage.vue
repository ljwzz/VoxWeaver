<script setup lang="ts">
import { onMounted } from 'vue';
import { useRouter } from 'vue-router';
import { useWorkspaceContext } from '@/workspace/context';
import { getProjectPageRouteName } from '@/workspace/navigation';
import { resolveWorkspaceEntry } from '@/workspace/resolver';

const router = useRouter();
const workspace = useWorkspaceContext();

async function resolveEntry(force = false): Promise<void> {
  const bootstrap = await workspace.ensureBootstrap(force);
  if (!bootstrap)
    return;

  await router.replace({
    name: getProjectPageRouteName(resolveWorkspaceEntry(bootstrap)),
  });
}

async function restartCore(): Promise<void> {
  if (await workspace.restartCore())
    await resolveEntry();
}

onMounted(() => {
  void resolveEntry();
});
</script>

<template>
  <section class="project-entry-resolver" aria-live="polite">
    <ElResult
      v-if="workspace.loadError.value"
      icon="error"
      title="无法进入项目工作台"
      :sub-title="workspace.loadError.value.message"
    >
      <template #extra>
        <ElButton
          v-if="workspace.loadError.value.code === 'CORE_UNAVAILABLE' && workspace.coreHealth.value?.canRestart"
          type="primary"
          @click="restartCore"
        >
          重启 Core
        </ElButton>
        <ElButton v-else type="primary" @click="resolveEntry(true)">重试</ElButton>
      </template>
    </ElResult>
    <div v-else class="project-entry-loading">
      <span class="project-entry-spinner" aria-hidden="true" />
      <strong>正在恢复项目工作位置…</strong>
    </div>
  </section>
</template>

<style scoped>
.project-entry-resolver {
  display: grid;
  min-height: 100%;
  place-items: center;
}

.project-entry-loading {
  display: grid;
  justify-items: center;
  gap: 12px;
  color: #6a726e;
}

.project-entry-spinner {
  width: 28px;
  height: 28px;
  border: 3px solid #d9ddd7;
  border-top-color: #2f6f68;
  border-radius: 50%;
  animation: project-entry-spin 800ms linear infinite;
}

@keyframes project-entry-spin {
  to { transform: rotate(360deg); }
}
</style>
