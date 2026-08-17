import type {
  ChangeDesc,
  Extension,
  Range,
  Transaction,
} from '@codemirror/state';
import type { ViewUpdate } from '@codemirror/view';
import type {
  ChapterEditorHiddenRange,
  ChapterEditorLine,
  ChapterEditorModel,
} from './chapterEditorModel';

import {
  ChangeSet,
  Facet,
  StateEffect,
  StateField,
} from '@codemirror/state';
import {
  Decoration,
  EditorView,
  ViewPlugin,
  WidgetType,
} from '@codemirror/view';
import { DEFAULT_CHAPTER_EDITOR_CONFIG } from './chapterEditorConfig';

type ChapterFoldEdge = 'bottom' | 'top';

interface ChapterFoldEdgeMovement {
  readonly canMoveBottom: boolean;
  readonly canMoveTop: boolean;
}

interface ChapterFoldMovementState {
  readonly bottom: ChapterFoldEdgeMovement;
  readonly top: ChapterFoldEdgeMovement;
}

interface ChapterFoldDispatchOptions {
  readonly viewportAnchor?: 'bottom-context';
}

interface ChapterFoldRegionState {
  readonly chapterId: string;
  readonly expanded: boolean;
  readonly from: number;
  readonly to: number;
}

type ChapterFoldAction
  = | {
    readonly chapterId: string;
    readonly edge: ChapterFoldEdge;
    readonly kind: 'reveal-lines';
    readonly lineCount: number;
  }
  | {
    readonly chapterId: string;
    readonly edge: ChapterFoldEdge;
    readonly kind: 'set-boundary';
    readonly position: number;
  }
  | {
    readonly chapterId: string;
    readonly kind: 'expand-all';
  }
  | {
    readonly chapterId: string;
    readonly kind: 'refold';
  };

export interface ChapterEditorFoldSnapshot {
  readonly chapterId: string;
  readonly expanded: boolean;
  readonly from: number;
  readonly hiddenLineCount: number;
  readonly to: number;
}

export const chapterEditorDocumentFacet = Facet.define<
  ChapterEditorModel,
  ChapterEditorModel | undefined
>({
  combine: values => values.at(-1),
});

const updateChapterFold = StateEffect.define<ChapterFoldAction>({
  map: (value, changes) => value.kind === 'set-boundary'
    ? { ...value, position: changes.mapPos(value.position, value.edge === 'top' ? 1 : -1) }
    : value,
});

interface ChapterFoldFieldState {
  readonly decorations: ReturnType<typeof Decoration.set>;
  readonly document: ChapterEditorModel;
  readonly regions: ReadonlyMap<string, ChapterFoldRegionState>;
}

const chapterEditorFoldField = StateField.define<ChapterFoldFieldState>({
  create: (state) => {
    const document = requireChapterEditorDocument(state.facet(chapterEditorDocumentFacet));
    const regions = reconcileFoldRegions(new Map(), document);
    return {
      decorations: buildFoldDecorations(document, regions),
      document,
      regions,
    };
  },
  update: (value, transaction) => {
    let dirty = transaction.docChanged;
    let regions = transaction.docChanged
      ? mapFoldRegions(value.regions, effectiveDocumentMapping(transaction))
      : value.regions;
    const document = requireChapterEditorDocument(
      transaction.state.facet(chapterEditorDocumentFacet),
    );
    if (document !== value.document) {
      regions = reconcileFoldRegions(regions, document);
      dirty = true;
    }
    for (const effect of transaction.effects) {
      if (!effect.is(updateChapterFold))
        continue;
      const updated = applyFoldAction(document, regions, effect.value);
      dirty = updated !== regions || dirty;
      regions = updated;
    }
    return dirty
      ? {
          decorations: buildFoldDecorations(document, regions),
          document,
          regions,
        }
      : value;
  },
  provide: field => EditorView.decorations.from(field, value => value.decorations),
});

