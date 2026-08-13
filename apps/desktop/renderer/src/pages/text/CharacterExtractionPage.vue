<script setup lang="ts">
import { computed, ref } from 'vue';
import PageDocument from '@/components/PageDocument.vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';
import TextDemoShell from './TextDemoShell.vue';

type CharacterStatus = 'confirmed' | 'conflict' | 'pending' | 'processing';

interface CharacterCandidate {
  aliases: string;
  avatar: string;
  attributes: string;
  chapters: readonly string[];
  evidence: string;
  evidenceSufficient: boolean;
  id: string;
  imitationTarget: string;
  initialStatus: CharacterStatus;
  name: string;
  source: string;
  status: CharacterStatus;
}

const bodyClasses = ['text-page'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const candidates = ref<CharacterCandidate[]>([
  { aliases: '林队、舟哥', avatar: '夜航者', attributes: '成年 · 紧张\n左臂受伤 · 克制', chapters: ['early'], evidence: '“林舟抬起受伤的左臂，示意众人停下。”', evidenceSufficient: true, id: 'lin-zhou', imitationTarget: '', initialStatus: 'processing', name: '林舟', source: '第 3、5 章', status: 'processing' },
  { aliases: '沈医生', avatar: '—', attributes: '成年 · 平静\n无伤病 · 专注', chapters: ['early'], evidence: '“沈砚合上药箱，语气仍然平静。”', evidenceSufficient: true, id: 'shen-yan', imitationTarget: '', initialStatus: 'confirmed', name: '沈砚', source: '第 3、8 章', status: 'confirmed' },
  { aliases: '称谓指向冲突', avatar: '守门人', attributes: '年龄未知 · 警觉\n伤病未知 · 防备', chapters: ['early'], evidence: '是否为同一角色，原文证据不足。', evidenceSufficient: false, id: 'a-man', imitationTarget: '', initialStatus: 'conflict', name: '阿满 / 满叔', source: '第 5、8 章', status: 'conflict' },
  { aliases: '小禾', avatar: '白鸢', attributes: '成年 · 紧张\n无伤病 · 犹疑', chapters: ['early'], evidence: '“白鸢借用沈砚的声线重复了警告。”', evidenceSufficient: true, id: 'su-he', imitationTarget: 'shen-yan', initialStatus: 'pending', name: '苏禾', source: '第 8 章', status: 'pending' },
]);
const selectedCandidateIds = ref<string[]>(['su-he']);
const searchQuery = ref('');
const statusFilter = ref('all');
const chapterFilter = ref('early');

const filteredCandidates = computed(() => candidates.value.filter((candidate) => {
  const query = searchQuery.value.trim().toLocaleLowerCase();
  const matchesSearch = !query || `${candidate.name} ${candidate.aliases} ${candidate.avatar}`.toLocaleLowerCase().includes(query);
  const matchesStatus = statusFilter.value === 'all' || candidate.status === statusFilter.value;
  const matchesChapter = chapterFilter.value === 'all' || candidate.chapters.includes(chapterFilter.value);
  return matchesSearch && matchesStatus && matchesChapter;
}));
const selectedCandidates = computed(() => (
  candidates.value.filter(candidate => selectedCandidateIds.value.includes(candidate.id))
));
const selectedCandidate = computed(() => selectedCandidates.value[0]);
const pendingCount = computed(() => candidates.value.filter(candidate => candidate.status !== 'confirmed').length);

function statusClass(status: CharacterStatus): string {
  return {
    confirmed: 'status-badge--success',
    conflict: 'status-badge--error',
    pending: 'status-badge--review',
    processing: 'status-badge--processing',
  }[status];
}

function statusText(status: CharacterStatus): string {
  return {
    confirmed: '✓ 已完成',
    conflict: '× 失败',
    pending: '! 待复核',
    processing: '◔ 处理中',
  }[status];
}

function rowClass(status: CharacterStatus): string {
  return {
    confirmed: 'character-row--success',
    conflict: 'character-row--error',
    pending: 'character-row--review',
    processing: '',
  }[status];
}

function toggleCandidate(candidateId: string): void {
  if (selectedCandidateIds.value.includes(candidateId)) {
    selectedCandidateIds.value = selectedCandidateIds.value.filter(id => id !== candidateId);
    return;
  }
  selectedCandidateIds.value = [...selectedCandidateIds.value, candidateId];
}

function confirmCandidate(candidate: CharacterCandidate): void {
  if (!candidate.evidenceSufficient || candidate.status === 'conflict') {
    candidate.status = 'conflict';
    showDemoFeedback(`${candidate.name} 存在冲突或证据不足，仍需复核`, 'warning');
    return;
  }

  candidate.status = 'confirmed';
  showDemoFeedback(`${candidate.name} 已在当前页面标记为已确认`, 'success');
}

function confirmSingleCandidate(): void {
  if (selectedCandidate.value)
    confirmCandidate(selectedCandidate.value);
}

function confirmSelectedCandidates(): void {
  if (selectedCandidates.value.length === 0) {
    showDemoFeedback('请先选择候选角色', 'warning');
    return;
  }

  let blockedCount = 0;
  for (const candidate of selectedCandidates.value) {
    if (!candidate.evidenceSufficient || candidate.status === 'conflict') {
      blockedCount += 1;
      continue;
    }
    candidate.status = 'confirmed';
  }

  showDemoFeedback(
    blockedCount > 0 ? `可确认候选已更新，${blockedCount} 项冲突仍待复核` : '所选候选已在当前页面标记为已确认',
    blockedCount > 0 ? 'warning' : 'success',
  );
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <TextDemoShell
      current-page="character-extraction"
      editor-aria-label="角色提取编辑区"
      label="VoxWeaver 角色提取演示页面"
      :toolbar-detail="`18 个候选 · ${pendingCount} 项待确认 · 1 项冲突`"
      toolbar-title="角色提取"
    >
      <template #toolbar-actions>
        <span class="icon-button" aria-disabled="true">⋯</span>
        <ElButton class="toolbar-button toolbar-button--secondary" data-testid="batch-confirm-characters" @click="confirmSelectedCandidates">
          批量确认
        </ElButton>
        <ElButton
          class="toolbar-button toolbar-button--primary"
          data-testid="confirm-selected-character"
          :disabled="selectedCandidates.length !== 1"
          @click="confirmSingleCandidate"
        >
          确认并加入角色档案
        </ElButton>
      </template>

      <div class="text-editor-content text-editor-content--compact character-content">
        <div class="page-heading"><div class="page-heading-copy"><h2>角色提取</h2><p>候选来自章节原文证据；确认只改变当前页面状态。</p></div><span class="status-badge status-badge--review">! 待复核</span></div>
        <div class="filter-row">
          <label class="static-filter static-filter--control" style="width: 450px">
            <span class="static-filter-label">搜索</span>
            <ElInput v-model="searchQuery" aria-label="搜索候选角色" clearable placeholder="姓名 / 称谓 / 别名" />
          </label>
          <label class="static-filter static-filter--control" style="width: 270px">
            <span class="static-filter-label">状态</span>
            <ElSelect v-model="statusFilter" aria-label="候选状态筛选">
              <ElOption label="全部候选" value="all" /><ElOption label="处理中" value="processing" /><ElOption label="待复核" value="pending" /><ElOption label="已确认" value="confirmed" /><ElOption label="冲突" value="conflict" />
            </ElSelect>
          </label>
          <label class="static-filter static-filter--control" style="width: 368px">
            <span class="static-filter-label">来源章节</span>
            <ElSelect v-model="chapterFilter" aria-label="来源章节筛选">
              <ElOption label="全部章节" value="all" /><ElOption label="第 1–8 章" value="early" /><ElOption label="第 9–16 章" value="middle" />
            </ElSelect>
          </label>
        </div>
        <div class="definition-warning"><span class="strong">!</span><span>“化身名称”和“模仿关系”的业务定义待确认；当前仅展示字段与选择控件，不补充含义。</span></div>
        <section class="surface-card character-table">
          <div class="character-table-head"><span>角色 / 状态</span><span>称谓 · 别名 · 化身</span><span>来源与证据</span><span>动态属性</span><span>模仿目标角色</span></div>
          <article
            v-for="candidate in filteredCandidates"
            :key="candidate.id"
            :aria-selected="selectedCandidateIds.includes(candidate.id)"
            class="character-row" :class="[rowClass(candidate.status), { 'character-row--selected': selectedCandidateIds.includes(candidate.id) }]"
            :data-testid="`character-candidate-${candidate.id}`"
            @click="toggleCandidate(candidate.id)"
          >
            <button
              class="character-identity character-select-control"
              type="button"
              :aria-label="`${selectedCandidateIds.includes(candidate.id) ? '取消选择' : '选择'}候选角色 ${candidate.name}`"
              @click.stop="toggleCandidate(candidate.id)"
            >
              <span>{{ candidate.name }}</span><span class="status-badge" :class="[statusClass(candidate.status)]">{{ statusText(candidate.status) }}</span>
            </button>
            <span class="character-cell">{{ candidate.aliases }}<br>化身：{{ candidate.avatar }}</span>
            <span class="character-cell">{{ candidate.source }}<br>{{ candidate.evidence }}</span>
            <span class="character-cell character-cell--multiline">{{ candidate.attributes }}</span>
            <span class="target-selector" @click.stop>
              <ElSelect v-model="candidate.imitationTarget" :aria-label="`${candidate.name}的模仿目标角色`" placeholder="未选择目标角色">
                <ElOption label="不设置" value="" />
                <ElOption v-for="target in candidates.filter(item => item.id !== candidate.id)" :key="target.id" :label="target.name" :value="target.id" />
              </ElSelect>
            </span>
          </article>
          <p v-if="filteredCandidates.length === 0" class="empty-filter-result">当前筛选条件下没有候选角色。</p>
        </section>
        <div class="selected-character-actions">
          <p class="body-copy" style="color: var(--vw-text-secondary)">
            已选择：{{ selectedCandidates.length ? selectedCandidates.map(candidate => candidate.name).join('、') : '无' }}
            <span v-if="selectedCandidates.some(candidate => !candidate.evidenceSufficient)"> · 含冲突或证据不足项，仍待复核</span>
          </p>
          <div class="card-actions" style="width: auto">
            <ElButton class="text-button" @click="showDemoFeedback('已展开当前候选的固定证据')">查看全部证据</ElButton>
            <ElButton class="text-button text-button--primary" data-testid="confirm-character-footer" :disabled="selectedCandidates.length !== 1" @click="confirmSingleCandidate">确认并加入角色档案</ElButton>
          </div>
        </div>
      </div>
    </TextDemoShell>
  </PageDocument>
</template>
