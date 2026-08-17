import { readonly, shallowRef } from 'vue';

export type ChapterDocumentLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';

export function useChapterDocument() {
  const text = shallowRef('');
  const status = shallowRef<ChapterDocumentLoadStatus>('idle');
  const errorMessage = shallowRef('');
  let generation = 0;

  async function load(revisionId: string, textByteLength: number): Promise<void> {
    const requestGeneration = ++generation;
    text.value = '';
    errorMessage.value = '';
    status.value = 'loading';

    const parts: string[] = [];
    let cursor = 0;
    while (cursor < textByteLength) {
      const result = await window.voxweaver.novelImport.getTextSlice({
        revisionId,
        startByte: cursor,
        endByte: textByteLength,
      });
      if (requestGeneration !== generation)
        return;
      if (!result.ok) {
        fail(result.error.message);
        return;
      }

      const slice = result.value;
      const reachedEnd = slice.range.endByte === textByteLength;
      if (slice.revisionId !== revisionId
        || slice.range.startByte !== cursor
        || slice.range.endByte <= cursor
        || slice.range.endByte > textByteLength
        || slice.done !== reachedEnd) {
        fail('正文分片范围不连续，无法安全显示。');
        return;
      }

      parts.push(slice.text);
      cursor = slice.range.endByte;
    }

    if (requestGeneration !== generation)
      return;
    text.value = parts.join('');
    status.value = 'loaded';
  }

  function cancel(): void {
    generation += 1;
    status.value = 'idle';
  }

  function fail(message: string): void {
    text.value = '';
    errorMessage.value = message;
    status.value = 'error';
  }

  return {
    cancel,
    errorMessage: readonly(errorMessage),
    load,
    status: readonly(status),
    text: readonly(text),
  };
}
