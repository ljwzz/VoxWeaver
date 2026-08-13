<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import AudioInspectorPanel from './components/AudioInspectorPanel.vue';
import AudioParagraphRow from './components/AudioParagraphRow.vue';
import AudioWorkspaceShell from './components/AudioWorkspaceShell.vue';

type SelectionPreset = 'cross-line' | 'none' | 'sentence';

const router = useRouter();
const selectedChapter = shallowRef({ id: '12', title: '雨夜来客' });
const selectionPreset = shallowRef<SelectionPreset>('sentence');
const specialRequirement = shallowRef('压低音量，句尾略停顿；保持克制。');
const playingParagraphId = shallowRef('');
const inspectorCollapsed = shallowRef(false);
const regenerationPending = shallowRef(false);

const selectionSummary = computed(() => {
  if (selectionPreset.value === 'sentence')
    return '完整句子 · 第 18 行';
  if (selectionPreset.value === 'cross-line')
    return '跨行边界 · 第 18 行末至第 19 行首';
  return '选区已取消 · 尚未指定范围';
});

function selectChapter(chapterId: string, chapterTitle: string): void {
  selectedChapter.value = { id: chapterId, title: chapterTitle };
}

function selectPreset(preset: SelectionPreset): void {
  selectionPreset.value = preset;
  regenerationPending.value = false;
}

function togglePlayback(paragraphId: string): void {
  playingParagraphId.value = playingParagraphId.value === paragraphId ? '' : paragraphId;
}

function requestRegeneration(): void {
  if (selectionPreset.value === 'none')
    return;
  regenerationPending.value = true;
  showDemoFeedback('当前选区已标记为本地待处理', 'warning');
}

function restoreChapterParameters(): void {
  void router.push({ name: getDemoPageRouteName('audio-chapter-parameters') });
}

function handleEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape')
    restoreChapterParameters();
}

onMounted(() => window.addEventListener('keydown', handleEscape));
onBeforeUnmount(() => window.removeEventListener('keydown', handleEscape));
</script>

