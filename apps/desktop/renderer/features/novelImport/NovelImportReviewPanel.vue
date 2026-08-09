<script setup lang="ts">
import type {
  CoverageClassificationV1,
  ProjectSummaryDto,
  UserSelectedTxtSourceEncoding,
} from '@voxweaver/contracts';
import type { ChapterBoundaryDraft, NovelImportRendererState, NovelImportTaskStorage } from './novelImportController';
import {
  computed,
  onMounted,
  onUnmounted,
  ref,
  shallowRef,
  watch,
} from 'vue';
import {
  NovelImportController,
  resolveNovelImportKeyboardCommand,
} from './novelImportController';

const props = defineProps<{
  readonly project: ProjectSummaryDto;
}>();

let updateState: (next: NovelImportRendererState) => void = () => {};
const controller = new NovelImportController({
  api: window.voxweaver.novelImport,
  onStateChange: next => updateState(next),
  storage: createSafeTaskStorage(),
});
const state = shallowRef(controller.state);
updateState = (next) => {
  state.value = next;
};

const headingStartByte = ref(0);
const headingEndByte = ref(0);
const contentStartByte = ref(0);
const contentEndByte = ref(0);

const isReadOnly = computed(() => (
  props.project.accessMode === 'read-only' || state.value.snapshot?.readOnly === true
));
const writeDisabled = computed(() => isReadOnly.value || state.value.action !== null);
const activeTask = computed(() => (
  state.value.task?.executionStatus === 'pending'
  || state.value.task?.executionStatus === 'running'
));
const canSelectSource = computed(() => !writeDisabled.value && !activeTask.value);
const canStart = computed(() => (
  !writeDisabled.value
  && !activeTask.value
  && state.value.selectedSource !== null
  && (state.value.phase === 'ready' || state.value.phase === 'encoding-required')
));
const selectedChapter = computed(() => state.value.snapshot?.chapters.find(
  chapter => chapter.chapterId === state.value.selectedChapterId,
) ?? null);
const canCancel = computed(() => (
  !writeDisabled.value
  && ['pending', 'running'].includes(state.value.task?.executionStatus ?? '')
));
const canRetry = computed(() => (
  !writeDisabled.value
  && !activeTask.value
  && (state.value.task !== null || state.value.error?.taskId !== undefined)
  && state.value.phase !== 'encoding-required'
  && (state.value.task?.executionStatus === 'failed'
    || state.value.task?.recoveryStatus === 'retryable'
    || state.value.error?.retryable === true)
));
const coveragePercent = computed(() => {
  const coverage = state.value.snapshot?.coverage;
  if (!coverage || coverage.totalByteLength === 0)
    return 0;
  return Math.round((coverage.classifiedByteLength / coverage.totalByteLength) * 10000) / 100;
});
const pendingCount = computed(() => {
  const snapshot = state.value.snapshot;
  if (!snapshot)
    return 0;
  return snapshot.chapterCandidates.filter(item => item.reviewStatus === 'pending').length
    + snapshot.issues.filter(item => item.reviewStatus === 'pending').length
    + snapshot.uncoveredRanges.filter(item => item.reviewStatus === 'pending').length
    + snapshot.normalizationProposals.filter(item => item.reviewStatus === 'pending').length;
});

const encodingOptions: readonly {
  readonly label: string;
  readonly value: UserSelectedTxtSourceEncoding;
}[] = [
  { label: 'GBK / GB2312', value: 'gbk' },
  { label: 'GB18030', value: 'gb18030' },
  { label: 'Big5', value: 'big5' },
  { label: 'UTF-16 LE', value: 'utf-16le' },
  { label: 'UTF-16 BE', value: 'utf-16be' },
];

const classificationOptions: readonly {
  readonly label: string;
  readonly value: Exclude<CoverageClassificationV1, 'chapter'>;
}[] = [
  { label: '前置内容', value: 'front_matter' },
  { label: '附录', value: 'appendix' },
  { label: '噪声', value: 'noise' },
  { label: '未知 / 待审', value: 'unknown' },
];

