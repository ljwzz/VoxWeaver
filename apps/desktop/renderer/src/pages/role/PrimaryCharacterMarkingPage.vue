<script setup lang="ts">
import { computed, shallowRef } from 'vue';
import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import PageDocument from '@/components/PageDocument.vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

type ConfirmationFilter = 'all' | 'confirmed' | 'conflict' | 'pending';
type VoiceFilter = 'all' | 'candidate' | 'configured' | 'none';

interface CharacterRecord {
  readonly ageDetail: string;
  readonly aliases: readonly string[];
  readonly aliasDetail: string;
  readonly associationDetail: string;
  readonly avatar: string;
  readonly chapterEnd: number;
  readonly chapterLabel: string;
  readonly chapterStart: number;
  readonly confirmation: string;
  readonly conflictCount: number;
  readonly evidenceCount: number;
  readonly firstChapter: number;
  readonly id: string;
  readonly importance: string;
  readonly name: string;
  readonly originalMain: boolean;
  readonly sourceDetail: string;
  readonly voice: string;
  readonly voiceState: Exclude<VoiceFilter, 'all'>;
}

const characters = [
  {
    ageDetail: '青年期（第 3–28 章）→ 成年期候选（第 29–36 章）。',
    aliases: ['黛玉', '潇湘妃子', '林姑娘'],
    aliasDetail: '林黛玉 ← 黛玉 / 林姑娘；潇湘妃子为诗社称号。',
    associationDetail: '42 个段落；其中 12 个引用当前声音配置。',
    avatar: '黛',
    chapterEnd: 36,
    chapterLabel: '3–36 章',
    chapterStart: 3,
    confirmation: '人工已确认',
    conflictCount: 0,
    evidenceCount: 26,
    firstChapter: 3,
    id: 'lin-daiyu',
    importance: '高',
    name: '林黛玉',
    originalMain: true,
    sourceDetail: '第 3 章首次出现；原文证据 26 处。来源身份在标记切换后保持不变。',
    voice: '青衣 · v3 当前生效',
    voiceState: 'configured',
  },
  {
    ageDetail: '当前固定设计未展开年龄阶段；原角色档案保持不变。',
    aliases: ['宝玉', '怡红公子', '绛洞花主'],
    aliasDetail: '贾宝玉 ← 宝玉 / 怡红公子 / 绛洞花主。',
    associationDetail: '关联段落与声音引用保持原角色档案内容。',
    avatar: '宝',
    chapterEnd: 36,
    chapterLabel: '2–36 章',
    chapterStart: 2,
    confirmation: '人工已确认',
    conflictCount: 0,
    evidenceCount: 34,
    firstChapter: 2,
    id: 'jia-baoyu',
    importance: '高',
    name: '贾宝玉',
    originalMain: true,
    sourceDetail: '第 2 章首次出现；原文证据 34 处。来源身份在标记切换后保持不变。',
    voice: '清朗少年 · v2',
    voiceState: 'configured',
  },
  {
    ageDetail: '当前固定设计未展开年龄阶段；冲突待确认状态保持不变。',
    aliases: ['凤姐', '琏二奶奶', '凤辣子'],
    aliasDetail: '王熙凤 ← 凤姐 / 琏二奶奶 / 凤辣子。',
    associationDetail: '关联段落保持原角色档案内容；候选声音不因标记切换而激活。',
    avatar: '凤',
    chapterEnd: 34,
    chapterLabel: '6–34 章',
    chapterStart: 6,
    confirmation: '冲突待确认',
    conflictCount: 2,
    evidenceCount: 19,
    firstChapter: 6,
    id: 'wang-xifeng',
    importance: '中',
    name: '王熙凤',
    originalMain: false,
    sourceDetail: '第 6 章首次出现；原文证据 19 处。来源身份与冲突证据保持不变。',
    voice: '明快女声 · 候选',
    voiceState: 'candidate',
  },
  {
    ageDetail: '第二次进府时期；当前固定设计未展开更多年龄阶段。',
    aliases: ['姥姥', '刘老老', '村妇称谓'],
    aliasDetail: '刘姥姥 ← 姥姥 / 刘老老 / 村妇称谓。',
    associationDetail: '关联段落保持原角色档案内容；暂无声音配置。',
    avatar: '刘',
    chapterEnd: 31,
    chapterLabel: '6–31 章',
    chapterStart: 6,
    confirmation: '待确认',
    conflictCount: 1,
    evidenceCount: 11,
    firstChapter: 6,
    id: 'granny-liu-second-visit',
    importance: '中',
    name: '刘姥姥（第二次进府时期）',
    originalMain: false,
    sourceDetail: '第 6 章首次出现；原文证据 11 处。来源身份与时期信息保持不变。',
    voice: '暂无声音配置',
    voiceState: 'none',
  },
] as const satisfies readonly CharacterRecord[];

