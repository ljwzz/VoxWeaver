<script setup lang="ts">
import { shallowRef } from 'vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import AudioInspectorPanel from './components/AudioInspectorPanel.vue';
import AudioParagraphRow from './components/AudioParagraphRow.vue';
import AudioWorkspaceShell from './components/AudioWorkspaceShell.vue';

const selectedChapter = shallowRef({ id: '12', title: '雨夜来客' });
const lowMatchExpanded = shallowRef(true);
const playingParagraphId = shallowRef('');
const lowMatchConfirmed = shallowRef(false);
const validationRetrying = shallowRef(false);
const inspectorCollapsed = shallowRef(false);
const promptDialogVisible = shallowRef(false);
const adjustedPrompt = shallowRef('压低音量，清晰读出“终于”，保持克制。');
const lowMatchPending = shallowRef(false);

function selectChapter(chapterId: string, chapterTitle: string): void {
  selectedChapter.value = { id: chapterId, title: chapterTitle };
}

function togglePlayback(paragraphId: string): void {
  playingParagraphId.value = playingParagraphId.value === paragraphId ? '' : paragraphId;
}

function confirmLowMatch(): void {
  lowMatchConfirmed.value = true;
  lowMatchExpanded.value = false;
  showDemoFeedback('低匹配行已切换为人工确认展示', 'success');
}

function retryValidation(): void {
  validationRetrying.value = true;
  showDemoFeedback('校验失败行已进入本地重试状态', 'warning');
}

function confirmPromptAdjustment(): void {
  promptDialogVisible.value = false;
  lowMatchPending.value = true;
  showDemoFeedback('提示词已保存并标记为本地待处理', 'warning');
}
</script>

