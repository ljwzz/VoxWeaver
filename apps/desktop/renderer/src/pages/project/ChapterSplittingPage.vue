<script setup lang="ts">
import type {
  NovelImportReviewCommandInput,
  NovelImportReviewSnapshotDto,
  StalePreviewDto,
  TextSliceDto,
} from '@voxweaver/contracts';

import { NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES } from '@voxweaver/contracts';
import { computed, shallowRef, watch } from 'vue';
import CapabilityGate from '@/components/workspace/CapabilityGate.vue';
import WorkspacePageHeader from '@/components/workspace/WorkspacePageHeader.vue';
import { useWorkspaceContext } from '@/workspace/context';
import { getWorkspacePage } from '@/workspace/navigation';

const page = getWorkspacePage('chapter-splitting');
const workspace = useWorkspaceContext();
const snapshot = shallowRef<NovelImportReviewSnapshotDto>();
const textSlice = shallowRef<TextSliceDto>();
const selectedChapterIds = shallowRef<string[]>([]);
const pendingCommand = shallowRef<NovelImportReviewCommandInput>();
const stalePreview = shallowRef<StalePreviewDto>();
const dialogVisible = shallowRef(false);
const boundaryDialogVisible = shallowRef(false);
const boundaryChapterId = shallowRef('');
const headingStartByte = shallowRef(0);
const headingEndByte = shallowRef(0);
const contentStartByte = shallowRef(0);
const contentEndByte = shallowRef(0);
const isLoading = shallowRef(false);
const isApplying = shallowRef(false);
const errorMessage = shallowRef('');

const capabilityAvailable = computed(() => (
  workspace.bootstrap.value?.capabilities['chapter-splitting'].available === true
));
const coveragePercent = computed(() => {
  const coverage = snapshot.value?.coverage;
  if (!coverage || coverage.totalByteLength === 0)
    return 0;
  return Math.round(coverage.classifiedByteLength / coverage.totalByteLength * 100);
});

async function loadSnapshot(): Promise<void> {
  if (isLoading.value)
    return;

  isLoading.value = true;
  errorMessage.value = '';
  const result = await window.voxweaver.novelImport.getReviewSnapshot();
  isLoading.value = false;
  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }

  snapshot.value = result.value;
  selectedChapterIds.value = [];
  textSlice.value = undefined;
}

async function applyCommand(command: NovelImportReviewCommandInput): Promise<void> {
  isApplying.value = true;
  errorMessage.value = '';
  const result = await window.voxweaver.novelImport.applyReview(command);
  isApplying.value = false;
  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }

  snapshot.value = result.value;
  pendingCommand.value = undefined;
  stalePreview.value = undefined;
  dialogVisible.value = false;
  await workspace.ensureBootstrap(true);
}

async function previewCommand(command: NovelImportReviewCommandInput): Promise<void> {
  isApplying.value = true;
  errorMessage.value = '';
  const result = await window.voxweaver.novelImport.previewReview(command);
  isApplying.value = false;
  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }

  if (result.value.requiresConfirmation || result.value.affected.length > 0) {
    pendingCommand.value = command;
    stalePreview.value = result.value;
    dialogVisible.value = true;
    return;
  }

  await applyCommand(command);
}

function decideProposal(proposalId: string, decision: 'approved' | 'rejected'): void {
  if (!snapshot.value)
    return;

  void previewCommand({
    commandType: 'decide-normalization-proposal',
    baselineRevision: snapshot.value.baselineRevision,
    proposalId,
    decision,
  });
}

function classifyUncoveredRange(
  range: NovelImportReviewSnapshotDto['coverage']['uncoveredRanges'][number],
  classification: 'front-matter' | 'noise',
): void {
  if (!snapshot.value)
    return;

  void previewCommand({
    commandType: 'classify-uncovered-range',
    baselineRevision: snapshot.value.baselineRevision,
    range,
    classification,
  });
}

function rerunSelection(): void {
  if (!snapshot.value || selectedChapterIds.value.length === 0)
    return;

  void previewCommand({
    commandType: 'rerun-selection',
    baselineRevision: snapshot.value.baselineRevision,
    chapterIds: selectedChapterIds.value,
  });
}

function openBoundaryEditor(
  chapter: NovelImportReviewSnapshotDto['chapters'][number],
): void {
  boundaryChapterId.value = chapter.chapterId;
  headingStartByte.value = chapter.headingRange.startByte;
  headingEndByte.value = chapter.headingRange.endByte;
  contentStartByte.value = chapter.contentRange.startByte;
  contentEndByte.value = chapter.contentRange.endByte;
  boundaryDialogVisible.value = true;
}

