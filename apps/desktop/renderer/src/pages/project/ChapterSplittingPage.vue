<script setup lang="ts">
import type {
  NovelImportReviewSnapshotDto,
  StalePreviewDto,
  UpdateChapterStructureCommandInput,
} from '@voxweaver/contracts';
import type { ChapterBoundaryEdit } from '@/components/chapter-review/chapterReviewModel';
import type {
  ChapterMergeDirection,
} from '@/components/chapter-review/chapterStructureDraftModel';

import { computed, shallowRef, useTemplateRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import ChapterCodeMirrorEditor from '@/components/chapter-review/ChapterCodeMirrorEditor.vue';
import ChapterStructureFooter from '@/components/chapter-review/ChapterStructureFooter.vue';
import ChapterStructureHeader from '@/components/chapter-review/ChapterStructureHeader.vue';
import { useChapterDocument } from '@/components/chapter-review/useChapterDocument';
import { useChapterStructureDraft } from '@/components/chapter-review/useChapterStructureDraft';
import CapabilityGate from '@/components/workspace/CapabilityGate.vue';
import { useWorkspaceContext } from '@/workspace/context';
import { getProjectPageRouteName } from '@/workspace/navigation';

type SubmissionMode = 'save' | 'next';

const router = useRouter();
const workspace = useWorkspaceContext();
const chapterDocument = useChapterDocument();
const chapterDraft = useChapterStructureDraft();
const chapterEditor = useTemplateRef<InstanceType<typeof ChapterCodeMirrorEditor>>('chapterEditor');

const snapshot = shallowRef<NovelImportReviewSnapshotDto>();
const pendingCommand = shallowRef<UpdateChapterStructureCommandInput>();
const stalePreview = shallowRef<StalePreviewDto>();
const impactDialogVisible = shallowRef(false);
const isLoading = shallowRef(false);
const submissionMode = shallowRef<SubmissionMode>();
const cutConfirmed = shallowRef(false);
const editorReady = shallowRef(false);
const errorMessage = shallowRef('');
const refreshRequired = shallowRef(false);
const focusedAnomalyId = shallowRef<string>();

const capabilityAvailable = computed(() => (
  workspace.bootstrap.value?.capabilities['chapter-splitting'].available === true
));
const isSubmitting = computed(() => submissionMode.value !== undefined);
const isApproved = computed(() => snapshot.value?.reviewStatus === 'approved');
const bodyLoaded = computed(() => (
  chapterDocument.status.value === 'loaded' && chapterDraft.draft.value !== undefined
));
const editorDisabled = computed(() => (
  isLoading.value
  || isSubmitting.value
  || impactDialogVisible.value
  || refreshRequired.value
));
const canConfirmCut = computed(() => Boolean(
  snapshot.value
  && bodyLoaded.value
  && (!isApproved.value || chapterDraft.dirty.value)
  && !refreshRequired.value
  && !impactDialogVisible.value
  && !isLoading.value
  && !isSubmitting.value,
));
const canGoNext = computed(() => Boolean(
  snapshot.value
  && !isSubmitting.value
  && !impactDialogVisible.value
  && !refreshRequired.value
  && bodyLoaded.value
  && !chapterDraft.dirty.value
  && chapterDraft.chapters.value.length > 0
  && cutConfirmed.value,
));
const anomalyNavigationDisabled = computed(() => (
  isSubmitting.value
  || impactDialogVisible.value
  || !editorReady.value
  || chapterDraft.anomalies.value.length === 0
));
const footerStatus = computed(() => {
  if (!snapshot.value)
    return '正在读取章节快照';
  if (chapterDocument.status.value === 'loading')
    return '正在加载章节正文';
  if (chapterDraft.dirty.value)
    return '草稿尚未保存';
  if (chapterDraft.unassignedRanges.value.length > 0)
    return '仍有未归属正文';
  if (isApproved.value)
    return '阶段 01 已完成';
  if (!cutConfirmed.value)
    return '请确认章节切割';
  return '章节切割已确认';
});

watch(capabilityAvailable, (available) => {
  if (available)
    void loadSnapshot();
}, { immediate: true });

async function loadSnapshot(): Promise<void> {
  if (isLoading.value || isSubmitting.value)
    return;
  isLoading.value = true;
  errorMessage.value = '';
  const result = await window.voxweaver.novelImport.getReviewSnapshot();
  if (!result.ok) {
    isLoading.value = false;
    setCommandError(result.error);
    return;
  }
  await replaceSnapshot(result.value, result.value.reviewStatus === 'approved');
  if (bodyLoaded.value)
    refreshRequired.value = false;
  isLoading.value = false;
}

async function replaceSnapshot(
  value: NovelImportReviewSnapshotDto,
  confirmed: boolean,
): Promise<void> {
  snapshot.value = value;
  pendingCommand.value = undefined;
  stalePreview.value = undefined;
  impactDialogVisible.value = false;
  focusedAnomalyId.value = undefined;
  cutConfirmed.value = confirmed;
  editorReady.value = false;
  chapterDraft.clear();
  chapterDocument.cancel();

  await chapterDocument.load(value.revisionId, value.textByteLength);
  if (chapterDocument.status.value !== 'loaded') {
    errorMessage.value = chapterDocument.errorMessage.value || '章节正文加载失败。';
    return;
  }

  try {
    chapterDraft.reset(value, chapterDocument.text.value);
  } catch (error) {
    errorMessage.value = toErrorMessage(error, '章节结构草稿初始化失败。');
  }
}

function handleDraftMutation(mutate: () => void): void {
  if (editorDisabled.value || !bodyLoaded.value)
    return;
  try {
    mutate();
    cutConfirmed.value = false;
    errorMessage.value = '';
  } catch (error) {
    errorMessage.value = toErrorMessage(error, '章节结构操作失败。');
  }
}

function handleBoundaryEdit(edit: ChapterBoundaryEdit): void {
  handleDraftMutation(() => chapterDraft.applyChapterBoundaryEdit(edit));
}

function handleAcceptAnomaly(chapterId: string): void {
  handleDraftMutation(() => chapterDraft.acceptChapterLengthAnomaly(chapterId));
}

function handleMergeChapter(chapterId: string, direction: ChapterMergeDirection): void {
  handleDraftMutation(() => chapterDraft.mergeChapter(chapterId, direction));
}

function handleDeleteChapter(chapterId: string): void {
  handleDraftMutation(() => chapterDraft.deleteChapterRecognition(chapterId));
}

function handleAddRecognition(characterOffset: number): void {
  handleDraftMutation(() => chapterDraft.addChapterRecognition(characterOffset));
}

function handleInsertLineBreak(characterOffset: number): void {
  handleDraftMutation(() => chapterDraft.insertLineBreak(characterOffset));
}

function navigateAnomaly(direction: -1 | 1): void {
  const anomalies = chapterDraft.anomalies.value;
  if (anomalies.length === 0)
    return;
  const currentIndex = anomalies.findIndex(anomaly => anomaly.chapterId === focusedAnomalyId.value);
  const nextIndex = currentIndex < 0
    ? (direction === 1 ? 0 : anomalies.length - 1)
    : (currentIndex + direction + anomalies.length) % anomalies.length;
  const anomaly = anomalies[nextIndex];
  if (!anomaly)
    return;
  focusedAnomalyId.value = anomaly.chapterId;
  chapterEditor.value?.focusChapter(anomaly.chapterId);
}

async function confirmChapterCut(): Promise<void> {
  const command = chapterDraft.command.value;
  if (!command || !canConfirmCut.value)
    return;

  submissionMode.value = 'save';
  errorMessage.value = '';
  const result = await window.voxweaver.novelImport.previewReview(command);
  if (!result.ok) {
    submissionMode.value = undefined;
    setCommandError(result.error);
    return;
  }

  if (result.value.requiresConfirmation || result.value.affected.length > 0) {
    pendingCommand.value = command;
    stalePreview.value = result.value;
    impactDialogVisible.value = true;
    submissionMode.value = undefined;
    return;
  }
  await applyStructureCommand(command);
}

async function applyStructureCommand(command: UpdateChapterStructureCommandInput): Promise<void> {
  submissionMode.value = 'save';
  errorMessage.value = '';
  const result = await window.voxweaver.novelImport.applyReview(command);
  if (!result.ok) {
    submissionMode.value = undefined;
    impactDialogVisible.value = false;
    setCommandError(result.error);
    return;
  }

  await replaceSnapshot(result.value, true);
  submissionMode.value = undefined;
}

function confirmPendingCommand(): void {
  const command = pendingCommand.value;
  if (!command || isSubmitting.value)
    return;
  void applyStructureCommand(command);
}

function cancelPendingCommand(): void {
  if (isSubmitting.value)
    return;
  impactDialogVisible.value = false;
  pendingCommand.value = undefined;
  stalePreview.value = undefined;
}

async function goToProofreading(): Promise<void> {
  const current = snapshot.value;
  if (!current || !canGoNext.value)
    return;
  if (current.reviewStatus === 'approved') {
    await router.push({ name: getProjectPageRouteName('proofreading') });
    return;
  }

  const command = {
    commandType: 'confirm-review',
    baselineRevision: current.baselineRevision,
  } as const;
  submissionMode.value = 'next';
  errorMessage.value = '';
  const preview = await window.voxweaver.novelImport.previewReview(command);
  if (!preview.ok) {
    submissionMode.value = undefined;
    setCommandError(preview.error);
    return;
  }
  const applied = await window.voxweaver.novelImport.applyReview(command);
  if (!applied.ok) {
    submissionMode.value = undefined;
    setCommandError(applied.error);
    return;
  }

  snapshot.value = applied.value;
  const refreshed = await workspace.ensureBootstrap(true);
  submissionMode.value = undefined;
  if (refreshed)
    await router.push({ name: getProjectPageRouteName('proofreading') });
}

function setCommandError(error: { readonly code: string; readonly message: string }): void {
  errorMessage.value = error.message;
  if (error.code === 'NOVEL_IMPORT_CONFLICT')
    refreshRequired.value = true;
}

function toErrorMessage(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}
</script>

<template>
  <article class="chapter-splitting-page">
    <CapabilityGate page-key="chapter-splitting">
      <div class="chapter-splitting-page__layout">
        <section class="chapter-splitting-page__header-region">
          <ChapterStructureHeader
            :anomaly-count="chapterDraft.anomalies.value.length"
            :chapter-count="chapterDraft.chapters.value.length"
            :navigation-disabled="anomalyNavigationDisabled"
            @next-anomaly="navigateAnomaly(1)"
            @previous-anomaly="navigateAnomaly(-1)"
          />
          <div v-if="errorMessage" class="chapter-splitting-page__error">
            <ElAlert
              :closable="false"
              show-icon
              :title="errorMessage"
              type="error"
            />
            <ElButton
              v-if="refreshRequired"
              data-testid="refresh-conflicted-chapter-draft"
              :loading="isLoading"
              type="primary"
              @click="loadSnapshot"
            >
              刷新章节快照
            </ElButton>
          </div>
        </section>

        <main class="chapter-splitting-page__editor-region">
          <ElSkeleton
            v-if="isLoading || chapterDocument.status.value === 'loading'"
            class="chapter-splitting-page__loading"
            :rows="8"
            animated
          />
          <ChapterCodeMirrorEditor
            v-else-if="bodyLoaded"
            ref="chapterEditor"
            :anomalies="chapterDraft.anomalies.value"
            :chapters="chapterDraft.chapters.value"
            :disabled="editorDisabled"
            :text="chapterDraft.text.value"
            :unassigned-ranges="chapterDraft.unassignedRanges.value"
            @accept-anomaly="handleAcceptAnomaly"
            @add-recognition="handleAddRecognition"
            @delete-chapter="handleDeleteChapter"
            @error="errorMessage = $event"
            @insert-line-break="handleInsertLineBreak"
            @merge-chapter="handleMergeChapter"
            @ready="editorReady = true"
            @boundary-edit="handleBoundaryEdit"
          />
          <ElEmpty v-else description="章节正文尚未加载" />
        </main>

        <ChapterStructureFooter
          :can-confirm="canConfirmCut"
          :can-go-next="canGoNext"
          :next-loading="submissionMode === 'next'"
          :operation-count="chapterDraft.operationCount.value"
          :save-loading="submissionMode === 'save'"
          :status="footerStatus"
          @confirm="confirmChapterCut"
          @next="goToProofreading"
        />
      </div>
    </CapabilityGate>

    <ElDialog
      v-model="impactDialogVisible"
      :close-on-click-modal="!isSubmitting"
      :close-on-press-escape="!isSubmitting"
      title="确认下游影响"
      width="520px"
      @closed="cancelPendingCommand"
    >
      <p class="chapter-splitting-page__dialog-description">
        本次章节结构保存基于 revision {{ stalePreview?.baselineRevision }}。
      </p>
      <ElAlert
        :closable="false"
        title="保存后下列下游产物将标记为 stale。"
        type="warning"
      />
      <ul v-if="stalePreview?.affected.length" class="chapter-splitting-page__impact-list">
        <li v-for="item in stalePreview.affected" :key="`${item.artifactType}:${item.artifactId}`">
          <strong>{{ item.artifactType }} · {{ item.artifactId }}</strong>
          <span>{{ item.reason }}</span>
        </li>
      </ul>
      <template #footer>
        <ElButton :disabled="isSubmitting" @click="cancelPendingCommand">取消</ElButton>
        <ElButton
          :disabled="isSubmitting"
          :loading="submissionMode === 'save'"
          type="primary"
          @click="confirmPendingCommand"
        >
          确认保存
        </ElButton>
      </template>
    </ElDialog>
  </article>
</template>

<style scoped>
.chapter-splitting-page {
  width: 100%;
  height: 100%;
  min-height: 0;
  overflow: hidden;
  background: #f6f7f5;
}

.chapter-splitting-page__layout {
  display: grid;
  width: 100%;
  height: 100%;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr) auto;
}

.chapter-splitting-page__header-region {
  z-index: 2;
  min-width: 0;
  background: #fff;
}

.chapter-splitting-page__error {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 8px 20px;
  border-bottom: 1px solid #f0c8c8;
  background: #fff;
}

.chapter-splitting-page__error :deep(.el-alert) {
  min-width: 0;
  flex: 1;
}

.chapter-splitting-page__editor-region {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.chapter-splitting-page__editor-region :deep(.chapter-code-mirror-editor),
.chapter-splitting-page__loading {
  width: 100%;
  height: 100%;
}

.chapter-splitting-page__loading {
  box-sizing: border-box;
  padding: 20px;
}

.chapter-splitting-page__dialog-description {
  margin: 0 0 12px;
  color: #6a726e;
  font-size: 12px;
}

.chapter-splitting-page__impact-list {
  display: grid;
  gap: 8px;
  margin: 14px 0 0;
  padding: 0;
  list-style: none;
}

.chapter-splitting-page__impact-list li {
  display: grid;
  gap: 3px;
  padding: 9px;
  border: 1px solid #ead7ae;
  border-radius: 6px;
  background: #fff9ed;
  font-size: 12px;
}

.chapter-splitting-page__impact-list span {
  color: #6a726e;
}
</style>
