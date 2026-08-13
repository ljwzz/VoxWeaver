<script setup lang="ts">
import { computed, ref } from 'vue';
import PageDocument from '@/components/PageDocument.vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';
import TextDemoShell from './TextDemoShell.vue';

type ExtractionState = 'completed' | 'default' | 'failed' | 'processing';

const bodyClasses = ['text-page'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const warningDialogOpen = ref(false);
const extractionState = ref<ExtractionState>('processing');
const retryStateOrder: readonly ExtractionState[] = ['default', 'processing', 'failed', 'completed'];
const retryStateLabels: Record<ExtractionState, string> = {
  completed: '完成',
  default: '默认',
  failed: '失败',
  processing: '处理中',
};
const warnings = [
  '第 7 章脚注标记顺序异常：标记 [2] 早于标记 [1]。',
  '第 19 章存在无正文对应项的脚注标记。',
] as const;

const extractionStateDetails = {
  completed: {
    badgeClass: 'status-badge--success',
    badgeText: '✓ 已完成',
    description: '36 章已完成本地演示提取，等待审核。',
    heading: '提取成功 · 100%',
    progress: 100,
  },
  default: {
    badgeClass: 'status-badge--neutral',
    badgeText: '• 默认',
    description: '尚未开始演示提取；源文件仍保持只读。',
    heading: '尚未提取 · 0%',
    progress: 0,
  },
  failed: {
    badgeClass: 'status-badge--error',
    badgeText: '× 失败',
    description: '演示阶段失败：解析 EPUB 章节索引。可继续手动切换状态。',
    heading: '提取失败 · 72%',
    progress: 72,
  },
  processing: {
    badgeClass: 'status-badge--processing',
    badgeText: '◔ 处理中',
    description: '当前阶段：解析 EPUB 章节索引。警告 2 项；失败阶段可单独重试，不回写源文件。',
    heading: '处理中 · 72%',
    progress: 72,
  },
} as const;

const currentState = computed(() => extractionStateDetails[extractionState.value]);
const progressStatus = computed(() => {
  if (extractionState.value === 'failed')
    return 'exception';
  if (extractionState.value === 'completed')
    return 'success';
  return undefined;
});

function startExtraction(): void {
  extractionState.value = 'processing';
  showDemoFeedback('已切换到文本提取处理中状态', 'info');
}

function retryFailedStage(): void {
  const currentIndex = retryStateOrder.indexOf(extractionState.value);
  extractionState.value = retryStateOrder[(currentIndex + 1) % retryStateOrder.length]!;
  showDemoFeedback(`重试阶段已切换为“${retryStateLabels[extractionState.value]}”`);
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <TextDemoShell
      current-page="text-extraction"
      editor-aria-label="文本提取编辑区"
      label="VoxWeaver 文本提取演示页面"
      toolbar-detail="示例小说.epub · EPUB · UTF-8 已识别"
      toolbar-title="文本提取"
    >
      <template #toolbar-actions>
        <span class="icon-button" aria-disabled="true">⋯</span>
        <ElButton
          class="toolbar-button toolbar-button--secondary"
          data-testid="view-extraction-warnings"
          @click="warningDialogOpen = true"
        >
          查看警告
        </ElButton>
        <ElButton
          class="toolbar-button toolbar-button--primary"
          data-testid="start-extraction"
          @click="startExtraction"
        >
          提取文本
        </ElButton>
      </template>

      <div class="text-editor-content extraction-content">
        <div class="page-heading">
          <div class="page-heading-copy"><h2>文本提取</h2><p>源文件保持只读；提取结果进入审核流程。</p></div>
          <span class="status-badge" :class="[currentState.badgeClass]">{{ currentState.badgeText }}</span>
        </div>

        <section class="processing-banner" :class="[`processing-banner--${extractionState}`]">
          <div class="processing-copy">
            <h3>{{ currentState.heading }}</h3>
            <p class="body-copy" style="color: var(--vw-text-secondary)">{{ currentState.description }}</p>
            <div class="progress-wrap">
              <ElProgress
                class="demo-progress"
                :percentage="currentState.progress"
                :show-text="false"
                :status="progressStatus"
                :stroke-width="8"
              />
            </div>
          </div>
          <ElButton class="text-button" data-testid="retry-extraction-stage" @click="retryFailedStage">
            重试失败阶段
          </ElButton>
        </section>

        <div class="preview-grid">
          <section class="surface-card preview-card preview-card--source">
            <div class="card-header"><h3 class="card-title">项目内源文件预览</h3><span class="preview-tag" style="color: var(--vw-text-secondary)">只读源内容</span></div>
            <p class="caption">1.8 MB · EPUB · UTF-8 · 未修改</p>
            <div class="preview-text">
              <p>第一章　雨夜</p><p aria-hidden="true">&nbsp;</p>
              <p>雨声从檐角落下，像一条断断续续的线。<br>林舟站在门边，没有回头。</p>
              <p aria-hidden="true">&nbsp;</p><p>第二章　旧信</p><p aria-hidden="true">&nbsp;</p>
              <p>信封边缘已经发黄，署名只剩一个模糊的“沈”字。</p>
            </div>
          </section>
          <section class="surface-card preview-card">
            <div class="card-header"><h3 class="card-title">提取文本预览</h3><span class="preview-tag preview-tag--accent">可审核结果</span></div>
            <p class="caption">已解析 {{ extractionState === 'completed' ? 36 : 22 }} / 36 章 · 当前结果未确认</p>
            <div class="preview-text">
              <p>第一章　雨夜</p><p aria-hidden="true">&nbsp;</p>
              <p>雨声从檐角落下，像一条断断续续的线。林舟站在门边，没有回头。</p>
              <p aria-hidden="true">&nbsp;</p><p>第二章　旧信</p><p aria-hidden="true">&nbsp;</p>
              <p>信封边缘已经发黄，署名只剩一个模糊的“沈”字。</p>
            </div>
            <p class="preview-warning">!&nbsp; 2 处疑似脚注顺序异常，等待审核。</p>
          </section>
        </div>

        <h3 class="state-example-title">组件状态示例</h3>
        <div class="state-grid">
          <section class="surface-card state-card"><div class="row-between"><span class="strong">尚未提取</span><span class="status-badge status-badge--neutral">• 默认</span></div><p class="caption">选择源文件后开始</p></section>
          <section class="surface-card state-card"><div class="row-between"><span class="strong">提取中</span><span class="status-badge status-badge--processing">◔ 处理中</span></div><p class="caption">72% · 解析章节索引</p></section>
          <section class="surface-card state-card state-card--error"><div class="row-between"><span class="strong">提取失败</span><span class="status-badge status-badge--error">× 失败</span></div><p class="caption">阶段：解析 EPUB 索引</p></section>
          <section class="surface-card state-card state-card--success"><div class="row-between"><span class="strong">提取成功</span><span class="status-badge status-badge--success">✓ 已完成</span></div><p class="caption">36 章 · 等待审核</p></section>
        </div>
      </div>

      <ElDialog v-model="warningDialogOpen" title="文本提取警告" width="520px" append-to-body>
        <ol class="demo-warning-list">
          <li v-for="warning in warnings" :key="warning">{{ warning }}</li>
        </ol>
        <template #footer>
          <ElButton type="primary" @click="warningDialogOpen = false">知道了</ElButton>
        </template>
      </ElDialog>
    </TextDemoShell>
  </PageDocument>
</template>
