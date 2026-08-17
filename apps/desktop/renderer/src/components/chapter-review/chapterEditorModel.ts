import type { ChapterDto } from '@voxweaver/contracts';

import { DEFAULT_CHAPTER_EDITOR_CONFIG } from './chapterEditorConfig';

export interface ChapterEditorLine {
  readonly number: number;
  readonly text: string;
  readonly from: number;
  readonly to: number;
  readonly end: number;
  readonly startByte: number;
  readonly bodyEndByte: number;
  readonly endByte: number;
}

export interface ChapterEditorHiddenRange {
  readonly chapterId: string;
  readonly id: string;
  readonly from: number;
  readonly to: number;
  readonly startLine: number;
  readonly endLine: number;
  readonly lineCount: number;
}

export interface ChapterEditorWidgetAnchor {
  readonly from: number;
  readonly lineNumber: number;
}

export interface ChapterEditorChapterLayout {
  readonly chapterId: string;
  readonly widgetAnchor: ChapterEditorWidgetAnchor;
  readonly headingLineFroms: readonly number[];
  readonly contentStartLineFrom: number;
}

export interface ChapterEditorPositionMap {
  readonly crlfOriginalEnds: Float64Array;
}

export interface ChapterEditorModel {
  readonly textLength: number;
  readonly textByteLength: number;
  readonly normalizedText: string;
  readonly positionMap: ChapterEditorPositionMap;
  readonly lines: readonly ChapterEditorLine[];
  readonly hiddenRanges: readonly ChapterEditorHiddenRange[];
  readonly chapterLayouts: readonly ChapterEditorChapterLayout[];
}

export type ChapterEditorModelFactory = (
  text: string,
  chapters: readonly ChapterDto[],
) => ChapterEditorModel;

export function createChapterEditorModel(
  text: string,
  chapters: readonly ChapterDto[],
): ChapterEditorModel {
  const projection = createTextProjection(text);
  return createChapterEditorModelFromProjection(text, projection, chapters);
}

export function createChapterEditorModelCache(): ChapterEditorModelFactory {
  let cachedText: string | undefined;
  let cachedProjection: ChapterEditorTextProjection | undefined;

  return (text, chapters) => {
    if (cachedProjection === undefined || text !== cachedText) {
      cachedText = text;
      cachedProjection = createTextProjection(text);
    }
    return createChapterEditorModelFromProjection(text, cachedProjection, chapters);
  };
}

function createChapterEditorModelFromProjection(
  text: string,
  projection: ChapterEditorTextProjection,
  chapters: readonly ChapterDto[],
): ChapterEditorModel {
  return {
    textLength: text.length,
    textByteLength: projection.textByteLength,
    normalizedText: projection.normalizedText,
    positionMap: projection.positionMap,
    lines: projection.lines,
    hiddenRanges: createChapterEditorHiddenRanges(projection.lines, chapters),
    chapterLayouts: createChapterEditorChapterLayouts(projection.lines, chapters),
  };
}

export function parseChapterEditorLines(text: string): readonly ChapterEditorLine[] {
  return createTextProjection(text).lines;
}

export function editorPositionToOriginalCharacter(
  model: ChapterEditorModel,
  editorPosition: number,
): number {
  assertUnicodeCharacterBoundary(
    model.normalizedText,
    editorPosition,
    'CodeMirror 字符位置',
  );
  return editorPosition + crlfCountAtEditorPosition(
    model.positionMap.crlfOriginalEnds,
    editorPosition,
  );
}

export function originalCharacterToEditorPosition(
  model: ChapterEditorModel,
  characterOffset: number,
): number {
  if (!Number.isSafeInteger(characterOffset)
    || characterOffset < 0
    || characterOffset > model.textLength) {
    throw invalidUnicodeBoundary('原始文本字符位置', characterOffset);
  }
  const editorPosition = characterOffset - upperBound(
    model.positionMap.crlfOriginalEnds,
    characterOffset,
  );
  assertUnicodeCharacterBoundary(
    model.normalizedText,
    editorPosition,
    '原始文本字符位置',
    characterOffset,
  );
  return editorPosition;
}

export function utf8ByteToEditorPosition(
  model: ChapterEditorModel,
  byteOffset: number,
): number {
  if (!Number.isSafeInteger(byteOffset)
    || byteOffset < 0
    || byteOffset > model.textByteLength) {
    throw invalidUnicodeBoundary('原始文本 UTF-8 字节位置', byteOffset);
  }
  const boundaryIndex = lineBoundaryIndexAtByte(model.lines, byteOffset);
  const line = model.lines[Math.min(boundaryIndex, model.lines.length - 1)]!;
  if (byteOffset === line.startByte)
    return line.from;
  if (byteOffset > line.bodyEndByte && byteOffset <= line.endByte)
    return line.end;
  if (byteOffset <= line.bodyEndByte) {
    return editorPositionAtLineByte(
      model.normalizedText.slice(line.from, line.to),
      line,
      byteOffset,
    );
  }
  throw invalidUnicodeBoundary('原始文本 UTF-8 字节位置', byteOffset);
}