class ChapterFoldDragPlugin {
  private activeDrag: {
    readonly chapterId: string;
    readonly edge: ChapterFoldEdge;
    readonly handle: HTMLElement;
    readonly root: HTMLElement;
  } | undefined;

  private activeDragCleanup: (() => void) | undefined;

  constructor(private readonly view: EditorView) {}

  destroy(): void {
    this.stopDragging();
  }

  update(update: ViewUpdate): void {
    const previousDocument = update.startState.field(chapterEditorFoldField, false)?.document;
    const currentState = update.state.field(chapterEditorFoldField, false);
    if (update.docChanged || previousDocument !== currentState?.document) {
      this.stopDragging();
      return;
    }
    const activeDrag = this.activeDrag;
    if (!activeDrag)
      return;
    const region = currentState?.regions.get(activeDrag.chapterId);
    if (!region || region.expanded) {
      this.stopDragging();
      return;
    }
    this.syncActiveDragClasses();
  }

  startDragging(
    chapterId: string,
    edge: ChapterFoldEdge,
    event: MouseEvent,
  ): void {
    if (event.button !== 0)
      return;
    const state = this.view.state.field(chapterEditorFoldField, false);
    if (!state)
      return;
    const region = state.regions.get(chapterId);
    if (!region || region.expanded)
      return;

    event.preventDefault();
    event.stopPropagation();
    this.stopDragging();
    const ownerWindow = this.view.dom.ownerDocument.defaultView;
    if (!ownerWindow)
      return;
    const handle = event.currentTarget;
    if (!(handle instanceof ownerWindow.HTMLElement))
      return;
    const root = handle.closest<HTMLElement>('.cm-chapter-fold');
    if (!root)
      return;
    const initialPosition = edge === 'top' ? region.from : region.to;
    const initialLineIndex = lineStartIndexAtOrBefore(
      state.document.lines,
      initialPosition,
    );
    const startY = event.clientY;
    let didMove = false;
    let previousLineDelta = 0;
    this.activeDrag = { chapterId, edge, handle, root };
    handle.classList.add('dragging');
    root.classList.add('dragging');
    this.view.dom.classList.add('cm-chapter-folding-dragging');
    this.syncActiveDragClasses();

    const handleMouseMove = (moveEvent: MouseEvent): void => {
      const delta = moveEvent.clientY - startY;
      didMove = didMove
        || Math.abs(delta) > DEFAULT_CHAPTER_EDITOR_CONFIG.folding.dragThresholdPx;
      if (!didMove)
        return;
      const lineDelta = Math.round(delta / Math.max(1, this.view.defaultLineHeight));
      if (lineDelta === previousLineDelta)
        return;
      previousLineDelta = lineDelta;
      const targetIndex = Math.max(
        0,
        Math.min(initialLineIndex + lineDelta, state.document.lines.length - 1),
      );
      dispatchFoldEdgeAction(this.view, {
        chapterId,
        edge,
        kind: 'set-boundary',
        position: state.document.lines[targetIndex]!.from,
      });
    };
    const handleMouseUp = (): void => {
      if (!didMove) {
        dispatchFoldEdgeAction(this.view, {
          chapterId,
          edge,
          kind: 'reveal-lines',
          lineCount: DEFAULT_CHAPTER_EDITOR_CONFIG.folding.clickRevealLines,
        });
      }
      this.stopDragging();
    };
    const handleBlur = (): void => this.stopDragging();
    ownerWindow.addEventListener('mousemove', handleMouseMove);
    ownerWindow.addEventListener('mouseup', handleMouseUp);
    ownerWindow.addEventListener('blur', handleBlur);
    this.activeDragCleanup = () => {
      ownerWindow.removeEventListener('mousemove', handleMouseMove);
      ownerWindow.removeEventListener('mouseup', handleMouseUp);
      ownerWindow.removeEventListener('blur', handleBlur);
      handle.classList.remove('dragging');
      root.classList.remove('dragging');
      this.view.dom.classList.remove('cm-chapter-folding-dragging');
      this.view.dom.classList.remove(
        'cm-chapter-folding-can-move-top',
        'cm-chapter-folding-can-move-bottom',
      );
      this.activeDrag = undefined;
      this.activeDragCleanup = undefined;
    };
  }

