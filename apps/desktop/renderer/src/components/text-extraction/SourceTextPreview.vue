<script setup lang="ts">
import { nextTick, onBeforeUnmount, onMounted, useTemplateRef, watch } from 'vue';
import {
  initialPreviewLineCount,
  nextPreviewLineCount,
  shouldPrefetchPreview,
  SOURCE_PREVIEW_LINE_HEIGHT,
  visiblePreviewLineCount,
} from './textExtractionPreviewConfig';

const props = defineProps<{
  text: string;
  loading: boolean;
  done: boolean;
  errorMessage: string;
  resetKey: number;
}>();

const emit = defineEmits<{
  requestLines: [targetLineCount: number];
}>();

const viewport = useTemplateRef<HTMLElement>('viewport');
const lineMeasure = useTemplateRef<HTMLElement>('lineMeasure');
let lineHeight = SOURCE_PREVIEW_LINE_HEIGHT;
let previousScrollTop = 0;
let requestPending = false;
let resizeObserver: ResizeObserver | undefined;

function measureLineHeight(): void {
  const measured = lineMeasure.value?.getBoundingClientRect().height ?? 0;
  if (measured > 0)
    lineHeight = measured;
}

function getVisibleLineCount(): number {
  return visiblePreviewLineCount(viewport.value?.clientHeight ?? 0, lineHeight);
}

function requestInitialChunk(): void {
  if (props.text || requestPending || props.loading || props.done || props.errorMessage)
    return;
  requestPending = true;
  emit('requestLines', initialPreviewLineCount(getVisibleLineCount()));
}

function requestMoreIfNeeded(): void {
  const element = viewport.value;
  if (!element || requestPending || props.loading || props.done || props.errorMessage)
    return;

  const visibleLineCount = getVisibleLineCount();
  const currentScrollTop = element.scrollTop;
  if (shouldPrefetchPreview(element.scrollHeight, currentScrollTop, element.clientHeight)) {
    requestPending = true;
    emit('requestLines', nextPreviewLineCount(
      visibleLineCount,
      currentScrollTop - previousScrollTop,
      lineHeight,
    ));
  }
  previousScrollTop = currentScrollTop;
}

function onScroll(): void {
  requestMoreIfNeeded();
}

onMounted(async () => {
  await nextTick();
  measureLineHeight();
  requestInitialChunk();
  requestMoreIfNeeded();
  if (typeof ResizeObserver !== 'undefined' && viewport.value) {
    resizeObserver = new ResizeObserver(() => {
      measureLineHeight();
      requestMoreIfNeeded();
    });
    resizeObserver.observe(viewport.value);
  }
});

watch(() => props.resetKey, async () => {
  previousScrollTop = 0;
  requestPending = false;
  if (viewport.value)
    viewport.value.scrollTop = 0;
  await nextTick();
  requestInitialChunk();
});

watch(() => props.loading, async (loading, previousLoading) => {
  if (!loading && previousLoading) {
    requestPending = false;
    await nextTick();
    requestMoreIfNeeded();
  }
});

onBeforeUnmount(() => {
  resizeObserver?.disconnect();
});
</script>

<template>
  <section class="source-text-preview" aria-label="源文本编码预览">
    <span ref="lineMeasure" aria-hidden="true" class="line-measure">M</span>
    <pre
      ref="viewport"
      :aria-busy="loading"
      class="preview-viewport"
      tabindex="0"
      @scroll="onScroll"
    >{{ text }}</pre>
    <div v-if="loading && !text" class="preview-state" role="status">
      正在读取源文本预览…
    </div>
    <div v-else-if="errorMessage" class="preview-state preview-error" role="alert">
      {{ errorMessage }}
    </div>
  </section>
</template>

<style scoped>
.source-text-preview {
  position: relative;
  min-height: 0;
  flex: 1;
  border: 1px solid #d9ddd7;
  border-radius: 8px;
  background: #fff;
  overflow: hidden;
}

.preview-viewport {
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  min-height: 0;
  margin: 0;
  padding: 16px 18px;
  border: 0;
  color: #202522;
  background: transparent;
  font:
    13px/20px ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace;
  /* stylelint-disable declaration-block-no-redundant-longhand-properties -- keep scroll axes explicit */
  overflow-x: hidden;
  overflow-y: auto;
  /* stylelint-enable declaration-block-no-redundant-longhand-properties */
  overflow-wrap: anywhere;
  tab-size: 4;
  white-space: pre-wrap;
}

.preview-viewport:focus-visible {
  outline: 2px solid #2f6f68;
  outline-offset: -2px;
}

.line-measure {
  position: absolute;
  visibility: hidden;
  font:
    13px/20px ui-monospace,
    SFMono-Regular,
    Menlo,
    Monaco,
    Consolas,
    monospace;
  pointer-events: none;
}

.preview-state {
  position: absolute;
  inset: 0;
  display: grid;
  place-items: center;
  color: #6a726e;
  background: rgb(255 255 255 / 88%);
  font-size: 13px;
}

.preview-error {
  color: #b34444;
}
</style>