watch(
  () => [props.project.projectId, props.project.projectSessionId, props.project.accessMode] as const,
  () => {
    void controller.activate({
      accessMode: props.project.accessMode,
      projectId: props.project.projectId,
      projectSessionId: props.project.projectSessionId,
    });
  },
  { immediate: true },
);

watch(
  () => selectedChapter.value?.chapterId,
  () => resetBoundaryDraft(),
  { immediate: true },
);

onMounted(() => {
  window.addEventListener('keydown', handleKeyboard);
});

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyboard);
  controller.dispose();
});

function selectSource(): void {
  void controller.selectSource();
}

function setEncoding(event: Event): void {
  const value = (event.target as HTMLSelectElement).value;
  controller.setEncoding(value === '' ? null : value as UserSelectedTxtSourceEncoding);
}

function startImport(): void {
  void controller.start();
}

function refreshTask(): void {
  void controller.refreshTask();
}

function inspectRevision(): void {
  void controller.inspect();
}

function cancelTask(): void {
  void controller.cancelTask();
}

function retryTask(): void {
  void controller.retryTask();
}

function prepareBoundaryAdjustment(): void {
  const chapter = selectedChapter.value;
  if (!chapter)
    return;
  const draft: ChapterBoundaryDraft = {
    chapterId: chapter.chapterId,
    contentEndByte: contentEndByte.value,
    contentStartByte: contentStartByte.value,
    headingEndByte: headingEndByte.value,
    headingStartByte: headingStartByte.value,
  };
  void controller.prepareBoundaryAdjustment(draft);
}

function prepareRangeClassification(
  rangeIndex: number,
  classification: Exclude<CoverageClassificationV1, 'chapter'>,
): void {
  void controller.prepareRangeClassification(rangeIndex, classification);
}

function prepareNormalizationDecision(
  proposalId: string,
  decision: 'approved' | 'rejected',
): void {
  void controller.prepareNormalizationDecision(proposalId, decision);
}

function prepareSelectedChapterRerun(): void {
  if (state.value.selectedChapterId)
    void controller.prepareChapterRerun(state.value.selectedChapterId);
}

function confirmPendingReview(): void {
  void controller.confirmPendingReview();
}

function resetBoundaryDraft(): void {
  const chapter = selectedChapter.value;
  headingStartByte.value = chapter?.headingRange.startByte ?? 0;
  headingEndByte.value = chapter?.headingRange.endByte ?? 0;
  contentStartByte.value = chapter?.contentRange.startByte ?? 0;
  contentEndByte.value = chapter?.contentRange.endByte ?? 0;
}

function handleKeyboard(event: KeyboardEvent): void {
  const target = event.target;
  const editable = target instanceof HTMLInputElement
    || target instanceof HTMLSelectElement
    || target instanceof HTMLTextAreaElement
    || (target instanceof HTMLElement && target.isContentEditable);
  const command = resolveNovelImportKeyboardCommand({
    altKey: event.altKey,
    ctrlKey: event.ctrlKey,
    editable,
    key: event.key,
    metaKey: event.metaKey,
    shiftKey: event.shiftKey,
  });
  if (!command)
    return;

  event.preventDefault();
  switch (command) {
    case 'cancel-dialog':
      if (state.value.pendingReview)
        controller.cancelPendingReview();
      else
        controller.clearError();
      break;
    case 'move-chapter-next':
      controller.moveChapterSelection(1);
      break;
    case 'move-chapter-previous':
      controller.moveChapterSelection(-1);
      break;
    case 'refresh-task':
      refreshTask();
      break;
    case 'select-source':
      selectSource();
      break;
    case 'start-task':
      startImport();
      break;
  }
}

function formatBytes(value: number): string {
  return new Intl.NumberFormat('zh-CN').format(value);
}

function shortHash(value: string): string {
  return `${value.slice(0, 12)}…`;
}

function rangeLabel(range: { readonly startByte: number; readonly endByte: number }): string {
  return `[${range.startByte}, ${range.endByte})`;
}