function previewBoundaryAdjustment(): void {
  if (!snapshot.value || !boundaryChapterId.value)
    return;

  const values = [
    headingStartByte.value,
    headingEndByte.value,
    contentStartByte.value,
    contentEndByte.value,
  ];
  if (values.some(value => !Number.isSafeInteger(value) || value < 0)
    || headingStartByte.value >= headingEndByte.value
    || contentStartByte.value >= contentEndByte.value) {
    errorMessage.value = '章节边界必须是非负整数，且每个结束位置必须大于开始位置。';
    return;
  }

  boundaryDialogVisible.value = false;
  void previewCommand({
    commandType: 'adjust-chapter-boundary',
    baselineRevision: snapshot.value.baselineRevision,
    chapterId: boundaryChapterId.value,
    headingRange: {
      offsetUnit: 'utf8-byte',
      startByte: headingStartByte.value,
      endByte: headingEndByte.value,
    },
    contentRange: {
      offsetUnit: 'utf8-byte',
      startByte: contentStartByte.value,
      endByte: contentEndByte.value,
    },
  });
}

function confirmReview(): void {
  if (!snapshot.value)
    return;

  void previewCommand({
    commandType: 'confirm-review',
    baselineRevision: snapshot.value.baselineRevision,
  });
}

function confirmPendingCommand(): void {
  if (pendingCommand.value)
    void applyCommand(pendingCommand.value);
}

async function loadChapterText(chapterId: string): Promise<void> {
  const current = snapshot.value;
  const chapter = current?.chapters.find(item => item.chapterId === chapterId);
  if (!current || !chapter)
    return;

  const startByte = chapter.contentRange.startByte;
  const endByte = Math.min(
    chapter.contentRange.endByte,
    startByte + NOVEL_IMPORT_TEXT_SLICE_MAX_BYTES,
  );
  const result = await window.voxweaver.novelImport.getTextSlice({
    revisionId: current.revisionId,
    startByte,
    endByte,
  });
  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }
  textSlice.value = result.value;
}

watch(capabilityAvailable, (available) => {
  if (available)
    void loadSnapshot();
}, { immediate: true });
</script>

