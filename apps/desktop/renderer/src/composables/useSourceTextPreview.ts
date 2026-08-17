import type { SourceTextPreviewDto, TxtSourceEncoding } from '@voxweaver/contracts';

import { shallowRef } from 'vue';

interface PreviewSource {
  readonly sourceHash: string;
  readonly sourceEncoding: TxtSourceEncoding;
}

export function useSourceTextPreview() {
  const source = shallowRef<PreviewSource>();
  const text = shallowRef('');
  const endByte = shallowRef(0);
  const done = shallowRef(false);
  const loading = shallowRef(false);
  const ready = shallowRef(false);
  const errorMessage = shallowRef('');
  const generation = shallowRef(0);

  function setSource(sourceHash?: string, sourceEncoding?: TxtSourceEncoding): void {
    generation.value += 1;
    source.value = sourceHash && sourceEncoding ? { sourceHash, sourceEncoding } : undefined;
    text.value = '';
    endByte.value = 0;
    done.value = false;
    loading.value = false;
    ready.value = false;
    errorMessage.value = '';
  }

  async function loadMore(targetLineCount: number): Promise<void> {
    const currentSource = source.value;
    if (!currentSource || loading.value || done.value)
      return;

    const requestGeneration = generation.value;
    const requestStartByte = endByte.value;
    loading.value = true;
    errorMessage.value = '';
    const result = await window.voxweaver.novelImport.getSourcePreview({
      ...currentSource,
      startByte: requestStartByte,
      targetLineCount,
    });

    if (requestGeneration !== generation.value)
      return;

    loading.value = false;
    if (!result.ok) {
      errorMessage.value = result.error.message;
      return;
    }

    if (!isExpectedChunk(result.value, currentSource, requestStartByte)) {
      errorMessage.value = '源文本预览响应与当前编码选择不匹配。';
      return;
    }
    if (!result.value.done && result.value.endByte <= requestStartByte) {
      errorMessage.value = '源文本预览未能继续向后读取。';
      return;
    }

    text.value += result.value.text;
    endByte.value = result.value.endByte;
    done.value = result.value.done;
    ready.value = true;
  }

  return {
    done,
    endByte,
    errorMessage,
    generation,
    loadMore,
    loading,
    ready,
    setSource,
    text,
  };
}

function isExpectedChunk(
  chunk: SourceTextPreviewDto,
  source: PreviewSource,
  startByte: number,
): boolean {
  return chunk.sourceHash === source.sourceHash
    && chunk.sourceEncoding === source.sourceEncoding
    && chunk.startByte === startByte;
}
