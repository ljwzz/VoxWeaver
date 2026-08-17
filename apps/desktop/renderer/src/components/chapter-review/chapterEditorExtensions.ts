import type { Extension, Range } from '@codemirror/state';
import type { Tooltip } from '@codemirror/view';
import type { ChapterEditorModel } from './chapterEditorModel';
import type {
  BoundaryShiftAction,
  BoundaryShiftIntent,
} from './chapterReviewModel';
import type {
  ChapterLengthAnomaly,
  ChapterMergeDirection,
} from './chapterStructureDraftModel';

import { StateEffect, StateField } from '@codemirror/state';
import {
  Decoration,
  EditorView,
  keymap,
  showTooltip,
  WidgetType,
} from '@codemirror/view';
import {
  chapterEditorDocumentFacet,
  createChapterEditorFolding,
} from './chapterEditorFolding';
import { BOUNDARY_SHIFT_INTENTS } from './chapterReviewModel';

type DisabledBoundaryActions = Readonly<Record<BoundaryShiftAction, boolean>>;

export interface ChapterEditorWidgetModel {
  readonly anomaly?: ChapterLengthAnomaly;
  readonly canMergeNext: boolean;
  readonly canMergePrevious: boolean;
  readonly chapterId: string;
  readonly disabled: boolean;
  readonly disabledActions: Readonly<{
    upper: DisabledBoundaryActions;
    lower: DisabledBoundaryActions;
  }>;
  readonly displayTitle: string;
  readonly order: number;
}

export interface ChapterEditorDecorationModel {
  readonly document: ChapterEditorModel;
  readonly unassignedRanges: readonly { readonly from: number; readonly to: number }[];
  readonly widgets: readonly ChapterEditorWidgetModel[];
}

export interface ChapterWidgetCallbacks {
  readonly onAcceptAnomaly: (chapterId: string) => void;
  readonly onDelete: (chapterId: string) => void;
  readonly onMerge: (chapterId: string, direction: ChapterMergeDirection) => void;
  readonly onShift: (chapterId: string, intent: BoundaryShiftIntent) => void;
}

export interface ChapterActionMenuCallbacks {
  readonly canInsertLineBreak: (characterOffset: number) => boolean;
  readonly onAddRecognition: (characterOffset: number) => void;
  readonly onInsertLineBreak: (characterOffset: number) => void;
}

interface ChapterEditorDecorationState {
  readonly decorations: ReturnType<typeof Decoration.set>;
  readonly model: ChapterEditorDecorationModel;
}

interface ChapterActionState {
  readonly position: number | null;
}

export const setChapterEditorDecorationModel = StateEffect.define<ChapterEditorDecorationModel>();
export const updateChapterEditorWidgets = StateEffect.define<readonly ChapterEditorWidgetModel[]>();
export const setChapterActionGap = StateEffect.define<number | null>({
  map: (value, changes) => value === null ? null : changes.mapPos(value),
});

export function createChapterEditorDecorations(
  initialModel: ChapterEditorDecorationModel,
  callbacks: ChapterWidgetCallbacks,
): Extension {
  const field = StateField.define<ChapterEditorDecorationState>({
    create: () => buildDecorationState(initialModel, callbacks),
    update: (value, transaction) => {
      let model = value.model;
      let rebuild = transaction.docChanged;
      const widgetUpdates: ChapterEditorWidgetModel[] = [];
      for (const effect of transaction.effects) {
        if (effect.is(setChapterEditorDecorationModel)) {
          model = effect.value;
          rebuild = true;
        } else if (effect.is(updateChapterEditorWidgets)) {
          widgetUpdates.push(...effect.value);
        }
      }
      const updatedWidgets = applyWidgetModelUpdates(model, widgetUpdates);
      if (rebuild)
        return buildDecorationState(updatedWidgets.model, callbacks);
      if (updatedWidgets.changed.length > 0) {
        return updateWidgetDecorationState(
          value,
          updatedWidgets.model,
          updatedWidgets.changed,
          callbacks,
        );
      }
      return value;
    },
    provide: currentField => [
      EditorView.decorations.from(
        currentField,
        value => value.decorations,
      ),
      chapterEditorDocumentFacet.from(
        currentField,
        value => value.model.document,
      ),
    ],
  });
  return [field, createChapterEditorFolding()];
}

