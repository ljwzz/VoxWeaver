export function normalizeImportedText(text: string): string {
  return text
    .replace(/\r\n?/gu, '\n')
    .replace(/\u00A0/gu, ' ');
}
