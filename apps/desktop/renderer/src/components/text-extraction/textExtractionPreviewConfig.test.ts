import { describe, expect, it } from 'vitest';
import {
  initialPreviewLineCount,
  nextPreviewLineCount,
  shouldPrefetchPreview,
  visiblePreviewLineCount,
} from './textExtractionPreviewConfig';

describe('text extraction preview sizing', () => {
  it('首批请求两个视口，不足半个视口时预取', () => {
    const visibleLines = visiblePreviewLineCount(1_000, 20);
    expect(visibleLines).toBe(50);
    expect(initialPreviewLineCount(visibleLines)).toBe(100);
    expect(shouldPrefetchPreview(1_501, 0, 1_000)).toBe(false);
    expect(shouldPrefetchPreview(1_500, 0, 1_000)).toBe(true);
    expect(shouldPrefetchPreview(1_499, 0, 1_000)).toBe(true);
  });

  it('快速滚动按像素差扩大批次，并受二到八个视口及后端上限限制', () => {
    expect(nextPreviewLineCount(50, 0, 20)).toBe(100);
    expect(nextPreviewLineCount(50, 3_000, 20)).toBe(350);
    expect(nextPreviewLineCount(50, 200_000, 20)).toBe(400);
    expect(nextPreviewLineCount(200, 200_000, 20)).toBe(1_000);
  });
});
