import type { ChapterStructureDraftChapter } from './chapterStructureDraftModel';

import { openSearchPanel } from '@codemirror/search';
import { EditorView } from '@codemirror/view';
import { mount } from '@vue/test-utils';
import { afterEach, describe, expect, it, vi } from 'vitest';
import ChapterCodeMirrorEditor from './ChapterCodeMirrorEditor.vue';
import { chapterEditorFoldSnapshots } from './chapterEditorFolding';
import { parseChapterEditorLines } from './chapterEditorModel';
import { characterOffsetToUtf8Byte } from './chapterStructureDraftModel';

describe('chapter CodeMirror editor', () => {
  const mountedWrappers: Array<ReturnType<typeof mount>> = [];

  afterEach(() => {
    for (const wrapper of mountedWrappers)
      wrapper.unmount();
    mountedWrappers.length = 0;
    vi.restoreAllMocks();
  });

  it('codemirror 保持只读写入但允许光标与文本选择', async () => {
    const text = numberedLines(30);
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [],
        chapters: [singleChapter(text)],
        text,
        unassignedRanges: [],
      },
    });
    mountedWrappers.push(wrapper);

    const editorDom = wrapper.get('.cm-editor').element as HTMLElement;
    const view = EditorView.findFromDOM(editorDom);

    expect(view).not.toBeNull();
    expect(view?.state.readOnly).toBe(true);
    expect(view?.lineWrapping).toBe(true);
    expect(view?.contentDOM.getAttribute('contenteditable')).toBe('true');
    expect(view?.contentDOM.getAttribute('aria-readonly')).toBe('true');
    expect(view?.state.doc.lines).toBe(30);

    view?.dispatch({
      changes: { from: 0, insert: '键入' },
      userEvent: 'input.type',
    });
    view?.dispatch({
      changes: { from: 0, insert: '粘贴' },
      userEvent: 'input.paste',
    });
    expect(view?.state.doc.toString()).toBe(text);

    const updatedText = `${text}\nline 31`;
    await wrapper.setProps({
      chapters: [singleChapter(updatedText)],
      text: updatedText,
    });
    expect(view?.state.doc.toString()).toBe(updatedText);
    expect(view?.state.doc.lines).toBe(31);

    view?.dispatch({ selection: { anchor: 1, head: 5 } });
    view?.focus();
    expect(view?.hasFocus).toBe(true);
    expect(view?.state.selection.main.from).toBe(1);
    expect(view?.state.selection.main.to).toBe(5);
  });

  it('正文右键在精确字符间隙打开垂直菜单，左键未命中和 Escape 会关闭', async () => {
    const text = '第一行\n第二行';
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [],
        chapters: [singleChapter(text)],
        text,
        unassignedRanges: [],
      },
    });
    mountedWrappers.push(wrapper);
    const view = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!;
    const targetLine = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[1]!;
    const exactPosition = text.indexOf('二') + 1;
    const positionSpy = vi.spyOn(view, 'posAtCoords').mockReturnValue(exactPosition);
    const contextMenu = new MouseEvent('contextmenu', {
      bubbles: true,
      button: 2,
      cancelable: true,
      clientX: 24,
      clientY: 30,
    });

    targetLine.dispatchEvent(contextMenu);

    expect(contextMenu.defaultPrevented).toBe(true);
    expect(positionSpy).toHaveBeenCalledWith({ x: 24, y: 30 });
    expect(view.state.selection.main.anchor).toBe(exactPosition);
    expect(view.hasFocus).toBe(true);
    expect(wrapper.find('.cm-chapter-action-marker').exists()).toBe(false);
    let menu = wrapper.get('.cm-chapter-action-menu');
    expect(menu.attributes('aria-orientation')).toBe('vertical');
    let buttons = menu.findAll<HTMLButtonElement>('button');
    expect(buttons.map(button => button.text())).toEqual(['添加章节识别', '添加换行']);
    expect(buttons[1]!.element.disabled).toBe(false);
    await menu.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[0]!.element);
    await menu.trigger('keydown', { key: 'ArrowDown' });
    expect(document.activeElement).toBe(buttons[1]!.element);

    await buttons[1]!.trigger('click');
    expect(wrapper.emitted('insertLineBreak')).toEqual([[exactPosition]]);
    expect(wrapper.find('.cm-chapter-action-menu').exists()).toBe(false);
    expect(view.hasFocus).toBe(true);

    const newlinePosition = text.indexOf('\n');
    positionSpy.mockReturnValue(newlinePosition);
    targetLine.dispatchEvent(editorContextMenu(16));
    menu = wrapper.get('.cm-chapter-action-menu');
    buttons = menu.findAll<HTMLButtonElement>('button');
    expect(buttons[1]!.element.disabled).toBe(true);
    await buttons[0]!.trigger('click');
    expect(wrapper.emitted('addRecognition')).toEqual([[newlinePosition]]);
    expect(view.hasFocus).toBe(true);

    positionSpy.mockReturnValue(exactPosition);
    targetLine.dispatchEvent(editorContextMenu());
    document.body.dispatchEvent(new MouseEvent('mousedown', {
      bubbles: true,
      button: 0,
      cancelable: true,
    }));
    expect(wrapper.find('.cm-chapter-action-menu').exists()).toBe(false);

    targetLine.dispatchEvent(editorContextMenu());
    view.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      cancelable: true,
      key: 'Escape',
    }));
    expect(wrapper.find('.cm-chapter-action-menu').exists()).toBe(false);
    expect(view.hasFocus).toBe(true);
  });

  it('搜索命中折叠正文时先从近侧展开，再选择并滚动匹配项', async () => {
    const text = ['第一章', ...Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1}`,
    )].join('\n');
    const lines = parseChapterEditorLines(text);
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [],
        chapters: [singleChapter(text)],
        text,
        unassignedRanges: [],
      },
    });
    mountedWrappers.push(wrapper);
    const view = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!;
    expect(chapterEditorFoldSnapshots(view)[0]).toMatchObject({
      from: lines[6]!.from,
      hiddenLineCount: 10,
      to: lines[16]!.from,
    });

    expect(openSearchPanel(view)).toBe(true);
    await Promise.resolve();
    await wrapper.get<HTMLInputElement>('.cm-chapter-search-panel__input').setValue('line 8');

    expect(view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    )).toBe('line 8');
    expect(chapterEditorFoldSnapshots(view)[0]).toMatchObject({
      from: lines[9]!.from,
      hiddenLineCount: 7,
      to: lines[16]!.from,
    });
    expect(wrapper.find('[name="replace"]').exists()).toBe(false);
  });

  it('受控插入换行使用最小文档事务并映射既有折叠锚点', async () => {
    const text = ['第一章', ...Array.from(
      { length: 20 },
      (_, index) => `line ${index + 1}`,
    )].join('\n');
    const lines = parseChapterEditorLines(text);
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [],
        chapters: [singleChapter(text)],
        text,
        unassignedRanges: [],
      },
    });
    mountedWrappers.push(wrapper);
    const view = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!;
    const before = chapterEditorFoldSnapshots(view)[0]!;
    const inserted = '新增行\n';
    const insertionPosition = lines[3]!.from;
    const updatedText = `${text.slice(0, insertionPosition)}${inserted}${text.slice(insertionPosition)}`;

    await wrapper.setProps({
      chapters: [singleChapter(updatedText)],
      text: updatedText,
    });

    expect(view.state.doc.toString()).toBe(updatedText);
    expect(chapterEditorFoldSnapshots(view)[0]).toMatchObject({
      from: before.from + inserted.length,
      hiddenLineCount: before.hiddenLineCount,
      to: before.to + inserted.length,
    });
  });

  it('兼容 CRLF/CR 视图位置，并将菜单 gap 映回原始字符位置', async () => {
    const text = '第一行\r\n第二行\r第三行';
    const normalizedText = '第一行\n第二行\n第三行';
    const secondLineStart = text.indexOf('第二行');
    const secondLineEnd = secondLineStart + '第二行'.length;
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [],
        chapters: [singleChapter(text)],
        text,
        unassignedRanges: [range(
          characterOffsetToUtf8Byte(text, secondLineStart),
          characterOffsetToUtf8Byte(text, secondLineEnd),
        )],
      },
    });
    mountedWrappers.push(wrapper);
    const view = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!;
    const targetLine = view.contentDOM.querySelectorAll<HTMLElement>('.cm-line')[1]!;
    const editorPosition = normalizedText.indexOf('第二行') + 1;
    const originalPosition = text.indexOf('第二行') + 1;
    const positionSpy = vi.spyOn(view, 'posAtCoords').mockReturnValue(editorPosition);

    expect(view.state.doc.toString()).toBe(normalizedText);
    expect(wrapper.get('.cm-chapter-unassigned').text()).toBe('第二行');

    targetLine.dispatchEvent(editorContextMenu());
    await wrapper.get('.cm-chapter-action-menu button').trigger('click');
    expect(wrapper.emitted('addRecognition')).toEqual([[originalPosition]]);

    targetLine.dispatchEvent(editorContextMenu());
    await wrapper.findAll('.cm-chapter-action-menu button')[1]!.trigger('click');
    expect(wrapper.emitted('insertLineBreak')).toEqual([[originalPosition]]);

    positionSpy.mockReturnValue(normalizedText.indexOf('\n') + 1);
    targetLine.dispatchEvent(editorContextMenu());
    expect(wrapper.findAll<HTMLButtonElement>('.cm-chapter-action-menu button')[1]!.element.disabled)
      .toBe(true);

    const updatedText = 'A\rB';
    await wrapper.setProps({
      chapters: [singleChapter(updatedText)],
      text: updatedText,
      unassignedRanges: [],
    });
    expect(view.state.doc.toString()).toBe('A\nB');
  });

  it('标记正常仅替换目标 widget 并复用正文投影', async () => {
    const text = 'T1\na1\nT2\n';
    const chapters = twoChapters(text);
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [{
          chapterId: 'chapter-2',
          codePointCount: 0,
          kind: 'empty',
          reason: '无正文',
        }],
        chapters,
        text,
        unassignedRanges: [],
      },
    });
    mountedWrappers.push(wrapper);
    const view = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!;
    const beforeDocument = view.state.doc;
    const beforeFirstWidget = wrapper.get('[data-chapter-id="chapter-1"]').element;
    const beforeSecondWidget = wrapper.get('[data-chapter-id="chapter-2"]').element;

    await wrapper.setProps({
      anomalies: [],
      chapters: chapters.map(chapter => chapter.draftId === 'chapter-2'
        ? { ...chapter, lengthAnomalyAccepted: true }
        : chapter),
    });

    expect(view.state.doc).toBe(beforeDocument);
    expect(wrapper.get('[data-chapter-id="chapter-1"]').element).toBe(beforeFirstWidget);
    expect(wrapper.get('[data-chapter-id="chapter-2"]').element).not.toBe(beforeSecondWidget);
    expect(wrapper.find('.cm-chapter-widget__accept-anomaly').exists()).toBe(false);
  });

  it('widget 提供异常接受、首尾结构状态，并暴露章节导航聚焦', async () => {
    const text = 'T1\na1\nT2\n';
    const chapters = twoChapters(text);
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [{
          chapterId: 'chapter-2',
          codePointCount: 0,
          kind: 'empty',
          reason: '无正文',
        }],
        chapters,
        text,
        unassignedRanges: [],
      },
    });
    mountedWrappers.push(wrapper);

    const firstWidget = wrapper.get('[data-chapter-id="chapter-1"]');
    const firstActions = firstWidget.findAll<HTMLButtonElement>('.cm-chapter-widget__structure-action');
    expect(firstActions.map(action => action.element.disabled)).toEqual([true, false, false]);
    expect(firstActions.map(action => action.text())).toEqual([
      '并入上一章',
      '并入下一章',
      '删除章节识别',
    ]);
    expect(firstWidget.find('.cm-chapter-widget__line').exists()).toBe(false);
    expect(firstWidget.find('.cm-chapter-widget__header > .cm-chapter-widget__controls').exists())
      .toBe(true);
    await firstWidget.get('.cm-chapter-widget__structure-menu').trigger('keydown', {
      key: 'ArrowRight',
    });
    expect(document.activeElement).toBe(firstActions[1]!.element);

    const secondWidget = wrapper.get('[data-chapter-id="chapter-2"]');
    const secondActions = secondWidget
      .findAll<HTMLButtonElement>('.cm-chapter-widget__structure-action');
    expect(secondActions.map(action => action.element.disabled)).toEqual([false, true, false]);
    await secondWidget.get('.cm-chapter-widget__accept-anomaly').trigger('click');
    expect(wrapper.emitted('acceptAnomaly')).toEqual([['chapter-2']]);

    const view = EditorView.findFromDOM(wrapper.get('.cm-editor').element as HTMLElement)!;
    const secondWidgetElement = secondWidget.element as HTMLElement;
    let animationFrameCallback: FrameRequestCallback | undefined;
    vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation((callback) => {
      animationFrameCallback = callback;
      return 41;
    });
    vi.spyOn(globalThis, 'cancelAnimationFrame').mockImplementation(() => {});
    secondWidgetElement.remove();
    view.focus();
    (wrapper.vm as unknown as { focusChapter: (chapterId: string) => void })
      .focusChapter('chapter-2');
    await Promise.resolve();
    expect(view.hasFocus).toBe(true);
    expect(animationFrameCallback).toBeTypeOf('function');

    view.contentDOM.append(secondWidgetElement);
    animationFrameCallback?.(0);
    expect(document.activeElement).toBe(secondWidgetElement);
  });

  it('首章章首向前移动时只发出主动章节的语义编辑', async () => {
    const text = `${[
      '书名',
      '作者',
      '简介一',
      '简介二',
      '简介三',
      '第一卷',
      '',
      '第一章 山边小村',
      '正文',
    ].join('\n')}\n`;
    const lines = parseChapterEditorLines(text);
    const heading = lines[7]!;
    const chapter: ChapterStructureDraftChapter = {
      draftId: 'chapter-1',
      existingChapterId: 'chapter-1',
      title: heading.text,
      headingKind: 'source',
      headingRange: range(heading.startByte, heading.bodyEndByte),
      contentRange: range(heading.endByte, lines.at(-1)!.endByte),
      lengthAnomalyAccepted: false,
    };
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [],
        chapters: [chapter],
        text,
        unassignedRanges: [],
      },
    });
    mountedWrappers.push(wrapper);

    const upperControls = wrapper.get('[aria-label="上边界"]');
    const fastBackward = upperControls.get<HTMLButtonElement>('button[aria-label="快退"]');
    const backward = upperControls.get<HTMLButtonElement>('button[aria-label="退"]');
    expect(fastBackward.element.disabled).toBe(false);
    expect(backward.element.disabled).toBe(false);

    await backward.trigger('click');
    expect(wrapper.emitted('boundaryEdit')).toEqual([[{
      chapterId: 'chapter-1',
      boundary: 'chapter-start',
      byteOffset: lines[6]!.startByte,
    }]]);
  });

  it('显式未归属范围会禁用将章节边界移入其中的操作', async () => {
    const text = 'T1\na1\nT2\na2\nT3\na3\n';
    const lines = parseChapterEditorLines(text);
    const chapters: readonly ChapterStructureDraftChapter[] = [
      {
        draftId: 'chapter-1',
        existingChapterId: 'chapter-1',
        title: 'T1',
        headingKind: 'source',
        headingRange: range(lines[0]!.startByte, lines[0]!.bodyEndByte),
        contentRange: range(lines[1]!.startByte, lines[1]!.endByte),
        lengthAnomalyAccepted: false,
      },
      {
        draftId: 'chapter-3',
        existingChapterId: 'chapter-3',
        title: 'T3',
        headingKind: 'source',
        headingRange: range(lines[4]!.startByte, lines[4]!.bodyEndByte),
        contentRange: range(lines[5]!.startByte, lines[5]!.endByte),
        lengthAnomalyAccepted: false,
      },
    ];
    const wrapper = mount(ChapterCodeMirrorEditor, {
      attachTo: document.body,
      props: {
        anomalies: [],
        chapters,
        text,
        unassignedRanges: [range(lines[1]!.endByte, lines[3]!.endByte)],
      },
    });
    mountedWrappers.push(wrapper);

    const thirdWidget = wrapper.get('[data-chapter-id="chapter-3"]');
    const upperControls = thirdWidget.findAll('.cm-chapter-widget__control-group')[0]!;
    const backward = upperControls.findAll<HTMLButtonElement>('button')[1]!;
    expect(backward.attributes('aria-label')).toBe('退');
    expect(backward.element.disabled).toBe(true);
    const mergePrevious = thirdWidget
      .findAll<HTMLButtonElement>('.cm-chapter-widget__structure-action')[0]!;
    expect(mergePrevious.text()).toBe('并入上一章');
    expect(mergePrevious.element.disabled).toBe(true);
  });
});

function numberedLines(count: number): string {
  return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');
}

function singleChapter(text: string): ChapterStructureDraftChapter {
  const lines = parseChapterEditorLines(text);
  const heading = lines[0]!;
  const contentStart = lines[1]!;
  return {
    draftId: 'chapter-1',
    existingChapterId: 'chapter-1',
    title: heading.text,
    headingKind: 'source',
    headingRange: range(heading.startByte, heading.bodyEndByte),
    contentRange: range(contentStart.startByte, lines.at(-1)!.endByte),
    lengthAnomalyAccepted: false,
  };
}

function twoChapters(text: string): readonly ChapterStructureDraftChapter[] {
  const lines = parseChapterEditorLines(text);
  return [
    {
      draftId: 'chapter-1',
      existingChapterId: 'chapter-1',
      title: 'T1',
      headingKind: 'source',
      headingRange: range(lines[0]!.startByte, lines[0]!.bodyEndByte),
      contentRange: range(lines[1]!.startByte, lines[1]!.endByte),
      lengthAnomalyAccepted: false,
    },
    {
      draftId: 'chapter-2',
      existingChapterId: 'chapter-2',
      title: 'T2',
      headingKind: 'source',
      headingRange: range(lines[2]!.startByte, lines[2]!.bodyEndByte),
      contentRange: range(lines[3]!.startByte, lines[3]!.endByte),
      lengthAnomalyAccepted: false,
    },
  ];
}

function range(startByte: number, endByte: number) {
  return { offsetUnit: 'utf8-byte' as const, startByte, endByte };
}

function editorContextMenu(clientX = 24): MouseEvent {
  return new MouseEvent('contextmenu', {
    bubbles: true,
    button: 2,
    cancelable: true,
    clientX,
    clientY: 30,
  });
}