  private syncActiveDragClasses(): void {
    const activeDrag = this.activeDrag;
    if (!activeDrag)
      return;
    const movement = foldEdgeMovementForView(
      this.view,
      activeDrag.chapterId,
      activeDrag.edge,
    );
    if (!movement)
      return;
    activeDrag.handle.classList.toggle('canMoveTop', movement.canMoveTop);
    activeDrag.handle.classList.toggle('canMoveBottom', movement.canMoveBottom);
    this.view.dom.classList.toggle(
      'cm-chapter-folding-can-move-top',
      movement.canMoveTop,
    );
    this.view.dom.classList.toggle(
      'cm-chapter-folding-can-move-bottom',
      movement.canMoveBottom,
    );
  }

  private stopDragging(): void {
    this.activeDragCleanup?.();
  }
}

const chapterFoldDragPlugin = ViewPlugin.fromClass(ChapterFoldDragPlugin);

export function createChapterEditorFolding(): Extension {
  return [chapterEditorFoldField, chapterFoldDragPlugin];
}

export function ensureChapterEditorRangeVisible(
  view: EditorView,
  from: number,
  to = from,
): boolean {
  const state = view.state.field(chapterEditorFoldField, false);
  if (!state)
    return false;
  const matchTo = to > from ? to : Math.min(state.document.normalizedText.length, from + 1);
  for (const region of state.regions.values()) {
    if (region.expanded || region.from >= region.to)
      continue;
    if (matchTo <= region.from || from >= region.to)
      continue;

    const lines = state.document.lines;
    const hiddenStartIndex = lineStartIndexAtOrBefore(lines, region.from);
    const hiddenEndIndex = lineStartIndexAtOrBefore(lines, region.to);
    const matchStartIndex = lineIndexAtPosition(lines, Math.max(region.from, from));
    const matchEndPosition = Math.max(from, matchTo - 1);
    const matchEndIndex = lineIndexAtPosition(
      lines,
      Math.min(region.to - 1, matchEndPosition),
    );
    const revealFromTop = matchEndIndex - hiddenStartIndex + 1;
    const revealFromBottom = hiddenEndIndex - matchStartIndex;
    const edge: ChapterFoldEdge = revealFromTop <= revealFromBottom ? 'top' : 'bottom';
    const position = edge === 'top'
      ? lines[Math.min(matchEndIndex + 1, lines.length - 1)]!.from
      : lines[matchStartIndex]!.from;
    dispatchFoldEdgeAction(view, {
      chapterId: region.chapterId,
      edge,
      kind: 'set-boundary',
      position,
    });
    return true;
  }
  return false;
}

export function chapterEditorFoldSnapshots(
  view: EditorView,
): readonly ChapterEditorFoldSnapshot[] {
  const state = view.state.field(chapterEditorFoldField, false);
  if (!state)
    return [];
  const defaults = defaultRangeByChapterId(state.document);
  return [...state.regions.values()].map(region => ({
    chapterId: region.chapterId,
    expanded: region.expanded,
    from: region.from,
    hiddenLineCount: region.expanded
      ? 0
      : countLogicalLines(state.document.lines, region.from, region.to),
    to: region.to,
  })).filter(region => defaults.has(region.chapterId));
}

function dispatchFoldEdgeAction(
  view: EditorView,
  action: Extract<ChapterFoldAction, { readonly edge: ChapterFoldEdge }>,
): void {
  dispatchFoldAction(view, action, action.edge === 'bottom'
    ? { viewportAnchor: 'bottom-context' }
    : undefined);
}