function createSafeTaskStorage(): NovelImportTaskStorage {
  return {
    getItem: (key) => {
      try {
        return window.sessionStorage.getItem(key);
      } catch {
        return null;
      }
    },
    removeItem: (key) => {
      try {
        window.sessionStorage.removeItem(key);
      } catch {
        // A disabled storage area only disables refresh recovery.
      }
    },
    setItem: (key, value) => {
      try {
        window.sessionStorage.setItem(key, value);
      } catch {
        // The live controller still owns the task in memory.
      }
    },
  };
}
</script>

<template>
  <section class="novel-import" aria-labelledby="novel-import-title">
    <header class="novel-import__header">
      <div>
        <p class="eyebrow">
          NOVEL IMPORT
        </p>
        <h2 id="novel-import-title">
          小说导入与章节审核
        </h2>
        <p class="novel-import__status" role="status">
          {{ state.statusMessage }}
        </p>
      </div>
      <div class="novel-import__badges">
        <span class="novel-import__badge" :data-state="state.eventSubscription">
          {{ state.eventSubscription === 'subscribed' ? '事件已订阅' : state.eventSubscription === 'unavailable' ? '事件不可用' : '等待事件' }}
        </span>
        <span v-if="isReadOnly" class="novel-import__badge" data-state="read-only">只读检查</span>
        <span v-if="pendingCount > 0" class="novel-import__badge" data-state="pending">{{ pendingCount }} 项待审核</span>
      </div>
    </header>

    <section v-if="state.error" class="novel-import__error" role="alert">
      <div>
        <strong>{{ state.error.code }}</strong>
        <p>{{ state.error.message }}</p>
        <small v-if="state.error.taskId">任务：{{ state.error.taskId }}</small>
        <small v-if="state.error.currentArtifactRevisionId">当前 revision：{{ state.error.currentArtifactRevisionId }}</small>
      </div>
      <button class="text-button" type="button" aria-label="关闭导入错误" @click="controller.clearError()">
        关闭
      </button>
    </section>

    <section v-if="state.pendingReview" class="novel-import__confirmation" role="alertdialog" aria-labelledby="novel-review-confirm-title">
      <div>
        <p class="eyebrow">
          STALE IMPACT PREVIEW
        </p>
        <h3 id="novel-review-confirm-title">
          确认审核写入
        </h3>
        <p>{{ state.pendingReview.scopeDescription }}</p>
        <dl class="novel-import__facts compact">
          <div><dt>影响消费者</dt><dd>{{ state.pendingReview.preview.impacts.length }}</dd></div>
          <div><dt>baseline</dt><dd>{{ state.pendingReview.preview.baselineStatus }}</dd></div>
          <div><dt>可应用</dt><dd>{{ state.pendingReview.preview.canApply ? '是' : '否' }}</dd></div>
        </dl>
      </div>
      <div class="novel-import__actions">
        <button class="button primary" :disabled="writeDisabled || !state.pendingReview.preview.canApply" type="button" @click="confirmPendingReview">
          确认并提交 revision
        </button>
        <button class="button secondary" :disabled="state.action !== null" type="button" @click="controller.cancelPendingReview()">
          取消
        </button>
      </div>
    </section>

    <div class="novel-import__grid">
      <article class="novel-import__card">
        <div class="novel-import__card-heading">
          <div>
            <p class="eyebrow">
              SOURCE
            </p>
            <h3>选择与编码</h3>
          </div>
          <button class="button secondary" :disabled="!canSelectSource" type="button" @click="selectSource">
            选择 TXT
          </button>
        </div>
        <p v-if="state.selectedSource" class="novel-import__filename">
          {{ state.selectedSource.displayName }}
        </p>
        <p v-else class="muted compact-margin">
          文件路径不会进入 Renderer；这里只显示安全文件名。
        </p>
        <label class="field-label" for="novel-source-encoding">源编码</label>
        <select id="novel-source-encoding" :disabled="writeDisabled || !state.selectedSource" :value="state.selectedEncoding ?? ''" @change="setEncoding">
          <option value="">
            自动：BOM / 严格 UTF-8
          </option>
          <option v-for="encoding in encodingOptions" :key="encoding.value" :value="encoding.value">
            {{ encoding.label }}
          </option>
        </select>
        <p v-if="state.phase === 'encoding-required'" class="novel-import__hint" role="note">
          请选择编码后再次开始；不会改走任务重试，也不会更换 selectionToken 或 idempotencyKey。
        </p>
        <button class="button primary novel-import__primary-action" :disabled="!canStart" type="button" @click="startImport">
          {{ state.action === 'start-task' ? '启动中…' : '开始导入' }}
        </button>
      </article>

      <article class="novel-import__card">
        <div class="novel-import__card-heading">
          <div>
            <p class="eyebrow">
              TASK
            </p>
            <h3>执行与恢复</h3>
          </div>
          <span class="novel-import__badge">{{ state.task?.executionStatus ?? '无任务' }}</span>
        </div>
        <dl v-if="state.task" class="novel-import__facts">
          <div><dt>任务 ID</dt><dd>{{ state.task.taskId }}</dd></div>
          <div><dt>尝试次数</dt><dd>{{ state.task.attempt }}</dd></div>
          <div><dt>恢复状态</dt><dd>{{ state.task.recoveryStatus }}</dd></div>
          <div><dt>结果 revision</dt><dd>{{ state.task.resultArtifactRevisionId ?? '尚无' }}</dd></div>
        </dl>
        <p v-else class="muted compact-margin">
          sessionStorage 仅保存当前 projectId / projectSessionId 绑定的 taskId；不保存 token 或文本。
        </p>
        <div class="novel-import__actions">
          <button class="button secondary" :disabled="state.action !== null || !state.task" type="button" @click="refreshTask">
            刷新任务
          </button>
          <button class="button secondary" :disabled="state.action !== null || !state.snapshot" type="button" @click="inspectRevision">
            刷新检查
          </button>
          <button class="button danger" :disabled="!canCancel" type="button" @click="cancelTask">
            取消任务
          </button>
          <button class="button secondary" :disabled="!canRetry" type="button" @click="retryTask">
            重试失败任务
          </button>
        </div>
      </article>
    </div>

    <section v-if="!state.snapshot" class="novel-import__empty">
      <h3>尚无检查快照</h3>
      <p>
        完成的任务会提供正式 baseline。若 Core dispatcher 或事件源尚未装配，界面只显示稳定错误或空状态，不把未返回结果视为完成。
      </p>
    </section>

    <template v-else>
      <section class="novel-import__summary" aria-label="导入摘要">
        <dl class="novel-import__facts summary-grid">
          <div><dt>格式 / 编码</dt><dd>{{ state.snapshot.source.format.toUpperCase() }} · {{ state.snapshot.source.encoding }}</dd></div>
          <div><dt>源字节</dt><dd>{{ formatBytes(state.snapshot.source.byteLength) }}</dd></div>
          <div>
            <dt>内容哈希</dt><dd :title="state.snapshot.source.contentHash">
              {{ shortHash(state.snapshot.source.contentHash) }}
            </dd>
          </div>
          <div><dt>适配器</dt><dd>{{ state.snapshot.adapter.adapterId }}@{{ state.snapshot.adapter.adapterVersion }}</dd></div>
          <div><dt>revision 历史</dt><dd>{{ state.snapshot.revisionHistory.length }}</dd></div>
          <div><dt>审核状态</dt><dd>{{ pendingCount === 0 ? '无 pending' : `${pendingCount} pending` }}</dd></div>
        </dl>
      </section>

      <section class="novel-import__review-section" aria-labelledby="novel-diff-title">
        <div class="novel-import__section-heading">
          <div>
            <p class="eyebrow">
              TEXT LAYERS
            </p>
            <h3 id="novel-diff-title">
              raw / canonical / normalized 差异
            </h3>
          </div>
          <span>{{ state.snapshot.layerDiffs.reduce((count, diff) => count + diff.hunks.length, 0) }} 个 hunk</span>
        </div>
        <p v-if="state.snapshot.layerDiffs.length === 0" class="muted compact-margin">
          当前快照没有层间变换 hunk。
        </p>
        <div v-else class="novel-import__diff-list">
          <details v-for="diff in state.snapshot.layerDiffs" :key="`${diff.fromRevision.textRevisionId}:${diff.toRevision.textRevisionId}`">
            <summary>{{ diff.fromRevision.textLayer }} → {{ diff.toRevision.textLayer }} · {{ diff.hunks.length }} 项</summary>
            <article v-for="(hunk, hunkIndex) in diff.hunks" :key="`${hunk.operation}:${hunkIndex}`" class="novel-import__diff-hunk">
              <header><strong>{{ hunk.operation }}</strong><span>{{ rangeLabel(hunk.fromRange) }} → {{ rangeLabel(hunk.toRange) }}</span></header>
              <div class="novel-import__diff-columns">
                <pre aria-label="变更前">{{ hunk.beforeText || '∅' }}</pre>
                <pre aria-label="变更后">{{ hunk.afterText || '∅' }}</pre>
              </div>
            </article>
          </details>
        </div>
      </section>

      <section class="novel-import__review-section" aria-labelledby="novel-chapter-title">
        <div class="novel-import__section-heading">
          <div>
            <p class="eyebrow">
              CHAPTER INDEX
            </p>
            <h3 id="novel-chapter-title">
              章节与覆盖率
            </h3>
          </div>
          <strong>{{ coveragePercent }}%</strong>
        </div>
        <div class="novel-import__coverage" role="progressbar" aria-label="已分类字节覆盖率" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="coveragePercent">
          <span :style="{ width: `${coveragePercent}%` }" />
        </div>
        <p class="novel-import__hint">
          已分类 {{ formatBytes(state.snapshot.coverage.classifiedByteLength) }} / {{ formatBytes(state.snapshot.coverage.totalByteLength) }} 字节；未分类 {{ formatBytes(state.snapshot.coverage.unclassifiedByteLength) }} 字节。
        </p>
        <div class="novel-import__chapters">
          <ol class="novel-import__chapter-list" aria-label="章节列表">
            <li v-for="chapter in state.snapshot.chapters" :key="chapter.chapterId">
              <button :aria-current="chapter.chapterId === state.selectedChapterId ? 'true' : undefined" type="button" @click="controller.selectChapter(chapter.chapterId)">
                <span>{{ chapter.order + 1 }}</span>
                <strong>{{ chapter.title }}</strong>
                <small>{{ chapter.reviewStatus }}</small>
              </button>
            </li>
          </ol>
          <article v-if="selectedChapter" class="novel-import__boundary-editor">
            <header>
              <div>
                <p class="eyebrow">
                  BOUNDARY
                </p><h4>{{ selectedChapter.title }}</h4>
              </div>
              <button class="text-button" :disabled="writeDisabled" type="button" @click="prepareSelectedChapterRerun">
                重跑本章
              </button>
            </header>
            <div class="novel-import__range-inputs">
              <label>标题起点<input v-model.number="headingStartByte" :disabled="writeDisabled" min="0" step="1" type="number"></label>
              <label>标题终点<input v-model.number="headingEndByte" :disabled="writeDisabled" min="0" step="1" type="number"></label>
              <label>正文起点<input v-model.number="contentStartByte" :disabled="writeDisabled" min="0" step="1" type="number"></label>
              <label>正文终点<input v-model.number="contentEndByte" :disabled="writeDisabled" min="0" step="1" type="number"></label>
            </div>
            <button class="button secondary" :disabled="writeDisabled" type="button" @click="prepareBoundaryAdjustment">
              预览边界影响
            </button>
          </article>
          <p v-else class="muted compact-margin">
            当前快照没有正式章节。
          </p>
        </div>
      </section>

      <section class="novel-import__review-section" aria-labelledby="novel-uncovered-title">
        <div class="novel-import__section-heading">
          <div>
            <p class="eyebrow">
              UNCOVERED RANGES
            </p>
            <h3 id="novel-uncovered-title">
              未覆盖范围分类
            </h3>
          </div>
          <span>{{ state.snapshot.uncoveredRanges.length }} 项</span>
        </div>
        <p v-if="state.snapshot.uncoveredRanges.length === 0" class="muted compact-margin">
          没有待分类的未覆盖范围。
        </p>
        <ul v-else class="novel-import__pending-list">
          <li v-for="(item, rangeIndex) in state.snapshot.uncoveredRanges" :key="`${item.range.startByte}:${item.range.endByte}`">
            <div><strong>{{ rangeLabel(item.range) }}</strong><small>{{ item.reviewStatus }} · 建议 {{ item.suggestedClassification ?? '无' }}</small></div>
            <div class="novel-import__actions">
              <button v-for="classification in classificationOptions" :key="classification.value" class="text-button" :disabled="writeDisabled" type="button" @click="prepareRangeClassification(rangeIndex, classification.value)">
                {{ classification.label }}
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section class="novel-import__review-section" aria-labelledby="novel-normalization-title">
        <div class="novel-import__section-heading">
          <div>
            <p class="eyebrow">
              NORMALIZATION
            </p>
            <h3 id="novel-normalization-title">
              normalized proposal
            </h3>
          </div>
          <span>{{ state.snapshot.normalizationProposals.length }} 项</span>
        </div>
        <p v-if="state.snapshot.normalizationProposals.length === 0" class="muted compact-margin">
          当前快照没有 normalization proposal。
        </p>
        <ul v-else class="novel-import__proposal-list">
          <li v-for="proposal in state.snapshot.normalizationProposals" :key="proposal.proposalId">
            <header><strong>{{ proposal.ruleId }} · {{ proposal.operation }}</strong><span :data-risk="proposal.risk">{{ proposal.risk }} / {{ proposal.reviewStatus }}</span></header>
            <p>{{ proposal.reason }}</p>
            <div class="novel-import__diff-columns">
              <pre aria-label="proposal 变更前">{{ proposal.beforeText || '∅' }}</pre>
              <pre aria-label="proposal 变更后">{{ proposal.afterText || '∅' }}</pre>
            </div>
            <div class="novel-import__actions">
              <button class="button secondary" :disabled="writeDisabled || proposal.reviewStatus !== 'pending'" type="button" @click="prepareNormalizationDecision(proposal.proposalId, 'approved')">
                预览并接受
              </button>
              <button class="button secondary" :disabled="writeDisabled || proposal.reviewStatus !== 'pending'" type="button" @click="prepareNormalizationDecision(proposal.proposalId, 'rejected')">
                预览并拒绝
              </button>
            </div>
          </li>
        </ul>
      </section>

      <section class="novel-import__review-section" aria-labelledby="novel-pending-title">
        <div class="novel-import__section-heading">
          <div>
            <p class="eyebrow">
              PENDING
            </p>
            <h3 id="novel-pending-title">
              候选、问题与目录证据
            </h3>
          </div>
          <span>{{ pendingCount }} 项待审</span>
        </div>
        <div class="novel-import__pending-columns">
          <article>
            <h4>章节候选</h4>
            <ul>
              <li v-for="candidate in state.snapshot.chapterCandidates" :key="candidate.chapterCandidateId">
                <strong>{{ candidate.normalizedTitle }}</strong><small>{{ candidate.reviewStatus }} · {{ rangeLabel(candidate.headingRange) }}</small>
              </li>
            </ul>
          </article>
          <article>
            <h4>导入问题</h4>
            <ul>
              <li v-for="issue in state.snapshot.issues" :key="issue.issueId">
                <strong>{{ issue.code }}</strong><small>{{ issue.severity }} / {{ issue.reviewStatus }} · {{ issue.message }}</small>
              </li>
            </ul>
          </article>
          <article>
            <h4>目录证据</h4>
            <ul>
              <li v-for="evidence in state.snapshot.tableOfContentsEvidence" :key="evidence.evidenceId">
                <strong>{{ evidence.kind }}</strong><small>{{ evidence.reviewStatus }} · {{ evidence.candidateIds.length }} 个候选</small>
              </li>
            </ul>
          </article>
        </div>
      </section>
    </template>

    <footer class="novel-import__shortcuts">
      <span>⌘/Ctrl+O 选择源</span><span>⌘/Ctrl+Enter 开始</span><span>⌥/Alt+R 刷新</span><span>⌥/Alt+↑↓ 选择章节</span><span>Esc 关闭提示</span>
    </footer>
  </section>
