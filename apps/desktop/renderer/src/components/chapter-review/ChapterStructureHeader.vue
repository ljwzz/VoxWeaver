<script setup lang="ts">
defineProps<{
  anomalyCount: number;
  chapterCount: number;
  navigationDisabled: boolean;
}>();

const emit = defineEmits<{
  nextAnomaly: [];
  previousAnomaly: [];
}>();
</script>

<template>
  <header class="chapter-structure-header">
    <div class="chapter-structure-header__title-group">
      <h1 class="chapter-structure-header__title">
        章节切割
      </h1>
      <span
        v-if="anomalyCount > 0"
        :aria-label="`${anomalyCount} 个异常，共 ${chapterCount} 章`"
        class="chapter-structure-header__count"
        data-testid="chapter-anomaly-count"
      >
        <strong class="chapter-structure-header__anomaly-count">{{ anomalyCount }}</strong>
        <span>/{{ chapterCount }} 章</span>
      </span>
      <span
        v-else
        :aria-label="`共 ${chapterCount} 章`"
        class="chapter-structure-header__count"
        data-testid="chapter-count"
      >
        {{ chapterCount }} 章
      </span>
    </div>

    <nav aria-label="章节长度异常导航" class="chapter-structure-header__navigation">
      <ElButton
        aria-label="上一处章节长度异常"
        data-testid="previous-chapter-anomaly"
        :disabled="navigationDisabled"
        @click="emit('previousAnomaly')"
      >
        上一处
      </ElButton>
      <ElButton
        aria-label="下一处章节长度异常"
        data-testid="next-chapter-anomaly"
        :disabled="navigationDisabled"
        @click="emit('nextAnomaly')"
      >
        下一处
      </ElButton>
    </nav>
  </header>
</template>

<style scoped>
.chapter-structure-header {
  display: flex;
  min-height: 56px;
  box-sizing: border-box;
  align-items: center;
  justify-content: space-between;
  gap: 20px;
  padding: 10px 20px;
  border-bottom: 1px solid #d9ddd7;
  background: #fff;
}

.chapter-structure-header__title-group,
.chapter-structure-header__navigation {
  display: flex;
  align-items: center;
  gap: 10px;
}

.chapter-structure-header__title {
  margin: 0;
  font-size: 16px;
  font-weight: 650;
}

.chapter-structure-header__count {
  color: #6a726e;
  font-size: 12px;
}

.chapter-structure-header__anomaly-count {
  color: var(--el-color-warning);
  font-weight: 700;
}
</style>