export function createChapterActionMenu(
  callbacks: ChapterActionMenuCallbacks,
): Extension {
  const field = StateField.define<ChapterActionState>({
    create: () => ({ position: null }),
    update: (value, transaction) => {
      let next = transaction.docChanged && value.position !== null
        ? { position: null }
        : value;
      for (const effect of transaction.effects) {
        if (effect.is(setChapterActionGap))
          next = { position: effect.value };
      }
      return next;
    },
    provide: currentField => showTooltip.from(currentField, (value): Tooltip | null => (
      value.position === null
        ? null
        : createActionTooltip(value.position, callbacks)
    )),
  });
  return [
    field,
    keymap.of([{
      key: 'Escape',
      run: view => closeActionTooltip(view, field),
    }]),
  ];
}

function buildDecorationState(
  model: ChapterEditorDecorationModel,
  callbacks: ChapterWidgetCallbacks,
): ChapterEditorDecorationState {
  const decorations: Array<Range<Decoration>> = [];
  const widgetByChapterId = new Map(model.widgets.map(widget => [widget.chapterId, widget]));
  for (const unassigned of model.unassignedRanges) {
    if (unassigned.from < unassigned.to) {
      decorations.push(Decoration.mark({ class: 'cm-chapter-unassigned' }).range(
        unassigned.from,
        unassigned.to,
      ));
    }
  }
  for (const layout of model.document.chapterLayouts) {
    const widgetModel = widgetByChapterId.get(layout.chapterId);
    if (!widgetModel)
      continue;
    decorations.push(createChapterWidgetDecoration(
      layout.widgetAnchor.from,
      widgetModel,
      callbacks,
    ));
    for (const from of layout.headingLineFroms)
      decorations.push(Decoration.line({ class: 'cm-chapter-heading-line' }).range(from));
    decorations.push(Decoration.line({ class: 'cm-chapter-content-start' }).range(
      layout.contentStartLineFrom,
    ));
  }
  return {
    decorations: Decoration.set(decorations, true),
    model,
  };
}

function updateWidgetDecorationState(
  value: ChapterEditorDecorationState,
  model: ChapterEditorDecorationModel,
  widgets: readonly ChapterEditorWidgetModel[],
  callbacks: ChapterWidgetCallbacks,
): ChapterEditorDecorationState {
  const layoutByChapterId = new Map(
    model.document.chapterLayouts.map(layout => [layout.chapterId, layout]),
  );
  let decorations = value.decorations;
  for (const widget of widgets) {
    const layout = layoutByChapterId.get(widget.chapterId);
    if (!layout)
      continue;
    const anchor = layout.widgetAnchor.from;
    decorations = decorations.update({
      add: [createChapterWidgetDecoration(anchor, widget, callbacks)],
      filter: (_from, _to, decoration) => !isChapterWidgetDecoration(
        decoration,
        widget.chapterId,
      ),
      filterFrom: anchor,
      filterTo: anchor,
    });
  }
  return { decorations, model };
}

function applyWidgetModelUpdates(
  model: ChapterEditorDecorationModel,
  updates: readonly ChapterEditorWidgetModel[],
): {
  readonly changed: readonly ChapterEditorWidgetModel[];
  readonly model: ChapterEditorDecorationModel;
} {
  if (updates.length === 0)
    return { changed: [], model };
  const updateByChapterId = new Map(updates.map(widget => [widget.chapterId, widget]));
  const changed: ChapterEditorWidgetModel[] = [];
  const widgets = model.widgets.map((current) => {
    const updated = updateByChapterId.get(current.chapterId);
    if (!updated || sameChapterEditorWidgetModel(current, updated))
      return current;
    changed.push(updated);
    return updated;
  });
  return changed.length === 0
    ? { changed, model }
    : { changed, model: { ...model, widgets } };
}

function createChapterWidgetDecoration(
  anchor: number,
  model: ChapterEditorWidgetModel,
  callbacks: ChapterWidgetCallbacks,
): Range<Decoration> {
  return Decoration.widget({
    block: true,
    side: -1,
    widget: new ChapterTitleWidget(model, callbacks),
  }).range(anchor);
}

function isChapterWidgetDecoration(
  decoration: Decoration,
  chapterId: string,
): boolean {
  const widget = decoration.spec.widget;
  return widget instanceof ChapterTitleWidget && widget.chapterId === chapterId;
}

class ChapterTitleWidget extends WidgetType {
  constructor(
    private readonly model: ChapterEditorWidgetModel,
    private readonly callbacks: ChapterWidgetCallbacks,
  ) {
    super();
  }

  get chapterId(): string {
    return this.model.chapterId;
  }

  override eq(other: ChapterTitleWidget): boolean {
    return sameChapterEditorWidgetModel(this.model, other.model);
  }

