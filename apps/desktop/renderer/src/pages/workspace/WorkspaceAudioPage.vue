<script setup lang="ts">
import { shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import AudioWorkspaceShell from '../audio/components/AudioWorkspaceShell.vue';

const router = useRouter();
const selectedChapter = shallowRef('第 12 章 · 雨夜来客');
const queuePaused = shallowRef(false);

function selectChapter(chapterId: string, chapterTitle: string): void {
  selectedChapter.value = `第 ${chapterId} 章 · ${chapterTitle}`;
}

function openChapterParameters(): void {
  void router.push({ name: getDemoPageRouteName('audio-chapter-parameters') });
}

function toggleQueuePreview(): void {
  queuePaused.value = !queuePaused.value;
  showDemoFeedback(
    queuePaused.value ? '已暂停队列视觉状态' : '已恢复队列视觉状态',
    queuePaused.value ? 'warning' : 'success',
  );
}
</script>

<template>
  <AudioWorkspaceShell
    label="VoxWeaver 音频生成假交互工作台"
    overview
    @chapter-select="selectChapter"
  >
    <section class="audio-overview-editor" aria-label="音频生成概览">
      <header class="chapter-toolbar">
        <div class="chapter-context">
          <strong>音频生成</strong>
          <span>{{ selectedChapter }}</span>
        </div>
        <div class="toolbar-summary">
          <ElTag :type="queuePaused ? 'warning' : 'primary'" effect="plain">
            {{ queuePaused ? '视觉队列已暂停' : '本地预览就绪' }}
          </ElTag>
          <ElButton size="small" @click="toggleQueuePreview">
            {{ queuePaused ? '恢复视觉队列' : '暂停视觉队列' }}
          </ElButton>
          <ElButton size="small" type="primary" @click="openChapterParameters">
            进入章节参数
          </ElButton>
        </div>
      </header>

      <div class="audio-overview-content">
        <div>
          <p class="eyebrow">项目工作台</p>
          <h1>音频生成</h1>
          <p class="editor-description">
            复用现有章节、段落和生成状态；所有操作只改变当前页面的视觉状态。
          </p>
        </div>

        <section class="audio-overview-progress" aria-label="章节音频概览">
          <div>
            <span>第 12 章 · 高匹配度</span>
            <strong>28 / 32</strong>
          </div>
          <ElProgress :percentage="88" :stroke-width="8" :show-text="false" />
          <p>待复核 1 · 校验失败 1 · 已失效 2</p>
        </section>

        <div class="audio-overview-grid">
          <section class="audio-overview-card audio-overview-card--processing">
            <ElTag effect="plain">↻ 生成中</ElTag>
            <h2>整章生成状态</h2>
            <p>成功结果保持完成；失败项可独立进入本地重试状态。</p>
          </section>
          <section class="audio-overview-card audio-overview-card--review">
            <ElTag effect="plain" type="warning">! 待复核</ElTag>
            <h2>ASR 低匹配</h2>
            <p>同时显示边框、图标、文字和相似度，不以颜色作为唯一提示。</p>
          </section>
          <section class="audio-overview-card audio-overview-card--stale">
            <ElTag effect="plain" type="info">↺ 已失效</ElTag>
            <h2>失效传播</h2>
            <p>旧结果保留在历史中，新段落继续标记为需要重新生成。</p>
          </section>
        </div>

        <ElAlert
          :closable="false"
          show-icon
          title="纯本地假交互：不会调用 TTS、ASR、Provider、任务调度、音频、IPC、文件系统或持久化。"
          type="info"
        />
      </div>
    </section>
  </AudioWorkspaceShell>
</template>
