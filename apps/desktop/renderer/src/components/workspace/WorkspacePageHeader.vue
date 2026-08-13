<script setup lang="ts">
defineProps<{
  title: string;
  description: string;
  stageId?: string | undefined;
}>();
</script>

<template>
  <header class="workspace-page-header">
    <div>
      <div class="workspace-page-heading">
        <h1>{{ title }}</h1>
        <ElTag v-if="stageId" effect="plain" size="small">
          阶段 {{ stageId }}
        </ElTag>
      </div>
      <p>{{ description }}</p>
    </div>
    <div class="workspace-page-actions">
      <slot name="actions" />
    </div>
  </header>
</template>

<style scoped>
.workspace-page-header {
  display: flex;
  min-height: 72px;
  align-items: flex-start;
  justify-content: space-between;
  gap: 24px;
  padding: 18px 24px 14px;
  border-bottom: 1px solid #d9ddd7;
  background: #fff;
}

.workspace-page-heading {
  display: flex;
  align-items: center;
  gap: 10px;
}

.workspace-page-header h1 {
  margin: 0;
  color: #202522;
  font-size: 20px;
  line-height: 28px;
}

.workspace-page-header p {
  margin: 4px 0 0;
  color: #6a726e;
  font-size: 13px;
  line-height: 20px;
}

.workspace-page-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
</style>