<template>
  <article class="project-controller-page">
    <WorkspacePageHeader
      :description="page.description"
      :stage-id="page.stageId"
      :title="page.label"
    >
      <template #actions>
        <ElButton :loading="isLoading" @click="loadSnapshot">刷新复核快照</ElButton>
        <ElButton
          :disabled="!snapshot || snapshot.reviewStatus === 'approved'"
          :loading="isApplying"
          type="primary"
          @click="confirmReview"
        >
          确认阶段 01
        </ElButton>
      </template>
    </WorkspacePageHeader>

    <CapabilityGate page-key="chapter-splitting">
      <div class="review-content">
        <ElAlert
          v-if="errorMessage"
          :closable="false"
          show-icon
          :title="errorMessage"
          type="error"
        />

        <template v-if="snapshot">
          <section class="review-summary-grid">
            <article>
              <span>章节</span>
              <strong>{{ snapshot.chapters.length }}</strong>
            </article>
            <article>
              <span>覆盖率</span>
              <strong>{{ coveragePercent }}%</strong>
            </article>
            <article>
              <span>未覆盖范围</span>
              <strong>{{ snapshot.coverage.uncoveredRanges.length }}</strong>
            </article>
            <article>
              <span>基线版本</span>
              <strong>{{ snapshot.baselineRevision }}</strong>
            </article>
          </section>

          <section class="review-panel">
            <header><div><h2>章节候选</h2><p>候选标题、置信度和证据均来自当前 Core revision。</p></div></header>
            <ElEmpty v-if="snapshot.candidates.length === 0" description="没有章节候选" />
            <template v-else>
              <div v-for="candidate in snapshot.candidates" :key="candidate.candidateId" class="candidate-row">
                <div>
                  <strong>{{ candidate.normalizedTitle }}</strong>
                  <p>{{ candidate.rawTitle }} · byte {{ candidate.headingRange.startByte }}–{{ candidate.headingRange.endByte }}</p>
                </div>
                <span>{{ candidate.evidence.join('；') }}</span>
                <ElTag effect="plain" size="small">
                  {{ Math.round(candidate.confidence * 100) }}% · {{ candidate.reviewStatus }}
                </ElTag>
              </div>
            </template>
          </section>

          <section class="review-panel">
            <header>
              <div><h2>章节与正文</h2><p>正文按 UTF-8 byte range 从 Core 分片读取。</p></div>
              <ElButton
                :disabled="selectedChapterIds.length === 0"
                :loading="isApplying"
                @click="rerunSelection"
              >
                局部重跑
              </ElButton>
            </header>
            <ElCheckboxGroup v-model="selectedChapterIds" class="chapter-list">
              <div v-for="chapter in snapshot.chapters" :key="chapter.chapterId" class="chapter-row">
                <ElCheckbox :value="chapter.chapterId">
                  {{ chapter.order }}. {{ chapter.title }}
                </ElCheckbox>
                <span>
                  heading {{ chapter.headingRange.startByte }}–{{ chapter.headingRange.endByte }} ·
                  content {{ chapter.contentRange.startByte }}–{{ chapter.contentRange.endByte }} ·
                  {{ chapter.reviewStatus }}
                </span>
                <div class="chapter-actions">
                  <ElButton link type="primary" @click="loadChapterText(chapter.chapterId)">读取正文</ElButton>
                  <ElButton link type="primary" @click="openBoundaryEditor(chapter)">调整边界</ElButton>
                </div>
              </div>
            </ElCheckboxGroup>
            <pre v-if="textSlice" class="text-slice">{{ textSlice.text }}</pre>
          </section>

          <section class="review-panel">
            <header><div><h2>覆盖范围</h2><p>未覆盖区间必须分类后才能确认阶段 01。</p></div></header>
            <ElProgress :percentage="coveragePercent" />
            <ElEmpty v-if="snapshot.coverage.uncoveredRanges.length === 0" description="正文已完整分类" />
            <template v-else>
              <div
                v-for="range in snapshot.coverage.uncoveredRanges"
                :key="`${range.startByte}:${range.endByte}`"
                class="coverage-row"
              >
                <span>byte {{ range.startByte }}–{{ range.endByte }}</span>
                <div>
                  <ElButton size="small" @click="classifyUncoveredRange(range, 'front-matter')">标记为前置内容</ElButton>
                  <ElButton size="small" @click="classifyUncoveredRange(range, 'noise')">标记为噪声</ElButton>
                </div>
              </div>
            </template>
          </section>

          <section class="review-panel">
            <header><div><h2>规范化提案</h2><p>每项决策先预览下游失效影响。</p></div></header>
            <ElEmpty v-if="snapshot.normalizationProposals.length === 0" description="没有待处理提案" />
            <template v-else>
              <div
                v-for="proposal in snapshot.normalizationProposals"
                :key="proposal.proposalId"
                class="proposal-row"
              >
                <div>
                  <strong>{{ proposal.reason }}</strong>
                  <p><del>{{ proposal.beforeText }}</del> → <ins>{{ proposal.afterText }}</ins></p>
                </div>
                <div v-if="proposal.decision === 'pending'" class="proposal-actions">
                  <ElButton size="small" @click="decideProposal(proposal.proposalId, 'rejected')">拒绝</ElButton>
                  <ElButton size="small" type="primary" @click="decideProposal(proposal.proposalId, 'approved')">接受</ElButton>
                </div>
                <ElTag v-else effect="plain">{{ proposal.decision }}</ElTag>
              </div>
            </template>
          </section>

          <section class="review-panel">
            <header><div><h2>文本差异</h2><p>规范化后的 diff 由 Core 计算。</p></div></header>
            <ElEmpty v-if="snapshot.diff.length === 0" description="当前 revision 没有文本差异" />
            <template v-else>
              <div v-for="hunk in snapshot.diff" :key="`${hunk.operation}:${hunk.range.startByte}`" class="diff-row">
                <ElTag effect="plain" size="small">{{ hunk.operation }}</ElTag>
                <span>byte {{ hunk.range.startByte }}–{{ hunk.range.endByte }}</span>
                <p><del>{{ hunk.beforeText }}</del> → <ins>{{ hunk.afterText }}</ins></p>
              </div>
            </template>
          </section>

          <section class="review-panel">
            <header><div><h2>Revision history</h2><p>仅展示 Core 返回的真实导入版本。</p></div></header>
            <div v-for="revision in snapshot.revisionHistory" :key="revision.revisionId" class="revision-row">
              <span>{{ revision.revisionId }}</span>
              <span>baseline {{ revision.baselineRevision }}</span>
              <ElTag :type="revision.active ? 'success' : 'info'" effect="plain" size="small">
                {{ revision.active ? 'active' : revision.reviewStatus }}
              </ElTag>
            </div>
          </section>
        </template>
      </div>
    </CapabilityGate>

    <ElDialog v-model="dialogVisible" title="确认应用复核操作" width="520px">
      <p class="dialog-description">此操作基于 revision {{ stalePreview?.baselineRevision }}。</p>
      <ElAlert
        v-if="stalePreview?.requiresConfirmation"
        :closable="false"
        title="Core 要求明确确认下游失效影响。"
        type="warning"
      />
      <ul v-if="stalePreview?.affected.length" class="impact-list">
        <li v-for="item in stalePreview.affected" :key="`${item.artifactType}:${item.artifactId}`">
          <strong>{{ item.artifactType }} · {{ item.artifactId }}</strong>
          <span>{{ item.reason }}</span>
        </li>
      </ul>
      <template #footer>
        <ElButton @click="dialogVisible = false">取消</ElButton>
        <ElButton :loading="isApplying" type="primary" @click="confirmPendingCommand">确认应用</ElButton>
      </template>
    </ElDialog>

    <ElDialog v-model="boundaryDialogVisible" title="调整章节 byte 边界" width="520px">
      <ElForm label-position="top">
        <div class="boundary-grid">
          <ElFormItem label="标题开始">
            <ElInputNumber v-model="headingStartByte" :min="0" />
          </ElFormItem>
          <ElFormItem label="标题结束">
            <ElInputNumber v-model="headingEndByte" :min="0" />
          </ElFormItem>
          <ElFormItem label="正文开始">
            <ElInputNumber v-model="contentStartByte" :min="0" />
          </ElFormItem>
          <ElFormItem label="正文结束">
            <ElInputNumber v-model="contentEndByte" :min="0" />
          </ElFormItem>
        </div>
      </ElForm>
      <template #footer>
        <ElButton @click="boundaryDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="previewBoundaryAdjustment">预览影响</ElButton>
      </template>
    </ElDialog>
  </article>
