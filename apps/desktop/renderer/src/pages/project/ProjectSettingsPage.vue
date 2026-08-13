<script setup lang="ts">
import { computed } from 'vue';
import CapabilityGate from '@/components/workspace/CapabilityGate.vue';
import WorkspacePageHeader from '@/components/workspace/WorkspacePageHeader.vue';
import { useWorkspaceContext } from '@/workspace/context';
import { getWorkspacePage } from '@/workspace/navigation';

const page = getWorkspacePage('project-settings');
const workspace = useWorkspaceContext();
const bootstrap = computed(() => workspace.bootstrap.value);
const completedStages = computed(() => bootstrap.value?.stages.filter(stage => stage.status === 'completed').length ?? 0);

function formatDate(value: string): string {
  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function restartCore(): void {
  void workspace.restartCore();
}
</script>

<template>
  <article class="project-settings-page">
    <WorkspacePageHeader :description="page.description" :title="page.label">
      <template #actions>
        <ElButton
          v-if="bootstrap?.coreHealth.canRestart"
          :loading="workspace.loadState.value === 'loading'"
          @click="restartCore"
        >
          重启 Core
        </ElButton>
      </template>
    </WorkspacePageHeader>

    <CapabilityGate page-key="project-settings">
      <div v-if="bootstrap" class="settings-content">
        <section class="settings-card">
          <header><h2>项目</h2><ElTag effect="plain">layout v{{ bootstrap.project.layoutVersion }}</ElTag></header>
          <dl>
            <div><dt>名称</dt><dd>{{ bootstrap.project.displayName }}</dd></div>
            <div><dt>项目 ID</dt><dd class="mono">{{ bootstrap.project.projectId }}</dd></div>
            <div><dt>创建时间</dt><dd>{{ formatDate(bootstrap.project.createdAt) }}</dd></div>
            <div><dt>更新时间</dt><dd>{{ formatDate(bootstrap.project.updatedAt) }}</dd></div>
          </dl>
        </section>

        <section class="settings-card">
          <header><h2>源资产</h2><ElTag effect="plain">不可变副本</ElTag></header>
          <dl>
            <div><dt>原始文件名</dt><dd>{{ bootstrap.sourceAsset.originalName }}</dd></div>
            <div><dt>项目内位置</dt><dd class="mono">{{ bootstrap.sourceAsset.relativePath }}</dd></div>
            <div><dt>字节数</dt><dd>{{ bootstrap.sourceAsset.byteLength.toLocaleString('zh-CN') }}</dd></div>
            <div><dt>SHA-256</dt><dd class="mono truncate">{{ bootstrap.sourceAsset.sha256 }}</dd></div>
          </dl>
        </section>

        <section class="settings-card">
          <header><h2>工作流与 Core</h2><ElTag :type="bootstrap.coreHealth.status === 'healthy' ? 'success' : 'danger'">{{ bootstrap.coreHealth.status }}</ElTag></header>
          <dl>
            <div><dt>协议版本</dt><dd>{{ bootstrap.coreHealth.protocolVersion }}</dd></div>
            <div><dt>阶段进度</dt><dd>{{ completedStages }} / {{ bootstrap.stages.length }} 已完成</dd></div>
            <div><dt>最后页面</dt><dd>{{ bootstrap.lastPage ?? '尚未记录' }}</dd></div>
            <div><dt>推荐页面</dt><dd>{{ bootstrap.recommendedPage }}</dd></div>
          </dl>
        </section>
      </div>
    </CapabilityGate>
  </article>
</template>

<style scoped>
.project-settings-page {
  min-height: 100%;
  background: #f7f8f6;
}

.settings-content {
  display: grid;
  max-width: 940px;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
  padding: 24px;
}

.settings-card {
  min-width: 0;
  padding: 18px;
  border: 1px solid #d9ddd7;
  border-radius: 8px;
  background: #fff;
}

.settings-card:last-child {
  grid-column: 1 / -1;
}

.settings-card header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.settings-card h2 {
  margin: 0;
  font-size: 15px;
}

.settings-card dl {
  display: grid;
  gap: 10px;
  margin: 16px 0 0;
}

.settings-card dl > div {
  display: grid;
  min-width: 0;
  grid-template-columns: 104px minmax(0, 1fr);
  gap: 12px;
  font-size: 12px;
}

.settings-card dt {
  color: #6a726e;
}

.settings-card dd {
  min-width: 0;
  margin: 0;
}

.mono {
  font-family: ui-monospace, monospace;
  font-size: 11px;
}

.truncate {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

@media (width <= 1080px) {
  .settings-content {
    grid-template-columns: 1fr;
  }

  .settings-card:last-child {
    grid-column: auto;
  }
}
</style>
