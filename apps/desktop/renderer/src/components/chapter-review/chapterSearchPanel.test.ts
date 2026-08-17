import type { ChapterSearchPanelController } from './chapterSearchPanel';

import {
  getSearchQuery,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import { EditorState } from '@codemirror/state';
import { EditorView } from '@codemirror/view';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createChapterSearchPanel } from './chapterSearchPanel';

describe('chapter search panel', () => {
  let controller: ChapterSearchPanelController | undefined;
  let parent: HTMLDivElement | undefined;
  let view: EditorView | undefined;

  afterEach(() => {
    controller?.destroy();
    view?.destroy();
    parent?.remove();
    controller = undefined;
    parent = undefined;
    view = undefined;
    vi.restoreAllMocks();
  });

  it('提供只读单行 Find Widget、选区预填和关闭焦点恢复', async () => {
    ({ controller, parent, view } = createEditor('beta alpha beta'));
    const betaFrom = view.state.doc.toString().indexOf('beta');
    view.dispatch({ selection: { anchor: betaFrom, head: betaFrom + 4 } });
    view.focus();

    keydown(view.contentDOM, 'f', modKey());
    await nextMicrotask();

    const panel = searchPanel(parent);
    const input = searchInput(panel);
    expect(panel.getAttribute('role')).toBe('dialog');
    expect(panel.getAttribute('aria-label')).toBe('查找');
    expect(input.type).toBe('text');
    expect(input.value).toBe('beta');
    expect(input.getAttribute('autocomplete')).toBe('off');
    expect(input.getAttribute('main-field')).toBe('true');
    expect(document.activeElement).toBe(input);
    expect(input.selectionStart).toBe(0);
    expect(input.selectionEnd).toBe(4);
    expect(getSearchQuery(view.state).search).toBe('beta');
    expect(panel.querySelector('[name="replace"]')).toBeNull();
    expect(panel.textContent).not.toContain('替换');
    expect([...panel.querySelectorAll('[aria-pressed]')].map(element => (
      element.getAttribute('aria-label')
    ))).toEqual(['区分大小写', '全词匹配', '使用正则表达式']);
    expect(panel.querySelector('[aria-label="上一个匹配项"]')).not.toBeNull();
    expect(panel.querySelector('[aria-label="下一个匹配项"]')).not.toBeNull();

    click(panel, '关闭查找');
    expect(parent.querySelector('.cm-chapter-search-panel')).toBeNull();
    expect(searchPanelOpen(view.state)).toBe(false);
    expect(view.hasFocus).toBe(true);
  });

  it('不把多行选区预填为查询', async () => {
    ({ controller, parent, view } = createEditor('alpha\nbeta'));
    view.dispatch({ selection: { anchor: 0, head: view.state.doc.length } });

    await openSearch(controller, view);

    expect(searchInput(searchPanel(parent)).value).toBe('');
    expect(getSearchQuery(view.state).search).toBe('');
  });

  it('即时查找并支持大小写、全词和正则选项', async () => {
    ({ controller, parent, view } = createEditor('alpha Alpha alphabet alpha'));
    await openSearch(controller, view);
    const panel = searchPanel(parent);
    const input = searchInput(panel);

    typeSearch(input, 'alpha');
    expect(searchStatus(panel).textContent).toBe('1 / 4');
    expect(view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    )).toBe('alpha');

    click(panel, '区分大小写');
    expect(getSearchQuery(view.state).caseSensitive).toBe(true);
    expect(searchStatus(panel).textContent).toBe('1 / 3');
    expect(button(panel, '区分大小写').getAttribute('aria-pressed')).toBe('true');

    click(panel, '全词匹配');
    expect(getSearchQuery(view.state).wholeWord).toBe(true);
    expect(searchStatus(panel).textContent).toBe('1 / 2');

    click(panel, '使用正则表达式');
    typeSearch(input, 'A[a-z]+');
    const query = getSearchQuery(view.state);
    expect(query.regexp).toBe(true);
    expect(query.caseSensitive).toBe(true);
    expect(query.wholeWord).toBe(true);
    expect(searchStatus(panel).textContent).toBe('1 / 1');
    expect(view.state.sliceDoc(
      view.state.selection.main.from,
      view.state.selection.main.to,
    )).toBe('Alpha');
  });

  it('区分无结果和非法正则状态并禁用导航', async () => {
    ({ controller, parent, view } = createEditor('alpha beta'));
    await openSearch(controller, view);
    const panel = searchPanel(parent);
    const input = searchInput(panel);

    click(panel, '使用正则表达式');
    typeSearch(input, '[');
    expect(panel.dataset.searchState).toBe('invalid');
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(searchStatus(panel).textContent).toBe('无效正则');
    expect(button(panel, '上一个匹配项').disabled).toBe(true);
    expect(button(panel, '下一个匹配项').disabled).toBe(true);

    click(panel, '使用正则表达式');
    expect(panel.dataset.searchState).toBe('no-results');
    expect(input.getAttribute('aria-invalid')).toBe('false');
    expect(searchStatus(panel).textContent).toBe('无结果');
    expect(input.classList).toContain('cm-chapter-search-panel__input--no-results');
  });

  it('计数达到配置上限时显示 19,999+ 且仍可导航', async () => {
    const text = Array.from({ length: 20_001 }).fill('x').join(' ');
    ({ controller, parent, view } = createEditor(text));
    await openSearch(controller, view);
    const panel = searchPanel(parent);

    typeSearch(searchInput(panel), 'x');

    expect(searchStatus(panel).textContent).toBe('1 / 19,999+');
    expect(searchStatus(panel).title).toContain('导航仍覆盖全文');
    expect(button(panel, '下一个匹配项').disabled).toBe(false);
    view.dispatch({ selection: { anchor: text.length } });
    button(panel, '下一个匹配项').click();
    expect(view.state.selection.main.from).toBe(0);
  });

  it('enter、Shift+Enter 和按钮循环导航并回调待展开行', async () => {
    const onRevealMatch = vi.fn();
    ({ controller, parent, view } = createEditor('one\ntwo one', { onRevealMatch }));
    await openSearch(controller, view);
    const panel = searchPanel(parent);
    const input = searchInput(panel);
    typeSearch(input, 'one');

    expect(view.state.selection.main.from).toBe(0);
    expect(onRevealMatch).toHaveBeenLastCalledWith(
      { from: 0, lineNumber: 1, to: 3 },
      view,
    );

    keydown(input, 'Enter');
    expect(view.state.selection.main.from).toBe(8);
    expect(searchStatus(panel).textContent).toBe('2 / 2');
    expect(onRevealMatch).toHaveBeenLastCalledWith(
      { from: 8, lineNumber: 2, to: 11 },
      view,
    );

    keydown(input, 'Enter');
    expect(view.state.selection.main.from).toBe(0);

    keydown(input, 'Enter', { shiftKey: true });
    expect(view.state.selection.main.from).toBe(8);

    click(panel, '上一个匹配项');
    expect(view.state.selection.main.from).toBe(0);
    click(panel, '下一个匹配项');
    expect(view.state.selection.main.from).toBe(8);
  });

  it('支持 Mod+F、F3、Shift+F3、Mod+G、Shift+Mod+G 和 Escape', async () => {
    ({ controller, parent, view } = createEditor('one two one'));
    view.dispatch({ selection: { anchor: 0, head: 3 } });
    view.focus();

    keydown(view.contentDOM, 'f', modKey());
    await nextMicrotask();
    let panel = searchPanel(parent);
    const input = searchInput(panel);
    expect(input.value).toBe('one');

    keydown(input, 'F3');
    expect(view.state.selection.main.from).toBe(8);
    keydown(input, 'F3', { shiftKey: true });
    expect(view.state.selection.main.from).toBe(0);
    keydown(input, 'g', modKey());
    expect(view.state.selection.main.from).toBe(8);
    keydown(input, 'g', { ...modKey(), shiftKey: true });
    expect(view.state.selection.main.from).toBe(0);

    keydown(input, 'Escape');
    expect(parent.querySelector('.cm-chapter-search-panel')).toBeNull();
    expect(view.hasFocus).toBe(true);

    keydown(view.contentDOM, 'f', modKey());
    await nextMicrotask();
    panel = searchPanel(parent);
    expect(document.activeElement).toBe(searchInput(panel));
  });

  it('文档和外部查询更新会即时刷新计数与控件', async () => {
    ({ controller, parent, view } = createEditor('alpha alpha'));
    await openSearch(controller, view);
    const panel = searchPanel(parent);
    typeSearch(searchInput(panel), 'alpha');
    expect(searchStatus(panel).textContent).toBe('1 / 2');

    view.dispatch({
      changes: {
        from: 0,
        to: view.state.doc.length,
        insert: 'alpha alpha alpha',
      },
    });
    expect(searchStatus(panel).textContent).toMatch(/\/ 3$/);

    view.dispatch({
      effects: setSearchQuery.of(new SearchQuery({
        search: 'ALPHA',
        caseSensitive: true,
      })),
    });
    expect(searchInput(panel).value).toBe('ALPHA');
    expect(button(panel, '区分大小写').getAttribute('aria-pressed')).toBe('true');
    expect(searchStatus(panel).textContent).toBe('无结果');

    controller.refresh(view);
    expect(panel.dataset.searchState).toBe('no-results');
  });

  it('destroy 关闭面板且句柄不可重新打开', async () => {
    ({ controller, parent, view } = createEditor('alpha'));
    await openSearch(controller, view);
    expect(parent.querySelector('.cm-chapter-search-panel')).not.toBeNull();

    controller.destroy();

    expect(parent.querySelector('.cm-chapter-search-panel')).toBeNull();
    expect(controller.open(view)).toBe(false);
  });
});

