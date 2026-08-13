<script setup lang="ts">
import { computed, ref } from 'vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import PostWorkbenchFrame from './PostWorkbenchFrame.vue';

type CoverStatus = 'confirmed' | 'failed' | 'generated' | 'stale';

interface CoverCandidate {
  id: string;
  inputVersion: string;
  promptVersion: string;
  status: CoverStatus;
  title: string;
}

const coverCandidates: readonly CoverCandidate[] = [
  { id: '01', inputVersion: '摘要 v3', promptVersion: '提示词 v2', status: 'generated', title: '灯影与雨幕' },
  { id: '02', inputVersion: '摘要 v3', promptVersion: '提示词 v2', status: 'confirmed', title: '门外的来客' },
  { id: '03', inputVersion: '摘要 v2', promptVersion: '提示词 v1', status: 'stale', title: '旧信与回声' },
  { id: '04', inputVersion: '摘要 v3', promptVersion: '提示词 v2', status: 'failed', title: '生成失败' },
];

const initialPrompt = '中性叙事封面；雨夜、旧宅门廊与一封未寄出的信；低饱和、清晰主体、避免文字；不引用具体艺术家或品牌视觉。';
const selectedCoverId = ref('02');
const confirmedCoverId = ref<string | null>(null);
const stylePrompt = ref(initialPrompt);
const promptState = ref('提示词 v2 · 本地草稿');
const confirmDialogVisible = ref(false);
const retryState = ref<'failed' | 'ready'>('failed');

const selectedCover = computed<CoverCandidate>(() => (
  coverCandidates.find(candidate => candidate.id === selectedCoverId.value) ?? coverCandidates[0]!
));
const canConfirmSelected = computed(() => selectedCover.value.status !== 'stale' && selectedCover.value.status !== 'failed');

function candidateStatus(candidate: CoverCandidate): string {
  if (confirmedCoverId.value === candidate.id)
    return '✓ 本地已确认';
  if (candidate.status === 'stale')
    return 'ⓧ 已失效';
  if (candidate.status === 'failed')
    return retryState.value === 'ready' ? '↻ 重试演示就绪' : '× 生成失败';
  if (candidate.id === selectedCoverId.value)
    return '● 已选择';
  return candidate.status === 'confirmed' ? '✓ 既有选择' : '● 已生成';
}

function selectCover(candidate: CoverCandidate): void {
  selectedCoverId.value = candidate.id;
  if (candidate.status === 'stale')
    showDemoFeedback('已失效候选可查看，但不能直接确认', 'warning');
}

function updatePrompt(): void {
  promptState.value = '提示词 v2 · 本地已编辑';
}

function retryFailedCandidate(): void {
  retryState.value = 'ready';
  selectedCoverId.value = '04';
  showDemoFeedback('失败候选已切换为重试演示就绪，未生成图片', 'info');
}

function requestConfirmation(): void {
  if (!canConfirmSelected.value) {
    showDemoFeedback('已失效或失败候选不能直接确认', 'error');
    return;
  }

  confirmDialogVisible.value = true;
}

function confirmCover(): void {
  confirmedCoverId.value = selectedCover.value.id;
  confirmDialogVisible.value = false;
  showDemoFeedback(`候选 ${selectedCover.value.id} 已更新为本地确认状态`, 'success');
}
</script>

