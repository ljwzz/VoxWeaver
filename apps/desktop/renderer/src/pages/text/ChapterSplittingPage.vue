<script setup lang="ts">
import { computed, ref } from 'vue';
import PageDocument from '@/components/PageDocument.vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';
import TextDemoShell from './TextDemoShell.vue';

interface DemoChapter {
  id: string;
  issue?: boolean;
  number: string;
  title: string;
  volume: 1 | 2;
}

const bodyClasses = ['text-page'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const chapters = ref<DemoChapter[]>([
  { id: 'chapter-01', number: '01', title: '第一章 · 雨夜', volume: 1 },
  { id: 'chapter-02', number: '02', title: '第二章 · 旧信', volume: 1 },
  { id: 'chapter-03', number: '03', title: '第三章 · 门后的影子', volume: 1 },
  { id: 'chapter-04', issue: true, number: '04', title: '第四章 · 空章节', volume: 1 },
  { id: 'chapter-19', issue: true, number: '19', title: '第十九章 · 边界重叠', volume: 2 },
]);
const selectedChapterId = ref('chapter-03');
const firstVolumeExpanded = ref(true);
const secondVolumeExpanded = ref(true);
const renameDialogOpen = ref(false);
const renameDraft = ref('');
const upperBoundary = ref(1280);
const lowerBoundary = ref(2140);
const structureIssues = ref(3);
const operationNote = ref('边界调整会重新计算章节内容范围；保存前问题列表必须清零。');

const selectedChapter = computed(() => (
  chapters.value.find(chapter => chapter.id === selectedChapterId.value) ?? chapters.value[0]!
));
const hasStructureIssues = computed(() => structureIssues.value > 0);

function selectChapter(chapterId: string): void {
  selectedChapterId.value = chapterId;
  operationNote.value = `已在本地选择：${selectedChapter.value.title}`;
}

function openRenameDialog(): void {
  renameDraft.value = selectedChapter.value.title;
  renameDialogOpen.value = true;
}

function renameChapter(): void {
  const nextName = renameDraft.value.trim();
  if (!nextName)
    return;

  selectedChapter.value.title = nextName;
  operationNote.value = `章节名已在当前预览中改为“${nextName}”。`;
  renameDialogOpen.value = false;
}

function moveChapter(): void {
  const index = chapters.value.findIndex(chapter => chapter.id === selectedChapterId.value);
  if (index <= 0) {
    operationNote.value = '当前章节已位于本地演示列表顶部。';
    return;
  }

  const previous = chapters.value[index - 1]!;
  chapters.value[index - 1] = chapters.value[index]!;
  chapters.value[index] = previous;
  operationNote.value = `已将“${selectedChapter.value.title}”在本地演示中上移一位。`;
}

function splitChapter(): void {
  lowerBoundary.value = Math.max(upperBoundary.value + 1, Math.round((upperBoundary.value + lowerBoundary.value) / 2));
  operationNote.value = `已为“${selectedChapter.value.title}”生成本地拆分预览，未创建章节记录。`;
}

function mergeChapter(): void {
  operationNote.value = `已为“${selectedChapter.value.title}”展示与上一章合并的本地预览。`;
}

function autoDetectBoundaries(): void {
  upperBoundary.value = 1280;
  lowerBoundary.value = 2140;
  operationNote.value = '自动检测已刷新边界建议；3 项结构问题仍需逐项处理。';
  showDemoFeedback('已刷新章节边界建议，结构问题仍待复核', 'warning');
}

function resolveStructureIssues(): void {
  structureIssues.value = 0;
  operationNote.value = '3 项结构问题已在当前页面切换为已处理，可确认章节结构。';
  showDemoFeedback('结构问题已完成本地演示处理', 'success');
}

function confirmStructure(): void {
  if (hasStructureIssues.value)
    return;
  showDemoFeedback('章节结构已在当前预览中确认', 'success');
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <TextDemoShell
      current-page="chapter-splitting"
      editor-aria-label="章节切割编辑区"
      label="VoxWeaver 章节切割演示页面"
      toolbar-detail="36 章 · 未归属文本 218 字"
      toolbar-title="章节切割"
    >
      <template #toolbar-actions>
        <span class="icon-button" aria-disabled="true">⋯</span>
        <ElButton class="toolbar-button toolbar-button--secondary" @click="autoDetectBoundaries">
          自动检测边界
        </ElButton>
        <ElTooltip
          :content="`仍有 ${structureIssues} 项结构问题，完成检测后才能确认`"
          :disabled="!hasStructureIssues"
          placement="bottom"
        >
          <span>
            <ElButton
              class="toolbar-button toolbar-button--primary"
              data-testid="confirm-chapter-structure"
              :disabled="hasStructureIssues"
              @click="confirmStructure"
            >
              确认章节结构
            </ElButton>
          </span>
        </ElTooltip>
      </template>

      <div class="text-editor-content text-editor-content--wide">
        <div class="page-heading">
          <div class="page-heading-copy"><h2>章节切割</h2><p>章节序号与行号仅用于显示，不作为稳定 ID。</p></div>
          <span class="status-badge" :class="[hasStructureIssues ? 'status-badge--review' : 'status-badge--success']">
            {{ hasStructureIssues ? '! 待复核' : '✓ 已完成' }}
          </span>
        </div>

        <div class="chapter-workspace">
          <section class="chapter-tree">
            <div class="card-header"><span class="strong">卷 / 章节树</span><span class="caption">2 卷 · 36 章</span></div>
            <button class="tree-row" type="button" @click="firstVolumeExpanded = !firstVolumeExpanded">
              <span>{{ firstVolumeExpanded ? '⌄' : '›' }}</span><span class="strong">第一卷 · 雨城</span><span></span>
            </button>
            <template v-if="firstVolumeExpanded">
              <button
                v-for="chapter in chapters.filter(item => item.volume === 1)"
                :key="chapter.id"
                :aria-pressed="chapter.id === selectedChapterId"
                class="tree-row tree-row--chapter" :class="[
                  chapter.id === selectedChapterId ? 'tree-row--selected' : '',
                  chapter.issue && chapter.id !== selectedChapterId ? 'tree-row--issue' : '',
                ]"
                type="button"
                @click="selectChapter(chapter.id)"
              >
                <span>{{ chapter.number }}</span><span>{{ chapter.title }}</span><span>{{ chapter.issue ? '!' : '' }}</span>
              </button>
            </template>
            <button
              class="tree-row" :class="[hasStructureIssues ? 'tree-row--issue' : '']"
              type="button"
              @click="secondVolumeExpanded = !secondVolumeExpanded"
            >
              <span>{{ secondVolumeExpanded ? '⌄' : '›' }}</span><span class="strong">第二卷 · 北境</span><span>{{ hasStructureIssues ? '!' : '' }}</span>
            </button>
            <template v-if="secondVolumeExpanded">
              <button
                v-for="chapter in chapters.filter(item => item.volume === 2)"
                :key="chapter.id"
                :aria-pressed="chapter.id === selectedChapterId"
                class="tree-row tree-row--chapter" :class="[
                  chapter.id === selectedChapterId ? 'tree-row--selected' : '',
                  chapter.issue && chapter.id !== selectedChapterId && hasStructureIssues ? 'tree-row--issue' : '',
                ]"
                type="button"
                @click="selectChapter(chapter.id)"
              >
                <span>{{ chapter.number }}</span><span>{{ chapter.title }}</span><span>{{ chapter.issue && hasStructureIssues ? '!' : '' }}</span>
              </button>
            </template>
          </section>

          <section class="surface-card chapter-editor-card">
            <div class="row-between">
              <div class="chapter-editor-heading"><h3 class="card-title">{{ selectedChapter.title }}</h3><p class="caption">显示序号 {{ selectedChapter.number }} · {{ upperBoundary.toLocaleString() }}–{{ lowerBoundary.toLocaleString() }} 字符</p></div>
              <div class="chapter-editor-actions">
                <ElButton class="text-button" @click="openRenameDialog">修改章节名</ElButton>
                <ElButton class="text-button" @click="moveChapter">调整顺序</ElButton>
                <ElButton class="text-button" @click="splitChapter">拆分</ElButton>
                <ElButton class="text-button" @click="mergeChapter">合并</ElButton>
              </div>
            </div>
            <div class="boundary">
              <span>上边界</span>
              <ElInputNumber v-model="upperBoundary" aria-label="上边界字符位置" :max="lowerBoundary - 1" :min="0" size="small" />
            </div>
            <div class="chapter-lines"><div class="line-numbers">1280<br>1281<br>1282<br>1283<br>1284<br>1285<br>1286</div><div class="chapter-copy-lines">门轴发出一声轻响。<br>林舟停在原地，雨水从衣角滴落。<br>走廊深处没有灯，只有一线冷风从门缝钻出。<br><br>“别回头。”沈砚在身后说。<br><br>林舟却已经看见门后的影子。</div></div>
            <div class="boundary">
              <span>下边界</span>
              <ElInputNumber v-model="lowerBoundary" aria-label="下边界字符位置" :min="upperBoundary + 1" size="small" />
            </div>
            <p class="body-copy chapter-operation-note" style="color: var(--vw-text-secondary)">{{ operationNote }}</p>
          </section>
        </div>

        <div class="section-header" style="width: 100%">
          <span class="strong">章节结构问题</span>
          <span class="chapter-issue-actions">
            <span class="caption" :style="{ color: hasStructureIssues ? 'var(--vw-state-error)' : 'var(--vw-accent-primary)' }">
              {{ hasStructureIssues ? `${structureIssues} 项需要处理` : '本地演示问题已清零' }}
            </span>
            <ElButton v-if="hasStructureIssues" link type="primary" @click="resolveStructureIssues">演示处理全部问题</ElButton>
          </span>
        </div>
        <div class="issue-grid">
          <section class="surface-card issue-card" :class="[hasStructureIssues ? 'issue-card--error' : 'state-card--success']"><div class="row-between"><span class="strong">空章节</span><span class="status-badge" :class="[hasStructureIssues ? 'status-badge--error' : 'status-badge--success']">{{ hasStructureIssues ? '× 失败' : '✓ 已处理' }}</span></div><p class="body-copy" style="color: var(--vw-text-secondary)">第四章没有归属文本</p></section>
          <section class="surface-card issue-card" :class="[hasStructureIssues ? 'issue-card--error' : 'state-card--success']"><div class="row-between"><span class="strong">重叠边界</span><span class="status-badge" :class="[hasStructureIssues ? 'status-badge--error' : 'status-badge--success']">{{ hasStructureIssues ? '× 失败' : '✓ 已处理' }}</span></div><p class="body-copy" style="color: var(--vw-text-secondary)">第 18 / 19 章重叠 42 字</p></section>
          <section class="surface-card issue-card" :class="[hasStructureIssues ? 'issue-card--stale' : 'state-card--success']"><div class="row-between"><span class="strong">未归属文本</span><span class="status-badge" :class="[hasStructureIssues ? 'status-badge--stale' : 'status-badge--success']">{{ hasStructureIssues ? '↻ 已失效' : '✓ 已处理' }}</span></div><p class="body-copy" style="color: var(--vw-text-secondary)">卷首 218 字尚未归属</p></section>
        </div>
      </div>

      <ElDialog v-model="renameDialogOpen" title="修改章节名" width="480px" append-to-body>
        <ElInput v-model="renameDraft" aria-label="章节名" maxlength="40" show-word-limit @keyup.enter="renameChapter" />
        <template #footer>
          <ElButton @click="renameDialogOpen = false">取消</ElButton>
          <ElButton type="primary" :disabled="!renameDraft.trim()" @click="renameChapter">保存名称</ElButton>
        </template>
      </ElDialog>
    </TextDemoShell>
  </PageDocument>
</template>