function dispatchFoldAction(
  view: EditorView,
  action: ChapterFoldAction,
  options: ChapterFoldDispatchOptions = {},
): void {
  const anchorPosition = options.viewportAnchor === 'bottom-context'
    ? bottomContextAnchorPosition(view, action.chapterId)
    : undefined;
  const anchorTop = anchorPosition === undefined
    ? undefined
    : documentBlockTop(view, anchorPosition);
  const scrollTop = anchorTop === undefined ? undefined : view.scrollDOM.scrollTop;
  view.dispatch({
    effects: updateChapterFold.of(action),
  });
  if (anchorPosition === undefined || anchorTop === undefined || scrollTop === undefined)
    return;
  const nextAnchorTop = documentBlockTop(view, anchorPosition);
  const scrollDelta = nextAnchorTop - anchorTop;
  if (scrollDelta !== 0)
    view.scrollDOM.scrollTop = scrollTop + scrollDelta;
}

function bottomContextAnchorPosition(
  view: EditorView,
  chapterId: string,
): number | undefined {
  const state = view.state.field(chapterEditorFoldField, false);
  if (!state)
    return undefined;
  return defaultRangeByChapterId(state.document).get(chapterId)?.to;
}

function documentBlockTop(view: EditorView, position: number): number {
  return position >= view.state.doc.length
    ? view.contentHeight
    : view.lineBlockAt(position).top;
}

function applyFoldAction(
  document: ChapterEditorModel,
  regions: ReadonlyMap<string, ChapterFoldRegionState>,
  action: ChapterFoldAction,
): ReadonlyMap<string, ChapterFoldRegionState> {
  const region = regions.get(action.chapterId);
  const defaultRange = defaultRangeByChapterId(document).get(action.chapterId);
  if (!region || !defaultRange)
    return regions;

  let next: ChapterFoldRegionState;
  if (action.kind === 'expand-all') {
    if (region.expanded)
      return regions;
    next = { ...region, expanded: true };
  } else if (action.kind === 'refold') {
    next = regionFromDefault(defaultRange);
  } else {
    const lines = document.lines;
    let from = region.from;
    let to = region.to;
    if (action.kind === 'reveal-lines') {
      if (region.expanded)
        return regions;
      if (action.edge === 'top') {
        const fromIndex = lineStartIndexAtOrBefore(lines, from);
        from = lines[Math.min(fromIndex + action.lineCount, lines.length - 1)]!.from;
      } else {
        const toIndex = lineStartIndexAtOrBefore(lines, to);
        to = lines[Math.max(0, toIndex - action.lineCount)]!.from;
      }
    } else if (action.edge === 'top') {
      from = action.position;
    } else {
      to = action.position;
    }

    from = lineStartAtOrAfter(
      lines,
      Math.max(defaultRange.from, Math.min(from, defaultRange.to)),
    );
    to = lineStartAtOrBefore(
      lines,
      Math.min(defaultRange.to, Math.max(to, defaultRange.from)),
    );
    const expanded = from >= to;
    const collapsedBoundary = action.edge === 'top' ? to : from;
    next = expanded
      ? {
          ...region,
          expanded: true,
          from: collapsedBoundary,
          to: collapsedBoundary,
        }
      : { ...region, expanded: false, from, to };
  }

  if (sameFoldRegion(region, next))
    return regions;
  const updated = new Map(regions);
  updated.set(action.chapterId, next);
  return updated;
}

function buildFoldDecorations(
  document: ChapterEditorModel,
  regions: ReadonlyMap<string, ChapterFoldRegionState>,
): ReturnType<typeof Decoration.set> {
  const decorations: Array<Range<Decoration>> = [];
  for (const defaultRange of document.hiddenRanges) {
    const region = regions.get(defaultRange.chapterId);
    if (!region)
      continue;
    if (region.expanded || region.from >= region.to) {
      decorations.push(Decoration.widget({
        block: true,
        side: -1,
        widget: new RefoldChapterWidget(defaultRange.chapterId),
      }).range(defaultRange.from));
      continue;
    }
    decorations.push(Decoration.replace({
      block: true,
      inclusive: false,
      widget: new CollapsedChapterWidget(
        defaultRange.chapterId,
        countLogicalLines(document.lines, region.from, region.to),
        foldMovementState(region, defaultRange),
      ),
    }).range(region.from, region.to));
  }
  return Decoration.set(decorations, true);
}

