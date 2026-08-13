<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import AudioInspectorPanel from './components/AudioInspectorPanel.vue';
import AudioParagraphRow from './components/AudioParagraphRow.vue';
import AudioWorkspaceShell from './components/AudioWorkspaceShell.vue';

type GenerationRowState = 'failed' | 'generating' | 'pending' | 'queued' | 'stopped' | 'success';

interface GenerationRow {
  id: string;
  number: string;
  script: string;
  speaker: string;
  state: GenerationRowState;
}

const router = useRouter();
const route = useRoute();
const initiallyCancelled = route.query.preview === 'cancelled';
const selectedChapter = shallowRef({ id: '12', title: '雨夜来客' });
const inspectorCollapsed = shallowRef(false);
const cancelDialogVisible = shallowRef(false);
const generationCancelled = shallowRef(initiallyCancelled);
const summaryFailureRetrying = shallowRef(false);
const rows = shallowRef<GenerationRow[]>([
  { id: 'para_12_018', number: '18', script: '雨线斜斜地敲在檐上，门外忽然传来三声轻叩。', speaker: '旁白', state: initiallyCancelled ? 'stopped' : 'queued' },
  { id: 'para_12_019', number: '19', script: '“谁？”', speaker: '沈砚', state: initiallyCancelled ? 'stopped' : 'generating' },
  { id: 'para_12_020', number: '20', script: '门外的人没有回答，只将油纸伞往廊下一收。', speaker: '旁白', state: 'pending' },
  { id: 'para_12_021', number: '21', script: '“是我。夜深了，仍要来叨扰。”', speaker: '苏婉', state: 'success' },
  { id: 'para_12_022', number: '22', script: '沈砚沉默片刻，侧身让开门。', speaker: '旁白', state: 'failed' },
]);

const completedCount = 17;
const failedCount = computed(() => rows.value.filter(row => row.state === 'failed').length
  + (summaryFailureRetrying.value ? 0 : 1));
const retryingCount = computed(() => rows.value.filter(row => row.state === 'queued' && row.id === 'para_12_022').length
  + (summaryFailureRetrying.value ? 1 : 0));
const progressLabel = computed(() => generationCancelled.value
  ? `已取消 · 已完成 ${completedCount} 条结果保留`
  : `总进度 19/32 · 成功 ${completedCount} · 失败 ${failedCount.value}`);

const statePresentation: Record<GenerationRowState, {
  audioVersion: string;
  secondaryStatus: string;
  stateText: string;
  status: string;
  tone: 'error' | 'neutral' | 'success' | 'warning';
  variant: 'generating' | 'generation-failed' | 'pending' | 'stopped' | 'success';
}> = {
  failed: {
    audioVersion: '音频 —',
    secondaryStatus: '× 生成失败',
    stateText: '生成失败 · 可单行重试',
    status: '× 生成失败',
    tone: 'error',
    variant: 'generation-failed',
  },
  generating: {
    audioVersion: '音频生成中',
    secondaryStatus: '… 待校验',
    stateText: '生成中',
    status: '↻ 生成中',
    tone: 'warning',
    variant: 'generating',
  },
  pending: {
    audioVersion: '音频 v3',
    secondaryStatus: '… 待校验',
    stateText: '已生成待校验',
    status: '… 待校验',
    tone: 'warning',
    variant: 'pending',
  },
  queued: {
    audioVersion: '音频 —',
    secondaryStatus: '○ 排队',
    stateText: '排队',
    status: '○ 排队',
    tone: 'neutral',
    variant: 'pending',
  },
  stopped: {
    audioVersion: '音频 —',
    secondaryStatus: '■ 已停止',
    stateText: '已停止 · 不再排队或生成',
    status: '■ 已停止',
    tone: 'neutral',
    variant: 'stopped',
  },
  success: {
    audioVersion: '音频 v3',
    secondaryStatus: '✓ 高匹配 · 96%',
    stateText: '高匹配',
    status: '✓ 高匹配',
    tone: 'success',
    variant: 'success',
  },
};

function selectChapter(chapterId: string, chapterTitle: string): void {
  selectedChapter.value = { id: chapterId, title: chapterTitle };
}

function retryRow(paragraphId: string): void {
  rows.value = rows.value.map(row => row.id === paragraphId && row.state === 'failed'
    ? { ...row, state: 'queued' }
    : row);
  showDemoFeedback(`${paragraphId} 已进入本地排队状态`, 'warning');
}

function retryFailedRows(): void {
  rows.value = rows.value.map(row => row.state === 'failed'
    ? { ...row, state: 'queued' }
    : row);
  summaryFailureRetrying.value = true;
  showDemoFeedback('失败项已进入本地重试队列，成功行保持不变', 'warning');
}

