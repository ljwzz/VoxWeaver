<script setup lang="ts">
import { shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import AudioInspectorPanel from './components/AudioInspectorPanel.vue';
import AudioParagraphRow from './components/AudioParagraphRow.vue';
import AudioWorkspaceShell from './components/AudioWorkspaceShell.vue';

const router = useRouter();
const selectedChapter = shallowRef({ id: '12', title: '雨夜来客' });
const selectedParagraphId = shallowRef('para_12_018');
const playingParagraphId = shallowRef('para_12_021');
const inspectorCollapsed = shallowRef(false);
const generationDialogVisible = shallowRef(false);
const generationStarted = shallowRef(false);

function selectChapter(chapterId: string, chapterTitle: string): void {
  selectedChapter.value = { id: chapterId, title: chapterTitle };
}

function selectParagraph(paragraphId: string): void {
  selectedParagraphId.value = paragraphId;
}

function togglePlayback(paragraphId: string): void {
  playingParagraphId.value = playingParagraphId.value === paragraphId ? '' : paragraphId;
}

function confirmChapterGeneration(): void {
  generationStarted.value = true;
  generationDialogVisible.value = false;
  showDemoFeedback('第 12 章已切换为本地生成中展示', 'success');
}

function openProjectSettings(): void {
  void router.push({ name: getDemoPageRouteName('project-settings') });
}
</script>

<template>
  <AudioWorkspaceShell
    label="音频生成章节参数假交互页面"
    page-class="chapter-parameters-page"
    @chapter-select="selectChapter"
  >
    <section class="audio-editor" aria-label="剧本与章节检查器">
      <header class="chapter-toolbar">
        <div class="chapter-context">
          <strong>第 {{ selectedChapter.id }} 章</strong>
          <span>{{ selectedChapter.title }}</span>
        </div>
        <div class="toolbar-summary">
          <ElTag v-if="generationStarted" effect="plain" type="warning">
            ↻ 本地生成中
          </ElTag>
          <span v-else class="toolbar-summary-text">高匹配度 28 / 32 条音频</span>
          <ElButton
            :disabled="generationStarted"
            size="small"
            type="primary"
            @click="generationDialogVisible = true"
          >
            {{ generationStarted ? '本地生成中' : '生成本章音频' }}
          </ElButton>
        </div>
      </header>

      <div class="audio-editor-body">
        <section class="audio-script-pane" aria-label="剧本区，可独立滚动" role="listbox">
          <header class="script-header">
            <h1>剧本 · 第 {{ selectedChapter.id }} 章</h1>
            <p>32 段 · 当前选中 {{ selectedParagraphId }} · 播放仅为视觉状态</p>
          </header>
          <div class="script-hint">
            点击段落可选中；播放按钮只切换当前行图标与高亮，不加载音频。
          </div>

          <AudioParagraphRow
            number="18"
            paragraph-id="para_12_018"
            script="雨线斜斜地敲在檐上，门外忽然传来三声轻叩。"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_018'"
            :selected="selectedParagraphId === 'para_12_018'"
            speaker="旁白"
            state-text="当前行"
            @select="selectParagraph"
            @toggle-play="togglePlayback"
          />
          <AudioParagraphRow
            number="19"
            paragraph-id="para_12_019"
            script="“谁？”"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_019'"
            :selected="selectedParagraphId === 'para_12_019'"
            speaker="沈砚"
            state-text="悬停行"
            variant="hover"
            @select="selectParagraph"
            @toggle-play="togglePlayback"
          />
          <AudioParagraphRow
            number="20"
            paragraph-id="para_12_020"
            script="门外的人没有回答，只将油纸伞往廊下一收。"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_020'"
            :selected="selectedParagraphId === 'para_12_020'"
            speaker="旁白"
            state-text="键盘焦点"
            variant="focus"
            @select="selectParagraph"
            @toggle-play="togglePlayback"
          />
          <AudioParagraphRow
            number="21"
            paragraph-id="para_12_021"
            script="“是我。夜深了，仍要来叨扰。”"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_021'"
            :selected="selectedParagraphId === 'para_12_021'"
            speaker="苏婉"
            state-text="播放中"
            @select="selectParagraph"
            @toggle-play="togglePlayback"
          />
          <AudioParagraphRow
            number="22"
            paragraph-id="para_12_022"
            script="沈砚沉默片刻，侧身让开门。"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_022'"
            :selected="selectedParagraphId === 'para_12_022'"
            speaker="旁白"
            state-text="高匹配"
            variant="success"
            @select="selectParagraph"
            @toggle-play="togglePlayback"
          />
          <AudioParagraphRow
            class="audio-row--last"
            audio-version="历史音频 v2 · 已失效"
            number="23"
            paragraph-id="para_12_023"
            script="“多谢。”"
            secondary-status="ASR 已解绑"
            :playing="playingParagraphId === 'para_12_023'"
            :selected="selectedParagraphId === 'para_12_023'"
            speaker="苏婉"
            state-text="需要重新生成"
            status="↺ 已失效"
            status-tone="stale"
            variant="stale"
            @select="selectParagraph"
            @toggle-play="togglePlayback"
          />
        </section>

        <AudioInspectorPanel
          v-model:collapsed="inspectorCollapsed"
          label="章节参数，可独立滚动"
          :subtitle="`当前段落 ${selectedParagraphId} · 使用章节默认值`"
          title="章节参数"
        >
          <section class="inspector-card">
            <h3>章节默认生成设置</h3>
            <p>声音：按角色当前激活配置</p>
            <p>默认提示词：遵循角色与段落批注</p>
            <p>段落最长字数：180 字</p>
            <p>ASR Gate 阈值：90%</p>
          </section>
          <section class="inspector-card">
            <h3>本次整章生成范围</h3>
            <p>第 {{ selectedChapter.id }} 章 · para_{{ selectedChapter.id }}_001–032</p>
            <p>共 32 段；示例数量不作为默认值</p>
          </section>
          <section class="inspector-card">
            <h3>已有音频处理策略</h3>
            <p>保留高匹配结果</p>
            <p>待复核与已失效段落重新生成</p>
            <p>不暴露未经规格确认的复杂模型参数</p>
          </section>
          <ElButton class="inspector-link-button" link type="primary" @click="openProjectSettings">
            进入项目设置 ↗
          </ElButton>
        </AudioInspectorPanel>
      </div>
    </section>

    <ElDialog
      v-model="generationDialogVisible"
      append-to-body
      title="确认生成本章音频"
      width="420px"
    >
      <p>仅把本页切换为“生成中”视觉状态，不会创建任务或生成音频。</p>
      <template #footer>
        <ElButton @click="generationDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="confirmChapterGeneration">确认本地预览</ElButton>
      </template>
    </ElDialog>
  </AudioWorkspaceShell>
</template>
