<script setup lang="ts">
import type { StateEffect } from '@codemirror/state';
import type {
  ChapterDto,
  Utf8TextRangeDto,
} from '@voxweaver/contracts';
import type { ChapterEditorDecorationModel } from './chapterEditorExtensions';
import type {
  BoundaryShiftAction,
  BoundaryShiftIntent,
  ChapterBoundaryEdit,
} from './chapterReviewModel';
import type {
  ChapterLengthAnomaly,
  ChapterMergeDirection,
  ChapterStructureDraftChapter,
} from './chapterStructureDraftModel';

import { Annotation, EditorState } from '@codemirror/state';
import {
  EditorView,
  highlightActiveLine,
  highlightActiveLineGutter,
  lineNumbers,
} from '@codemirror/view';
import {
  onBeforeUnmount,
  onMounted,
  shallowRef,
  useTemplateRef,
  watch,
} from 'vue';
import {
  createChapterActionMenu,
  createChapterEditorDecorations,
  sameChapterEditorWidgetModel,
  setChapterActionGap,
  setChapterEditorDecorationModel,
  updateChapterEditorWidgets,
} from './chapterEditorExtensions';
import { ensureChapterEditorRangeVisible } from './chapterEditorFolding';
import {
  createChapterEditorModelCache,
  editorPositionToOriginalCharacter,
  utf8ByteToEditorPosition,
} from './chapterEditorModel';
import { defaultChapterEditorTheme } from './chapterEditorTheme';
import {
  BOUNDARY_SHIFT_INTENTS,
  resolveBoundaryShift,
} from './chapterReviewModel';
import { createChapterSearchPanel } from './chapterSearchPanel';
import {
  chapterBoundaryEditCanApply,
} from './chapterStructureDraftModel';

const props = withDefaults(defineProps<{
  anomalies: readonly ChapterLengthAnomaly[];
  chapters: readonly ChapterStructureDraftChapter[];
  disabled?: boolean;
  text: string;
  unassignedRanges: readonly Utf8TextRangeDto[];
}>(), {
  disabled: false,
});

const emit = defineEmits<{
  acceptAnomaly: [chapterId: string];
  addRecognition: [characterOffset: number];
  boundaryEdit: [edit: ChapterBoundaryEdit];
  deleteChapter: [chapterId: string];
  error: [message: string];
  insertLineBreak: [characterOffset: number];
  mergeChapter: [chapterId: string, direction: ChapterMergeDirection];
  ready: [];
}>();

const controlledDocumentUpdate = Annotation.define<boolean>();
const MAX_INCREMENTAL_WIDGET_UPDATES = 16;
const createCachedEditorModel = createChapterEditorModelCache();
const searchPanel = createChapterSearchPanel({
  onRevealMatch: (match, view) => {
    ensureChapterEditorRangeVisible(view, match.from, match.to);
  },
});
const host = useTemplateRef<HTMLElement>('host');
const editorView = shallowRef<EditorView>();
let activeDecorationModel: ChapterEditorDecorationModel | undefined;

onMounted(() => {
  const parent = host.value;
  const decorationModel = createDecorationModel();
  if (!parent || !decorationModel)
    return;
  activeDecorationModel = decorationModel;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: decorationModel.document.normalizedText,
      extensions: [
        EditorState.readOnly.of(true),
        EditorState.transactionFilter.of(transaction => (
          transaction.docChanged && !transaction.annotation(controlledDocumentUpdate)
            ? []
            : transaction
        )),
        EditorView.contentAttributes.of({
          'aria-label': '章节切割正文编辑器',
          'aria-readonly': 'true',
          'role': 'textbox',
        }),
        lineNumbers(),
        highlightActiveLine(),
        highlightActiveLineGutter(),
        searchPanel.extension,
        EditorView.lineWrapping,
        defaultChapterEditorTheme,
        createChapterEditorDecorations(decorationModel, {
          onAcceptAnomaly: chapterId => emit('acceptAnomaly', chapterId),
          onDelete: chapterId => emit('deleteChapter', chapterId),
          onMerge: (chapterId, direction) => emit('mergeChapter', chapterId, direction),
          onShift: handleShift,
        }),
        createChapterActionMenu({
          canInsertLineBreak: editorPosition => !props.disabled
            && canInsertLineBreakAt(editorPosition),
          onAddRecognition: handleAddRecognition,
          onInsertLineBreak: handleInsertLineBreak,
        }),
        EditorView.domEventHandlers({
          contextmenu: handleEditorContextMenu,
        }),
      ],
    }),
  });
  editorView.value = view;
  document.addEventListener('mousedown', handleDocumentMouseDown, true);
  emit('ready');
});

