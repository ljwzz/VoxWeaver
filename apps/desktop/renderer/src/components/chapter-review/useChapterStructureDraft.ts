import type {
  NovelImportReviewSnapshotDto,
  UpdateChapterStructureCommandInput,
} from '@voxweaver/contracts';
import type { ChapterBoundaryEdit } from './chapterReviewModel';
import type {
  ChapterCoverageSegment,
  ChapterLengthAnomaly,
  ChapterMergeDirection,
  ChapterRangeUpdate,
  ChapterStructureDraft,
  ChapterStructureDraftChapter,
  ChapterTextIndex,
} from './chapterStructureDraftModel';

import { computed, readonly, shallowRef } from 'vue';
import {
  acceptChapterLengthAnomaly as acceptLengthAnomalyInDraft,
  addChapterRecognition as addRecognitionToDraft,
  applyChapterBoundaryEdit as applyBoundaryEditToDraft,
  buildUpdateChapterStructureCommand,
  calculateChapterBodyLengths,
  calculateChapterLengthAnomalies,
  createChapterCoverageSegments,
  createChapterStructureDraft,
  createChapterTextIndex,
  deleteChapterRecognition as deleteRecognitionFromDraft,
  insertLineBreak as insertLineBreakInDraft,
  mergeChapter as mergeChapterInDraft,
  updateChapterRanges as updateRangesInDraft,
} from './chapterStructureDraftModel';

const emptyChapters: readonly ChapterStructureDraftChapter[] = [];
const emptyCoverage: readonly ChapterCoverageSegment[] = [];
const emptyAnomalies: readonly ChapterLengthAnomaly[] = [];

interface ChapterDraftAnalysis {
  readonly baselineTextIndex: ChapterTextIndex;
  readonly bodyLengths: ReadonlyMap<string, number>;
  readonly coverageSegments: readonly ChapterCoverageSegment[];
  readonly textIndex: ChapterTextIndex;
}

interface ChapterDraftUpdate {
  readonly analysis: ChapterDraftAnalysis;
  readonly draft: ChapterStructureDraft;
}

