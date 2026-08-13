<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import PageDocument from '@/components/PageDocument.vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

type VoiceStatus = 'available' | 'review' | 'used';

interface VoiceRecord {
  readonly age: string;
  readonly avatar: string;
  readonly authorization: string;
  readonly id: string;
  readonly name: string;
  readonly occupancy: string;
  readonly preview: string;
  readonly rhythm: string;
  readonly status: VoiceStatus;
  readonly statusLabel: string;
  readonly tone: string;
  readonly version: string;
}

interface TemporaryAssignment {
  readonly candidate: string;
  readonly range: string;
  readonly role: string;
}

const voices = [
  {
    age: '成熟',
    avatar: '青',
    authorization: '项目授权音色包 · 授权已核验',
    id: 'qingyan',
    name: '青砚',
    occupancy: '未占用 · 可用于临时角色',
    preview: '林黛玉试听 · 00:08',
    rhythm: '稳',
    status: 'available',
    statusLabel: '可用',
    tone: '清亮',
    version: 'v2',
  },
  {
    age: '成熟',
    avatar: '沉',
    authorization: '项目授权音色包 · 授权已核验',
    id: 'chenzhong',
    name: '沉钟',
    occupancy: '已占用：贾母 · 第 12–16 章',
    preview: '林黛玉试听 · 00:08',
    rhythm: '稳',
    status: 'used',
    statusLabel: '已使用',
    tone: '清亮',
    version: 'v4',
  },
] as const satisfies readonly VoiceRecord[];

const temporaryRoles = [
  { label: '丫鬟甲 · 第 18 章 · 2 行台词', source: '来源段落 para_18_042', value: 'maid-a' },
] as const;
const candidateVoices = [
  { age: '成熟', label: '青禾 · v1 候选', tone: '清亮', value: 'qinghe' },
  { age: '成熟', label: '青砚 · v2', tone: '清亮', value: 'qingyan' },
] as const;
const assignmentRanges = [
  { detail: '不扩展到其他章节', label: '仅当前角色与第 18 章', value: 'role-chapter' },
] as const;

const bodyClasses = ['role-detail'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const searchQuery = shallowRef('');
const ageFilter = shallowRef('all');
const toneFilter = shallowRef('all');
const statusFilter = shallowRef<'all' | VoiceStatus>('all');
const selectedVoiceId = shallowRef<string>('chenzhong');
const playingVoiceId = shallowRef<string | null>('chenzhong');
const candidateDialogVisible = shallowRef(false);
const candidateName = shallowRef('');
const candidateAge = shallowRef('成熟');
const candidateTone = shallowRef('清亮');
const candidateRhythm = shallowRef('稳');
const temporaryRoleId = shallowRef(temporaryRoles[0].value);
const candidateVoiceId = shallowRef(candidateVoices[0].value);
const assignmentRangeId = shallowRef(assignmentRanges[0].value);
const temporaryAssignment = shallowRef<TemporaryAssignment>();

const filteredVoices = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('zh-CN');

  return voices.filter((voice) => {
    const matchesQuery = !query || [voice.name, voice.occupancy]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(query));
    const matchesAge = ageFilter.value === 'all' || voice.age === ageFilter.value;
    const matchesTone = toneFilter.value === 'all' || voice.tone === toneFilter.value;
    const matchesStatus = statusFilter.value === 'all' || voice.status === statusFilter.value;

    return matchesQuery && matchesAge && matchesTone && matchesStatus;
  });
});
const selectedTemporaryRole = computed(() => (
  temporaryRoles.find(role => role.value === temporaryRoleId.value) ?? temporaryRoles[0]
));
const selectedCandidateVoice = computed(() => (
  candidateVoices.find(voice => voice.value === candidateVoiceId.value) ?? candidateVoices[0]
));
const selectedAssignmentRange = computed(() => (
  assignmentRanges.find(range => range.value === assignmentRangeId.value) ?? assignmentRanges[0]
));

function selectVoice(voiceId: string): void {
  selectedVoiceId.value = voiceId;
}

function togglePlayback(voiceId: string): void {
  playingVoiceId.value = playingVoiceId.value === voiceId ? null : voiceId;
}

function showBatchPreviewFeedback(): void {
  showDemoFeedback('批量试听已触发；不会播放真实音频');
}

