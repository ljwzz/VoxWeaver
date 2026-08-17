export const CHAPTER_HEADING_MAX_CODE_POINTS = 120;

export interface DetectedChapterHeadingLine {
  readonly title: string;
  readonly startCharacter: number;
  readonly endCharacter: number;
}

export function detectChapterHeadingLine(
  lineText: string,
): DetectedChapterHeadingLine | undefined {
  const leadingWhitespace = lineText.match(/^\s*/u)?.[0] ?? '';
  const trailingWhitespace = lineText.match(/\s*$/u)?.[0] ?? '';
  const startCharacter = leadingWhitespace.length;
  const endCharacter = lineText.length - trailingWhitespace.length;
  const rawTitle = lineText.slice(startCharacter, endCharacter);
  const codePointLength = [...rawTitle].length;
  if (codePointLength === 0 || codePointLength > CHAPTER_HEADING_MAX_CODE_POINTS)
    return undefined;
  if (!isChapterHeading(rawTitle))
    return undefined;
  return {
    title: normalizeHeadingTitle(rawTitle),
    startCharacter,
    endCharacter,
  };
}

function isChapterHeading(rawTitle: string): boolean {
  const titleStart = /^(?:第[^\s，。！？!?]{1,24}[章回节卷部篇集]|序章|序言|楔子|前言|引子|终章|尾声|后记|番外(?:\s*[0-9〇零一二三四五六七八九十百千万两]+)?|chapter\s+(?:\d+|[ivxlcdm]+))/iu.exec(rawTitle);
  if (titleStart === null)
    return false;
  const suffix = rawTitle.slice(titleStart[0].length);
  return suffix.length === 0 || /^[\s:：.．·\-—]/u.test(suffix);
}

function normalizeHeadingTitle(rawTitle: string): string {
  return rawTitle.trim().replace(/[\t \u3000]+/gu, ' ');
}
