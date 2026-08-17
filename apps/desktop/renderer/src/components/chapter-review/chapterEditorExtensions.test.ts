import type { ChapterDto } from '@voxweaver/contracts';
import type { ChapterEditorDecorationModel } from './chapterEditorExtensions';

import { EditorState } from '@codemirror/state';
import { EditorView, lineNumbers } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChapterActionMenu,
  createChapterEditorDecorations,
  setChapterActionGap,
  setChapterEditorDecorationModel,
  updateChapterEditorWidgets,
} from './chapterEditorExtensions';
import {
  chapterEditorFoldSnapshots,
  ensureChapterEditorRangeVisible,
} from './chapterEditorFolding';
import {
  createChapterEditorModel,
  parseChapterEditorLines,
} from './chapterEditorModel';

describe('chapter editor extensions', () => {
  let view: EditorView | undefined;
  let parent: HTMLDivElement | undefined;

  afterEach(() => {
    view?.destroy();
    parent?.remove();
    view = undefined;
    parent = undefined;
  });

  it('全文不折叠，widget 提供边界、异常与章节结构操作', () => {
    const text = numberedLines(8);
    const lines = parseChapterEditorLines(text);
    const baseDocument = createChapterEditorModel(text, []);
    const model: ChapterEditorDecorationModel = {
      document: {
        ...baseDocument,
        chapterLayouts: [
          {
            chapterId: 'chapter-1',
            widgetAnchor: { from: lines[0]!.from, lineNumber: 1 },
            headingLineFroms: [lines[0]!.from],
            contentStartLineFrom: lines[1]!.from,
          },
          {
            chapterId: 'chapter-2',
            widgetAnchor: { from: lines[4]!.from, lineNumber: 5 },
            headingLineFroms: [],
            contentStartLineFrom: lines[4]!.from,
          },
        ],
        hiddenRanges: [],
      },
      unassignedRanges: [],
      widgets: [
        {
          chapterId: 'chapter-1',
          disabled: false,
          disabledActions: {
            upper: disabledActions(),
            lower: { ...disabledActions(), forward: false },
          },
          displayTitle: '第一章',
          order: 1,
          canMergePrevious: false,
          canMergeNext: true,
        },
        {
          anomaly: {
            chapterId: 'chapter-2',
            codePointCount: 0,
            kind: 'empty',
            reason: '无正文',
          },
          chapterId: 'chapter-2',
          disabled: false,
          disabledActions: {
            upper: disabledActions(),
            lower: disabledActions(),
          },
          displayTitle: '未命名章节 1',
          order: 2,
          canMergePrevious: true,
          canMergeNext: false,
        },
      ],
    };
    const callbacks = {
      onAcceptAnomaly: vi.fn(),
      onDelete: vi.fn(),
      onMerge: vi.fn(),
      onShift: vi.fn(),
    };
    parent = document.body.appendChild(document.createElement('div'));
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [lineNumbers(), createChapterEditorDecorations(model, callbacks)],
      }),
    });

    expect(view.state.doc.lines).toBe(8);
    expect(parent.querySelector('.cm-hidden-lines-widget')).toBeNull();
    expect(visibleLineNumbers(parent)).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
    expect(parent.querySelector('[data-chapter-id="chapter-2"] .cm-chapter-widget__title')?.textContent)
      .toBe('⚠ 未命名章节 1');
    expect(parent.querySelector('.cm-chapter-widget__anomaly-reason')?.textContent)
      .toBe('无正文 · 0 字');

    parent.querySelector<HTMLButtonElement>('.cm-chapter-widget__accept-anomaly')?.click();
    expect(callbacks.onAcceptAnomaly).toHaveBeenCalledWith('chapter-2');

    const beforeDocument = view.state.doc;
    const beforeFirstWidget = parent.querySelector('[data-chapter-id="chapter-1"]');
    const beforeSecondWidget = parent.querySelector('[data-chapter-id="chapter-2"]');
    const { anomaly, ...acceptedWidget } = model.widgets[1]!;
    expect(anomaly).toBeDefined();
    view.dispatch({ effects: updateChapterEditorWidgets.of([acceptedWidget]) });
    expect(view.state.doc).toBe(beforeDocument);
    expect(parent.querySelector('[data-chapter-id="chapter-1"]')).toBe(beforeFirstWidget);
    expect(parent.querySelector('[data-chapter-id="chapter-2"]')).not.toBe(beforeSecondWidget);
    expect(parent.querySelector('[data-chapter-id="chapter-2"] .cm-chapter-widget__anomaly'))
      .toBeNull();

    parent.querySelector<HTMLButtonElement>(
      '[data-chapter-id="chapter-1"] [aria-label="下边界"] [aria-label="进"]',
    )?.click();
    expect(callbacks.onShift).toHaveBeenCalledWith('chapter-1', {
      boundary: 'lower',
      direction: 'forward',
      lineCount: 1,
    });

    const firstMenu = parent.querySelector<HTMLElement>(
      '[data-chapter-id="chapter-1"] .cm-chapter-widget__structure-menu',
    )!;
    expect(parent.querySelector(
      '[data-chapter-id="chapter-1"] .cm-chapter-widget__header > .cm-chapter-widget__controls',
    )).not.toBeNull();
    expect(parent.querySelector('.cm-chapter-widget__line')).toBeNull();
    const structureButtons = [...firstMenu.querySelectorAll<HTMLButtonElement>('button')];
    expect(structureButtons.map(button => button.textContent)).toEqual([
      '并入上一章',
      '并入下一章',
      '删除章节识别',
    ]);
    expect(structureButtons[0]?.disabled).toBe(true);
    expect(structureButtons[1]?.disabled).toBe(false);
    structureButtons[1]?.click();
    expect(callbacks.onMerge).toHaveBeenCalledWith('chapter-1', 'next');

    structureButtons[2]?.click();
    expect(callbacks.onDelete).toHaveBeenCalledWith('chapter-1');
  });

  it('精确位置右键菜单垂直显示候选项并支持禁用换行、动作与 Escape', () => {
    const text = '第一行\n第二行';
    const position = text.indexOf('二') + 1;
    const callbacks = {
      canInsertLineBreak: vi.fn().mockReturnValue(false),
      onAddRecognition: vi.fn(),
      onInsertLineBreak: vi.fn(),
    };
    parent = document.body.appendChild(document.createElement('div'));
    view = new EditorView({
      parent,
      state: EditorState.create({
        doc: text,
        extensions: [createChapterActionMenu(callbacks)],
      }),
    });

    view.dispatch({ effects: setChapterActionGap.of(position) });

    const menu = parent.querySelector<HTMLElement>('.cm-chapter-action-menu')!;
    expect(parent.querySelector('.cm-chapter-action-marker')).toBeNull();
    expect(menu.getAttribute('aria-orientation')).toBe('vertical');
    const buttons = [...menu.querySelectorAll<HTMLButtonElement>('button')];
    expect(buttons.map(button => button.textContent)).toEqual(['添加章节识别', '添加换行']);
    expect(buttons[1]?.disabled).toBe(true);
    expect(callbacks.canInsertLineBreak).toHaveBeenCalledWith(position);
    buttons[0]?.click();
    expect(callbacks.onAddRecognition).toHaveBeenCalledWith(position);
    expect(parent.querySelector('.cm-chapter-action-menu')).toBeNull();

    view.dispatch({ effects: setChapterActionGap.of(position) });
    const reopened = parent.querySelector<HTMLElement>('.cm-chapter-action-menu')!;
    reopened.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
    expect(parent.querySelector('.cm-chapter-action-menu')).toBeNull();
    expect(view.hasFocus).toBe(true);
  });

  it('折叠正文中段，支持双侧单击、键盘、全部展开和重新折叠', () => {
    const text = chapterText(16);
    const model = foldingDecorationModel(text, [sourceChapter(text, 'chapter-1', 1, 2)]);
    ({ parent, view } = createEditor(text, model));

    expect(parent.querySelector('.cm-chapter-fold')?.textContent).toContain('隐藏 6 行');
    expect(visibleEditorLines(parent)).toEqual([
      '第一章',
      'line 1',
      'line 2',
      'line 3',
      'line 4',
      'line 5',
      'line 12',
      'line 13',
      'line 14',
      'line 15',
      'line 16',
    ]);

    const top = parent.querySelector<HTMLButtonElement>('.cm-chapter-fold__edge--top')!;
    top.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientY: 100,
    }));
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, clientY: 100 }));
    expect(parent.querySelector('.cm-chapter-fold')?.textContent).toContain('隐藏 1 行');

    const bottom = parent.querySelector<HTMLButtonElement>('.cm-chapter-fold__edge--bottom')!;
    view.scrollDOM.scrollTop = 20;
    const bottomTextTop = blockScreenTop(view, model.document.hiddenRanges[0]!.to);
    bottom.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'Enter',
    }));
    expect(blockScreenTop(view, model.document.hiddenRanges[0]!.to)).toBeCloseTo(bottomTextTop);
    expect(parent.querySelector('.cm-chapter-fold')).toBeNull();
    expect(parent.querySelector('.cm-chapter-refold__button')?.textContent).toBe('重新折叠');
    expect(visibleEditorLines(parent)).toEqual(['第一章', ...numberedLineArray(16)]);

    parent.querySelector<HTMLButtonElement>('.cm-chapter-refold__button')?.click();
    expect(parent.querySelector('.cm-chapter-fold')?.textContent).toContain('隐藏 6 行');
    parent.querySelector<HTMLButtonElement>('.cm-chapter-fold__expand-all')?.click();
    expect(parent.querySelector('.cm-chapter-fold')).toBeNull();
    expect(parent.querySelector('.cm-chapter-refold__button')).not.toBeNull();
  });

  it('上下边缘拖动时固定对应侧正文并让折叠条移动', () => {
    const text = chapterText(20);
    const model = foldingDecorationModel(text, [sourceChapter(text, 'chapter-1', 1, 2)]);
    ({ parent, view } = createEditor(text, model));
    const lineHeight = view.defaultLineHeight;
    const lines = model.document.lines;
    const defaultRange = model.document.hiddenRanges[0]!;
    view.scrollDOM.scrollTop = 3 * lineHeight;

    const initialBottomTextTop = blockScreenTop(view, defaultRange.to);
    const initialScrollTop = view.scrollDOM.scrollTop;
    dragFoldEdge(parent, 'bottom', lineHeight);
    expect(foldSnapshot(view)).toMatchObject({ hiddenLineCount: 10 });
    expect(blockScreenTop(view, defaultRange.to)).toBeCloseTo(initialBottomTextTop);
    expect(view.scrollDOM.scrollTop).toBe(initialScrollTop);

    const upperTextTop = blockScreenTop(view, lines[1]!.from);
    const widgetTopBeforeTopDrag = foldWidgetScreenTop(view);
    const scrollTopBeforeTopDrag = view.scrollDOM.scrollTop;

    dragFoldEdge(parent, 'top', 2 * lineHeight);
    expect(foldSnapshot(view)).toMatchObject({ hiddenLineCount: 8 });
    expect(blockScreenTop(view, lines[1]!.from)).toBeCloseTo(upperTextTop);
    expect(view.scrollDOM.scrollTop).toBe(scrollTopBeforeTopDrag);
    expect(foldWidgetScreenTop(view)).toBeGreaterThan(widgetTopBeforeTopDrag);
    dragFoldEdge(parent, 'top', -lineHeight);
    expect(foldSnapshot(view)).toMatchObject({ hiddenLineCount: 9 });

    const bottomTextTop = blockScreenTop(view, defaultRange.to);
    const widgetTopBeforeBottomDrag = foldWidgetScreenTop(view);
    const scrollTopBeforeBottomDrag = view.scrollDOM.scrollTop;
    dragFoldEdgeMoves(parent, 'bottom', [-lineHeight, -2 * lineHeight]);
    expect(foldSnapshot(view)).toMatchObject({ hiddenLineCount: 7 });
    expect(blockScreenTop(view, defaultRange.to)).toBeCloseTo(bottomTextTop);
    expect(view.scrollDOM.scrollTop).not.toBe(scrollTopBeforeBottomDrag);
    expect(foldWidgetScreenTop(view)).toBeLessThan(widgetTopBeforeBottomDrag);
    dragFoldEdge(parent, 'bottom', lineHeight);
    expect(foldSnapshot(view)).toMatchObject({ hiddenLineCount: 8 });
    expect(blockScreenTop(view, defaultRange.to)).toBeCloseTo(bottomTextTop);
  });

  it('拖动状态按可移动方向设置光标类并在 mouseup 后清理', () => {
    const text = chapterText(20);
    const model = foldingDecorationModel(text, [sourceChapter(text, 'chapter-1', 1, 2)]);
    ({ parent, view } = createEditor(text, model));
    const top = parent.querySelector<HTMLButtonElement>('.cm-chapter-fold__edge--top')!;
    const bottom = parent.querySelector<HTMLButtonElement>('.cm-chapter-fold__edge--bottom')!;
    const root = parent.querySelector<HTMLElement>('.cm-chapter-fold')!;

    expect(top.classList.contains('canMoveTop')).toBe(false);
    expect(top.classList.contains('canMoveBottom')).toBe(true);
    expect(bottom.classList.contains('canMoveTop')).toBe(true);
    expect(bottom.classList.contains('canMoveBottom')).toBe(false);

    top.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientY: 100,
    }));
    expect(top.classList.contains('dragging')).toBe(true);
    expect(root.classList.contains('dragging')).toBe(true);
    expect(view.dom.classList.contains('cm-chapter-folding-dragging')).toBe(true);
    expect(view.dom.classList.contains('cm-chapter-folding-can-move-top')).toBe(false);
    expect(view.dom.classList.contains('cm-chapter-folding-can-move-bottom')).toBe(true);

    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientY: 100 + 2 * view.defaultLineHeight,
    }));
    expect(view.dom.classList.contains('cm-chapter-folding-can-move-top')).toBe(true);
    expect(view.dom.classList.contains('cm-chapter-folding-can-move-bottom')).toBe(true);
    window.dispatchEvent(new MouseEvent('mouseup', { bubbles: true }));

    expect(top.classList.contains('dragging')).toBe(false);
    expect(root.classList.contains('dragging')).toBe(false);
    expect(view.dom.classList.contains('cm-chapter-folding-dragging')).toBe(false);
    expect(view.dom.classList.contains('cm-chapter-folding-can-move-top')).toBe(false);
    expect(view.dom.classList.contains('cm-chapter-folding-can-move-bottom')).toBe(false);
  });

  it('拖动中文档模型变化会立即清理全局监听和拖动状态', () => {
    const text = chapterText(20);
    const chapter = sourceChapter(text, 'chapter-1', 1, 2);
    const model = foldingDecorationModel(text, [chapter]);
    ({ parent, view } = createEditor(text, model));
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const top = parent.querySelector<HTMLButtonElement>('.cm-chapter-fold__edge--top')!;
    const root = parent.querySelector<HTMLElement>('.cm-chapter-fold')!;
    top.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientY: 100,
    }));

    const rebuilt = foldingDecorationModel(text, [{
      ...chapter,
      lengthAnomalyAccepted: true,
    }]);
    view.dispatch({ effects: setChapterEditorDecorationModel.of(rebuilt) });

    expect(removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    expect(top.classList.contains('dragging')).toBe(false);
    expect(root.classList.contains('dragging')).toBe(false);
    expect(view.dom.classList.contains('cm-chapter-folding-dragging')).toBe(false);
  });

  it('销毁编辑器时清理尚未结束的全局拖动监听', () => {
    const text = chapterText(20);
    const model = foldingDecorationModel(text, [sourceChapter(text, 'chapter-1', 1, 2)]);
    ({ parent, view } = createEditor(text, model));
    const removeEventListener = vi.spyOn(window, 'removeEventListener');
    const top = parent.querySelector<HTMLButtonElement>('.cm-chapter-fold__edge--top')!;
    top.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      clientY: 100,
    }));

    view.destroy();
    view = undefined;
    expect(removeEventListener).toHaveBeenCalledWith('mousemove', expect.any(Function));
    expect(removeEventListener).toHaveBeenCalledWith('mouseup', expect.any(Function));
    expect(parent.querySelector('.cm-editor')).toBeNull();
  });

  it('普通模型重建和范围扩大保留隐藏锚点，范围收缩时按前后五行夹紧', () => {
    const text = numberedLines(30);
    const initialChapter = sourceChapter(text, 'chapter-1', 1, 5, 25);
    const initialModel = foldingDecorationModel(text, [initialChapter]);
    ({ parent, view } = createEditor(text, initialModel));
    dragFoldEdge(parent, 'top', 2 * view.defaultLineHeight);
    const adjusted = foldSnapshot(view);

    const ordinaryRebuild = foldingDecorationModel(text, [{
      ...initialChapter,
      lengthAnomalyAccepted: true,
    }]);
    view.dispatch({ effects: setChapterEditorDecorationModel.of(ordinaryRebuild) });
    expect(foldSnapshot(view)).toEqual(adjusted);

    const expandedRange = foldingDecorationModel(text, [sourceChapter(
      text,
      'chapter-1',
      1,
      2,
      29,
    )]);
    view.dispatch({ effects: setChapterEditorDecorationModel.of(expandedRange) });
    expect(foldSnapshot(view)).toEqual(adjusted);

    const contractedRange = foldingDecorationModel(text, [sourceChapter(
      text,
      'chapter-1',
      1,
      13,
      25,
    )]);
    view.dispatch({ effects: setChapterEditorDecorationModel.of(contractedRange) });
    expect(foldSnapshot(view)).toMatchObject({
      from: contractedRange.document.hiddenRanges[0]?.from,
      to: contractedRange.document.hiddenRanges[0]?.to,
    });
  });

  it('整篇替换形式插入换行时映射锚点，新增、删除和合并只影响对应章节状态', () => {
    const text = [chapterText(20), '第二章', ...numberedLineArray(20, 'second')].join('\n');
    const lines = parseChapterEditorLines(text);
    const secondHeadingLine = 22;
    const chapters = [
      sourceChapter(text, 'chapter-1', 1, 2, secondHeadingLine),
      sourceChapter(text, 'chapter-2', secondHeadingLine, secondHeadingLine + 1),
    ];
    const initialModel = foldingDecorationModel(text, [chapters[0]!]);
    ({ parent, view } = createEditor(text, initialModel));
    const before = foldSnapshot(view);
    const insertionPosition = lines[3]!.from;
    const changedText = `${text.slice(0, insertionPosition)}新增行\n${text.slice(insertionPosition)}`;
    const insertedByteLength = new TextEncoder().encode('新增行\n').byteLength;
    const changedFirst = {
      ...chapters[0]!,
      contentRange: {
        ...chapters[0]!.contentRange,
        endByte: chapters[0]!.contentRange.endByte + insertedByteLength,
      },
    };
    const changedSecond = shiftChapter(chapters[1]!, insertedByteLength);
    const changedModel = foldingDecorationModel(changedText, [changedFirst, changedSecond]);
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: changedText },
      effects: setChapterEditorDecorationModel.of(changedModel),
    });

    const afterInsertion = chapterEditorFoldSnapshots(view);
    expect(afterInsertion.map(region => region.chapterId)).toEqual(['chapter-1', 'chapter-2']);
    expect(afterInsertion[0]).toMatchObject({
      from: before.from + '新增行\n'.length,
      to: before.to + '新增行\n'.length,
      hiddenLineCount: before.hiddenLineCount,
    });

    const mergedFirst = {
      ...changedFirst,
      contentRange: {
        ...changedFirst.contentRange,
        endByte: new TextEncoder().encode(changedText).byteLength,
      },
    };
    const mergedModel = foldingDecorationModel(changedText, [mergedFirst]);
    view.dispatch({ effects: setChapterEditorDecorationModel.of(mergedModel) });
    expect(chapterEditorFoldSnapshots(view)).toEqual([afterInsertion[0]]);

    const deletedModel = foldingDecorationModel(changedText, [changedSecond]);
    view.dispatch({ effects: setChapterEditorDecorationModel.of(deletedModel) });
    expect(chapterEditorFoldSnapshots(view).map(region => region.chapterId)).toEqual([
      'chapter-2',
    ]);
  });

  it('搜索命中隐藏正文时从较近一侧同步展开到命中行', () => {
    const text = chapterText(20);
    const model = foldingDecorationModel(text, [sourceChapter(text, 'chapter-1', 1, 2)]);
    ({ parent, view } = createEditor(text, model));
    const lines = parseChapterEditorLines(text);

    expect(ensureChapterEditorRangeVisible(
      view,
      lines[7]!.from,
    )).toBe(true);
    expect(foldSnapshot(view)).toMatchObject({
      from: lines[8]!.from,
      hiddenLineCount: 8,
    });
    expect(ensureChapterEditorRangeVisible(
      view,
      lines[2]!.from,
      lines[2]!.to,
    )).toBe(false);

    parent.querySelector<HTMLButtonElement>('.cm-chapter-fold__expand-all')?.click();
    parent.querySelector<HTMLButtonElement>('.cm-chapter-refold__button')?.click();
    expect(ensureChapterEditorRangeVisible(
      view,
      lines[15]!.from,
      lines[15]!.to,
    )).toBe(true);
    expect(foldSnapshot(view)).toMatchObject({
      to: lines[15]!.from,
      hiddenLineCount: 9,
    });
  });
});

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');
}

