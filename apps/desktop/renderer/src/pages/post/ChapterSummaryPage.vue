<script setup lang="ts">
import { computed, ref } from 'vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import PostWorkbenchFrame from './PostWorkbenchFrame.vue';

type SummaryHistoryStatus = 'confirmed' | 'current' | 'stale';

interface SummaryHistoryItem {
  inputVersion: string;
  label: string;
  status: SummaryHistoryStatus;
  text: string;
  version: string;
}

const initialSummary = '雨夜，沈砚独自在旧宅整理遗物，门外忽然传来三声轻叩。来客苏婉带着一封多年未曾寄出的信，也带回一段被刻意掩埋的往事。\n\n两人在试探与沉默之间重新拼合线索：失踪的账册、被改写的证词，以及雨幕中反复出现的脚步声，都指向同一个未被审判的夜晚。\n\n章节结尾，苏婉留下信件后离开。沈砚没有追出去，只听见脚步声在廊下停顿了一瞬。';
const regeneratedSummary = '雨夜，苏婉带着一封未寄出的旧信来到沈砚的宅邸。两人围绕失踪账册、被改写的证词与重复出现的脚步声重新核对线索。章节结尾，苏婉留下信件离开，沈砚在沉默中意识到往事仍未结束。';

const summaryHistory: readonly SummaryHistoryItem[] = [
  { inputVersion: '剧本 v18', label: '待确认', status: 'current', text: initialSummary, version: 'v3' },
  { inputVersion: '剧本 v17', label: '已失效', status: 'stale', text: '旧宅雨夜出现来客，沈砚收到一封信并开始调查旧案。', version: 'v2' },
  { inputVersion: '剧本 v16', label: '已确认历史', status: 'confirmed', text: '沈砚在雨夜接待来客，旧案的线索重新浮现。', version: 'v1' },
];

const draft = ref(initialSummary);
const draftState = ref('本地草稿 · 未修改');
const selectedHistoryVersion = ref('v3');
const confirmedVersionLabel = ref('候选 v3 · 待确认');
const differenceVisible = ref(false);
const regenerationVariant = ref<'initial' | 'regenerated'>('initial');

const characterCount = computed(() => Array.from(draft.value).length);
const selectedHistory = computed<SummaryHistoryItem>(() => (
  summaryHistory.find(item => item.version === selectedHistoryVersion.value) ?? summaryHistory[0]!
));

function markDraftEdited(): void {
  selectedHistoryVersion.value = 'v3';
  draftState.value = '本地草稿 · 已保存到当前页面';
  confirmedVersionLabel.value = '候选 v3 · 待确认';
}

function showDifference(): void {
  differenceVisible.value = true;
}

function regenerateCandidate(): void {
  regenerationVariant.value = regenerationVariant.value === 'initial' ? 'regenerated' : 'initial';
  draft.value = regenerationVariant.value === 'initial' ? initialSummary : regeneratedSummary;
  selectedHistoryVersion.value = 'v3';
  draftState.value = `本地草稿 · 已切换现有候选 ${regenerationVariant.value === 'initial' ? 'A' : 'B'}`;
  confirmedVersionLabel.value = '候选 v3 · 待确认';
  showDemoFeedback('已切换现有摘要候选，未调用 LLM', 'info');
}

function confirmSummary(): void {
  confirmedVersionLabel.value = 'v3 · 本地已确认';
  draftState.value = '本地草稿 · 已确认到当前页面';
  showDemoFeedback('章节摘要已更新为本地确认状态', 'success');
}

function selectHistory(item: SummaryHistoryItem): void {
  selectedHistoryVersion.value = item.version;
  if (item.status === 'stale') {
    showDemoFeedback('已失效版本仅供查看，未恢复为当前输入', 'warning');
    return;
  }

  if (item.status === 'current')
    draft.value = regenerationVariant.value === 'initial' ? initialSummary : regeneratedSummary;
}
</script>