watch(
  [
    () => props.text,
    () => props.chapters,
    () => props.anomalies,
    () => props.unassignedRanges,
    () => props.disabled,
  ],
  () => {
    const view = editorView.value;
    const decorationModel = createDecorationModel();
    if (!view || !decorationModel)
      return;
    const previousDecorationModel = activeDecorationModel;
    const textChanged = previousDecorationModel !== undefined
      && decorationModel.document.lines !== previousDecorationModel.document.lines;
    const structureUnchanged = previousDecorationModel !== undefined
      && !textChanged
      && sameDecorationStructure(previousDecorationModel, decorationModel);
    const widgetUpdates = structureUnchanged
      ? changedChapterEditorWidgets(previousDecorationModel.widgets, decorationModel.widgets)
      : [];
    activeDecorationModel = decorationModel;
    const effects: StateEffect<unknown>[] = structureUnchanged
      ? widgetUpdates.length === 0
        ? []
        : widgetUpdates.length <= MAX_INCREMENTAL_WIDGET_UPDATES
          ? [updateChapterEditorWidgets.of(widgetUpdates)]
          : [setChapterEditorDecorationModel.of(decorationModel)]
      : [setChapterEditorDecorationModel.of(decorationModel)];
    if (textChanged || props.disabled)
      effects.push(setChapterActionGap.of(null));
    if (!textChanged && effects.length === 0)
      return;
    const documentChange = textChanged
      ? createControlledDocumentChange(
          view.state.doc.toString(),
          decorationModel.document.normalizedText,
        )
      : undefined;
    view.dispatch({
      ...(documentChange
        ? {
            annotations: controlledDocumentUpdate.of(true),
            changes: documentChange,
          }
        : {}),
      effects,
    });
    searchPanel.refresh(view);
  },
  { flush: 'post' },
);

onBeforeUnmount(() => {
  document.removeEventListener('mousedown', handleDocumentMouseDown, true);
  searchPanel.destroy();
  editorView.value?.destroy();
  editorView.value = undefined;
  activeDecorationModel = undefined;
});

function createDecorationModel(): ChapterEditorDecorationModel | undefined {
  try {
    const editorChapters = toEditorChapters(props.chapters);
    const document = createCachedEditorModel(props.text, editorChapters);
    const anomalyById = new Map(props.anomalies.map(anomaly => [anomaly.chapterId, anomaly]));
    const chapterIndexes = createChapterIndexes(props.chapters);
    const normalizedUnassigned = normalizeUnassignedRanges(props.unassignedRanges);
    return {
      document,
      unassignedRanges: props.unassignedRanges.map(unassigned => ({
        from: utf8ByteToEditorPosition(document, unassigned.startByte),
        to: utf8ByteToEditorPosition(document, unassigned.endByte),
      })),
      widgets: props.chapters.map((chapter) => {
        const index = chapterIndexes.indexById.get(chapter.draftId);
        if (index === undefined)
          throw new RangeError(`找不到章节 ${chapter.draftId} 的编辑器索引。`);
        const anomaly = anomalyById.get(chapter.draftId);
        const previous = props.chapters[index - 1];
        return {
          ...(anomaly ? { anomaly } : {}),
          canMergeNext: index < props.chapters.length - 1,
          canMergePrevious: previous !== undefined
            && !chapterOverlapsUnassignedRanges(
              previous,
              chapter.contentRange.endByte,
              normalizedUnassigned,
            ),
          chapterId: chapter.draftId,
          disabled: props.disabled,
          disabledActions: {
            upper: createDisabledActions(index, 'upper', document),
            lower: createDisabledActions(index, 'lower', document),
          },
          displayTitle: chapterIndexes.displayTitleById.get(chapter.draftId)!,
          order: index + 1,
        };
      }),
    };
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '章节编辑器初始化失败。');
    return undefined;
  }
}

interface NormalizedByteRange {
  readonly endByte: number;
  readonly startByte: number;
}

