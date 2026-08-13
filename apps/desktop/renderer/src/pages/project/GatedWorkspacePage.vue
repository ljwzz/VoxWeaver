<script setup lang="ts">
import type { WorkspacePageKey } from '@voxweaver/contracts';

import { computed } from 'vue';
import { useRoute } from 'vue-router';
import CapabilityGate from '@/components/workspace/CapabilityGate.vue';
import WorkspacePageHeader from '@/components/workspace/WorkspacePageHeader.vue';
import { getWorkspacePage } from '@/workspace/navigation';

const route = useRoute();
const page = computed(() => getWorkspacePage(route.meta.workspacePageKey as WorkspacePageKey));
</script>

<template>
  <article class="gated-workspace-page">
    <WorkspacePageHeader
      :description="page.description"
      :stage-id="page.stageId"
      :title="page.label"
    />
    <CapabilityGate :page-key="page.key">
      <ElResult
        icon="info"
        title="能力已开放"
        sub-title="此页面尚无可执行的 Renderer 控制器。"
      />
    </CapabilityGate>
  </article>
</template>

<style scoped>
.gated-workspace-page {
  min-height: 100%;
  background: #fff;
}
</style>