interface ChapterEditorTextProjection {
  readonly lines: readonly ChapterEditorLine[];
  readonly normalizedText: string;
  readonly positionMap: ChapterEditorPositionMap;
  readonly textByteLength: number;
}

const utf8Encoder = new TextEncoder();

function createTextProjection(text: string): ChapterEditorTextProjection {
  const lines: ChapterEditorLine[] = [];
  const normalizedParts: string[] = [];
  const crlfOriginalEnds: number[] = [];
  let originalOffset = 0;
  let editorOffset = 0;
  let byteOffset = 0;
  let lineOriginalFrom = 0;

  while (originalOffset < text.length) {
    const character = text[originalOffset]!;
    if (character !== '\r' && character !== '\n') {
      originalOffset += 1;
      continue;
    }

    const separatorLength = character === '\r' && text[originalOffset + 1] === '\n' ? 2 : 1;
    const body = text.slice(lineOriginalFrom, originalOffset);
    const bodyEndByte = byteOffset + utf8Encoder.encode(body).byteLength;
    const bodyEndEditor = editorOffset + body.length;
    lines.push({
      number: lines.length + 1,
      text: body,
      from: editorOffset,
      to: bodyEndEditor,
      end: bodyEndEditor + 1,
      startByte: byteOffset,
      bodyEndByte,
      endByte: bodyEndByte + separatorLength,
    });
    normalizedParts.push(body, '\n');

    if (separatorLength === 2)
      crlfOriginalEnds.push(originalOffset + separatorLength);
    originalOffset += separatorLength;
    editorOffset = bodyEndEditor + 1;
    byteOffset = bodyEndByte + separatorLength;
    lineOriginalFrom = originalOffset;
  }

  const finalBody = text.slice(lineOriginalFrom);
  const finalBodyEndByte = byteOffset + utf8Encoder.encode(finalBody).byteLength;
  const finalBodyEndEditor = editorOffset + finalBody.length;
  lines.push({
    number: lines.length + 1,
    text: finalBody,
    from: editorOffset,
    to: finalBodyEndEditor,
    end: finalBodyEndEditor,
    startByte: byteOffset,
    bodyEndByte: finalBodyEndByte,
    endByte: finalBodyEndByte,
  });
  normalizedParts.push(finalBody);
  return {
    lines,
    normalizedText: normalizedParts.join(''),
    positionMap: {
      crlfOriginalEnds: Float64Array.from(crlfOriginalEnds),
    },
    textByteLength: finalBodyEndByte,
  };
}

function crlfCountAtEditorPosition(
  crlfOriginalEnds: Float64Array,
  editorPosition: number,
): number {
  let low = 0;
  let high = crlfOriginalEnds.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    const editorEnd = crlfOriginalEnds[middle]! - (middle + 1);
    if (editorEnd <= editorPosition)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}

function upperBound(values: Float64Array, target: number): number {
  let low = 0;
  let high = values.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (values[middle]! <= target)
      low = middle + 1;
    else
      high = middle;
  }
  return low;
}

function assertUnicodeCharacterBoundary(
  text: string,
  characterOffset: number,
  label: string,
  sourceOffset = characterOffset,
): void {
  if (!Number.isSafeInteger(characterOffset)
    || characterOffset < 0
    || characterOffset > text.length
    || isSurrogatePairBoundary(text, characterOffset)) {
    throw invalidUnicodeBoundary(label, sourceOffset);
  }
}

function isSurrogatePairBoundary(text: string, characterOffset: number): boolean {
  if (characterOffset <= 0 || characterOffset >= text.length)
    return false;
  const previous = text.charCodeAt(characterOffset - 1);
  const current = text.charCodeAt(characterOffset);
  return previous >= 0xD800 && previous <= 0xDBFF
    && current >= 0xDC00 && current <= 0xDFFF;
}

function editorPositionAtLineByte(
  body: string,
  line: ChapterEditorLine,
  byteOffset: number,
): number {
  const targetByte = byteOffset - line.startByte;
  let bodyByte = 0;
  let bodyCharacter = 0;
  for (const codePoint of body) {
    bodyByte += utf8ByteLength(codePoint.codePointAt(0)!);
    bodyCharacter += codePoint.length;
    if (bodyByte === targetByte)
      return line.from + bodyCharacter;
    if (bodyByte > targetByte)
      break;
  }
  throw invalidUnicodeBoundary('原始文本 UTF-8 字节位置', byteOffset);
}

function utf8ByteLength(codePoint: number): 1 | 2 | 3 | 4 {
  if (codePoint <= 0x7F)
    return 1;
  if (codePoint <= 0x7FF)
    return 2;
  if (codePoint <= 0xFFFF)
    return 3;
  return 4;
}

function invalidUnicodeBoundary(label: string, sourceOffset: number): RangeError {
  return new RangeError(`${label} ${sourceOffset} 不是有效的 Unicode 字符边界。`);
}