<template>
  <PostWorkbenchFrame editor-label="章节封面编辑区">
    <header class="chapter-toolbar">
      <div class="chapter-context">
        <h2>第 12 章 · 雨夜来客</h2>
        <p>章节封面生成 · 当前摘要 v3</p>
      </div>
      <div class="toolbar-spacer"></div>
      <ElTag effect="plain" type="success">摘要 v3 · 当前有效</ElTag>
      <ElTag effect="plain" type="warning">规格待确认</ElTag>
      <ElTag effect="plain">固定候选 4 个</ElTag>
    </header>

    <div class="post-content">
      <div class="post-content-inner cover-layout">
        <section class="cover-candidates card" aria-label="章节封面固定候选">
          <header class="cover-header">
            <h3 class="section-title">封面候选</h3>
            <span class="caption">4 个等宽候选 · 选择只改变本页 Inspector</span>
          </header>
          <div class="cover-grid">
            <button
              v-for="candidate in coverCandidates"
              :key="candidate.id"
              class="cover-candidate"
              :class="[{ 'is-current': candidate.id === selectedCover.id, 'is-stale': candidate.status === 'stale', 'is-error': candidate.status === 'failed' }]"
              :data-cover-id="candidate.id"
              type="button"
              @click="selectCover(candidate)"
            >
              <span class="panel-header">
                <strong>候选 {{ candidate.id }}</strong>
                <span>{{ candidateStatus(candidate) }}</span>
              </span>
              <img src="./assets/cover-preview.svg" :alt="`候选 ${candidate.id} 抽象预览`">
              <span>{{ candidate.title }}</span>
              <span class="caption">{{ candidate.inputVersion }} · {{ candidate.promptVersion }}</span>
            </button>
          </div>

          <div class="selected-cover" :aria-label="`已选择候选 ${selectedCover.id} 抽象占位封面`">
            <div class="cover-sky"></div>
            <img class="cover-light" src="./assets/cover-abstract-light.svg" alt="抽象光源">
            <div class="cover-building"></div>
            <div class="cover-doorway"></div>
            <i v-for="index in 18" :key="index" class="rain-line" :style="{ top: `${20 + (index % 4) * 34}px`, left: `${15 + (index - 1) * 42}px`, height: `${36 + (index % 3) * 12}px` }"></i>
            <span class="cover-placeholder-badge">候选 {{ selectedCover.id }} · {{ selectedCover.title }} · 抽象占位图</span>
          </div>
          <div class="cover-footer">
            <span data-testid="selected-cover-label">已选择候选 {{ selectedCover.id }} · {{ candidateStatus(selectedCover) }}</span>
            <span :class="canConfirmSelected ? 'state-warning' : 'state-stale'">{{ canConfirmSelected ? '待确认' : '不可确认' }}</span>
          </div>
        </section>

        <aside class="cover-inspector card" aria-label="封面检查器">
          <h3 class="section-title">封面检查器</h3>
          <ElTag effect="plain" :type="canConfirmSelected ? undefined : 'danger'">
            候选 {{ selectedCover.id }} · {{ candidateStatus(selectedCover) }}
          </ElTag>
          <div class="input-card format-card">
            <div class="info-row"><span class="caption">画幅</span><span class="caption">16:9 · 占位</span></div>
            <div class="info-row"><span class="caption">尺寸</span><span class="caption">1920 × 1080 · 占位</span></div>
            <div class="info-row"><span class="caption">规格状态</span><span class="caption state-warning">待确认</span></div>
            <span class="caption state-warning">具体画幅、尺寸和输出格式尚未固化。</span>
          </div>
          <label class="label" for="cover-style-prompt">风格提示词</label>
          <ElInput
            id="cover-style-prompt"
            v-model="stylePrompt"
            class="style-prompt-input"
            data-testid="cover-prompt"
            :maxlength="220"
            resize="none"
            :rows="6"
            type="textarea"
            @input="updatePrompt"
          />
          <span class="caption">{{ promptState }}</span>
          <div class="input-card generation-card">
            <div class="info-row"><span class="caption">摘要版本</span><span class="caption">{{ selectedCover.inputVersion }}</span></div>
            <div class="info-row"><span class="caption">提示词版本</span><span class="caption">{{ selectedCover.promptVersion }}</span></div>
            <div class="info-row"><span class="caption">候选状态</span><span class="caption">{{ candidateStatus(selectedCover) }}</span></div>
            <div class="info-row"><span class="caption">输入摘要</span><span class="caption">sha256 91e0…d214</span></div>
          </div>
          <div v-if="selectedCover.status === 'failed'" class="progress-card">
            <strong class="label" :class="retryState === 'ready' ? 'state-success' : 'state-error'">
              {{ retryState === 'ready' ? '候选 04 · 重试演示就绪' : '候选 04 · 生成失败' }}
            </strong>
            <span class="caption">用户操作后直接切换状态，不使用计时器。</span>
          </div>
          <div class="inspector-actions">
            <ElButton data-testid="retry-cover" :disabled="selectedCover.status !== 'failed'" @click="retryFailedCandidate">重新生成</ElButton>
            <ElTooltip :content="canConfirmSelected ? '确认只更新本地候选标签' : '已失效或失败候选不能直接确认'" placement="top">
              <span>
                <ElButton data-testid="confirm-cover" :disabled="!canConfirmSelected" type="primary" @click="requestConfirmation">选择并确认</ElButton>
              </span>
            </ElTooltip>
          </div>
          <span class="caption">不调用图片生成，不下载远程资源。</span>
        </aside>
      </div>
    </div>

    <ElDialog
      v-model="confirmDialogVisible"
      data-testid="cover-confirm-dialog"
      :teleported="false"
      title="确认章节封面"
      width="480px"
    >
      <p>将候选 {{ selectedCover.id }} 标记为本地已确认。不会生成、下载或写入图片。</p>
      <template #footer>
        <ElButton @click="confirmDialogVisible = false">取消</ElButton>
        <ElButton type="primary" data-testid="confirm-cover-dialog" @click="confirmCover">确认选择</ElButton>
      </template>
    </ElDialog>
  </PostWorkbenchFrame>
</template>
