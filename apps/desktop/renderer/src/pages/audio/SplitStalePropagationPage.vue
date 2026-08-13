<script setup lang="ts">
import { shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import AudioInspectorPanel from './components/AudioInspectorPanel.vue';
import AudioParagraphRow from './components/AudioParagraphRow.vue';
import AudioWorkspaceShell from './components/AudioWorkspaceShell.vue';

const router = useRouter();
const selectedChapter = shallowRef({ id: '12', title: '雨夜来客' });
const playingParagraphId = shallowRef('');
const inspectorCollapsed = shallowRef(false);

function selectChapter(chapterId: string, chapterTitle: string): void {
  selectedChapter.value = { id: chapterId, title: chapterTitle };
}

function togglePlayback(paragraphId: string): void {
  playingParagraphId.value = playingParagraphId.value === paragraphId ? '' : paragraphId;
}

function openConfirmationOverlay(): void {
  void router.push({ name: getDemoPageRouteName('audio-stale-confirm-dialog') });
}
</script>

<template>
  <AudioWorkspaceShell
    label="段落拆分失效传播假交互页面"
    chapter-twelve-status="stale"
    @chapter-select="selectChapter"
  >
    <section class="audio-editor" aria-label="失效传播详情与检查器">
      <header class="chapter-toolbar">
        <div class="chapter-context">
          <strong>第 {{ selectedChapter.id }} 章</strong>
          <span>{{ selectedChapter.title }}</span>
        </div>
        <div class="toolbar-summary">
          <ElTag effect="plain" type="info">↺ 旧结果保留</ElTag>
          <span class="toolbar-summary-text">新段落 2 · 需要重新生成</span>
        </div>
      </header>

      <div class="audio-editor-body">
        <section class="audio-script-pane" aria-label="失效传播详情，可独立滚动">
          <header class="script-header script-header--propagation">
            <h1>段落拆分后的失效传播</h1>
            <p>旧 para_12_018 → 新 para_12_018a + para_12_018b</p>
          </header>
          <div class="inheritance-note">
            <strong>继承：说话人、来源信息、仍适用的基础批注</strong>
            <span>不继承：旧音频、ASR 结果、时间轴引用</span>
          </div>
          <div class="propagation-section-title propagation-section-title--old">
            <strong>修改前 · 旧段落历史</strong>
            <span>历史结果保留但标记“已失效”</span>
          </div>
          <AudioParagraphRow
            audio-version="历史音频 v3 · 已失效"
            number="18"
            paragraph-id="para_12_018"
            :playing="playingParagraphId === 'para_12_018'"
            script="“你终于来了。雨这样大，我还是赶过来了。”"
            secondary-status="ASR 已解绑 · 历史可见"
            speaker="苏婉"
            state-text="旧结果已失效 · 历史继续可见"
            status="↺ 已失效"
            status-tone="stale"
            variant="stale"
            @toggle-play="togglePlayback"
          />
          <div class="split-operation">拆分段落　→　分配两个不同的新段落 ID</div>
          <div class="propagation-section-title propagation-section-title--new">
            <strong>修改后 · 当前剧本</strong>
            <span>两个新段落均需要重新生成</span>
          </div>
          <AudioParagraphRow
            audio-version="音频 — · 新段落"
            disabled
            number="18"
            paragraph-id="para_12_018a"
            :playable="false"
            script="“你终于来了。”"
            secondary-status="○ ASR — 未生成"
            speaker="苏婉"
            state-text="需要重新生成 · 不继承旧音频、ASR 与时间轴"
            status="○ 需要重新生成"
            status-tone="warning"
            variant="new"
          />
          <AudioParagraphRow
            audio-version="音频 — · 新段落"
            disabled
            number="19"
            paragraph-id="para_12_018b"
            :playable="false"
            script="“雨这样大，我还是赶过来了。”"
            secondary-status="○ ASR — 未生成"
            speaker="苏婉"
            state-text="需要重新生成 · 不继承旧音频、ASR 与时间轴"
            status="○ 需要重新生成"
            status-tone="warning"
            variant="new"
          />
          <div class="history-trace">
            <strong>历史信息 · 可追溯</strong>
            <span>旧音频 v3 / ASR 96% / 时间轴 clip_088 → 已失效；不显示在两个新段落上。</span>
          </div>
        </section>

        <AudioInspectorPanel
          v-model:collapsed="inspectorCollapsed"
          label="失效影响，可独立滚动"
          subtitle="段落拆分 · 3 项下游结果"
          title="失效影响"
        >
          <section class="inspector-card">
            <div class="impact-list">
              <div class="impact-item">
                <strong>旧音频 audio_para_12_018_v3</strong>
                <span>↺ 已失效 · 历史保留</span>
              </div>
              <div class="impact-item">
                <strong>ASR review_asr_088</strong>
                <span>↺ 已失效 · 不继承</span>
              </div>
              <div class="impact-item">
                <strong>时间轴 timeline_clip_088</strong>
                <span>↺ 已失效 · 不继承</span>
              </div>
            </div>
          </section>
          <section class="inspector-card">
            <h3>当前结果策略</h3>
            <p class="warning-text">para_12_018a · 需要重新生成</p>
            <p class="warning-text">para_12_018b · 需要重新生成</p>
            <p>旧结果仅在历史信息中可见</p>
          </section>
          <ElButton type="primary" @click="openConfirmationOverlay">
            查看确认提示
          </ElButton>
          <div class="definition-note">
            <strong>状态语义</strong>
            <span>“已失效”描述旧结果；“需要重新生成”描述当前新段落。</span>
          </div>
        </AudioInspectorPanel>
      </div>
    </section>
  </AudioWorkspaceShell>
</template>
