<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import workspaceStyles from '../../workspace/styles.css?inline';
import audioStyles from '../styles.css?inline';
import AudioActivityRail from './AudioActivityRail.vue';
import AudioChapterSidebar from './AudioChapterSidebar.vue';

const props = withDefaults(defineProps<{
  label: string;
  chapterTwelveStatus?: 'complete' | 'generating' | 'not-generated' | 'review' | 'stale';
  overview?: boolean;
  pageClass?: string;
  selectedChapterId?: string;
}>(), {
  chapterTwelveStatus: 'review',
  overview: false,
  pageClass: '',
  selectedChapterId: '12',
});

const emit = defineEmits<{
  chapterSelect: [chapterId: string, chapterTitle: string];
}>();

const bodyClasses: readonly string[] = props.overview
  ? ['workspace-view', 'workspace-view--audio', 'audio-detail-view']
  : ['audio-detail-view'];
const styleSheets = [workspaceStyles, audioStyles] as const;

function forwardChapterSelection(chapterId: string, chapterTitle: string): void {
  emit('chapterSelect', chapterId, chapterTitle);
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="workspace audio-workspace" :class="props.pageClass" :aria-label="props.label">
      <header class="window-titlebar">
        <img class="window-controls" src="../assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
        <p class="window-title">VoxWeaver · 示例小说</p>
        <p class="window-context">项目工作台 · 假交互预览</p>
      </header>

      <div class="workspace-body">
        <AudioActivityRail />
        <AudioChapterSidebar
          :chapter-twelve-status="props.chapterTwelveStatus"
          :selected-chapter-id="props.selectedChapterId"
          @select="forwardChapterSelection"
        />
        <slot />
      </div>
    </main>
  </PageDocument>
</template>