<template>
  <PostWorkbenchFrame editor-label="章节摘要编辑区">
    <header class="chapter-toolbar">
      <div class="chapter-context">
        <h2>第 12 章 · 雨夜来客</h2>
        <p>章节摘要生成 · 当前有效剧本 v18</p>
      </div>
      <div class="toolbar-spacer"></div>
      <ElTag effect="plain" type="warning" data-testid="summary-version-label">{{ confirmedVersionLabel }}</ElTag>
      <ElTag effect="plain" type="info">旧摘要 v2 · 已失效</ElTag>
      <ElButton type="primary" data-testid="confirm-summary" @click="confirmSummary">确认章节摘要</ElButton>
    </header>

    <div class="post-content">
      <div class="post-content-inner three-column">
        <section class="dense-column card" aria-label="有效剧本固定快照">
          <h3 class="section-title">有效剧本与内容范围</h3>
          <ElTag effect="plain" type="success">v18 · 当前有效</ElTag>
          <div class="info-stack">
            <div class="info-row"><span class="caption">章节范围</span><span class="caption">para_12_001 – 032</span></div>
            <div class="info-row"><span class="caption">内容统计</span><span class="caption">32 段 · 3,842 字</span></div>
            <div class="info-row"><span class="caption">更新时间</span><span class="caption">今天 10:42</span></div>
          </div>
          <div class="script-update">
            <strong class="label state-stale">ⓧ 剧本已更新</strong>
            <span class="caption state-stale">摘要 v2 因输入变化已失效</span>
          </div>
          <div class="chapter-preview">
            <strong class="label">章节内容预览</strong>
            <div class="paragraph-row"><span>001</span><span>雨线斜斜地敲在檐上……</span></div>
            <div class="paragraph-row"><span>006</span><span>沈砚起身走向门边。</span></div>
            <div class="paragraph-row"><span>012</span><span>陌生人收起油纸伞。</span></div>
            <div class="paragraph-row is-current"><span>018</span><span>门外传来三声轻叩。</span></div>
            <div class="paragraph-row"><span>023</span><span>“多谢。”</span></div>
            <div class="paragraph-row"><span>032</span><span>灯火在雨幕里渐远。</span></div>
          </div>
        </section>

        <section class="dense-column card" aria-label="摘要候选编辑">
          <div class="notice-stale">
            <strong class="body-strong">ⓧ</strong>
            <div class="notice-stale-message">
              <strong class="body-strong">摘要 v2 已失效，需要重新确认</strong>
              <span class="caption state-stale">输入从剧本 v17 更新为 v18 · 变更 8 处</span>
            </div>
          </div>
          <div class="candidate-summary-header">
            <h3 class="section-title">摘要候选 v3</h3>
            <span class="caption state-warning">✎ 可编辑 · {{ draftState }}</span>
          </div>
          <div class="summary-editor summary-editor--interactive">
            <ElInput
              v-model="draft"
              aria-label="摘要候选"
              data-testid="summary-input"
              :maxlength="360"
              resize="none"
              :rows="15"
              type="textarea"
              @input="markDraftEdited"
            />
            <div class="editor-stats">
              <span class="caption" data-testid="summary-count">{{ characterCount }} / 360 字</span>
              <span class="caption state-success">{{ draftState }}</span>
            </div>
          </div>
          <button class="change-summary" data-testid="show-summary-difference" type="button" @click="showDifference">
            <span>相较摘要 v2：新增 2 个线索 · 改写结尾 · 删除过时人物关系</span>
            <span>查看差异 ↗</span>
          </button>
        </section>

        <aside class="dense-column card" aria-label="生成输入与版本信息">
          <h3 class="section-title">生成输入与版本</h3>
          <div class="input-card summary-input-card">
            <div class="info-row"><span class="caption">输入版本</span><span class="caption">剧本 v18</span></div>
            <div class="info-row"><span class="caption">章节范围</span><span class="caption">001 – 032</span></div>
            <div class="info-row"><span class="caption">候选状态</span><span class="caption">{{ regenerationVariant === 'initial' ? '候选 A' : '候选 B' }}</span></div>
            <div class="info-row"><span class="caption">输入摘要</span><span class="caption">sha256 7b4e…a12c</span></div>
          </div>
          <span class="label">提示词</span>
          <div class="prompt-card">保留核心冲突和悬念；按事件顺序概括；不添加剧本未出现的事实；结尾避免剧透下一章。</div>
          <ElButton data-testid="regenerate-summary" @click="regenerateCandidate">重新生成</ElButton>
          <div class="history-header"><strong class="label">历史版本</strong><span class="caption">3 个版本</span></div>
          <div class="history-list">
            <button
              v-for="item in summaryHistory"
              :key="item.version"
              class="history-item"
              :class="[`is-${item.status === 'current' ? 'warning' : item.status === 'stale' ? 'stale' : 'success'}`, { 'is-selected': item.version === selectedHistoryVersion }]"
              :data-history-version="item.version"
              type="button"
              @click="selectHistory(item)"
            >
              <span>{{ item.version }}</span>
              <span>{{ item.status === 'stale' ? 'ⓧ ' : '' }}{{ item.label }} · {{ item.inputVersion }}</span>
            </button>
          </div>
          <div class="history-preview" data-testid="history-preview">
            <strong>{{ selectedHistory.version }} · {{ selectedHistory.label }}</strong>
            <p>{{ selectedHistory.text }}</p>
            <span v-if="selectedHistory.status === 'stale'" class="state-stale">仅查看：不能恢复为当前有效输入</span>
          </div>
        </aside>
      </div>
    </div>

    <ElDrawer
      v-model="differenceVisible"
      data-testid="summary-difference-drawer"
      direction="rtl"
      :teleported="false"
      title="摘要差异"
      size="440px"
    >
      <div class="difference-content">
        <ElTag effect="plain" type="info">v2 · 已失效</ElTag>
        <p><del>沈砚收到一封匿名信。</del></p>
        <ElTag effect="plain" type="success">v3 · 当前候选</ElTag>
        <p><ins>苏婉带来一封多年未曾寄出的信，并补充失踪账册与被改写证词两条线索。</ins></p>
        <p class="caption">差异只来自页面内固定版本，不调用生成服务。</p>
      </div>
    </ElDrawer>
  </PostWorkbenchFrame>
</template>
