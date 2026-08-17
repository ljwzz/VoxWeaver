import type { Extension, SelectionRange } from '@codemirror/state';
import type {
  KeyBinding,
  Panel,
  ViewUpdate,
} from '@codemirror/view';

import {
  closeSearchPanel,
  findNext,
  findPrevious,
  getSearchQuery,
  openSearchPanel,
  search,
  searchPanelOpen,
  SearchQuery,
  setSearchQuery,
} from '@codemirror/search';
import {
  EditorView,
  keymap,
  runScopeHandlers,
} from '@codemirror/view';
import { DEFAULT_CHAPTER_EDITOR_CONFIG } from './chapterEditorConfig';

export interface ChapterSearchMatch {
  readonly from: number;
  readonly lineNumber: number;
  readonly to: number;
}

export interface ChapterSearchPanelOptions {
  readonly onRevealMatch?: (match: ChapterSearchMatch, view: EditorView) => void;
}

export interface ChapterSearchPanelController {
  readonly extension: Extension;
  readonly close: (view: EditorView) => boolean;
  readonly destroy: () => void;
  readonly open: (view: EditorView) => boolean;
  readonly refresh: (view: EditorView) => void;
}

interface MatchCount {
  readonly current: number | undefined;
  readonly limited: boolean;
  readonly total: number;
}

const SEARCH_PANEL_SCOPE = 'search-panel';
const MATCH_COUNT_LIMIT = DEFAULT_CHAPTER_EDITOR_CONFIG.search.matchCountLimit;

export function createChapterSearchPanel(
  options: ChapterSearchPanelOptions = {},
): ChapterSearchPanelController {
  return new ChapterSearchPanelControllerImpl(options);
}

class ChapterSearchPanelControllerImpl implements ChapterSearchPanelController {
  readonly extension: Extension;

  private activePanel: ChapterSearchPanel | undefined;
  private destroyed = false;

  constructor(private readonly options: ChapterSearchPanelOptions) {
    const bindings = createSearchKeymap(this);
    this.extension = [
      search({
        top: true,
        createPanel: view => this.createPanel(view),
        scrollToMatch: (range, view) => this.scrollToMatch(range, view),
      }),
      keymap.of(bindings),
      createChapterSearchPanelTheme(),
    ];
  }

  open(view: EditorView): boolean {
    if (this.destroyed)
      return false;

    const selection = view.state.selection.main;
    const previousQuery = getSearchQuery(view.state);
    const selectedText = selectedSingleLineText(view, selection);
    const searchText = selectedText ?? previousQuery.search;
    const nextQuery = copyQuery(previousQuery, searchText);

    openSearchPanel(view);
    this.activePanel?.setSearchAnchor(selection.from);
    if (!nextQuery.eq(getSearchQuery(view.state)))
      view.dispatch({ effects: setSearchQuery.of(nextQuery) });
    this.activePanel?.scheduleFocusAndSelect();
    return true;
  }

  close(view: EditorView): boolean {
    if (this.destroyed)
      return false;
    return closeSearchPanel(view);
  }

  refresh(view: EditorView): void {
    if (!this.destroyed && this.activePanel?.view === view)
      this.activePanel.refresh();
  }

  destroy(): void {
    if (this.destroyed)
      return;
    const panel = this.activePanel;
    panel?.blur();
    if (panel && searchPanelOpen(panel.view.state))
      closeSearchPanel(panel.view);
    panel?.dispose();
    this.activePanel = undefined;
    this.destroyed = true;
  }

  detach(panel: ChapterSearchPanel): void {
    if (this.activePanel === panel)
      this.activePanel = undefined;
  }

  private createPanel(view: EditorView): Panel {
    const panel = new ChapterSearchPanel(view, this);
    this.activePanel = panel;
    return panel;
  }

  private scrollToMatch(range: SelectionRange, view: EditorView) {
    this.options.onRevealMatch?.({
      from: range.from,
      lineNumber: view.state.doc.lineAt(range.from).number,
      to: range.to,
    }, view);
    return EditorView.scrollIntoView(range, { y: 'center', yMargin: 24 });
  }
}

class ChapterSearchPanel implements Panel {
  readonly dom: HTMLElement;
  readonly top = true;
  readonly view: EditorView;