function createChapterIndexes(
  chapters: readonly ChapterStructureDraftChapter[],
): {
  readonly displayTitleById: ReadonlyMap<string, string>;
  readonly indexById: ReadonlyMap<string, number>;
} {
  const displayTitleById = new Map<string, string>();
  const indexById = new Map<string, number>();
  let unnamedOrder = 0;
  for (const [index, chapter] of chapters.entries()) {
    indexById.set(chapter.draftId, index);
    if (chapter.headingKind === 'missing')
      unnamedOrder += 1;
    displayTitleById.set(
      chapter.draftId,
      chapter.headingKind === 'source' ? chapter.title : `未命名章节 ${unnamedOrder}`,
    );
  }
  return { displayTitleById, indexById };
}

function normalizeUnassignedRanges(
  ranges: readonly Utf8TextRangeDto[],
): readonly NormalizedByteRange[] {
  const sorted = ranges
    .filter(range => range.endByte > range.startByte)
    .map(range => ({ endByte: range.endByte, startByte: range.startByte }))
    .sort((left, right) => left.startByte - right.startByte || left.endByte - right.endByte);
  const normalized: NormalizedByteRange[] = [];
  for (const current of sorted) {
    const previous = normalized.at(-1);
    if (previous && current.startByte <= previous.endByte) {
      normalized[normalized.length - 1] = {
        startByte: previous.startByte,
        endByte: Math.max(previous.endByte, current.endByte),
      };
    } else {
      normalized.push(current);
    }
  }
  return normalized;
}

function chapterOverlapsUnassignedRanges(
  previous: ChapterStructureDraftChapter,
  mergedContentEndByte: number,
  unassignedRanges: readonly NormalizedByteRange[],
): boolean {
  return (previous.headingRange !== undefined
    && rangeOverlapsUnassigned(previous.headingRange, unassignedRanges))
  || rangeOverlapsUnassigned({
    startByte: previous.contentRange.startByte,
    endByte: mergedContentEndByte,
  }, unassignedRanges);
}

function rangeOverlapsUnassigned(
  range: NormalizedByteRange,
  unassignedRanges: readonly NormalizedByteRange[],
): boolean {
  if (range.endByte <= range.startByte)
    return false;
  let low = 0;
  let high = unassignedRanges.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (unassignedRanges[middle]!.endByte <= range.startByte)
      low = middle + 1;
    else
      high = middle;
  }
  return low < unassignedRanges.length
    && unassignedRanges[low]!.startByte < range.endByte;
}

function sameDecorationStructure(
  left: ChapterEditorDecorationModel,
  right: ChapterEditorDecorationModel,
): boolean {
  return left.document.lines === right.document.lines
    && left.document.positionMap === right.document.positionMap
    && samePositionRanges(left.unassignedRanges, right.unassignedRanges)
    && sameHiddenRanges(
      left.document.hiddenRanges,
      right.document.hiddenRanges,
    )
    && sameChapterLayouts(
      left.document.chapterLayouts,
      right.document.chapterLayouts,
    );
}

function samePositionRanges(
  left: ChapterEditorDecorationModel['unassignedRanges'],
  right: ChapterEditorDecorationModel['unassignedRanges'],
): boolean {
  return left.length === right.length && left.every((range, index) => (
    range.from === right[index]!.from && range.to === right[index]!.to
  ));
}

function sameHiddenRanges(
  left: ChapterEditorDecorationModel['document']['hiddenRanges'],
  right: ChapterEditorDecorationModel['document']['hiddenRanges'],
): boolean {
  return left.length === right.length && left.every((range, index) => {
    const candidate = right[index]!;
    return range.chapterId === candidate.chapterId
      && range.from === candidate.from
      && range.to === candidate.to
      && range.startLine === candidate.startLine
      && range.endLine === candidate.endLine
      && range.lineCount === candidate.lineCount;
  });
}