class CollapsedChapterWidget extends WidgetType {
  constructor(
    private readonly chapterId: string,
    private readonly hiddenLineCount: number,
    private readonly movement: ChapterFoldMovementState,
  ) {
    super();
  }

  override eq(other: CollapsedChapterWidget): boolean {
    return this.chapterId === other.chapterId
      && this.hiddenLineCount === other.hiddenLineCount
      && sameFoldMovementState(this.movement, other.movement);
  }

  override updateDOM(dom: HTMLElement, _view: EditorView, from: this): boolean {
    if (this.chapterId !== from.chapterId)
      return false;
    updateCollapsedWidgetDOM(dom, this.hiddenLineCount, this.movement);
    return true;
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cm-chapter-fold';
    root.dataset.chapterFoldId = this.chapterId;
    root.setAttribute('aria-label', `章节正文隐藏 ${this.hiddenLineCount} 行`);
    root.setAttribute('role', 'group');

    const top = createFoldEdgeButton(view, this.chapterId, 'top');
    const expandAll = document.createElement('button');
    expandAll.type = 'button';
    expandAll.className = 'cm-chapter-fold__expand-all';
    expandAll.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchFoldAction(view, {
        chapterId: this.chapterId,
        kind: 'expand-all',
      });
    });
    const bottom = createFoldEdgeButton(view, this.chapterId, 'bottom');
    root.append(top, expandAll, bottom);
    updateCollapsedWidgetDOM(root, this.hiddenLineCount, this.movement);
    return root;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override get estimatedHeight(): number {
    return 24;
  }
}

class RefoldChapterWidget extends WidgetType {
  constructor(private readonly chapterId: string) {
    super();
  }

  override eq(other: RefoldChapterWidget): boolean {
    return this.chapterId === other.chapterId;
  }

  override toDOM(view: EditorView): HTMLElement {
    const root = document.createElement('div');
    root.className = 'cm-chapter-refold';
    root.dataset.chapterRefoldId = this.chapterId;
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'cm-chapter-refold__button';
    button.setAttribute('aria-label', '重新折叠章节正文，保留前后各 5 行');
    button.textContent = '重新折叠';
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      dispatchFoldAction(view, {
        chapterId: this.chapterId,
        kind: 'refold',
      });
    });
    root.append(button);
    return root;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override get estimatedHeight(): number {
    return 20;
  }
}

function createFoldEdgeButton(
  view: EditorView,
  chapterId: string,
  edge: ChapterFoldEdge,
): HTMLButtonElement {
  const button = document.createElement('button');
  const direction = edge === 'top' ? '上方' : '下方';
  button.type = 'button';
  button.className = `cm-chapter-fold__edge cm-chapter-fold__edge--${edge}`;
  button.setAttribute(
    'aria-label',
    `从${direction}展开 ${DEFAULT_CHAPTER_EDITOR_CONFIG.folding.clickRevealLines} 行，可拖动逐行调整`,
  );
  button.title = `单击展开 ${DEFAULT_CHAPTER_EDITOR_CONFIG.folding.clickRevealLines} 行，拖动逐行调整`;
  button.textContent = edge === 'top' ? '︿' : '﹀';
  button.addEventListener('mousedown', (event) => {
    view.plugin(chapterFoldDragPlugin)?.startDragging(chapterId, edge, event);
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ')
      return;
    event.preventDefault();
    event.stopPropagation();
    dispatchFoldEdgeAction(view, {
      chapterId,
      edge,
      kind: 'reveal-lines',
      lineCount: DEFAULT_CHAPTER_EDITOR_CONFIG.folding.clickRevealLines,
    });
  });
  return button;
}