const bodyClasses = ['role-detail'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const defaultCharacter = characters[0];
const searchQuery = shallowRef('');
const chapterFilter = shallowRef('all');
const confirmationFilter = shallowRef<ConfirmationFilter>('all');
const voiceFilter = shallowRef<VoiceFilter>('all');
const conflictOnly = shallowRef(false);
const selectedCharacterId = shallowRef<string>(defaultCharacter.id);
const localMainFlags = shallowRef<Record<string, boolean>>(
  Object.fromEntries(characters.map(character => [character.id, character.originalMain])),
);
const savedMainFlags = shallowRef<Record<string, boolean>>({ ...localMainFlags.value });

const chapterRanges = {
  all: undefined,
  early: [1, 12],
  late: [25, 36],
  middle: [13, 24],
} as const;

const filteredCharacters = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('zh-CN');
  const chapterRange = chapterRanges[chapterFilter.value as keyof typeof chapterRanges];

  return characters.filter((character) => {
    const matchesQuery = !query || [character.name, ...character.aliases, character.avatar]
      .some(value => value.toLocaleLowerCase('zh-CN').includes(query));
    const matchesChapter = !chapterRange
      || (character.chapterStart <= chapterRange[1] && character.chapterEnd >= chapterRange[0]);
    const matchesConfirmation = confirmationFilter.value === 'all'
      || (confirmationFilter.value === 'confirmed' && character.confirmation === '人工已确认')
      || (confirmationFilter.value === 'pending' && character.confirmation === '待确认')
      || (confirmationFilter.value === 'conflict' && character.conflictCount > 0);
    const matchesVoice = voiceFilter.value === 'all' || character.voiceState === voiceFilter.value;
    const matchesConflictFocus = !conflictOnly.value || character.conflictCount > 0;

    return matchesQuery && matchesChapter && matchesConfirmation && matchesVoice && matchesConflictFocus;
  });
});

const selectedCharacter = computed(() => (
  characters.find(character => character.id === selectedCharacterId.value) ?? defaultCharacter
));
const isDirty = computed(() => characters.some(
  character => localMainFlags.value[character.id] !== savedMainFlags.value[character.id],
));

function clearConflictFocus(): void {
  conflictOnly.value = false;
}

function selectCharacter(characterId: string): void {
  selectedCharacterId.value = characterId;
}

function toggleMainCharacter(characterId: string): void {
  localMainFlags.value = {
    ...localMainFlags.value,
    [characterId]: !localMainFlags.value[characterId],
  };
}

function toggleConflictFocus(): void {
  if (conflictOnly.value) {
    conflictOnly.value = false;
    return;
  }

  searchQuery.value = '';
  chapterFilter.value = 'all';
  confirmationFilter.value = 'all';
  voiceFilter.value = 'all';
  conflictOnly.value = true;
  const firstConflict = characters.find(character => character.conflictCount > 0);
  if (firstConflict)
    selectedCharacterId.value = firstConflict.id;
}