</template>

<style scoped>
.novel-import {
  width: min(100%, 1120px);
  margin: 18px auto 0;
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 22px;
  padding: clamp(20px, 3vw, 32px);
  background: rgb(20 27 39 / 91%);
  box-shadow: 0 24px 60px rgb(0 0 0 / 24%);
}

.novel-import h2,
.novel-import h3,
.novel-import h4,
.novel-import p {
  margin-top: 0;
}

.novel-import h3 {
  margin-bottom: 8px;
  font-size: 19px;
}

.novel-import h4 {
  margin-bottom: 10px;
}

.novel-import__header,
.novel-import__card-heading,
.novel-import__section-heading,
.novel-import__boundary-editor > header,
.novel-import__proposal-list header,
.novel-import__diff-hunk header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.novel-import__status,
.novel-import__hint {
  margin-bottom: 0;
  color: #9fb1c6;
  font-size: 13px;
  line-height: 1.55;
}

.novel-import__badges,
.novel-import__actions,
.novel-import__shortcuts {
  display: flex;
  flex-wrap: wrap;
  gap: 9px;
}

.novel-import__badge {
  width: max-content;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 999px;
  padding: 6px 9px;
  color: #a9bad0;
  background: rgb(255 255 255 / 4%);
  font-size: 11px;
  font-weight: 700;
}