function chapterText(bodyLineCount: number): string {
  return ['第一章', ...numberedLineArray(bodyLineCount)].join('\n');
}

function numberedLineArray(count: number, prefix = 'line'): string[] {
  return Array.from({ length: count }, (_, index) => `${prefix} ${index + 1}`);
}

function disabledActions() {
  return {
    'fast-backward': true,
    'backward': true,
    'forward': true,
    'fast-forward': true,
  } as const;
}

function sourceChapter(
  text: string,
  chapterId: string,
  headingLineNumber: number,
  contentStartLineNumber: number,
  contentEndLineExclusive?: number,
): ChapterDto {
  const lines = parseChapterEditorLines(text);
  const heading = lines[headingLineNumber - 1]!;
  const contentStart = lines[contentStartLineNumber - 1]!;
  const contentEndByte = contentEndLineExclusive === undefined
    ? lines.at(-1)!.endByte
    : lines[contentEndLineExclusive - 1]!.startByte;
  return {
    chapterId,
    order: 1,
    title: heading.text,
    headingKind: 'source',
    headingRange: {
      offsetUnit: 'utf8-byte',
      startByte: heading.startByte,
      endByte: heading.bodyEndByte,
    },
    contentRange: {
      offsetUnit: 'utf8-byte',
      startByte: contentStart.startByte,
      endByte: contentEndByte,
    },
    reviewStatus: 'pending',
    lengthAnomalyAccepted: false,
  };
}