function confirmCancellation(): void {
  rows.value = rows.value.map(row => (
    row.state === 'queued' || row.state === 'generating'
      ? { ...row, state: 'stopped' }
      : row
  ));
  generationCancelled.value = true;
  cancelDialogVisible.value = false;
  showDemoFeedback('已停止排队和生成中视觉状态，17 条完成结果保留', 'warning');
}

function openOverlayPreview(): void {
  void router.push({ name: getDemoPageRouteName('audio-cancel-generation-dialog') });
}
</script>

<template>
  <AudioWorkspaceShell
    label="整章生成状态假交互页面"
    chapter-twelve-status="generating"
    @chapter-select="selectChapter"
  >
    <section class="audio-editor" aria-label="整章生成任务与检查器">
      <header class="chapter-toolbar">
        <div class="chapter-context">
          <strong>第 {{ selectedChapter.id }} 章</strong>
          <span>{{ selectedChapter.title }}</span>
        </div>
        <div class="toolbar-summary">
          <div class="toolbar-progress">
            <strong>{{ progressLabel }}</strong>
            <ElProgress :percentage="59" :show-text="false" :stroke-width="6" />
          </div>
          <ElButton
            :disabled="generationCancelled"
            size="small"
            @click="cancelDialogVisible = true"
          >
            {{ generationCancelled ? '已取消' : '取消' }}
          </ElButton>
        </div>
      </header>

      <div class="audio-editor-body">
        <section class="audio-script-pane" aria-label="任务剧本，可独立滚动">
          <header class="script-header">
            <h1>整章生成任务</h1>
            <p>{{ progressLabel }}</p>
          </header>
          <div class="script-hint">
            成功结果保持完成；失败行独立重试；不使用计时器自动推进进度。
          </div>

          <AudioParagraphRow
            v-for="row in rows"
            :key="row.id"
            :audio-version="statePresentation[row.state].audioVersion"
            :number="row.number"
            :paragraph-id="row.id"
            :playable="row.state === 'success' || row.state === 'pending'"
            :script="row.script"
            :secondary-status="statePresentation[row.state].secondaryStatus"
            :speaker="row.speaker"
            :state-text="statePresentation[row.state].stateText"
            :status="statePresentation[row.state].status"
            :status-tone="statePresentation[row.state].tone"
            :variant="statePresentation[row.state].variant"
          >
            <template v-if="row.state === 'failed'" #status>
              <span class="audio-version">音频 —</span>
              <ElTag effect="plain" type="danger">× 生成失败</ElTag>
              <ElButton size="small" @click.stop="retryRow(row.id)">重试本行</ElButton>
            </template>
          </AudioParagraphRow>
        </section>

        <AudioInspectorPanel
          v-model:collapsed="inspectorCollapsed"
          label="任务摘要，可独立滚动"
          :subtitle="generationCancelled ? '整章生成已取消 · 剧本保持可见' : '整章生成中 · 剧本保持可见'"
          title="任务摘要"
        >
          <section class="task-card" :class="{ 'task-card--cancelled': generationCancelled }">
            <div class="task-summary">
              <strong>{{ generationCancelled ? '已取消' : '部分失败' }}</strong>
              <span>19 / 32</span>
            </div>
            <ElProgress :percentage="59" :show-text="false" :stroke-width="8" />
            <p class="task-result">成功 {{ completedCount }} · 失败 {{ failedCount }} · 本地重试 {{ retryingCount }}</p>
            <p class="task-detail">成功行保持当前状态，仅失败行进入重试。</p>
            <ElButton
              :disabled="failedCount === 0 || generationCancelled"
              size="small"
              @click="retryFailedRows"
            >
              重试失败项
            </ElButton>
          </section>
          <section class="inspector-card inspector-card--error">
            <h3>失败原因</h3>
            <p>第 07 行：Provider 超时（展示文本）</p>
            <p>第 22 行：文本超过限制</p>
            <p>成功行保持当前状态，不回退</p>
          </section>
          <section class="inspector-card">
            <h3>后续处理</h3>
            <p>仅失败行进入本地重试队列</p>
            <p>取消时已完成 {{ completedCount }} 条结果仍保留</p>
          </section>
          <ElButton
            :disabled="failedCount === 0 || generationCancelled"
            @click="retryFailedRows"
          >
            重试失败项
          </ElButton>
          <ElButton link type="primary" @click="openOverlayPreview">
            查看独立取消 Overlay
          </ElButton>
        </AudioInspectorPanel>
      </div>
    </section>

    <ElDialog
      v-model="cancelDialogVisible"
      append-to-body
      title="取消整章生成？"
      width="420px"
    >
      <p>已完成的 {{ completedCount }} 条结果仍保留；排队和生成中的视觉状态将停止。</p>
      <template #footer>
        <ElButton @click="cancelDialogVisible = false">继续生成</ElButton>
        <ElButton type="primary" @click="confirmCancellation">确认取消</ElButton>
      </template>
    </ElDialog>
  </AudioWorkspaceShell>
</template>
