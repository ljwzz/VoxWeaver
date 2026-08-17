export interface ChapterEditorConfig {
  readonly folding: {
    readonly bodyContextLines: number;
    readonly clickRevealLines: number;
    readonly dragThresholdPx: number;
  };
  readonly search: {
    readonly matchCountLimit: number;
  };
}

export const DEFAULT_CHAPTER_EDITOR_CONFIG = {
  folding: {
    bodyContextLines: 5,
    clickRevealLines: 5,
    dragThresholdPx: 2,
  },
  search: {
    matchCountLimit: 19_999,
  },
} as const satisfies ChapterEditorConfig;
