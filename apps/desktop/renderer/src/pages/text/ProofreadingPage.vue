<script setup lang="ts">
import { computed, ref } from 'vue';
import PageDocument from '@/components/PageDocument.vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';
import TextDemoShell from './TextDemoShell.vue';

type ProofreadingStatus = 'accepted' | 'edited' | 'kept' | 'pending';

interface ProofreadingIssue {
  chapter: string;
  confidence: 'high' | 'medium';
  context: string;
  id: string;
  initialStatus: ProofreadingStatus;
  line: string;
  original: string;
  status: ProofreadingStatus;
  suggestion: string;
  summary: string;
  type: 'punctuation' | 'typo';
}

const bodyClasses = ['text-page'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const issues = ref<ProofreadingIssue[]>([
  {
    chapter: 'chapter-3',
    confidence: 'high',
    context: '雨声渐密，走廊尽头传来脚步。林舟却已经看见门缝后的影子。',
    id: 'issue-1283',
    initialStatus: 'pending',
    line: '1283',
    original: '他低声说道：“别回头。',
    status: 'pending',
    suggestion: '他低声说道：“别回头。”',
    summary: '句尾缺少闭合引号',
    type: 'punctuation',
  },
  {
    chapter: 'chapter-3',
    confidence: 'high',
    context: '沈砚合上药箱，林舟转身看向门口。',
    id: 'issue-1284',
    initialStatus: 'pending',
    line: '1284',
    original: '“沈研”合上药箱。',
    status: 'pending',
    suggestion: '“沈砚”合上药箱。',
    summary: '“沈砚”疑似误写为“沈研”',
    type: 'typo',
  },
  {
    chapter: 'chapter-3',
    confidence: 'medium',
    context: '走廊里只剩雨水敲击玻璃的声音。',
    id: 'issue-1290',
    initialStatus: 'kept',
    line: '1290',
    original: '他停了很久………',
    status: 'kept',
    suggestion: '他停了很久……',
    summary: '连续三个省略号可能需要规范',
    type: 'punctuation',
  },
  {
    chapter: 'chapter-3',
    confidence: 'high',
    context: '林舟没有回答，只把手按在门把上。',
    id: 'issue-1302',
    initialStatus: 'accepted',
    line: '1302',
    original: '“现在走。',
    status: 'accepted',
    suggestion: '“现在走。”',
    summary: '句尾缺少闭合引号',
    type: 'punctuation',
  },
]);
const currentIssueId = ref('issue-1283');
const chapterFilter = ref('chapter-3');
const issueTypeFilter = ref('all');
const confidenceFilter = ref('all');
const manualEditing = ref(false);
const manualDraft = ref('');

const currentIssue = computed(() => (
  issues.value.find(issue => issue.id === currentIssueId.value) ?? issues.value[0]!
));
const resolvedDemoCount = computed(() => issues.value.filter(issue => (
  issue.initialStatus === 'pending' && issue.status !== 'pending'
)).length);
const processedCount = computed(() => 18 + resolvedDemoCount.value);
const pendingCount = computed(() => Math.max(0, 7 - resolvedDemoCount.value));
const visibleQueue = computed(() => issues.value.filter((issue) => {
  if (issue.id === currentIssueId.value)
    return false;
  if (chapterFilter.value !== 'all' && issue.chapter !== chapterFilter.value)
    return false;
  if (issueTypeFilter.value !== 'all' && issue.type !== issueTypeFilter.value)
    return false;
  if (confidenceFilter.value === 'pending' && issue.status !== 'pending')
    return false;
  if (confidenceFilter.value === 'high' && issue.confidence !== 'high')
    return false;
  return true;
}));

function statusLabel(status: ProofreadingStatus): string {
  return {
    accepted: '建议已接受',
    edited: '手动编辑已保存',
    kept: '已保留原文',
    pending: '系统候选 · 待复核',
  }[status];
}

function statusBadgeClass(status: ProofreadingStatus): string {
  if (status === 'pending')
    return 'status-badge--review';
  if (status === 'kept')
    return 'status-badge--neutral';
  return 'status-badge--success';
}

function statusBadgeText(status: ProofreadingStatus): string {
  if (status === 'pending')
    return '! 待复核';
  if (status === 'kept')
    return '• 已保留';
  return '✓ 已完成';
}

function selectIssue(issueId: string): void {
  currentIssueId.value = issueId;
  manualEditing.value = false;
}

function beginManualEdit(): void {
  manualDraft.value = currentIssue.value.suggestion;
  manualEditing.value = true;
}

function saveManualEdit(): void {
  const editedText = manualDraft.value.trim();
  if (!editedText)
    return;

  currentIssue.value.suggestion = editedText;
  currentIssue.value.status = 'edited';
  manualEditing.value = false;
  showDemoFeedback('手动编辑已保存到当前页面状态', 'success');
}

function keepOriginal(): void {
  currentIssue.value.status = 'kept';
  manualEditing.value = false;
  showDemoFeedback(`已保留第 ${currentIssue.value.line} 行原文`);
}

function acceptSuggestion(): void {
  currentIssue.value.status = 'accepted';
  manualEditing.value = false;
  showDemoFeedback(`已接受第 ${currentIssue.value.line} 行建议`, 'success');
}

function goToNextPending(): void {
  const currentIndex = issues.value.findIndex(issue => issue.id === currentIssueId.value);
  for (let offset = 1; offset <= issues.value.length; offset += 1) {
    const candidate = issues.value[(currentIndex + offset) % issues.value.length]!;
    if (candidate.status === 'pending') {
      selectIssue(candidate.id);
      return;
    }
  }

  showDemoFeedback('当前演示队列没有下一条待处理项', 'success');
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <TextDemoShell
      current-page="proofreading"
      editor-aria-label="错别字与标点编辑区"
      label="VoxWeaver 错别字与标点演示页面"
      :toolbar-detail="`第 3 章 · 已处理 ${processedCount} / 待处理 ${pendingCount}`"
      toolbar-title="错别字与标点"
    >
      <template #toolbar-actions>
        <span class="icon-button" aria-disabled="true">⋯</span>
        <ElButton class="toolbar-button toolbar-button--secondary" @click="showDemoFeedback('已打开批量操作演示')">
          批量操作
        </ElButton>
        <ElButton class="toolbar-button toolbar-button--primary" data-testid="next-proofreading-issue" @click="goToNextPending">
          下一项
        </ElButton>
      </template>

      <div class="text-editor-content text-editor-content--wide">
        <div class="page-heading">
          <div class="page-heading-copy"><h2>错别字与标点</h2><p>本章已处理 {{ processedCount }} 项 · 待处理 {{ pendingCount }} 项</p></div>
          <span class="status-badge" :class="[statusBadgeClass(currentIssue.status)]">{{ statusBadgeText(currentIssue.status) }}</span>
        </div>

        <div class="filter-row">
          <label class="static-filter static-filter--control" style="width: 420px">
            <span class="static-filter-label">章节</span>
            <ElSelect v-model="chapterFilter" aria-label="章节筛选">
              <ElOption label="全部章节" value="all" />
              <ElOption label="第 3 章 · 门后的影子" value="chapter-3" />
              <ElOption label="第 8 章 · 白鸢" value="chapter-8" />
            </ElSelect>
          </label>
          <label class="static-filter static-filter--control" style="width: 320px">
            <span class="static-filter-label">问题类型</span>
            <ElSelect v-model="issueTypeFilter" aria-label="问题类型筛选">
              <ElOption label="错别字与标点" value="all" />
              <ElOption label="错别字" value="typo" />
              <ElOption label="标点" value="punctuation" />
            </ElSelect>
          </label>
          <label class="static-filter static-filter--control" style="width: 336px">
            <span class="static-filter-label">置信状态</span>
            <ElSelect v-model="confidenceFilter" aria-label="置信状态筛选">
              <ElOption label="全部状态" value="all" />
              <ElOption label="高置信" value="high" />
              <ElOption label="待确认" value="pending" />
            </ElSelect>
          </label>
        </div>

        <section class="surface-card proofreading-card" data-testid="current-proofreading-issue">
          <div class="row-between"><div class="proofreading-title"><span class="strong">{{ currentIssue.type === 'typo' ? '错别字' : '标点' }} · {{ currentIssue.confidence === 'high' ? '高置信' : '中置信' }}</span><span class="caption">第 3 章 · 显示行 {{ currentIssue.line }}</span></div><span class="status-badge" :class="[statusBadgeClass(currentIssue.status)]">{{ statusBadgeText(currentIssue.status) }}</span></div>
          <div class="comparison-grid">
            <div class="comparison-cell"><span class="preview-tag" style="color: var(--vw-text-secondary)">原文</span><p class="body-large">{{ currentIssue.original }}</p></div>
            <div class="comparison-cell comparison-cell--candidate">
              <span class="preview-tag" style="color: var(--vw-text-secondary)">修改候选</span>
              <ElInput v-if="manualEditing" v-model="manualDraft" aria-label="手动编辑文本" :rows="2" type="textarea" />
              <p v-else class="body-large">{{ currentIssue.suggestion }}</p>
            </div>
            <div class="comparison-cell"><span class="preview-tag" style="color: var(--vw-text-secondary)">上下文</span><p class="body-large">{{ currentIssue.context }}</p></div>
          </div>
          <div class="impact-callout"><span class="impact-badge">链&nbsp; 音频 2 · 时间轴 1</span><p class="body-copy">若接受，此修改可能影响剧本正文、已生成音频与后续时间轴；当前仅提示影响，尚未执行失效标记。</p></div>
          <div class="card-actions">
            <template v-if="manualEditing">
              <ElButton class="text-button" @click="manualEditing = false">取消编辑</ElButton>
              <ElButton class="text-button text-button--primary" :disabled="!manualDraft.trim()" @click="saveManualEdit">保存手动编辑</ElButton>
            </template>
            <template v-else>
              <ElButton class="text-button" @click="beginManualEdit">手动编辑</ElButton>
              <ElButton class="text-button" data-testid="keep-proofreading-original" @click="keepOriginal">保留原文</ElButton>
              <ElButton class="text-button text-button--primary" data-testid="accept-proofreading-suggestion" @click="acceptSuggestion">接受建议</ElButton>
            </template>
          </div>
        </section>

        <div class="section-header" style="width: 100%"><span class="strong">本章问题队列</span><span class="caption">已处理 {{ processedCount }} · 待处理 {{ pendingCount }}</span></div>
        <div class="issue-queue">
          <button
            v-for="issue in visibleQueue"
            :key="issue.id"
            class="surface-card queue-row" :class="[{ 'queue-row--selected': issue.id === currentIssueId }]"
            :data-testid="`proofreading-queue-${issue.id}`"
            type="button"
            @click="selectIssue(issue.id)"
          >
            <span class="queue-copy"><span class="caption">{{ issue.line }}</span><span>{{ issue.summary }}</span><span class="caption">{{ statusLabel(issue.status) }}</span></span>
            <span class="status-badge" :class="[statusBadgeClass(issue.status)]">{{ statusBadgeText(issue.status) }}</span>
          </button>
          <p v-if="visibleQueue.length === 0" class="empty-filter-result">当前筛选条件下没有其他问题。</p>
        </div>
      </div>
    </TextDemoShell>
  </PageDocument>
</template>