export function useChapterStructureDraft() {
  const state = shallowRef<ChapterStructureDraft>();
  const analysisByDraft = new WeakMap<ChapterStructureDraft, ChapterDraftAnalysis>();

  const text = computed(() => state.value?.text ?? '');
  const chapters = computed(() => state.value?.chapters ?? emptyChapters);
  const unassignedRanges = computed(() => state.value?.unassignedRanges ?? []);
  const dirty = computed(() => (state.value?.operationCount ?? 0) > 0);
  const operationCount = computed(() => state.value?.operationCount ?? 0);
  const coverageSegments = computed<readonly ChapterCoverageSegment[]>(() => (
    state.value ? requireAnalysis(state.value).coverageSegments : emptyCoverage
  ));
  const coverageComplete = computed(() => Boolean(
    state.value
    && state.value.chapters.length > 0
    && coverageSegments.value.every(segment => segment.classification === 'chapter'),
  ));
  const anomalies = computed<readonly ChapterLengthAnomaly[]>(() => {
    const draft = state.value;
    if (!draft)
      return emptyAnomalies;
    const analysis = requireAnalysis(draft);
    return calculateChapterLengthAnomalies(
      draft,
      analysis.textIndex,
      analysis.bodyLengths,
    );
  });
  const command = computed<UpdateChapterStructureCommandInput | undefined>(() => (
    state.value ? buildUpdateChapterStructureCommand(state.value) : undefined
  ));

  function reset(snapshot: NovelImportReviewSnapshotDto, sourceText: string): void {
    const textIndex = createChapterTextIndex(sourceText);
    const draft = createChapterStructureDraft(snapshot, sourceText, textIndex);
    commit({
      draft,
      analysis: createAnalysis(draft, textIndex, textIndex),
    });
  }

  function clear(): void {
    state.value = undefined;
  }

  function addChapterRecognition(characterOffset: number): void {
    updateStructure((draft, analysis) => (
      addRecognitionToDraft(draft, characterOffset, analysis.textIndex)
    ));
  }

  function updateChapterRanges(updates: readonly ChapterRangeUpdate[]): void {
    updateStructure((draft, analysis) => (
      updateRangesInDraft(draft, updates, analysis.textIndex)
    ));
  }

  function applyChapterBoundaryEdit(edit: ChapterBoundaryEdit): void {
    updateStructure((draft, analysis) => (
      applyBoundaryEditToDraft(draft, edit, analysis.textIndex)
    ));
  }

  function mergeChapter(chapterId: string, direction: ChapterMergeDirection): void {
    updateStructure(draft => mergeChapterInDraft(draft, chapterId, direction));
  }

  function deleteChapterRecognition(chapterId: string): void {
    updateStructure((draft, analysis) => (
      deleteRecognitionFromDraft(draft, chapterId, analysis.textIndex)
    ));
  }

  function insertLineBreak(characterOffset: number): void {
    update((draft, analysis) => {
      const nextDraft = insertLineBreakInDraft(
        draft,
        characterOffset,
        analysis.textIndex,
        analysis.baselineTextIndex,
      );
      const textIndex = createChapterTextIndex(nextDraft.text);
      return {
        draft: nextDraft,
        analysis: createAnalysis(nextDraft, textIndex, analysis.baselineTextIndex),
      };
    });
  }

  function acceptChapterLengthAnomaly(chapterId: string): void {
    update((draft, analysis) => ({
      draft: acceptLengthAnomalyInDraft(draft, chapterId),
      analysis,
    }));
  }

  function updateStructure(
    transform: (
      draft: ChapterStructureDraft,
      analysis: ChapterDraftAnalysis,
    ) => ChapterStructureDraft,
  ): void {
    update((draft, analysis) => {
      const nextDraft = transform(draft, analysis);
      return nextDraft === draft
        ? { draft, analysis }
        : {
            draft: nextDraft,
            analysis: createAnalysis(
              nextDraft,
              analysis.textIndex,
              analysis.baselineTextIndex,
            ),
          };
    });
  }

  function update(
    transform: (
      draft: ChapterStructureDraft,
      analysis: ChapterDraftAnalysis,
    ) => ChapterDraftUpdate,
  ): void {
    const current = state.value;
    if (!current)
      throw new Error('章节结构草稿尚未初始化。');
    commit(transform(current, requireAnalysis(current)));
  }

  function createAnalysis(
    draft: ChapterStructureDraft,
    textIndex: ChapterTextIndex,
    baselineTextIndex: ChapterTextIndex,
  ): ChapterDraftAnalysis {
    const nextCoverageSegments = createChapterCoverageSegments(draft, textIndex);
    return {
      baselineTextIndex,
      coverageSegments: nextCoverageSegments,
      bodyLengths: calculateChapterBodyLengths(draft, textIndex, nextCoverageSegments),
      textIndex,
    };
  }

  function commit(update: ChapterDraftUpdate): void {
    analysisByDraft.set(update.draft, update.analysis);
    state.value = update.draft;
  }

  function requireAnalysis(draft: ChapterStructureDraft): ChapterDraftAnalysis {
    const analysis = analysisByDraft.get(draft);
    if (!analysis)
      throw new Error('章节结构草稿分析缓存不存在。');
    return analysis;
  }

  return {
    acceptChapterLengthAnomaly,
    addChapterRecognition,
    applyChapterBoundaryEdit,
    anomalies,
    chapters,
    clear,
    command,
    coverageComplete,
    coverageSegments,
    deleteChapterRecognition,
    dirty,
    draft: readonly(state),
    insertLineBreak,
    mergeChapter,
    operationCount,
    reset,
    text,
    unassignedRanges,
    updateChapterRanges,
  };
}