</template>

<style scoped>
.project-controller-page {
  min-height: 100%;
  background: #f7f8f6;
}

.review-content {
  display: grid;
  gap: 16px;
  padding: 24px;
}

.review-summary-grid {
  display: grid;
  grid-template-columns: repeat(4, minmax(120px, 1fr));
  gap: 10px;
}

.review-summary-grid article,
.review-panel {
  border: 1px solid #d9ddd7;
  border-radius: 8px;
  background: #fff;
}

.review-summary-grid article {
  display: grid;
  gap: 5px;
  padding: 14px;
}

.review-summary-grid span,
.review-panel header p {
  color: #6a726e;
  font-size: 11px;
}

.review-summary-grid strong {
  font-size: 19px;
}

.review-panel {
  padding: 16px;
}

.review-panel header,
.candidate-row,
.chapter-row,
.coverage-row,
.diff-row,
.proposal-row,
.revision-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.review-panel header {
  margin-bottom: 12px;
}

.review-panel h2,
.review-panel p {
  margin: 0;
}

.review-panel h2 {
  font-size: 15px;
}

.review-panel header p {
  margin-top: 3px;
}

.chapter-list {
  display: grid;
  gap: 2px;
}

.chapter-row,
.candidate-row,
.coverage-row,
.diff-row,
.proposal-row,
.revision-row {
  min-height: 38px;
  padding: 6px 8px;
  border-top: 1px solid #eef0ed;
  font-size: 12px;
}

.chapter-row > span,
.candidate-row > span,
.revision-row > span {
  color: #6a726e;
  font-size: 11px;
}

.chapter-row > span {
  margin-left: auto;
}

.chapter-actions {
  display: flex;
  gap: 2px;
}

.candidate-row > div,
.diff-row p {
  min-width: 0;
  flex: 1;
}

.candidate-row p,
.diff-row p {
  margin: 3px 0 0;
  color: #6a726e;
  font-size: 11px;
}

.candidate-row > span {
  max-width: 260px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.coverage-row > div {
  display: flex;
  gap: 6px;
}

.diff-row {
  justify-content: flex-start;
}

.diff-row > span {
  color: #6a726e;
  font-size: 11px;
  white-space: nowrap;
}

.diff-row ins {
  color: #286b56;
}

.text-slice {
  max-height: 240px;
  margin: 12px 0 0;
  padding: 12px;
  overflow: auto;
  border: 1px solid #e3e6e2;
  border-radius: 6px;
  color: #414744;
  background: #fafbf9;
  font-family: inherit;
  font-size: 12px;
  line-height: 20px;
  white-space: pre-wrap;
}

.proposal-row p {
  margin-top: 4px;
  color: #6a726e;
  font-size: 12px;
}

.proposal-row ins {
  color: #286b56;
}

.proposal-actions {
  display: flex;
  gap: 6px;
}

.dialog-description {
  margin: 0 0 12px;
  color: #6a726e;
}

.impact-list {
  display: grid;
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.impact-list li {
  display: grid;
  gap: 3px;
  padding: 9px;
  border: 1px solid #ead7ae;
  border-radius: 6px;
  background: #fff9ed;
  font-size: 12px;
}

.impact-list span {
  color: #6a726e;
}

.boundary-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 0 12px;
}

.boundary-grid :deep(.el-input-number) {
  width: 100%;
}

@media (width <= 1100px) {
  .review-summary-grid {
    grid-template-columns: repeat(2, minmax(120px, 1fr));
  }
}
</style>