.novel-import__badge[data-state='subscribed'] {
  color: #78e6c0;
}

.novel-import__badge[data-state='unavailable'],
.novel-import__badge[data-state='pending'] {
  color: #ffd18a;
}

.novel-import__badge[data-state='read-only'] {
  color: #9cc7ff;
}

.novel-import__error,
.novel-import__confirmation {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-top: 18px;
  border: 1px solid rgb(231 116 116 / 36%);
  border-radius: 14px;
  padding: 16px;
  color: #ffd3d3;
  background: rgb(115 38 42 / 25%);
}

.novel-import__confirmation {
  border-color: rgb(120 230 192 / 34%);
  color: #dffbf1;
  background: rgb(42 111 89 / 20%);
}

.novel-import__error p,
.novel-import__confirmation p {
  margin: 5px 0;
}

.novel-import__error small {
  display: block;
  overflow-wrap: anywhere;
}

.novel-import__grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin-top: 20px;
}

.novel-import__card,
.novel-import__review-section,
.novel-import__summary,
.novel-import__empty {
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 16px;
  padding: 18px;
  background: rgb(255 255 255 / 3%);
}

.novel-import__review-section,
.novel-import__summary,
.novel-import__empty {
  margin-top: 14px;
}

.novel-import__filename {
  overflow: hidden;
  margin: 18px 0 0;
  color: #e7eef7;
  font-weight: 700;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.novel-import select,
.novel-import input {
  width: 100%;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 10px;
  padding: 10px 12px;
  color: inherit;
  background: #111824;
}

.novel-import__primary-action {
  width: 100%;
  margin-top: 14px;
}

.novel-import__facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  margin: 16px 0;
}