function shiftChapter(chapter: ChapterDto, byteDelta: number): ChapterDto {
  return {
    ...chapter,
    ...(chapter.headingRange
      ? {
          headingRange: {
            ...chapter.headingRange,
            startByte: chapter.headingRange.startByte + byteDelta,
            endByte: chapter.headingRange.endByte + byteDelta,
          },
        }
      : {}),
    contentRange: {
      ...chapter.contentRange,
      startByte: chapter.contentRange.startByte + byteDelta,
      endByte: chapter.contentRange.endByte + byteDelta,
    },
  };
}

function foldingDecorationModel(
  text: string,
  chapters: readonly ChapterDto[],
): ChapterEditorDecorationModel {
  const document = createChapterEditorModel(text, chapters);
  return {
    document,
    unassignedRanges: [],
    widgets: chapters.map((chapter, index) => ({
      chapterId: chapter.chapterId,
      disabled: false,
      disabledActions: {
        upper: disabledActions(),
        lower: disabledActions(),
      },
      displayTitle: chapter.title,
      order: index + 1,
      canMergePrevious: index > 0,
      canMergeNext: index < chapters.length - 1,
    })),
  };
}

function createEditor(
  text: string,
  model: ChapterEditorDecorationModel,
): { readonly parent: HTMLDivElement; readonly view: EditorView } {
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text,
      extensions: [
        lineNumbers(),
        createChapterEditorDecorations(model, {
          onAcceptAnomaly: vi.fn(),
          onDelete: vi.fn(),
          onMerge: vi.fn(),
          onShift: vi.fn(),
        }),
      ],
    }),
  });
  return { parent, view };
}