function createControlledDocumentChange(
  current: string,
  next: string,
): { readonly from: number; readonly insert: string; readonly to: number } | undefined {
  if (current === next)
    return undefined;

  const sharedLength = Math.min(current.length, next.length);
  let from = 0;
  while (from < sharedLength) {
    const currentCodePoint = current.codePointAt(from)!;
    if (currentCodePoint !== next.codePointAt(from))
      break;
    from += currentCodePoint > 0xFFFF ? 2 : 1;
  }

  let currentTo = current.length;
  let nextTo = next.length;
  while (currentTo > from && nextTo > from) {
    const currentStart = previousCodePointStart(current, currentTo);
    const nextStart = previousCodePointStart(next, nextTo);
    if (current.slice(currentStart, currentTo) !== next.slice(nextStart, nextTo))
      break;
    currentTo = currentStart;
    nextTo = nextStart;
  }
  return {
    from,
    to: currentTo,
    insert: next.slice(from, nextTo),
  };
}

function previousCodePointStart(text: string, end: number): number {
  const trailing = text.charCodeAt(end - 1);
  return trailing >= 0xDC00
    && trailing <= 0xDFFF
    && end >= 2
    && text.charCodeAt(end - 2) >= 0xD800
    && text.charCodeAt(end - 2) <= 0xDBFF
    ? end - 2
    : end - 1;
}

function sameChapterLayouts(
  left: ChapterEditorDecorationModel['document']['chapterLayouts'],
  right: ChapterEditorDecorationModel['document']['chapterLayouts'],
): boolean {
  return left.length === right.length && left.every((layout, index) => {
    const candidate = right[index]!;
    return layout.chapterId === candidate.chapterId
      && layout.widgetAnchor.from === candidate.widgetAnchor.from
      && layout.widgetAnchor.lineNumber === candidate.widgetAnchor.lineNumber
      && layout.contentStartLineFrom === candidate.contentStartLineFrom
      && layout.headingLineFroms.length === candidate.headingLineFroms.length
      && layout.headingLineFroms.every(
        (from, headingIndex) => from === candidate.headingLineFroms[headingIndex],
      );
  });
}

function changedChapterEditorWidgets(
  previous: ChapterEditorDecorationModel['widgets'],
  current: ChapterEditorDecorationModel['widgets'],
): readonly ChapterEditorDecorationModel['widgets'][number][] {
  const previousById = new Map(previous.map(widget => [widget.chapterId, widget]));
  return current.filter((widget) => {
    const candidate = previousById.get(widget.chapterId);
    return candidate === undefined || !sameChapterEditorWidgetModel(candidate, widget);
  });
}

function createDisabledActions(
  chapterIndex: number,
  boundary: BoundaryShiftIntent['boundary'],
  document: ChapterEditorDecorationModel['document'],
): Readonly<Record<BoundaryShiftAction, boolean>> {
  return {
    'fast-backward': !canShift(chapterIndex, {
      boundary,
      ...BOUNDARY_SHIFT_INTENTS['fast-backward'],
    }, document),
    'backward': !canShift(chapterIndex, {
      boundary,
      ...BOUNDARY_SHIFT_INTENTS.backward,
    }, document),
    'forward': !canShift(chapterIndex, {
      boundary,
      ...BOUNDARY_SHIFT_INTENTS.forward,
    }, document),
    'fast-forward': !canShift(chapterIndex, {
      boundary,
      ...BOUNDARY_SHIFT_INTENTS['fast-forward'],
    }, document),
  };
}

function canShift(
  chapterIndex: number,
  intent: BoundaryShiftIntent,
  document: ChapterEditorDecorationModel['document'],
): boolean {
  if (props.disabled)
    return false;
  const edit = resolveBoundaryShift(
    props.chapters,
    chapterIndex,
    intent,
    document.lines,
    document.textByteLength,
  );
  return edit !== undefined && chapterBoundaryEditCanApply(
    props.chapters,
    props.unassignedRanges,
    edit,
    document.textByteLength,
  );
}

function handleShift(chapterId: string, intent: BoundaryShiftIntent): void {
  if (props.disabled)
    return;
  const chapterIndex = props.chapters.findIndex(chapter => chapter.draftId === chapterId);
  const document = activeDecorationModel?.document;
  if (chapterIndex < 0 || !document)
    return;
  const edit = resolveBoundaryShift(
    props.chapters,
    chapterIndex,
    intent,
    document.lines,
    document.textByteLength,
  );
  if (edit && chapterBoundaryEditCanApply(
    props.chapters,
    props.unassignedRanges,
    edit,
    document.textByteLength,
  )) {
    emit('boundaryEdit', edit);
  }
}

