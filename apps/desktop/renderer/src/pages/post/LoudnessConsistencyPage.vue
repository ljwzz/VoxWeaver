<script setup lang="ts">
import { computed, ref } from 'vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import PostWorkbenchFrame from './PostWorkbenchFrame.vue';

type CandidateStatus = 'automatic' | 'failed' | 'manual' | 'risk';
type PreviewSide = 'after' | 'before';

interface LoudnessCandidate {
  currentState: string;
  id: string;
  proposal: string;
  risk: string;
  speaker: string;
  status: CandidateStatus;
}

const automaticCandidates: readonly LoudnessCandidate[] = [
  { currentState: '当前响度偏低', id: 'P-018', proposal: '候选调整 · 规格待确认', risk: '峰值待复核', speaker: '旁白', status: 'automatic' },
  { currentState: '当前响度偏高', id: 'P-021', proposal: '候选调整 · 规格待确认', risk: '峰值风险', speaker: '苏婉', status: 'risk' },
  { currentState: '当前测量失败', id: 'P-027', proposal: '无可用候选', risk: '处理失败', speaker: '旁白', status: 'failed' },
];

const manualCandidate: LoudnessCandidate = {
  currentState: '人工复核前状态',
  id: 'P-023',
  proposal: '人工候选 · 规格待确认',
  risk: '人工标记为可试听',
  speaker: '苏婉',
  status: 'manual',
};

const allCandidates: readonly LoudnessCandidate[] = [...automaticCandidates, manualCandidate];
const selectedCandidateId = ref('P-021');
const previewSide = ref<PreviewSide>('after');
const isPreviewing = ref(false);
const appliedCandidateId = ref<string | null>(null);
const applyDialogVisible = ref(false);

const selectedCandidate = computed<LoudnessCandidate>(() => (
  allCandidates.find(candidate => candidate.id === selectedCandidateId.value) ?? automaticCandidates[0]!
));
const canApplySelected = computed(() => selectedCandidate.value.status !== 'failed');

function rowStateClass(status: CandidateStatus): string {
  if (status === 'risk')
    return 'is-warning';
  if (status === 'failed')
    return 'is-error';
  if (status === 'manual')
    return 'is-manual';
  return '';
}

function statusLabel(candidate: LoudnessCandidate): string {
  if (appliedCandidateId.value === candidate.id)
    return '✓ 已应用演示状态';
  if (candidate.status === 'failed')
    return '× 处理失败';
  if (candidate.status === 'risk')
    return '! 峰值风险';
  if (candidate.status === 'manual')
    return '✓ 人工确认候选';
  return '⚙ 自动候选';
}

function selectCandidate(candidateId: string): void {
  selectedCandidateId.value = candidateId;
  isPreviewing.value = false;
}

function togglePreview(candidateId: string, side: PreviewSide): void {
  if (selectedCandidateId.value === candidateId && previewSide.value === side)
    isPreviewing.value = !isPreviewing.value;
  else
    isPreviewing.value = true;

  selectedCandidateId.value = candidateId;
  previewSide.value = side;
}

function undoCandidate(): void {
  appliedCandidateId.value = null;
  selectedCandidateId.value = 'P-021';
  previewSide.value = 'after';
  isPreviewing.value = false;
  showDemoFeedback('已恢复本页原始候选显示', 'info');
}

function requestApply(): void {
  if (!canApplySelected.value) {
    showDemoFeedback('失败候选不能应用', 'error');
    return;
  }

  applyDialogVisible.value = true;
}

function confirmApply(): void {
  appliedCandidateId.value = selectedCandidate.value.id;
  applyDialogVisible.value = false;
  isPreviewing.value = false;
  showDemoFeedback(`${selectedCandidate.value.id} 已切换为本地已应用状态`, 'success');
}
</script>