function resetCandidateDraft(): void {
  candidateName.value = '';
  candidateAge.value = '成熟';
  candidateTone.value = '清亮';
  candidateRhythm.value = '稳';
}

function openCandidateDialog(): void {
  resetCandidateDraft();
  candidateDialogVisible.value = true;
}

function closeCandidateDialog(): void {
  candidateDialogVisible.value = false;
}

function previewCandidate(): void {
  if (!candidateName.value.trim())
    return;

  showDemoFeedback(`声音候选“${candidateName.value.trim()}”仅保留到弹窗关闭`, 'success');
  candidateDialogVisible.value = false;
}

function assignTemporaryCandidate(): void {
  temporaryAssignment.value = {
    candidate: selectedCandidateVoice.value.label,
    range: selectedAssignmentRange.value.label,
    role: selectedTemporaryRole.value.label,
  };
  showDemoFeedback('已在当前页面标记为临时候选，未建立永久绑定', 'success');
}
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 路人声音池交互预览">
      <header class="window-titlebar">
        <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
        <p class="window-title">VoxWeaver · 示例小说</p>
        <p class="window-context">项目工作台</p>
      </header>

      <div class="workspace-body">
        <aside class="activity-rail" aria-label="功能分组导航">
          <div class="activity-list">
            <DemoModuleButton module-key="text" class="activity-item"><span class="activity-glyph">文</span></DemoModuleButton>
            <DemoModuleButton module-key="role" class="activity-item activity-item--selected"><span class="activity-glyph">角</span><span class="selection-bar" aria-hidden="true"></span></DemoModuleButton>
            <DemoModuleButton module-key="audio" class="activity-item"><span class="activity-glyph">音</span></DemoModuleButton>
            <DemoModuleButton module-key="post" class="activity-item"><span class="activity-glyph">后</span></DemoModuleButton>
          </div>
          <DemoModuleButton module-key="settings" class="activity-item"><span class="activity-glyph">设</span></DemoModuleButton>
        </aside>

        <aside class="context-sidebar" aria-label="角色管理上下文侧栏">
          <div class="sidebar-content">
            <div class="sidebar-top">
              <header class="sidebar-header">
                <div class="sidebar-heading-row"><h1>角色管理</h1><span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span></div>
                <p class="sidebar-subtitle">3 个子功能 · 5 项待复核</p>
              </header>
              <DemoPageButton page-slug="primary-character-marking" class="sidebar-item sidebar-item--default"><span class="sidebar-state" aria-hidden="true"></span><span class="sidebar-label">主要角色标记</span><span class="sidebar-count">18</span></DemoPageButton>
              <DemoPageButton page-slug="crowd-voice-pool" class="sidebar-item sidebar-item--selected"><span class="sidebar-state" aria-hidden="true">✓</span><span class="sidebar-label">路人声音池</span><span class="sidebar-count">24</span></DemoPageButton>
              <DemoPageButton page-slug="character-voice-refinement" class="sidebar-item sidebar-item--review"><span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">角色声音精修</span><span class="sidebar-count">12</span></DemoPageButton>
            </div>
            <section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
          </div>
          <div class="resize-handle" aria-disabled="true"><span></span></div>
        </aside>

        <section class="editor" aria-label="路人声音池编辑区">
          <header class="editor-toolbar">
            <div class="toolbar-context"><strong>路人声音池</strong><span>·</span><span>24 个声音 · 6 已使用 · 14 可用 · 4 待复核</span></div>
            <div class="toolbar-actions" aria-label="声音池操作">
              <ElTooltip content="更多操作不在当前预览范围内" placement="bottom">
                <ElButton class="icon-button" aria-label="更多操作" disabled>⋯</ElButton>
              </ElTooltip>
              <ElButton class="toolbar-button toolbar-button--secondary" data-testid="batch-preview" @click="showBatchPreviewFeedback">批量试听</ElButton>
              <ElButton class="toolbar-button toolbar-button--primary" data-testid="open-candidate-dialog" @click="openCandidateDialog">添加声音候选</ElButton>
            </div>
          </header>

          <div class="editor-content">
            <section class="pool-summary" aria-label="声音池摘要与筛选">
              <div class="pool-stats">
                <div class="pool-stat"><strong>24</strong><div class="stat-detail"><strong>声音池数量</strong><span>含 4 个待复核</span></div></div>
                <div class="pool-stat pool-stat--success"><strong>6</strong><div class="stat-detail"><strong>已使用</strong><span>占用 9 个章节</span></div></div>
                <div class="pool-stat pool-stat--accent"><strong>14</strong><div class="stat-detail"><strong>可用</strong><span>可临时分配</span></div></div>
                <div class="pool-stat pool-stat--warning"><strong>4</strong><div class="stat-detail"><strong>待复核</strong><span>授权或区分度</span></div></div>
              </div>
              <div class="pool-filters">
                <label class="filter-field"><span>年龄感</span><ElSelect v-model="ageFilter" aria-label="年龄感" data-testid="age-filter" size="small"><ElOption label="全部 · 青年 / 成熟 / 年长" value="all" /><ElOption label="青年" value="青年" /><ElOption label="成熟" value="成熟" /><ElOption label="年长" value="年长" /></ElSelect></label>
                <label class="filter-field"><span>音色特征</span><ElSelect v-model="toneFilter" aria-label="音色特征" data-testid="tone-filter" size="small"><ElOption label="全部 · 清亮 / 低沉 / 粗粝" value="all" /><ElOption label="清亮" value="清亮" /><ElOption label="低沉" value="低沉" /><ElOption label="粗粝" value="粗粝" /></ElSelect></label>
                <label class="filter-field"><span>使用状态</span><ElSelect v-model="statusFilter" aria-label="使用状态" data-testid="voice-status-filter" size="small"><ElOption label="全部状态" value="all" /><ElOption label="可用" value="available" /><ElOption label="已使用" value="used" /><ElOption label="待复核" value="review" /></ElSelect></label>
                <label class="filter-field"><span>搜索</span><ElInput v-model="searchQuery" aria-label="搜索声音名或占用角色" clearable data-testid="voice-search" placeholder="声音名 / 占用角色" size="small" /></label>
                <span class="filter-total" aria-live="polite">{{ filteredVoices.length }} / {{ voices.length }} 项固定预览</span>
              </div>
            </section>

            <div class="detail-main pool-main">
              <section class="voice-list" aria-label="固定声音候选列表">
                <header class="section-header"><h2>声音候选 · 24</h2><span>紧凑列表 ↕</span></header>

                <article
                  v-for="voice in filteredVoices"
                  :key="voice.id"
                  class="voice-card"
                  :class="{ 'voice-card--selected': selectedVoiceId === voice.id }"
                  :data-voice-id="voice.id"
                  role="button"
                  tabindex="0"
                  @click="selectVoice(voice.id)"
                  @keydown.enter.prevent="selectVoice(voice.id)"
                  @keydown.space.prevent="selectVoice(voice.id)"
                >
                  <header class="voice-card-header"><div class="voice-identity"><span class="avatar">{{ voice.avatar }}</span><strong>{{ voice.name }}</strong></div><ElTag :type="voice.status === 'used' ? 'success' : 'info'" effect="plain" size="small">{{ voice.statusLabel }}</ElTag></header>
                  <div class="voice-features"><ElTag class="chip" effect="plain" round>年龄感：{{ voice.age }}</ElTag><ElTag class="chip" effect="plain" round>音色：{{ voice.tone }}</ElTag><ElTag class="chip" effect="plain" round>节奏：{{ voice.rhythm }}</ElTag></div>
                  <div class="voice-card-meta"><span :data-testid="`permanent-binding-${voice.id}`">{{ voice.occupancy }}</span><span>{{ voice.authorization }} · 当前版本 {{ voice.version }}</span></div>
                  <ElButton class="audio-preview" :data-testid="`play-${voice.id}`" @click.stop="togglePlayback(voice.id)">
                    <span class="audio-icon">{{ playingVoiceId === voice.id ? 'Ⅱ' : '▶' }}</span>
                    <span class="audio-copy"><strong>{{ playingVoiceId === voice.id ? '正在播放' : '可播放' }}</strong><span>{{ voice.preview }}</span></span>
                    <span class="audio-action">{{ playingVoiceId === voice.id ? '暂停' : '播放' }}</span>
                  </ElButton>
                </article>

                <div v-if="filteredVoices.length === 0" class="notice notice--processing" data-testid="empty-voice-filter"><strong>没有匹配的固定声音</strong><span>调整搜索或筛选条件后继续。</span></div>
                <div class="notice notice--review"><strong>! 4 个候选待复核</strong><span>2 个授权状态待确认；2 个同场景区分度待复核。</span></div>
                <div class="notice notice--processing"><strong>◌ 固定预览条目</strong><span>当前页面仅展示 2 / 24 个声音条目。</span></div>
              </section>

              <aside class="assignment-panel" aria-label="临时角色分配检查器">
                <h2>临时角色分配</h2>
                <p class="assignment-intro">为当前场景选择声音池候选；本步骤不会建立自动永久绑定。</p>
                <label class="assignment-field"><span>临时角色</span><ElSelect v-model="temporaryRoleId" aria-label="临时角色" data-testid="temporary-role" size="small"><ElOption v-for="role in temporaryRoles" :key="role.value" :label="role.label" :value="role.value" /></ElSelect><span>{{ selectedTemporaryRole.source }}</span></label>
                <label class="assignment-field"><span>声音池候选</span><ElSelect v-model="candidateVoiceId" aria-label="声音池候选" data-testid="candidate-voice" size="small"><ElOption v-for="voice in candidateVoices" :key="voice.value" :label="voice.label" :value="voice.value" /></ElSelect><span>年龄感：{{ selectedCandidateVoice.age }} · 音色：{{ selectedCandidateVoice.tone }}</span></label>
                <div class="assignment-warning"><strong>≠ 区分度待复核</strong><span>{{ selectedCandidateVoice.label }} 与同场景“青砚”音色接近；请试听后确认。</span></div>
                <label class="assignment-field"><span>分配范围</span><ElSelect v-model="assignmentRangeId" aria-label="分配范围" data-testid="assignment-range" size="small"><ElOption v-for="range in assignmentRanges" :key="range.value" :label="range.label" :value="range.value" /></ElSelect><span>{{ selectedAssignmentRange.detail }}</span></label>
                <div class="assignment-info" data-testid="assignment-state"><strong>{{ temporaryAssignment ? '已分配为临时候选' : '未永久绑定' }}</strong><span>{{ temporaryAssignment ? `${temporaryAssignment.role} · ${temporaryAssignment.candidate} · ${temporaryAssignment.range}` : '保存后记录为临时候选；需人工确认后才能进入正式绑定流程。' }}</span></div>
                <ElButton class="static-action" data-testid="assign-temporary" @click="assignTemporaryCandidate">分配为临时候选</ElButton>
              </aside>
            </div>
          </div>
        </section>
      </div>

      <ElDialog
        v-model="candidateDialogVisible"
        aria-label="添加声音候选"
        data-testid="candidate-dialog"
        title="添加声音候选"
        width="440px"
        @closed="resetCandidateDraft"
      >
        <div class="role-dialog-form">
          <label><span>候选名称</span><ElInput v-model="candidateName" aria-label="候选名称" data-testid="candidate-name" maxlength="24" placeholder="填写声音名称" /></label>
          <label><span>年龄感标签</span><ElSelect v-model="candidateAge" aria-label="年龄感标签"><ElOption label="青年" value="青年" /><ElOption label="成熟" value="成熟" /><ElOption label="年长" value="年长" /></ElSelect></label>
          <label><span>音色标签</span><ElSelect v-model="candidateTone" aria-label="音色标签"><ElOption label="清亮" value="清亮" /><ElOption label="低沉" value="低沉" /><ElOption label="粗粝" value="粗粝" /></ElSelect></label>
          <label><span>节奏标签</span><ElSelect v-model="candidateRhythm" aria-label="节奏标签"><ElOption label="稳" value="稳" /></ElSelect></label>
          <p>候选内容仅存在于当前弹窗；关闭后不会加入声音池。</p>
        </div>
        <template #footer>
          <ElButton data-testid="cancel-candidate" @click="closeCandidateDialog">取消</ElButton>
          <ElButton type="primary" data-testid="preview-candidate" :disabled="!candidateName.trim()" @click="previewCandidate">保存到当前预览</ElButton>
        </template>
      </ElDialog>
    </main>
  </PageDocument>
</template>