function dragFoldEdge(
  parent: HTMLElement,
  edge: 'bottom' | 'top',
  deltaY: number,
): void {
  dragFoldEdgeMoves(parent, edge, [deltaY]);
}

function dragFoldEdgeMoves(
  parent: HTMLElement,
  edge: 'bottom' | 'top',
  deltaYs: readonly number[],
): void {
  const button = parent.querySelector<HTMLButtonElement>(`.cm-chapter-fold__edge--${edge}`)!;
  button.dispatchEvent(new MouseEvent('mousedown', {
    bubbles: true,
    button: 0,
    clientY: 100,
  }));
  for (const deltaY of deltaYs) {
    window.dispatchEvent(new MouseEvent('mousemove', {
      bubbles: true,
      clientY: 100 + deltaY,
    }));
  }
  const finalDeltaY = deltaYs.at(-1) ?? 0;
  window.dispatchEvent(new MouseEvent('mouseup', {
    bubbles: true,
    clientY: 100 + finalDeltaY,
  }));
}

function foldSnapshot(view: EditorView) {
  return chapterEditorFoldSnapshots(view)[0]!;
}

function blockScreenTop(view: EditorView, position: number): number {
  return view.lineBlockAt(position).top - view.scrollDOM.scrollTop;
}

function foldWidgetScreenTop(view: EditorView): number {
  return blockScreenTop(view, foldSnapshot(view).from);
}

function visibleLineNumbers(parent: HTMLElement): number[] {
  return [...parent.querySelectorAll<HTMLElement>('.cm-lineNumbers .cm-gutterElement')]
    .filter(element => element.style.visibility !== 'hidden')
    .map(element => element.textContent?.trim() ?? '')
    .filter(text => /^\d+$/.test(text))
    .map(Number);
}

function visibleEditorLines(parent: HTMLElement): string[] {
  return [...parent.querySelectorAll<HTMLElement>('.cm-line')]
    .map(line => line.textContent ?? '')
    .filter(Boolean);
}
