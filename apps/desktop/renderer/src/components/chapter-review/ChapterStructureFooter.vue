<script setup lang="ts">
defineProps<{
  canConfirm: boolean;
  canGoNext: boolean;
  nextLoading: boolean;
  operationCount: number;
  saveLoading: boolean;
  status: string;
}>();

const emit = defineEmits<{
  confirm: [];
  next: [];
}>();
</script>

<template>
  <footer class="chapter-structure-footer">
    <div class="chapter-structure-footer__status">
      <span data-testid="chapter-operation-count">
        未保存操作：{{ operationCount }} 项
      </span>
      <span data-testid="chapter-structure-status">{{ status }}</span>
    </div>
    <div class="chapter-structure-footer__actions">
      <ElButton
        data-testid="confirm-chapter-cut"
        :disabled="!canConfirm"
        :loading="saveLoading"
        @click="emit('confirm')"
      >
        确认章节切割
      </ElButton>
      <ElButton
        data-testid="next-proofreading"
        :disabled="!canGoNext"
        :loading="nextLoading"
        type="primary"
        @click="emit('next')"
      >
        下一步
      </ElButton>
    </div>
  </footer>
</template>

<style scoped>
.chapter-structure-footer {
  display: flex;
  min-height: 64px;
  box-sizing: border-box;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 20px;
  border-top: 1px solid #d9ddd7;
  background: #fff;
  box-shadow: 0 -4px 14px rgb(31 38 34 / 5%);
}

.chapter-structure-footer__status {
  display: flex;
  align-items: center;
  gap: 14px;
  color: #6a726e;
  font-size: 11px;
}

.chapter-structure-footer__actions {
  display: flex;
  gap: 8px;
}
</style>