<template>
  <AudioWorkspaceShell
    label="音频生成选区特殊要求假交互页面"
    @chapter-select="selectChapter"
  >
    <section class="audio-editor" aria-label="选区剧本与检查器">
      <header class="chapter-toolbar">
        <div class="chapter-context">
          <strong>第 {{ selectedChapter.id }} 章</strong>
          <span>{{ selectedChapter.title }}</span>
        </div>
        <div class="toolbar-summary">
          <ElTag v-if="regenerationPending" effect="plain" type="warning">○ 本地待处理</ElTag>
          <span class="toolbar-summary-text">{{ selectionSummary }}</span>
        </div>
      </header>

      <div class="audio-editor-body">
        <section class="audio-script-pane" aria-label="选区剧本，可独立滚动" role="listbox">
          <header class="script-header">
            <h1>剧本 · 选区模式</h1>
            <p>通过既有句子与段落入口切换预设范围，不实现原生文本拖选。</p>
          </header>

          <div class="selection-preset-bar" aria-label="预设选区">
            <span>预设选区</span>
            <ElButton
              :type="selectionPreset === 'sentence' ? 'primary' : 'default'"
              size="small"
              @click="selectPreset('sentence')"
            >
              完整句子
            </ElButton>
            <ElButton
              :type="selectionPreset === 'cross-line' ? 'warning' : 'default'"
              size="small"
              @click="selectPreset('cross-line')"
            >
              跨行边界
            </ElButton>
            <ElButton
              :type="selectionPreset === 'none' ? 'info' : 'default'"
              size="small"
              @click="selectPreset('none')"
            >
              取消高亮
            </ElButton>
          </div>

          <AudioParagraphRow
            number="17"
            paragraph-id="para_12_017"
            script="门轴轻响，沈砚抬眼望向廊下。"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_017'"
            speaker="旁白"
            state-text="当前行"
            @toggle-play="togglePlayback"
          />
          <AudioParagraphRow
            number="18"
            paragraph-id="para_12_018"
            script="“你终于来了。”"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_018'"
            :selected="selectionPreset === 'sentence' || selectionPreset === 'cross-line'"
            speaker="苏婉"
            :state-text="selectionPreset === 'sentence' ? '完整句子已选中' : selectionPreset === 'cross-line' ? '跨行起点已选中' : '选区已取消'"
            :variant="selectionPreset === 'none' ? 'current' : 'selection'"
            @select="selectPreset('sentence')"
            @toggle-play="togglePlayback"
          />

          <button
            v-if="selectionPreset === 'sentence'"
            class="selection-strip selection-entry"
            data-selection-state="sentence"
            type="button"
            @click="selectPreset('sentence')"
          >
            <strong>完整句子 <span>← 当前选区</span></strong>
            <span>「你终于来了。」</span>
          </button>

          <AudioParagraphRow
            number="19"
            paragraph-id="para_12_019"
            script="“雨这样大，你不该一个人来。”"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_019'"
            :selected="selectionPreset === 'cross-line'"
            speaker="沈砚"
            :state-text="selectionPreset === 'cross-line' ? '跨行终点已选中' : '当前行'"
            :variant="selectionPreset === 'cross-line' ? 'selection' : 'current'"
            @select="selectPreset('cross-line')"
            @toggle-play="togglePlayback"
          />

          <button
            v-if="selectionPreset === 'cross-line'"
            class="selection-strip selection-strip--cross-line selection-entry"
            data-selection-state="cross-line"
            type="button"
            @click="selectPreset('cross-line')"
          >
            <strong>跨行边界 <span>↕ 当前边界</span></strong>
            <span>第 18 行末 → 第 19 行首 · 范围待确认</span>
          </button>

          <div
            v-if="selectionPreset === 'none'"
            class="selection-cancelled-state"
            data-selection-state="none"
            role="status"
          >
            <ElTag effect="plain" type="info">选区已取消</ElTag>
            <span>当前没有文本范围；特殊要求不会应用到任何音频。</span>
          </div>

          <AudioParagraphRow
            number="20"
            paragraph-id="para_12_020"
            script="她把伞靠在墙边，衣袖仍在往下滴水。"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_020'"
            speaker="旁白"
            state-text="当前行"
            @toggle-play="togglePlayback"
          />
        </section>

        <AudioInspectorPanel
          v-model:collapsed="inspectorCollapsed"
          label="选区设置，可独立滚动"
          :subtitle="selectionSummary"
          title="选区设置"
        >
          <section class="inspector-card">
            <h3>当前选区</h3>
            <template v-if="selectionPreset === 'sentence'">
              <p>所属段落：para_12_018</p>
              <p>说话人：苏婉</p>
              <p>选中文本：“你终于来了。”</p>
            </template>
            <template v-else-if="selectionPreset === 'cross-line'">
              <p>起点：para_12_018 行末</p>
              <p>终点：para_12_019 行首</p>
              <p>边界状态：跨行范围待确认</p>
            </template>
            <p v-else>选区已取消；请选择完整句子或跨行边界。</p>
          </section>

          <ElButton
            :class="{ 'is-playing-preview': playingParagraphId === 'selection' }"
            :disabled="selectionPreset === 'none'"
            plain
            @click="togglePlayback('selection')"
          >
            {{ playingParagraphId === 'selection' ? 'Ⅱ 停止试听视觉' : '▶ 试听视觉 00:08' }}
          </ElButton>

          <section class="inspector-card">
            <h3>特殊要求提示词</h3>
            <ElInput
              v-model="specialRequirement"
              aria-label="特殊要求提示词"
              :disabled="selectionPreset === 'none'"
              :rows="4"
              type="textarea"
            />
          </section>

          <ElButton
            :disabled="selectionPreset === 'none' || regenerationPending"
            type="primary"
            @click="requestRegeneration"
          >
            {{ regenerationPending ? '本地待处理' : '重新生成' }}
          </ElButton>
          <section class="inspector-card inspector-card--warning">
            <h3>范围说明</h3>
            <p>特殊要求仅锁定到当前预设选区；不会生成真实音频。</p>
          </section>
          <ElButton link type="primary" @click="restoreChapterParameters">
            取消选择 · 恢复章节参数
          </ElButton>
          <footer class="inspector-footer">
            <ElButton @click="restoreChapterParameters">取消选择</ElButton>
            <span>Esc 返回章节参数</span>
          </footer>
        </AudioInspectorPanel>
      </div>
    </section>
  </AudioWorkspaceShell>
</template>
