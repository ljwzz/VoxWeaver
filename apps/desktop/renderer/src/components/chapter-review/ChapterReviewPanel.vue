<script setup lang="ts">
import type {
  ChapterDto,
  NovelImportReviewSnapshotDto,
} from '@voxweaver/contracts';
import type { ChapterBoundaryEdit } from './chapterReviewModel';
import type {
  ChapterStructureDraftChapter,
} from './chapterStructureDraftModel';

import { computed, onBeforeUnmount, watch } from 'vue';
import ChapterCodeMirrorEditor from './ChapterCodeMirrorEditor.vue';
import { useChapterDocument } from './useChapterDocument';

const props = defineProps<{
  chapters: readonly ChapterDto[];
  snapshot: NovelImportReviewSnapshotDto;
  submitting: boolean;
}>();

const emit = defineEmits<{
  boundaryEdit: [edit: ChapterBoundaryEdit];
  bodyReady: [ready: boolean];
  error: [message: string];
}>();

const chapterDocument = useChapterDocument();

const editorChapters = computed<readonly ChapterStructureDraftChapter[]>(() => (
  props.chapters.map(chapter => ({
    draftId: chapter.chapterId,
    existingChapterId: chapter.chapterId,
    title: chapter.title,
    headingKind: chapter.headingKind,
    ...(chapter.headingRange ? { headingRange: chapter.headingRange } : {}),
    contentRange: chapter.contentRange,
    lengthAnomalyAccepted: chapter.lengthAnomalyAccepted,
  }))
));

const coveragePercent = computed(() => {
  const total = props.snapshot.coverage.totalByteLength;
  return total === 0
    ? 0
    : Math.round(props.snapshot.coverage.classifiedByteLength / total * 100);
});

watch(
  [
    () => props.snapshot.revisionId,
    () => props.snapshot.textByteLength,
  ],
  ([revisionId, textByteLength]) => {
    emit('bodyReady', false);
    void chapterDocument.load(revisionId, textByteLength);
  },
  { immediate: true },
);

watch(chapterDocument.status, (status) => {
  const ready = status === 'loaded' && props.chapters.length > 0;
  emit('bodyReady', ready);
  if (status === 'error' && chapterDocument.errorMessage.value)
    emit('error', chapterDocument.errorMessage.value);
});

onBeforeUnmount(() => {
  chapterDocument.cancel();
});

function handleEditorError(message: string): void {
  emit('bodyReady', false);
  emit('error', message);
}

function handleBoundaryEdit(edit: ChapterBoundaryEdit): void {
  emit('boundaryEdit', edit);
}
</script>

<template>
  <section
    :aria-busy="chapterDocument.status.value === 'loading'"
    class="chapter-review-panel"
  >
    <header class="chapter-review-panel__header">
      <div class="chapter-review-panel__heading">
        <div>
          <h1>章节与正文</h1>
          <p>
            {{ snapshot.chapters.length }} 章 ·
            {{ snapshot.coverage.uncoveredRanges.length }} 个未归属区间
          </p>
        </div>
        <span class="chapter-review-panel__editor-label">Visual Studio Light</span>
      </div>
      <div class="chapter-review-panel__coverage">
        <span>覆盖进度</span>
        <ElProgress :percentage="coveragePercent" :stroke-width="6" />
        <strong>{{ coveragePercent }}%</strong>
      </div>
    </header>

    <div class="chapter-review-panel__editor-shell">
      <ElSkeleton
        v-if="chapterDocument.status.value === 'loading'"
        class="chapter-review-panel__loading"
        :rows="8"
        animated
      />
      <ElAlert
        v-else-if="chapterDocument.status.value === 'error'"
        :closable="false"
        :title="chapterDocument.errorMessage.value"
        type="error"
      />
      <ElEmpty
        v-else-if="chapters.length === 0"
        description="未识别到有效章节，无法确认章节切割"
      />
      <ChapterCodeMirrorEditor
        v-else-if="chapterDocument.status.value === 'loaded'"
        :anomalies="[]"
        :chapters="editorChapters"
        :disabled="submitting"
        :text="chapterDocument.text.value"
        :unassigned-ranges="snapshot.coverage.uncoveredRanges"
        @error="handleEditorError"
        @boundary-edit="handleBoundaryEdit"
      />
    </div>
  </section>
</template>

<style scoped>
.chapter-review-panel {
  display: grid;
  height: 100%;
  min-width: 0;
  min-height: 0;
  grid-template-rows: auto minmax(0, 1fr);
  border: 1px solid #d4d4d4;
  background: #fff;
}

.chapter-review-panel__header {
  position: relative;
  z-index: 1;
  display: grid;
  gap: 10px;
  padding: 12px 16px;
  border-bottom: 1px solid #d4d4d4;
  background: #f3f3f3;
}

.chapter-review-panel__heading,
.chapter-review-panel__coverage {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.chapter-review-panel__heading h1,
.chapter-review-panel__heading p {
  margin: 0;
}

.chapter-review-panel__heading h1 {
  color: #000;
  font-size: 15px;
  line-height: 20px;
}

.chapter-review-panel__heading p {
  margin-top: 2px;
  color: #616161;
  font-size: 10px;
}

.chapter-review-panel__editor-label {
  color: #616161;
  font-size: 10px;
  white-space: nowrap;
}

.chapter-review-panel__coverage {
  display: grid;
  grid-template-columns: auto minmax(120px, 1fr) 36px;
  color: #616161;
  font-size: 11px;
}

.chapter-review-panel__coverage :deep(.el-progress) {
  width: 100%;
}

.chapter-review-panel__coverage strong {
  color: #000;
  text-align: right;
}

.chapter-review-panel__editor-shell {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
  background: #fff;
}

.chapter-review-panel__loading {
  padding: 18px;
}

.chapter-review-panel__editor-shell :deep(.chapter-code-mirror-editor) {
  height: 100%;
}
</style>