<template>
  <PostWorkbenchFrame editor-label="响度一致性编辑区">
    <header class="chapter-toolbar">
      <div class="chapter-context">
        <h2>第 12 章 · 雨夜来客</h2>
        <p>章节音频合并 / 响度一致性</p>
      </div>
      <div class="toolbar-spacer"></div>
      <ElTag effect="plain">4 个固定候选</ElTag>
      <ElTag effect="plain" type="warning">待音频规格确认</ElTag>
      <ElButton data-testid="undo-loudness" @click="undoCandidate">撤销候选</ElButton>
      <ElButton
        data-testid="apply-loudness"
        :disabled="!canApplySelected"
        type="primary"
        @click="requestApply"
      >
        应用到本章
      </ElButton>
    </header>

    <div class="post-content">
      <div class="post-content-inner loudness-layout">
        <section class="spec-gate">
          <strong class="body-strong">!</strong>
          <p class="body-text">响度目标、真峰值与输出标准尚未确认；本页只保留固定候选和风险标签。</p>
          <span class="caption">当前章节：38 个有效片段</span>
        </section>

        <div class="loudness-labels">
          <span>片段</span><span>当前状态</span><span>建议状态</span><span>峰值 / 风险</span><span>处理状态</span><span>试听</span>
        </div>

        <section class="candidate-panel" aria-label="自动响度候选">
          <header class="candidate-header">
            <strong class="section-title">⚙ 自动候选</strong>
            <span class="caption">3 项 · 仅本地选择</span>
          </header>
          <button
            v-for="candidate in automaticCandidates"
            :key="candidate.id"
            class="loudness-row"
            :class="[rowStateClass(candidate.status), { 'is-selected': candidate.id === selectedCandidate.id }]"
            :data-candidate-id="candidate.id"
            type="button"
            @click="selectCandidate(candidate.id)"
          >
            <strong>{{ candidate.id }} · {{ candidate.speaker }}</strong>
            <span class="caption">{{ candidate.currentState }}</span>
            <strong class="state-accent">{{ candidate.proposal }}</strong>
            <span :class="candidate.status === 'failed' ? 'state-error' : 'state-warning'">{{ candidate.risk }}</span>
            <strong :class="candidate.status === 'failed' ? 'state-error' : candidate.status === 'risk' ? 'state-warning' : 'state-accent'">
              {{ statusLabel(candidate) }}
            </strong>
            <span class="listen-actions">
              <ElButton size="small" text @click.stop="togglePreview(candidate.id, 'before')">A</ElButton>
              <ElButton size="small" text @click.stop="togglePreview(candidate.id, 'after')">B</ElButton>
            </span>
          </button>
        </section>

        <section class="manual-panel" aria-label="人工确认候选">
          <header class="manual-header">
            <strong class="section-title">人工确认</strong>
            <span class="caption state-success">1 项固定候选 · 与自动候选视觉分离</span>
          </header>
          <button
            class="loudness-row is-manual"
            :class="{ 'is-selected': manualCandidate.id === selectedCandidate.id }"
            :data-candidate-id="manualCandidate.id"
            type="button"
            @click="selectCandidate(manualCandidate.id)"
          >
            <strong>{{ manualCandidate.id }} · {{ manualCandidate.speaker }}</strong>
            <span class="caption">{{ manualCandidate.currentState }}</span>
            <strong class="state-accent">{{ manualCandidate.proposal }}</strong>
            <span class="state-success">{{ manualCandidate.risk }}</span>
            <strong class="state-success">{{ statusLabel(manualCandidate) }}</strong>
            <span class="listen-actions">
              <ElButton size="small" text @click.stop="togglePreview(manualCandidate.id, 'before')">前</ElButton>
              <ElButton size="small" text @click.stop="togglePreview(manualCandidate.id, 'after')">后</ElButton>
            </span>
          </button>
        </section>

        <section class="preview-grid" aria-label="响度试听视觉状态">
          <article class="preview-card" :class="{ 'is-active': previewSide === 'before' }">
            <strong class="section-title">处理前试听</strong>
            <span class="body-strong">{{ selectedCandidate.id }} · {{ selectedCandidate.currentState }}</span>
            <ElButton @click="togglePreview(selectedCandidate.id, 'before')">
              {{ isPreviewing && previewSide === 'before' ? '暂停视觉' : '试听 A / 前' }}
            </ElButton>
            <span class="caption">原片段视觉状态 · 不读取源文件</span>
          </article>
          <article class="preview-card is-accent" :class="{ 'is-active': previewSide === 'after' }">
            <strong class="section-title state-accent">候选后试听</strong>
            <span class="body-strong state-warning">{{ selectedCandidate.proposal }} · {{ selectedCandidate.risk }}</span>
            <ElButton type="primary" @click="togglePreview(selectedCandidate.id, 'after')">
              {{ isPreviewing && previewSide === 'after' ? '暂停视觉' : '试听 B / 后' }}
            </ElButton>
            <span class="caption">仅切换前 / 后试听视觉，不处理音频</span>
          </article>
          <article class="preview-card is-warning">
            <strong class="section-title state-warning">当前选择</strong>
            <span class="body-strong" data-testid="selected-loudness">{{ selectedCandidate.id }} · {{ selectedCandidate.risk }}</span>
            <strong :class="appliedCandidateId === selectedCandidate.id ? 'state-success' : 'state-warning'">
              {{ appliedCandidateId === selectedCandidate.id ? '已应用演示状态' : '待复核' }}
            </strong>
            <span class="caption">撤销只恢复本地候选显示</span>
          </article>
        </section>
      </div>
    </div>

    <ElDialog
      v-model="applyDialogVisible"
      data-testid="loudness-apply-dialog"
      :teleported="false"
      title="确认应用响度候选"
      width="480px"
    >
      <p>{{ selectedCandidate.id }} 将被标记为“已应用演示状态”。不会处理、覆盖或生成音频。</p>
      <p class="dialog-warning">峰值风险和音频规格待确认提示会继续保留。</p>
      <template #footer>
        <ElButton @click="applyDialogVisible = false">取消</ElButton>
        <ElButton type="primary" data-testid="confirm-loudness-apply" @click="confirmApply">确认应用</ElButton>
      </template>
    </ElDialog>
  </PostWorkbenchFrame>
</template>