<template>
  <AudioWorkspaceShell
    label="ASR 低匹配行内复核假交互页面"
    @chapter-select="selectChapter"
  >
    <section class="audio-editor" aria-label="ASR 复核剧本与检查器">
      <header class="chapter-toolbar">
        <div class="chapter-context">
          <strong>第 {{ selectedChapter.id }} 章</strong>
          <span>{{ selectedChapter.title }}</span>
        </div>
        <div class="toolbar-summary">
          <ElTag v-if="lowMatchPending" effect="plain" type="warning">○ 本地待处理</ElTag>
          <span class="toolbar-summary-text">
            {{ lowMatchConfirmed ? '人工确认 1 · 高匹配 29' : '低匹配 1 · 高匹配 28' }}
          </span>
        </div>
      </header>

      <div class="audio-editor-body">
        <section class="audio-script-pane" aria-label="ASR 行内复核，可独立滚动">
          <header class="script-header">
            <h1>ASR Gate · 行内复核</h1>
            <p>{{ lowMatchConfirmed ? '待复核 0 · 人工确认 1' : '低匹配 1' }} · 校验失败 1 · 高匹配 28</p>
          </header>
          <div class="script-hint">
            转写不一致仅作为复核证据；不推断为“发音错误”。
          </div>

          <AudioParagraphRow
            number="18"
            paragraph-id="para_12_018"
            script="“你终于来了。”"
            :secondary-status="lowMatchConfirmed ? '✓ 人工确认 · 原相似度 82%' : '! 低匹配 · 82%'"
            :playing="playingParagraphId === 'para_12_018'"
            speaker="苏婉"
            :state-text="lowMatchConfirmed ? '✓ 已人工确认 · 原转写不一致记录保留' : '⚠ 转写结果不一致，待复核 · 相似度 82% · 阈值 90%'"
            :status="lowMatchConfirmed ? '✓ 已确认' : '! 低匹配'"
            :status-tone="lowMatchConfirmed ? 'success' : 'low-match'"
            :variant="lowMatchConfirmed ? 'success' : 'low-match'"
            @toggle-play="togglePlayback"
          />

          <section
            v-if="!lowMatchConfirmed"
            class="asr-diff-panel"
            :class="{ 'asr-diff-panel--collapsed': !lowMatchExpanded }"
            aria-label="ASR 差异证据面板"
          >
            <header class="asr-diff-title">
              <span>⚠ 转写结果不一致，待复核 · 82%</span>
              <ElButton link type="primary" @click="lowMatchExpanded = !lowMatchExpanded">
                {{ lowMatchExpanded ? '收起' : '展开' }}
              </ElButton>
            </header>
            <template v-if="lowMatchExpanded">
              <div class="asr-compare">
                <div class="asr-card">
                  <strong>目标剧本文本</strong>
                  <span>“你终于来了，我等了很久。”</span>
                  <span><em>差异定位：终于</em></span>
                </div>
                <div class="asr-card">
                  <strong>ASR 回听文本</strong>
                  <span>“你总于来了，我等了很久。”</span>
                  <span><em>回听片段：总于</em></span>
                </div>
              </div>
              <div class="asr-actions">
                <ElButton
                  :type="playingParagraphId === 'para_12_018' ? 'primary' : 'default'"
                  size="small"
                  @click="togglePlayback('para_12_018')"
                >
                  {{ playingParagraphId === 'para_12_018' ? 'Ⅱ 停止试听' : '▶ 试听' }}
                </ElButton>
                <ElButton size="small" @click="promptDialogVisible = true">
                  调整提示词并重新生成
                </ElButton>
                <ElButton size="small" type="primary" @click="confirmLowMatch">
                  人工确认
                </ElButton>
              </div>
            </template>
          </section>

          <AudioParagraphRow
            number="19"
            paragraph-id="para_12_019"
            script="“雨这样大，你不该一个人来。”"
            :secondary-status="validationRetrying ? '↻ 本地重试中' : '× 校验失败'"
            :playing="playingParagraphId === 'para_12_019'"
            speaker="沈砚"
            :state-text="validationRetrying ? '本地重试中 · 不调用 ASR' : '校验失败 · 可重试'"
            :status="validationRetrying ? '↻ 重试中' : '× 校验失败'"
            :status-tone="validationRetrying ? 'warning' : 'error'"
            :variant="validationRetrying ? 'generating' : 'error'"
            @toggle-play="togglePlayback"
          >
            <template #status>
              <span class="audio-version">音频 v3</span>
              <ElTag :type="validationRetrying ? 'warning' : 'danger'" effect="plain">
                {{ validationRetrying ? '↻ 本地重试中' : '× 校验失败' }}
              </ElTag>
              <ElButton
                v-if="!validationRetrying"
                size="small"
                @click.stop="retryValidation"
              >
                重试校验
              </ElButton>
            </template>
          </AudioParagraphRow>

          <AudioParagraphRow
            number="20"
            paragraph-id="para_12_020"
            script="她把伞靠在墙边，衣袖仍在往下滴水。"
            secondary-status="✓ 高匹配 · 96%"
            :playing="playingParagraphId === 'para_12_020'"
            speaker="旁白"
            state-text="高匹配"
            variant="success"
            @toggle-play="togglePlayback"
          />
        </section>

        <AudioInspectorPanel
          v-model:collapsed="inspectorCollapsed"
          label="ASR 复核说明，可独立滚动"
          subtitle="ASR 证据与人工判断保持分离"
          title="复核说明"
        >
          <section class="inspector-card">
            <h3>状态表达</h3>
            <p>低匹配：洋红边框 + ⚠ 图标 + 文字 + 82% 相似度</p>
            <p>校验失败：红色边框 + × 图标 + 独立重试入口</p>
            <p>人工确认：绿色边框 + ✓ 图标 + 已确认文字</p>
          </section>
          <section class="inspector-card">
            <h3>判断边界</h3>
            <p>保留“转写不一致”语义。</p>
            <p>不把 ASR 证据改写成“发音错误”。</p>
          </section>
          <section v-if="lowMatchPending" class="inspector-card inspector-card--warning">
            <h3>本地待处理</h3>
            <p>{{ adjustedPrompt }}</p>
          </section>
        </AudioInspectorPanel>
      </div>
    </section>

    <ElDialog
      v-model="promptDialogVisible"
      append-to-body
      title="调整提示词并重新生成"
      width="480px"
    >
      <ElInput
        v-model="adjustedPrompt"
        aria-label="调整后的提示词"
        :rows="4"
        type="textarea"
      />
      <p class="dialog-local-note">确认后只标记为本地待处理，不调用 TTS 或 ASR。</p>
      <template #footer>
        <ElButton @click="promptDialogVisible = false">取消</ElButton>
        <ElButton type="primary" @click="confirmPromptAdjustment">保存本地状态</ElButton>
      </template>
    </ElDialog>
  </AudioWorkspaceShell>
</template>