function updateCollapsedWidgetDOM(
  root: HTMLElement,
  hiddenLineCount: number,
  movement: ChapterFoldMovementState,
): void {
  root.setAttribute('aria-label', `章节正文隐藏 ${hiddenLineCount} 行`);
  for (const edge of ['top', 'bottom'] as const) {
    const edgeElement = root.querySelector<HTMLElement>(`.cm-chapter-fold__edge--${edge}`);
    edgeElement?.classList.toggle('canMoveTop', movement[edge].canMoveTop);
    edgeElement?.classList.toggle('canMoveBottom', movement[edge].canMoveBottom);
  }
  const expandAll = root.querySelector<HTMLButtonElement>('.cm-chapter-fold__expand-all');
  if (!expandAll)
    return;
  expandAll.setAttribute('aria-label', `展开全部 ${hiddenLineCount} 行隐藏正文`);
  expandAll.textContent = `隐藏 ${hiddenLineCount} 行 · 展开全部`;
}

function foldMovementState(
  region: ChapterFoldRegionState,
  defaultRange: ChapterEditorHiddenRange,
): ChapterFoldMovementState {
  return {
    top: {
      canMoveTop: region.from > defaultRange.from,
      canMoveBottom: region.from < region.to,
    },
    bottom: {
      canMoveTop: region.to > region.from,
      canMoveBottom: region.to < defaultRange.to,
    },
  };
}

function foldEdgeMovementForView(
  view: EditorView,
  chapterId: string,
  edge: ChapterFoldEdge,
): ChapterFoldEdgeMovement | undefined {
  const state = view.state.field(chapterEditorFoldField, false);
  const region = state?.regions.get(chapterId);
  const defaultRange = state
    ? defaultRangeByChapterId(state.document).get(chapterId)
    : undefined;
  return region && defaultRange && !region.expanded
    ? foldMovementState(region, defaultRange)[edge]
    : undefined;
}

function sameFoldMovementState(
  left: ChapterFoldMovementState,
  right: ChapterFoldMovementState,
): boolean {
  return left.top.canMoveTop === right.top.canMoveTop
    && left.top.canMoveBottom === right.top.canMoveBottom
    && left.bottom.canMoveTop === right.bottom.canMoveTop
    && left.bottom.canMoveBottom === right.bottom.canMoveBottom;
}

function reconcileFoldRegions(
  current: ReadonlyMap<string, ChapterFoldRegionState>,
  document: ChapterEditorModel,
): Map<string, ChapterFoldRegionState> {
  const next = new Map<string, ChapterFoldRegionState>();
  for (const defaultRange of document.hiddenRanges) {
    const existing = current.get(defaultRange.chapterId);
    if (!existing) {
      next.set(defaultRange.chapterId, regionFromDefault(defaultRange));
      continue;
    }
    if (existing.expanded) {
      next.set(defaultRange.chapterId, {
        ...existing,
        chapterId: defaultRange.chapterId,
      });
      continue;
    }
    const from = lineStartAtOrAfter(
      document.lines,
      Math.max(existing.from, defaultRange.from),
    );
    const to = lineStartAtOrBefore(
      document.lines,
      Math.min(existing.to, defaultRange.to),
    );
    if (from >= to) {
      const boundary = Math.min(from, to);
      next.set(defaultRange.chapterId, {
        chapterId: defaultRange.chapterId,
        expanded: true,
        from: boundary,
        to: boundary,
      });
    } else {
      next.set(defaultRange.chapterId, {
        chapterId: defaultRange.chapterId,
        expanded: false,
        from,
        to,
      });
    }
  }
  return next;
}

function regionFromDefault(defaultRange: ChapterEditorHiddenRange): ChapterFoldRegionState {
  return {
    chapterId: defaultRange.chapterId,
    expanded: false,
    from: defaultRange.from,
    to: defaultRange.to,
  };
}

function mapFoldRegions(
  regions: ReadonlyMap<string, ChapterFoldRegionState>,
  changes: ChangeDesc,
): Map<string, ChapterFoldRegionState> {
  return new Map([...regions].map(([chapterId, region]) => [chapterId, {
    ...region,
    from: changes.mapPos(region.from, 1),
    to: changes.mapPos(region.to, -1),
  }]));
}