  private readonly caseButton: HTMLButtonElement;
  private readonly closeButton: HTMLButtonElement;
  private readonly input: HTMLInputElement;
  private readonly nextButton: HTMLButtonElement;
  private readonly previousButton: HTMLButtonElement;
  private readonly regexpButton: HTMLButtonElement;
  private readonly status: HTMLOutputElement;
  private readonly wholeWordButton: HTMLButtonElement;
  private disposed = false;
  private query: SearchQuery;
  private searchAnchor: number;

  constructor(
    view: EditorView,
    private readonly owner: ChapterSearchPanelControllerImpl,
  ) {
    this.view = view;
    this.query = getSearchQuery(view.state);
    this.searchAnchor = view.state.selection.main.from;

    this.input = document.createElement('input');
    this.input.type = 'text';
    this.input.className = 'cm-chapter-search-panel__input';
    this.input.name = 'search';
    this.input.value = this.query.search;
    this.input.placeholder = '查找';
    this.input.autocomplete = 'off';
    this.input.spellcheck = false;
    this.input.setAttribute('aria-label', '查找');
    this.input.setAttribute('main-field', 'true');
    this.input.addEventListener('input', this.handleInput);

    this.caseButton = createToggleButton('区分大小写', 'Aa', () => {
      this.commit({ caseSensitive: !this.query.caseSensitive });
    });
    this.wholeWordButton = createToggleButton('全词匹配', 'ab', () => {
      this.commit({ wholeWord: !this.query.wholeWord });
    });
    this.regexpButton = createToggleButton('使用正则表达式', '.*', () => {
      this.commit({ regexp: !this.query.regexp });
    });

    this.status = document.createElement('output');
    this.status.className = 'cm-chapter-search-panel__status';
    this.status.setAttribute('aria-live', 'polite');
    this.status.setAttribute('aria-atomic', 'true');

    this.previousButton = createActionButton('上一个匹配项', '↑', () => {
      findPrevious(this.view);
    });
    this.nextButton = createActionButton('下一个匹配项', '↓', () => {
      findNext(this.view);
    });
    this.closeButton = createActionButton('关闭查找', '×', () => {
      this.owner.close(this.view);
    });

    this.dom = document.createElement('div');
    this.dom.className = 'cm-chapter-search-panel';
    this.dom.dataset.searchState = 'empty';
    this.dom.setAttribute('aria-label', '查找');
    this.dom.setAttribute('role', 'dialog');
    this.dom.addEventListener('keydown', this.handleKeyDown);
    this.dom.append(
      this.input,
      this.caseButton,
      this.wholeWordButton,
      this.regexpButton,
      this.status,
      this.previousButton,
      this.nextButton,
      this.closeButton,
    );
    this.refresh();
  }

  update(update: ViewUpdate): void {
    if (update.docChanged)
      this.searchAnchor = update.changes.mapPos(this.searchAnchor, 1);

    const query = getSearchQuery(update.state);
    if (!query.eq(this.query))
      this.setQuery(query);
    if (update.docChanged || update.selectionSet || !query.eq(getSearchQuery(update.startState)))
      this.refresh();
  }

  destroy(): void {
    this.dispose();
    this.owner.detach(this);
  }

  dispose(): void {
    if (this.disposed)
      return;
    this.disposed = true;
    this.input.removeEventListener('input', this.handleInput);
    this.dom.removeEventListener('keydown', this.handleKeyDown);
  }

  blur(): void {
    const activeElement = this.view.root.activeElement;
    if (activeElement instanceof HTMLElement && this.dom.contains(activeElement))
      activeElement.blur();
  }

  scheduleFocusAndSelect(): void {
    queueMicrotask(() => {
      if (this.disposed || !this.dom.isConnected)
        return;
      this.input.focus();
      this.input.select();
    });
  }

  refresh(): void {
    const invalidRegexp = this.query.search.length > 0
      && this.query.regexp
      && !this.query.valid;
    const counts = this.query.valid
      ? countMatches(this.view, this.query, MATCH_COUNT_LIMIT)
      : { current: undefined, limited: false, total: 0 };
    const noResults = this.query.valid && counts.total === 0;

    this.dom.dataset.searchState = invalidRegexp
      ? 'invalid'
      : noResults
        ? 'no-results'
        : this.query.valid
          ? 'ready'
          : 'empty';
    this.input.classList.toggle('cm-chapter-search-panel__input--invalid', invalidRegexp);
    this.input.classList.toggle('cm-chapter-search-panel__input--no-results', noResults);
    this.input.setAttribute('aria-invalid', String(invalidRegexp));
    this.status.textContent = formatMatchCount(this.query, counts, MATCH_COUNT_LIMIT);
    this.status.title = counts.limited
      ? `仅计数前 ${formatNumber(MATCH_COUNT_LIMIT)} 条结果，导航仍覆盖全文。`
      : '';
    this.previousButton.disabled = counts.total === 0 || !this.query.valid;
    this.nextButton.disabled = counts.total === 0 || !this.query.valid;
    updateToggleButton(this.caseButton, this.query.caseSensitive);
    updateToggleButton(this.wholeWordButton, this.query.wholeWord);
    updateToggleButton(this.regexpButton, this.query.regexp);
  }