.novel-import__facts.compact {
  margin-bottom: 0;
}

.novel-import__facts div {
  min-width: 0;
  border-radius: 9px;
  padding: 9px;
  background: rgb(255 255 255 / 4%);
}

.novel-import__facts dd {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.summary-grid {
  grid-template-columns: repeat(3, minmax(0, 1fr));
  margin: 0;
}

.compact-margin {
  margin: 12px 0 0;
}

.novel-import__coverage {
  overflow: hidden;
  height: 8px;
  margin: 16px 0 9px;
  border-radius: 999px;
  background: rgb(255 255 255 / 8%);
}

.novel-import__coverage span {
  display: block;
  height: 100%;
  border-radius: inherit;
  background: linear-gradient(90deg, #78e6c0, #7cb5ff);
}

.novel-import__diff-list,
.novel-import__proposal-list,
.novel-import__pending-list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 16px 0 0;
  list-style: none;
}

.novel-import__diff-list details,
.novel-import__proposal-list > li,
.novel-import__pending-list > li {
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 12px;
  padding: 12px;
  background: rgb(7 12 19 / 28%);
}

.novel-import__diff-list summary {
  cursor: pointer;
  font-weight: 700;
}

.novel-import__diff-hunk {
  margin-top: 12px;
}

.novel-import__diff-hunk header,
.novel-import__proposal-list header {
  color: #9fb1c6;
  font-size: 12px;
}

.novel-import__diff-columns {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 8px;
  margin-top: 8px;
}

.novel-import pre {
  overflow: auto;
  max-height: 180px;
  margin: 0;
  border-radius: 8px;
  padding: 10px;
  color: #dce8f5;
  background: #0c111a;
  font:
    12px/1.55 ui-monospace,
    SFMono-Regular,
    Menlo,
    monospace;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.novel-import__chapters {
  display: grid;
  grid-template-columns: minmax(220px, 0.8fr) minmax(0, 1.5fr);
  gap: 14px;
  margin-top: 16px;
}

.novel-import__chapter-list {
  overflow: auto;
  max-height: 360px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.novel-import__chapter-list button {
  display: grid;
  grid-template-columns: 24px minmax(0, 1fr) auto;
  width: 100%;
  gap: 8px;
  border: 0;
  border-radius: 9px;
  padding: 9px;
  color: #cbd8e6;
  background: transparent;
  text-align: left;
}

.novel-import__chapter-list button[aria-current='true'] {
  color: #eafff8;
  background: rgb(120 230 192 / 12%);
}

.novel-import__chapter-list small {
  color: #8ea1b8;
}

.novel-import__boundary-editor {
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 12px;
  padding: 14px;
}

.novel-import__range-inputs {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 9px;
  margin-bottom: 12px;
}

.novel-import__range-inputs label {
  color: #9fb1c6;
  font-size: 12px;
}

.novel-import__range-inputs input {
  margin-top: 5px;
}

.novel-import__pending-list > li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.novel-import__pending-list small,
.novel-import__pending-columns small {
  display: block;
  margin-top: 4px;
  color: #91a4ba;
  line-height: 1.45;
}

.novel-import__proposal-list p {
  margin: 8px 0;
  color: #aebed0;
}

.novel-import__pending-columns {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
  margin-top: 14px;
}

.novel-import__pending-columns article {
  min-width: 0;
  border-radius: 10px;
  padding: 12px;
  background: rgb(255 255 255 / 3%);
}

.novel-import__pending-columns ul {
  display: grid;
  gap: 9px;
  padding: 0;
  margin: 0;
  list-style: none;
}

.novel-import__shortcuts {
  margin-top: 16px;
  color: #7f93aa;
  font-size: 11px;
}

@media (max-width: 820px) {
  .novel-import__grid,
  .novel-import__chapters,
  .novel-import__pending-columns,
  .summary-grid {
    grid-template-columns: 1fr;
  }

  .novel-import__header,
  .novel-import__error,
  .novel-import__confirmation,
  .novel-import__pending-list > li {
    align-items: stretch;
    flex-direction: column;
  }
}

@media (max-width: 540px) {
  .novel-import__diff-columns,
  .novel-import__range-inputs,
  .novel-import__facts {
    grid-template-columns: 1fr;
  }
}
</style>