function saveMainCharacterMarks(): void {
  savedMainFlags.value = { ...localMainFlags.value };
  showDemoFeedback('主要角色标记已保存到当前预览', 'success');
}
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 主要角色标记交互预览">
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
              <DemoPageButton page-slug="primary-character-marking" class="sidebar-item sidebar-item--selected"><span class="sidebar-state" aria-hidden="true">✓</span><span class="sidebar-label">主要角色标记</span><span class="sidebar-count">18</span></DemoPageButton>
              <DemoPageButton page-slug="crowd-voice-pool" class="sidebar-item sidebar-item--review"><span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">路人声音池</span><span class="sidebar-count">24</span></DemoPageButton>
              <DemoPageButton page-slug="character-voice-refinement" class="sidebar-item sidebar-item--processing"><span class="sidebar-state" aria-hidden="true">◔</span><span class="sidebar-label">角色声音精修</span><span class="sidebar-count">12</span></DemoPageButton>
            </div>
            <section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
          </div>
          <div class="resize-handle" aria-disabled="true"><span></span></div>
        </aside>

        <section class="editor" aria-label="主要角色标记编辑区">
          <header class="editor-toolbar">
            <div class="toolbar-context"><strong>主要角色标记</strong><span>·</span><span>18 个角色 · 4 待确认 · 2 声音冲突</span></div>
            <div class="toolbar-actions" aria-label="主要角色标记操作">
              <ElTooltip content="更多操作不在当前预览范围内" placement="bottom">
                <ElButton class="icon-button" aria-label="更多操作" disabled>⋯</ElButton>
              </ElTooltip>
              <ElButton
                class="toolbar-button toolbar-button--secondary"
                data-testid="check-conflicts"
                @click="toggleConflictFocus"
              >
                {{ conflictOnly ? '查看全部角色' : '检查冲突' }}
              </ElButton>
              <ElButton
                class="toolbar-button toolbar-button--primary"
                data-testid="save-main-marks"
                :disabled="!isDirty"
                @click="saveMainCharacterMarks"
              >
                保存主要角色标记
              </ElButton>
            </div>
          </header>

          <div class="editor-content">
            <section class="filter-bar" aria-label="角色筛选条件">
              <label class="filter-field filter-field--search">
                <span>搜索</span>
                <ElInput
                  v-model="searchQuery"
                  aria-label="搜索角色名、别名或化身"
                  clearable
                  data-testid="role-search"
                  placeholder="角色名 / 别名 / 化身"
                  size="small"
                  @input="clearConflictFocus"
                />
              </label>
              <label class="filter-field filter-field--chapters">
                <span>章节范围</span>
                <ElSelect v-model="chapterFilter" aria-label="章节范围" data-testid="chapter-filter" size="small" @change="clearConflictFocus">
                  <ElOption label="全书 · 1–36 章" value="all" />
                  <ElOption label="前段 · 1–12 章" value="early" />
                  <ElOption label="中段 · 13–24 章" value="middle" />
                  <ElOption label="后段 · 25–36 章" value="late" />
                </ElSelect>
              </label>
              <label class="filter-field filter-field--confirm">
                <span>确认状态</span>
                <ElSelect v-model="confirmationFilter" aria-label="确认状态" data-testid="confirmation-filter" size="small" @change="clearConflictFocus">
                  <ElOption label="全部状态" value="all" />
                  <ElOption label="人工已确认" value="confirmed" />
                  <ElOption label="待确认" value="pending" />
                  <ElOption label="冲突待确认" value="conflict" />
                </ElSelect>
              </label>
              <label class="filter-field filter-field--voice">
                <span>声音状态</span>
                <ElSelect v-model="voiceFilter" aria-label="声音状态" data-testid="voice-filter" size="small" @change="clearConflictFocus">
                  <ElOption label="全部声音状态" value="all" />
                  <ElOption label="已配置" value="configured" />
                  <ElOption label="候选" value="candidate" />
                  <ElOption label="暂无配置" value="none" />
                </ElSelect>
              </label>
              <div class="filter-summary" aria-live="polite">
                <strong>固定预览 {{ filteredCharacters.length }} / {{ characters.length }} 个角色</strong>
                <span>{{ conflictOnly ? '仅显示现有冲突角色' : '⌘F 搜索 · Tab 顺序 1–4' }}</span>
              </div>
            </section>

            <div class="detail-main">
              <section class="character-list" aria-label="固定角色列表">
                <header class="section-header"><h2>角色列表 · 18</h2><span>按重要度排序 ↓</span></header>

                <article
                  v-for="character in filteredCharacters"
                  :key="character.id"
                  class="character-row"
                  :class="{
                    'character-row--main': localMainFlags[character.id],
                    'character-row--selected': selectedCharacter.id === character.id,
                  }"
                  :data-character-id="character.id"
                  role="button"
                  tabindex="0"
                  @click="selectCharacter(character.id)"
                  @keydown.enter.prevent="selectCharacter(character.id)"
                  @keydown.space.prevent="selectCharacter(character.id)"
                >
                  <div class="character-top">
                    <span class="avatar">{{ character.avatar }}</span>
                    <div class="character-identity"><strong>{{ character.name }}</strong><span>{{ character.aliases.join('、') }}</span><span>来源证据 {{ character.evidenceCount }} 处 · 首见第 {{ character.firstChapter }} 章</span></div>
                    <div class="row-action">
                      <ElTag :type="localMainFlags[character.id] ? 'success' : 'info'" effect="plain" size="small">{{ localMainFlags[character.id] ? '主要角色' : character.confirmation }}</ElTag>
                      <ElButton
                        link
                        :data-testid="`toggle-main-${character.id}`"
                        @click.stop="toggleMainCharacter(character.id)"
                      >
                        {{ localMainFlags[character.id] ? '取消主要角色' : '设为主要角色' }}
                      </ElButton>
                    </div>
                  </div>
                  <div class="character-meta">
                    <div class="meta-cell"><span>出场章节</span><strong>{{ character.chapterLabel }}</strong></div>
                    <div class="meta-cell meta-cell--importance"><span>重要度</span><strong>{{ character.importance }}</strong></div>
                    <div class="meta-cell"><span>状态阶段</span><strong>{{ character.confirmation }}</strong></div>
                    <div class="meta-cell"><span>声音配置</span><strong>{{ character.voice }}</strong></div>
                    <div class="meta-cell meta-cell--conflict" :class="{ 'is-clear': character.conflictCount === 0 }"><span>冲突数</span><strong>{{ character.conflictCount }}</strong></div>
                  </div>
                </article>

                <div v-if="filteredCharacters.length === 0" class="notice notice--processing" data-testid="empty-role-filter"><strong>没有匹配的固定角色</strong><span>调整搜索或筛选条件后继续。</span></div>
                <div class="notice notice--review"><strong>! 2 个声音配置冲突待复核</strong><span>切换主要角色标记不会删除角色身份、别名或来源证据。</span></div>
                <div class="notice notice--processing"><strong>◌ 正在核对 4 个待确认角色</strong><span>完成后仅更新标记建议，不自动绑定声音。</span></div>
              </section>

              <aside class="character-inspector" :aria-label="`${selectedCharacter.name}检查器`" data-testid="character-inspector">
                <section class="inspector-card">
                  <header class="inspector-identity"><span class="avatar">{{ selectedCharacter.avatar }}</span><div class="inspector-name"><strong>{{ selectedCharacter.name }}</strong><span>{{ localMainFlags[selectedCharacter.id] ? '主要角色' : '非主要角色' }} · {{ selectedCharacter.confirmation }}</span></div></header>
                  <div class="detail-section detail-section--large"><h3>角色来源</h3><p>{{ selectedCharacter.sourceDetail }}</p></div>
                  <div class="detail-section detail-section--large detail-section--warning"><h3>别名关系</h3><p>{{ selectedCharacter.aliasDetail }}</p></div>
                  <div class="detail-section detail-section--large"><h3>年龄阶段</h3><p>{{ selectedCharacter.ageDetail }}</p></div>
                  <div class="detail-section detail-section--small detail-section--accent"><h3>关联剧本段落</h3><p>{{ selectedCharacter.associationDetail }}</p></div>
                </section>
                <div class="status-card status-card--accent" data-testid="mark-status"><strong>主要角色标记：{{ isDirty ? '有未保存更改' : '已保存于当前预览' }}</strong><span>所有标记变化仅存在于当前页面生命周期，不写入项目。</span></div>
                <div class="status-card" :class="selectedCharacter.conflictCount === 0 ? 'status-card--success' : 'status-card--warning'"><strong>声音冲突 {{ selectedCharacter.conflictCount }}</strong><span>{{ selectedCharacter.conflictCount === 0 ? '当前声音配置无冲突；关联段落仅为引用信息。' : '现有冲突保持待复核；筛选和保存不会自动消除冲突。' }}</span></div>
              </aside>
            </div>
          </div>
        </section>
      </div>
    </main>
  </PageDocument>
</template>