  setSearchAnchor(position: number): void {
    this.searchAnchor = position;
  }

  private readonly handleInput = (): void => {
    this.commit({ search: this.input.value });
  };

  private readonly handleKeyDown = (event: KeyboardEvent): void => {
    if (runScopeHandlers(this.view, event, SEARCH_PANEL_SCOPE)) {
      event.preventDefault();
      return;
    }
    if (event.key === 'Enter' && event.target === this.input) {
      event.preventDefault();
      (event.shiftKey ? findPrevious : findNext)(this.view);
    }
  };

  private commit(overrides: Partial<Pick<
    SearchQuery,
    'caseSensitive' | 'regexp' | 'search' | 'wholeWord'
  >>): void {
    const query = new SearchQuery({
      search: overrides.search ?? this.query.search,
      caseSensitive: overrides.caseSensitive ?? this.query.caseSensitive,
      literal: this.query.literal,
      regexp: overrides.regexp ?? this.query.regexp,
      wholeWord: overrides.wholeWord ?? this.query.wholeWord,
      ...(this.query.test ? { test: this.query.test } : {}),
    });
    if (query.eq(this.query))
      return;

    const anchor = Math.min(this.searchAnchor, this.view.state.doc.length);
    this.view.dispatch({
      effects: setSearchQuery.of(query),
      selection: { anchor },
    });
    if (query.valid)
      findNext(this.view);
  }

  private setQuery(query: SearchQuery): void {
    this.query = query;
    if (this.input.value !== query.search)
      this.input.value = query.search;
    updateToggleButton(this.caseButton, query.caseSensitive);
    updateToggleButton(this.wholeWordButton, query.wholeWord);
    updateToggleButton(this.regexpButton, query.regexp);
  }
}

function createSearchKeymap(
  controller: ChapterSearchPanelController,
): readonly KeyBinding[] {
  const next = (view: EditorView): boolean => {
    if (!searchPanelOpen(view.state) && !getSearchQuery(view.state).valid)
      return controller.open(view);
    return findNext(view);
  };
  const previous = (view: EditorView): boolean => {
    if (!searchPanelOpen(view.state) && !getSearchQuery(view.state).valid)
      return controller.open(view);
    return findPrevious(view);
  };
  return [
    { key: 'Mod-f', run: view => controller.open(view), scope: 'editor search-panel' },
    {
      key: 'F3',
      run: next,
      shift: previous,
      scope: 'editor search-panel',
      preventDefault: true,
    },
    {
      key: 'Mod-g',
      run: next,
      shift: previous,
      scope: 'editor search-panel',
      preventDefault: true,
    },
    { key: 'Escape', run: view => controller.close(view), scope: 'editor search-panel' },
  ];
}

function selectedSingleLineText(
  view: EditorView,
  selection: SelectionRange,
): string | undefined {
  if (selection.empty)
    return undefined;
  const text = view.state.sliceDoc(selection.from, selection.to);
  return /[\r\n]/.test(text) ? undefined : text;
}

function copyQuery(query: SearchQuery, searchText: string): SearchQuery {
  return new SearchQuery({
    search: searchText,
    caseSensitive: query.caseSensitive,
    literal: query.literal,
    regexp: query.regexp,
    wholeWord: query.wholeWord,
    ...(query.test ? { test: query.test } : {}),
  });
}

function countMatches(
  view: EditorView,
  query: SearchQuery,
  limit: number,
): MatchCount {
  const selection = view.state.selection.main;
  const cursor = query.getCursor(view.state);
  let current: number | undefined;
  let total = 0;
  let limited = false;
  while (true) {
    const result = cursor.next();
    if (result.done)
      break;
    total += 1;
    if (result.value.from === selection.from && result.value.to === selection.to)
      current = total;
    if (total > limit) {
      total = limit;
      limited = true;
      break;
    }
  }
  return { current, limited, total };
}

