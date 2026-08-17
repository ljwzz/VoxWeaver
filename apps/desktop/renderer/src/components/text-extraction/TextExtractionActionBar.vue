<script setup lang="ts">
import type { TaskSummaryDto, TxtSourceEncoding } from '@voxweaver/contracts';

import { computed } from 'vue';

const props = withDefaults(defineProps<{
  task?: TaskSummaryDto | undefined;
  sourceName?: string | undefined;
  sourceSize?: string | undefined;
  encodingOptions?: readonly {
    label: string;
    value: TxtSourceEncoding;
  }[] | undefined;
  probeLoading?: boolean | undefined;
  hasCompletedRevision: boolean;
  canConfirm: boolean;
  runningAction?: 'cancel' | 'retry' | 'start' | undefined;
  errorMessage?: string | undefined;
}>(), {
  encodingOptions: () => [],
  probeLoading: false,
});

defineEmits<{
  cancel: [];
  encodingChanged: [];
  proceed: [];
  redetect: [];
  retry: [];
}>();

const encoding = defineModel<TxtSourceEncoding | undefined>('encoding');
const taskRunning = computed(() => (
  props.task?.status === 'pending' || props.task?.status === 'running'
));
const taskRetryable = computed(() => (
  props.task?.status === 'failed' || props.task?.status === 'canceled'
));
const canProceed = computed(() => (
  props.canConfirm || props.task?.status === 'succeeded' || props.hasCompletedRevision
));
</script>

<template>
  <footer class="text-extraction-action-bar">
    <div v-if="sourceName" class="source-info">
      <span class="source-name" :title="sourceName">{{ sourceName }}</span>
      <span v-if="sourceSize" class="source-size">{{ sourceSize }}</span>
    </div>

    <div class="action-status" aria-live="polite">
      <template v-if="taskRunning && task">
        <span>{{ task.progress.message }}</span>
        <ElProgress :percentage="task.progress.percent" :show-text="false" />
        <span>{{ task.progress.percent }}%</span>
      </template>
      <span v-else-if="taskRetryable" class="action-error" role="alert">
        {{ task?.errorMessage || errorMessage || '文本提取未完成。' }}
      </span>
      <span v-else-if="errorMessage" class="action-error" role="alert">{{ errorMessage }}</span>
    </div>

    <div class="action-controls">
      <div class="source-controls">
        <ElSelect
          v-if="encodingOptions.length > 0"
          v-model="encoding"
          aria-label="源文本编码"
          :disabled="taskRunning"
          placeholder="选择编码"
          @change="$emit('encodingChanged')"
        >
          <ElOption
            v-for="option in encodingOptions"
            :key="option.value"
            :label="option.label"
            :value="option.value"
          />
        </ElSelect>
        <ElButton :loading="probeLoading" @click="$emit('redetect')">
          重新检测
        </ElButton>
      </div>

      <div class="action-buttons">
        <ElButton
          v-if="taskRunning"
          :disabled="!task?.canCancel"
          :loading="runningAction === 'cancel'"
          @click="$emit('cancel')"
        >
          取消
        </ElButton>
        <ElButton
          v-else-if="taskRetryable"
          :disabled="!task?.canRetry"
          :loading="runningAction === 'retry'"
          type="primary"
          @click="$emit('retry')"
        >
          重试
        </ElButton>
        <ElButton
          v-else
          :disabled="!canProceed"
          :loading="runningAction === 'start'"
          type="primary"
          @click="$emit('proceed')"
        >
          确定文本解析正确并进入章节复核
        </ElButton>
      </div>
    </div>
  </footer>
</template>

<style scoped>
.text-extraction-action-bar {
  display: flex;
  min-height: 60px;
  flex: 0 0 auto;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  padding: 10px 24px;
  border-top: 1px solid #d9ddd7;
  background: #fff;
}

.source-info {
  display: flex;
  min-width: 0;
  flex: 0 1 280px;
  align-items: center;
  justify-content: flex-start;
  gap: 10px;
}

.source-name {
  min-width: 0;
  overflow: hidden;
  color: #202522;
  font-size: 13px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.source-size {
  flex: 0 0 auto;
  color: #6a726e;
  font-size: 12px;
  white-space: nowrap;
}

.action-status {
  display: flex;
  min-width: 0;
  flex: 1;
  align-items: center;
  gap: 12px;
  color: #6a726e;
  font-size: 12px;
}

.action-status .el-progress {
  width: min(320px, 32vw);
}

.action-error {
  overflow: hidden;
  color: #b34444;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.action-controls,
.source-controls,
.action-buttons {
  display: flex;
  flex: 0 0 auto;
  align-items: center;
}

.action-controls {
  justify-content: flex-end;
  gap: 12px;
}

.source-controls,
.action-buttons {
  gap: 8px;
}

.source-controls .el-select {
  width: 132px;
}

.action-buttons {
  justify-content: flex-end;
}
</style>