  override toDOM(): HTMLElement {
    const root = document.createElement('section');
    root.className = 'cm-chapter-widget';
    root.dataset.chapterId = this.model.chapterId;
    root.tabIndex = -1;
    root.setAttribute('aria-label', `章节 ${this.model.order}：${this.model.displayTitle}`);

    const header = document.createElement('div');
    header.className = 'cm-chapter-widget__header';
    root.append(header);

    const order = document.createElement('span');
    order.className = 'cm-chapter-widget__order';
    order.textContent = String(this.model.order);
    header.append(order);

    const title = document.createElement('strong');
    title.className = `cm-chapter-widget__title${this.model.anomaly ? ' cm-chapter-widget__warning' : ''}`;
    title.textContent = `${this.model.anomaly ? '⚠ ' : ''}${this.model.displayTitle}`;
    header.append(title);

    const controls = document.createElement('div');
    controls.className = 'cm-chapter-widget__controls';
    controls.append(
      this.createControlGroup(root, 'upper', '章首', this.model.disabledActions.upper),
      this.createControlGroup(root, 'lower', '正文', this.model.disabledActions.lower),
    );
    header.append(controls, this.createStructureMenu(root));

    if (this.model.anomaly)
      root.append(this.createAnomalyRow(root));
    return root;
  }

  override ignoreEvent(): boolean {
    return true;
  }

  override get estimatedHeight(): number {
    return this.model.anomaly ? 66 : 38;
  }

  private createAnomalyRow(root: HTMLElement): HTMLElement {
    const anomaly = this.model.anomaly!;
    const row = document.createElement('div');
    row.className = 'cm-chapter-widget__anomaly';
    row.dataset.anomalyKind = anomaly.kind;
    const reason = document.createElement('span');
    reason.className = 'cm-chapter-widget__anomaly-reason';
    reason.textContent = anomaly.reason.includes('字')
      ? anomaly.reason
      : `${anomaly.reason} · ${anomaly.codePointCount} 字`;
    row.append(reason);
    const accept = document.createElement('button');
    accept.type = 'button';
    accept.className = 'cm-chapter-widget__accept-anomaly';
    accept.disabled = this.model.disabled;
    accept.textContent = '✓ 标记正常';
    accept.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.callbacks.onAcceptAnomaly(this.model.chapterId);
      root.focus();
    });
    row.append(accept);
    return row;
  }

  private createControlGroup(
    root: HTMLElement,
    boundary: BoundaryShiftIntent['boundary'],
    label: string,
    disabledActions: DisabledBoundaryActions,
  ): HTMLElement {
    const group = document.createElement('div');
    group.className = 'cm-chapter-widget__control-group';
    group.setAttribute('aria-label', boundary === 'upper' ? '上边界' : '下边界');
    group.setAttribute('role', 'group');
    const groupLabel = document.createElement('span');
    groupLabel.className = 'cm-chapter-widget__control-label';
    groupLabel.textContent = label;
    group.append(groupLabel);
    const actions: ReadonlyArray<{ action: BoundaryShiftAction; glyph: string; label: string }> = [
      { action: 'fast-backward', glyph: '«', label: '快退' },
      { action: 'backward', glyph: '‹', label: '退' },
      { action: 'forward', glyph: '›', label: '进' },
      { action: 'fast-forward', glyph: '»', label: '快进' },
    ];
    for (const item of actions) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'cm-chapter-widget__button';
      button.disabled = this.model.disabled || disabledActions[item.action];
      button.setAttribute('aria-label', item.label);
      button.title = `${label}${item.label}`;
      button.textContent = item.glyph;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (!button.disabled) {
          this.callbacks.onShift(this.model.chapterId, {
            boundary,
            ...BOUNDARY_SHIFT_INTENTS[item.action],
          });
          root.focus();
        }
      });
      group.append(button);
    }
    return group;
  }

  private createStructureMenu(root: HTMLElement): HTMLElement {
    const menu = document.createElement('div');
    menu.className = 'cm-chapter-widget__structure-menu';
    menu.setAttribute('aria-label', '章节结构操作');
    menu.setAttribute('role', 'group');
    const items: ReadonlyArray<{
      direction?: ChapterMergeDirection;
      disabled: boolean;
      label: string;
    }> = [
      { direction: 'previous', disabled: !this.model.canMergePrevious, label: '并入上一章' },
      { direction: 'next', disabled: !this.model.canMergeNext, label: '并入下一章' },
      { disabled: false, label: '删除章节识别' },
    ];
    for (const item of items) {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = `cm-chapter-widget__structure-action${item.direction ? '' : ' cm-chapter-widget__structure-action--delete'}`;
      button.disabled = this.model.disabled || item.disabled;
      button.textContent = item.label;
      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.disabled)
          return;
        if (item.direction)
          this.callbacks.onMerge(this.model.chapterId, item.direction);
        else
          this.callbacks.onDelete(this.model.chapterId);
        root.focus();
      });
      menu.append(button);
    }
    menu.addEventListener('keydown', event => moveMenuFocus(menu, event));
    return menu;
  }
}