function formatMatchCount(
  query: SearchQuery,
  counts: MatchCount,
  limit: number,
): string {
  if (query.search.length === 0)
    return '无结果';
  if (!query.valid)
    return query.regexp ? '无效正则' : '无结果';
  if (counts.total === 0)
    return '无结果';
  const current = counts.current === undefined ? '?' : formatNumber(counts.current);
  const total = counts.limited ? `${formatNumber(limit)}+` : formatNumber(counts.total);
  return `${current} / ${total}`;
}

function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

function createToggleButton(
  ariaLabel: string,
  text: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = createActionButton(ariaLabel, text, onClick);
  button.classList.add('cm-chapter-search-panel__toggle');
  button.setAttribute('aria-pressed', 'false');
  return button;
}

function createActionButton(
  ariaLabel: string,
  text: string,
  onClick: () => void,
): HTMLButtonElement {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'cm-chapter-search-panel__button';
  button.textContent = text;
  button.title = ariaLabel;
  button.setAttribute('aria-label', ariaLabel);
  button.addEventListener('click', onClick);
  return button;
}

function updateToggleButton(button: HTMLButtonElement, active: boolean): void {
  button.classList.toggle('cm-chapter-search-panel__toggle--active', active);
  button.setAttribute('aria-pressed', String(active));
}

function createChapterSearchPanelTheme(): Extension {
  return EditorView.theme({
    '&': {
      position: 'relative',
    },
    '.cm-panels.cm-panels-top': {
      position: 'absolute',
      zIndex: '20',
      top: '0',
      right: '0',
      left: '0',
      border: '0',
      backgroundColor: 'transparent',
    },
    '.cm-chapter-search-panel': {
      boxSizing: 'border-box',
      display: 'flex',
      width: 'min(520px, calc(100% - 28px))',
      minHeight: '34px',
      alignItems: 'center',
      gap: '2px',
      margin: '0 14px 0 auto',
      padding: '4px',
      border: '1px solid #C8C8C8',
      borderTop: '0',
      color: '#3B3B3B',
      backgroundColor: '#F3F3F3',
      boxShadow: '0 2px 8px #00000029',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      fontSize: '11px',
    },
    '.cm-chapter-search-panel__input': {
      boxSizing: 'border-box',
      width: '190px',
      minWidth: '72px',
      height: '26px',
      flex: '1 1 190px',
      padding: '3px 6px',
      border: '1px solid #CECECE',
      borderRadius: '2px',
      outline: 'none',
      color: '#3B3B3B',
      backgroundColor: '#FFFFFF',
      font: '12px/18px SFMono-Regular, Consolas, monospace',
    },
    '.cm-chapter-search-panel__input:focus': {
      borderColor: '#0090F1',
      outline: '1px solid #0090F1',
      outlineOffset: '-1px',
    },
    '.cm-chapter-search-panel__input--invalid, .cm-chapter-search-panel__input--no-results': {
      borderColor: '#E51400',
    },
    '.cm-chapter-search-panel__button': {
      boxSizing: 'border-box',
      minWidth: '24px',
      height: '24px',
      padding: '0',
      border: '1px solid transparent',
      borderRadius: '2px',
      color: '#3B3B3B',
      backgroundColor: 'transparent',
      cursor: 'pointer',
      font: '12px/22px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
    },
    '.cm-chapter-search-panel__button:hover:not(:disabled)': {
      backgroundColor: '#E8E8E8',
    },
    '.cm-chapter-search-panel__button:focus-visible': {
      borderColor: '#0090F1',
      outline: '1px solid #0090F1',
    },
    '.cm-chapter-search-panel__button:disabled': {
      opacity: '0.4',
      cursor: 'default',
    },
    '.cm-chapter-search-panel__toggle': {
      fontFamily: 'SFMono-Regular, Consolas, monospace',
      fontSize: '10px',
    },
    '.cm-chapter-search-panel__toggle--active': {
      borderColor: '#007ACC',
      color: '#005FB8',
      backgroundColor: '#E1F0FF',
    },
    '.cm-chapter-search-panel__status': {
      minWidth: '72px',
      overflow: 'hidden',
      padding: '0 4px',
      color: '#616161',
      lineHeight: '24px',
      textAlign: 'center',
      textOverflow: 'ellipsis',
      whiteSpace: 'nowrap',
    },
    '.cm-searchMatch': {
      backgroundColor: '#EA5C0055',
    },
    '.cm-searchMatch.cm-searchMatch-selected': {
      backgroundColor: '#F9C51388',
      outline: '1px solid #EA5C00',
    },
  });
}