function effectiveDocumentMapping(transaction: Transaction): ChangeDesc {
  if (!isWholeDocumentReplacement(transaction))
    return transaction.changes;
  const before = transaction.startState.doc.toString();
  const after = transaction.state.doc.toString();
  let prefix = commonPrefixLength(before, after);
  let suffix = commonSuffixLength(before, after, prefix);
  if (prefix > 0 && prefix < before.length && splitsSurrogatePair(before, prefix))
    prefix -= 1;
  if (suffix > 0 && splitsSurrogatePair(before, before.length - suffix))
    suffix -= 1;
  return ChangeSet.of({
    from: prefix,
    to: before.length - suffix,
    insert: after.slice(prefix, after.length - suffix),
  }, before.length);
}

function isWholeDocumentReplacement(transaction: Transaction): boolean {
  let count = 0;
  let onlyRange: readonly [number, number, number, number] | undefined;
  transaction.changes.iterChangedRanges((fromA, toA, fromB, toB) => {
    count += 1;
    onlyRange = [fromA, toA, fromB, toB];
  }, true);
  return count === 1
    && onlyRange?.[0] === 0
    && onlyRange[1] === transaction.startState.doc.length
    && onlyRange[2] === 0
    && onlyRange[3] === transaction.state.doc.length;
}

function commonPrefixLength(left: string, right: string): number {
  const maximum = Math.min(left.length, right.length);
  let index = 0;
  while (index < maximum && left[index] === right[index])
    index += 1;
  return index;
}

function commonSuffixLength(left: string, right: string, prefixLength: number): number {
  const maximum = Math.min(left.length, right.length) - prefixLength;
  let length = 0;
  while (length < maximum
    && left[left.length - length - 1] === right[right.length - length - 1]) {
    length += 1;
  }
  return length;
}

function splitsSurrogatePair(text: string, position: number): boolean {
  const previous = text.charCodeAt(position - 1);
  const current = text.charCodeAt(position);
  return previous >= 0xD800 && previous <= 0xDBFF
    && current >= 0xDC00 && current <= 0xDFFF;
}

function defaultRangeByChapterId(
  document: ChapterEditorModel,
): ReadonlyMap<string, ChapterEditorHiddenRange> {
  return new Map(document.hiddenRanges.map(range => [range.chapterId, range]));
}

function countLogicalLines(
  lines: readonly ChapterEditorLine[],
  from: number,
  to: number,
): number {
  if (from >= to)
    return 0;
  return Math.max(
    0,
    lineStartIndexAtOrBefore(lines, to) - lineStartIndexAtOrBefore(lines, from),
  );
}

function lineIndexAtPosition(
  lines: readonly ChapterEditorLine[],
  position: number,
): number {
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle]!.from <= position)
      low = middle + 1;
    else
      high = middle;
  }
  return Math.max(0, low - 1);
}

function lineStartIndexAtOrBefore(
  lines: readonly ChapterEditorLine[],
  position: number,
): number {
  return lineIndexAtPosition(lines, position);
}

function lineStartAtOrBefore(
  lines: readonly ChapterEditorLine[],
  position: number,
): number {
  return lines[lineStartIndexAtOrBefore(lines, position)]!.from;
}

function lineStartAtOrAfter(
  lines: readonly ChapterEditorLine[],
  position: number,
): number {
  const beforeIndex = lineStartIndexAtOrBefore(lines, position);
  const before = lines[beforeIndex]!;
  if (before.from >= position)
    return before.from;
  return lines[Math.min(beforeIndex + 1, lines.length - 1)]!.from;
}

function sameFoldRegion(
  left: ChapterFoldRegionState,
  right: ChapterFoldRegionState,
): boolean {
  return left.chapterId === right.chapterId
    && left.expanded === right.expanded
    && left.from === right.from
    && left.to === right.to;
}

function requireChapterEditorDocument(
  document: ChapterEditorModel | undefined,
): ChapterEditorModel {
  if (!document)
    throw new Error('Chapter editor folding requires a document model.');
  return document;
}