async function openSearch(
  controller: ChapterSearchPanelController,
  view: EditorView,
): Promise<void> {
  controller.open(view);
  await nextMicrotask();
}

async function nextMicrotask(): Promise<void> {
  await Promise.resolve();
}

function createEditor(
  doc: string,
  options: Parameters<typeof createChapterSearchPanel>[0] = {},
): {
  readonly controller: ChapterSearchPanelController;
  readonly parent: HTMLDivElement;
  readonly view: EditorView;
} {
  const controller = createChapterSearchPanel(options);
  const parent = document.body.appendChild(document.createElement('div'));
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc,
      extensions: [controller.extension],
    }),
  });
  return { controller, parent, view };
}

function searchPanel(parent: HTMLElement): HTMLElement {
  const panel = parent.querySelector<HTMLElement>('.cm-chapter-search-panel');
  if (!panel)
    throw new Error('找不到章节搜索面板。');
  return panel;
}

function searchInput(panel: HTMLElement): HTMLInputElement {
  const input = panel.querySelector<HTMLInputElement>('[aria-label="查找"]');
  if (!input)
    throw new Error('找不到章节搜索输入框。');
  return input;
}

function searchStatus(panel: HTMLElement): HTMLOutputElement {
  const status = panel.querySelector<HTMLOutputElement>('output');
  if (!status)
    throw new Error('找不到章节搜索计数。');
  return status;
}

function button(panel: HTMLElement, ariaLabel: string): HTMLButtonElement {
  const target = panel.querySelector<HTMLButtonElement>(`button[aria-label="${ariaLabel}"]`);
  if (!target)
    throw new Error(`找不到按钮：${ariaLabel}`);
  return target;
}

function click(panel: HTMLElement, ariaLabel: string): void {
  button(panel, ariaLabel).click();
}

function typeSearch(input: HTMLInputElement, value: string): void {
  input.value = value;
  input.dispatchEvent(new InputEvent('input', { bubbles: true }));
}

function keydown(
  target: HTMLElement,
  key: string,
  init: KeyboardEventInit = {},
): void {
  target.dispatchEvent(new KeyboardEvent('keydown', {
    bubbles: true,
    cancelable: true,
    key,
    ...init,
  }));
}

function modKey(): Pick<KeyboardEventInit, 'ctrlKey' | 'metaKey'> {
  return /Mac/.test(navigator.platform) ? { metaKey: true } : { ctrlKey: true };
}
