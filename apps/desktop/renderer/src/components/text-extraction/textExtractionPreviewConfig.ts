import { NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES } from '@voxweaver/contracts';

export const SOURCE_PREVIEW_LINE_HEIGHT = 20;
export const SOURCE_PREVIEW_FALLBACK_VISIBLE_LINES = 50;

export function visiblePreviewLineCount(viewportHeight: number, lineHeight: number): number {
  const measuredHeight = viewportHeight > 0
    ? viewportHeight
    : SOURCE_PREVIEW_FALLBACK_VISIBLE_LINES * lineHeight;
  return Math.max(1, Math.ceil(measuredHeight / lineHeight));
}

export function initialPreviewLineCount(visibleLineCount: number): number {
  return Math.min(NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES, visibleLineCount * 2);
}

export function shouldPrefetchPreview(
  scrollHeight: number,
  scrollTop: number,
  viewportHeight: number,
): boolean {
  const remainingPixels = scrollHeight - scrollTop - viewportHeight;
  return remainingPixels <= Math.ceil(viewportHeight / 2);
}

export function nextPreviewLineCount(
  visibleLineCount: number,
  scrollPixelDelta: number,
  lineHeight: number,
): number {
  const minimum = visibleLineCount * 2;
  const scrollLineDelta = Math.ceil(Math.abs(scrollPixelDelta) / lineHeight);
  const requested = Math.max(minimum, visibleLineCount + 2 * scrollLineDelta);
  return Math.min(
    NOVEL_IMPORT_SOURCE_PREVIEW_MAX_LINES,
    Math.max(minimum, Math.min(visibleLineCount * 8, requested)),
  );
}