function createActionTooltip(
  position: number,
  callbacks: ChapterActionMenuCallbacks,
): Tooltip {
  return {
    pos: position,
    above: false,
    strictSide: true,
    create: (view) => {
      const dom = document.createElement('div');
      dom.className = 'cm-chapter-action-menu';
      dom.setAttribute('aria-label', '当前位置操作');
      dom.setAttribute('aria-orientation', 'vertical');
      dom.setAttribute('role', 'menu');
      const addRecognition = createMenuButton('添加章节识别', () => {
        callbacks.onAddRecognition(position);
        clearChapterAction(view);
      });
      const insertLineBreak = createMenuButton('添加换行', () => {
        callbacks.onInsertLineBreak(position);
        clearChapterAction(view);
      });
      insertLineBreak.disabled = !callbacks.canInsertLineBreak(position);
      dom.append(addRecognition, insertLineBreak);
      dom.addEventListener('keydown', (event) => {
        if (event.key !== 'Escape') {
          moveMenuFocus(dom, event);
          return;
        }
        event.preventDefault();
        event.stopPropagation();
        closeActionTooltip(view);
      });
      return {
        dom,
      };
    },
  };
}

function createMenuButton(label: string, action: () => void): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-chapter-action-menu__button';
  button.setAttribute('role', 'menuitem');
  button.textContent = label;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!button.disabled)
      action();
  });
  return button;
}

function moveMenuFocus(menu: HTMLElement, event: KeyboardEvent): void {
  const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')];
  if (buttons.length === 0)
    return;
  const currentIndex = buttons.findIndex(button => button === document.activeElement);
  let nextIndex: number | undefined;
  if (event.key === 'ArrowDown' || event.key === 'ArrowRight')
    nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % buttons.length;
  else if (event.key === 'ArrowUp' || event.key === 'ArrowLeft')
    nextIndex = (currentIndex <= 0 ? buttons.length : currentIndex) - 1;
  else if (event.key === 'Home')
    nextIndex = 0;
  else if (event.key === 'End')
    nextIndex = buttons.length - 1;
  if (nextIndex === undefined)
    return;
  event.preventDefault();
  event.stopPropagation();
  buttons[nextIndex]?.focus();
}

function closeActionTooltip(
  view: EditorView,
  field?: StateField<ChapterActionState>,
): boolean {
  const isOpen = field ? view.state.field(field).position !== null : true;
  if (!isOpen)
    return false;
  view.dispatch({ effects: setChapterActionGap.of(null) });
  view.focus();
  return true;
}

function clearChapterAction(view: EditorView): void {
  view.dispatch({ effects: setChapterActionGap.of(null) });
  view.focus();
}

function sameAnomaly(
  left: ChapterLengthAnomaly | undefined,
  right: ChapterLengthAnomaly | undefined,
): boolean {
  return left === undefined
    ? right === undefined
    : right !== undefined
      && left.kind === right.kind
      && left.codePointCount === right.codePointCount
      && left.reason === right.reason;
}

export function sameChapterEditorWidgetModel(
  left: ChapterEditorWidgetModel,
  right: ChapterEditorWidgetModel,
): boolean {
  return left.chapterId === right.chapterId
    && left.order === right.order
    && left.displayTitle === right.displayTitle
    && left.disabled === right.disabled
    && left.canMergePrevious === right.canMergePrevious
    && left.canMergeNext === right.canMergeNext
    && sameAnomaly(left.anomaly, right.anomaly)
    && sameDisabledActions(left.disabledActions.upper, right.disabledActions.upper)
    && sameDisabledActions(left.disabledActions.lower, right.disabledActions.lower);
}

function sameDisabledActions(
  left: DisabledBoundaryActions,
  right: DisabledBoundaryActions,
): boolean {
  return left['fast-backward'] === right['fast-backward']
    && left.backward === right.backward
    && left.forward === right.forward
    && left['fast-forward'] === right['fast-forward'];
}