export function createChapterEditorHiddenRanges(
  lines: readonly ChapterEditorLine[],
  chapters: readonly ChapterDto[],
): readonly ChapterEditorHiddenRange[] {
  const contextLines = DEFAULT_CHAPTER_EDITOR_CONFIG.folding.bodyContextLines;
  const minimumVisibleLines = contextLines * 2;
  const hiddenRanges: ChapterEditorHiddenRange[] = [];

  for (const chapter of chapters) {
    const { startByte, endByte } = chapter.contentRange;
    assertByteOffset(lines, startByte);
    assertByteOffset(lines, endByte);
    if (endByte < startByte) {
      throw new RangeError(
        `Chapter ${chapter.chapterId} content range ${startByte}-${endByte} is invalid.`,
      );
    }
    const contentLineRange = logicalLineRangeAtBytes(lines, startByte, endByte);
    const contentLineCount = contentLineRange.to - contentLineRange.from;
    if (contentLineCount <= minimumVisibleLines)
      continue;

    const hiddenStartIndex = contentLineRange.from + contextLines;
    const hiddenEndIndexExclusive = contentLineRange.to - contextLines;
    const firstHiddenLine = lines[hiddenStartIndex]!;
    const lastHiddenLine = lines[hiddenEndIndexExclusive - 1]!;
    const firstTrailingLine = lines[hiddenEndIndexExclusive]!;
    hiddenRanges.push({
      chapterId: chapter.chapterId,
      id: chapter.chapterId,
      from: firstHiddenLine.from,
      to: firstTrailingLine.from,
      startLine: firstHiddenLine.number,
      endLine: lastHiddenLine.number,
      lineCount: hiddenEndIndexExclusive - hiddenStartIndex,
    });
  }

  return hiddenRanges;
}

function logicalLineRangeAtBytes(
  lines: readonly ChapterEditorLine[],
  startByte: number,
  endByte: number,
): { readonly from: number; readonly to: number } {
  if (startByte === endByte)
    return { from: 0, to: 0 };

  const firstLine = lineAtByte(lines, startByte);
  let endIndex = lineBoundaryIndexAtByte(lines, endByte);
  if (endIndex < lines.length && lines[endIndex]!.startByte < endByte)
    endIndex += 1;
  return {
    from: firstLine.number - 1,
    to: Math.max(firstLine.number, endIndex),
  };
}

export function createChapterEditorChapterLayouts(
  lines: readonly ChapterEditorLine[],
  chapters: readonly ChapterDto[],
): readonly ChapterEditorChapterLayout[] {
  return chapters.map((chapter) => {
    const anchorByte = chapter.headingRange?.startByte ?? chapter.contentRange.startByte;
    const anchorLine = lineAtByte(lines, anchorByte);
    const contentStartLine = lineAtByte(lines, chapter.contentRange.startByte);
    assertByteOffset(lines, chapter.contentRange.endByte);
    const headingLineFroms: number[] = [];

    if (chapter.headingRange) {
      assertByteOffset(lines, chapter.headingRange.endByte);
      for (let index = anchorLine.number - 1; index < lines.length; index += 1) {
        const line = lines[index]!;
        if (line.startByte >= chapter.headingRange.endByte)
          break;
        if (line.endByte > chapter.headingRange.startByte)
          headingLineFroms.push(line.from);
      }
      if (headingLineFroms.length === 0)
        throw new RangeError(`Chapter ${chapter.chapterId} heading does not overlap a logical line.`);
    }

    return {
      chapterId: chapter.chapterId,
      widgetAnchor: {
        from: anchorLine.from,
        lineNumber: anchorLine.number,
      },
      headingLineFroms,
      contentStartLineFrom: contentStartLine.from,
    };
  });
}

function lineAtByte(
  lines: readonly ChapterEditorLine[],
  byteOffset: number,
): ChapterEditorLine {
  const boundaryIndex = lineBoundaryIndexAtByte(lines, byteOffset);
  const line = lines[Math.min(boundaryIndex, lines.length - 1)]!;
  if (byteOffset > line.bodyEndByte && line.number < lines.length)
    return lines[line.number]!;
  return line;
}

function lineBoundaryIndexAtByte(
  lines: readonly ChapterEditorLine[],
  byteOffset: number,
): number {
  assertByteOffset(lines, byteOffset);
  let low = 0;
  let high = lines.length;
  while (low < high) {
    const middle = Math.floor((low + high) / 2);
    if (lines[middle]!.startByte < byteOffset)
      low = middle + 1;
    else
      high = middle;
  }

  if (low < lines.length && lines[low]!.startByte === byteOffset)
    return low;
  if (low === lines.length && byteOffset === lines.at(-1)!.endByte)
    return lines.length;
  return Math.max(0, low - 1);
}

function assertByteOffset(
  lines: readonly ChapterEditorLine[],
  byteOffset: number,
): void {
  const textByteLength = lines.at(-1)?.endByte;
  if (textByteLength === undefined
    || !Number.isSafeInteger(byteOffset)
    || byteOffset < 0
    || byteOffset > textByteLength) {
    throw new RangeError(`UTF-8 byte offset ${byteOffset} is outside the editor document.`);
  }
}