function handleEditorContextMenu(event: MouseEvent, view: EditorView): boolean {
  if (props.disabled)
    return false;
  const target = event.target;
  if (!(target instanceof Node))
    return false;
  const targetElement = target instanceof Element ? target : target.parentElement;
  if (!view.contentDOM.contains(target)
    || targetElement?.closest('.cm-chapter-widget')) {
    return false;
  }
  const position = view.posAtCoords({ x: event.clientX, y: event.clientY });
  if (position === null)
    return false;
  event.preventDefault();
  view.dispatch({
    selection: { anchor: position },
    effects: setChapterActionGap.of(position),
  });
  view.focus();
  return true;
}

function handleDocumentMouseDown(event: MouseEvent): void {
  if (event.button !== 0)
    return;
  const view = editorView.value;
  const target = event.target;
  if (!view || !(target instanceof Node))
    return;
  const targetElement = target instanceof Element ? target : target.parentElement;
  if (targetElement?.closest('.cm-chapter-action-menu')
    || !view.dom.querySelector('.cm-chapter-action-menu')) {
    return;
  }
  view.dispatch({ effects: setChapterActionGap.of(null) });
}

function canInsertLineBreakAt(editorPosition: number): boolean {
  const document = activeDecorationModel?.document;
  if (!document)
    return false;
  try {
    const characterOffset = editorPositionToOriginalCharacter(document, editorPosition);
    return !isLineBreakCharacter(props.text[characterOffset - 1])
      && !isLineBreakCharacter(props.text[characterOffset]);
  } catch {
    return false;
  }
}

function handleAddRecognition(editorPosition: number): void {
  const characterOffset = originalCharacterOffsetAt(editorPosition);
  if (characterOffset !== undefined)
    emit('addRecognition', characterOffset);
}

function handleInsertLineBreak(editorPosition: number): void {
  const characterOffset = originalCharacterOffsetAt(editorPosition);
  if (characterOffset !== undefined)
    emit('insertLineBreak', characterOffset);
}

function originalCharacterOffsetAt(
  editorPosition: number,
): number | undefined {
  const document = activeDecorationModel?.document;
  if (!document)
    return undefined;
  try {
    return editorPositionToOriginalCharacter(document, editorPosition);
  } catch (error) {
    emit('error', error instanceof Error ? error.message : '章节操作位置无效。');
    return undefined;
  }
}

function isLineBreakCharacter(character: string | undefined): boolean {
  return character === '\r' || character === '\n';
}

function focusChapter(chapterId: string): void {
  const view = editorView.value;
  const layout = activeDecorationModel?.document.chapterLayouts.find(
    chapter => chapter.chapterId === chapterId,
  );
  if (!view || !layout)
    return;
  view.dispatch({
    effects: EditorView.scrollIntoView(layout.widgetAnchor.from, { y: 'center', yMargin: 24 }),
  });
  const focusWidget = (): boolean => {
    if (editorView.value !== view)
      return false;
    const widget = [...view.dom.querySelectorAll<HTMLElement>('.cm-chapter-widget')]
      .find(element => element.dataset.chapterId === chapterId);
    if (widget) {
      widget.focus();
      return true;
    }
    return false;
  };
  if (focusWidget())
    return;
  view.focus();
  const frame = requestAnimationFrame(() => {
    focusWidget();
  });
  queueMicrotask(() => {
    if (focusWidget())
      cancelAnimationFrame(frame);
  });
}

function toEditorChapters(
  chapters: readonly ChapterStructureDraftChapter[],
): readonly ChapterDto[] {
  return chapters.map((chapter, index) => ({
    chapterId: chapter.draftId,
    order: index + 1,
    title: chapter.title,
    headingKind: chapter.headingKind,
    ...(chapter.headingRange ? { headingRange: chapter.headingRange } : {}),
    contentRange: chapter.contentRange,
    reviewStatus: 'pending',
    lengthAnomalyAccepted: chapter.lengthAnomalyAccepted,
  }));
}

defineExpose({ focusChapter });
</script>

<template>
  <div
    ref="host"
    class="chapter-code-mirror-editor"
    data-testid="chapter-code-mirror-editor"
  />
</template>

<style scoped>
.chapter-code-mirror-editor {
  min-width: 0;
  min-height: 0;
  overflow: hidden;
}

.chapter-code-mirror-editor :deep(.cm-editor) {
  width: 100%;
}
</style>
