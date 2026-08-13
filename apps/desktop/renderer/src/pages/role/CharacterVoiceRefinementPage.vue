<script setup lang="ts">
import type { ComponentPublicInstance } from 'vue';

import { computed, shallowRef } from 'vue';
import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import PageDocument from '@/components/PageDocument.vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

interface OverrideRecord {
  readonly id: string;
  readonly label: string;
  readonly state: 'active' | 'candidate' | 'stale';
  readonly stateLabel: string;
  readonly tags: readonly string[];
}

type VersionId = 'version-a' | 'version-b';

const characters = [
  { label: '林黛玉', value: 'lin-daiyu' },
  { label: '贾宝玉', value: 'jia-baoyu' },
] as const;
const baseVoices = [
  { label: '青衣 · v3 当前生效', value: 'qingyi-v3' },
  { label: '清朗少年 · v2', value: 'clear-youth-v2' },
] as const;
const previewSentences = [
  { label: '第 12 章 · para_12_018', text: '宝玉，你好好的罢，我再来看你。', value: 'para-12-018' },
  { label: '第 18 章 · para_18_042', text: '我再来看你。', value: 'para-18-042' },
] as const;
const overrides = [
  { id: 'young-injured-restrained', label: '青年期 · 轻伤 · 克制', state: 'active', stateLabel: '当前生效', tags: ['青年期', '轻伤', '克制'] },
  { id: 'adult-calm-anxious', label: '成年期 · 无伤 · 焦虑', state: 'candidate', stateLabel: '候选', tags: ['成年期', '无伤', '焦虑'] },
  { id: 'young-severe-sad', label: '青年期 · 重伤 · 悲伤', state: 'stale', stateLabel: '已失效', tags: ['青年期', '重伤', '悲伤'] },
] as const satisfies readonly OverrideRecord[];
const versions = [
  { id: 'version-a', label: '版本 A', metrics: '语速 0% · 气息 18%\n稳定度 76%', originalState: '当前生效' },
  { id: 'version-b', label: '版本 B', metrics: '语速 -4% · 气息 24%\n稳定度 82%', originalState: '候选' },
] as const;

const bodyClasses = ['role-detail'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const selectedCharacterId = shallowRef(characters[0].value);
const selectedBaseVoiceId = shallowRef(baseVoices[0].value);
const selectedSentenceId = shallowRef(previewSentences[0].value);
const selectedOverrideId = shallowRef<string>(overrides[0].id);
const overrideDialogVisible = shallowRef(false);
const overrideAge = shallowRef('青年期');
const overrideInjury = shallowRef('轻伤');
const overrideMood = shallowRef('克制');
const localOverride = shallowRef<OverrideRecord>();
const currentAge = shallowRef('青年');
const currentInjury = shallowRef('轻咳');
const currentMood = shallowRef('克制 · 忧虑');
const promptText = shallowRef('气息轻，句尾收束；悲而不弱。');
const parameterText = shallowRef('语速 0.92 · 音高 -1 · 稳定度 0.78');
const selectedVersionId = shallowRef<VersionId>('version-a');
const playingVersionId = shallowRef<VersionId | null>('version-a');
const candidateVersionId = shallowRef<VersionId>('version-b');
const savedCandidateVersionId = shallowRef<VersionId | null>(null);
const activeVersionId = shallowRef<VersionId>('version-a');
const activationDialogVisible = shallowRef(false);
const pendingActivationVersionId = shallowRef<VersionId>('version-a');
const hasActivatedLocally = shallowRef(false);
const pageRoot = shallowRef<HTMLElement>();
const characterSelectRef = shallowRef<ComponentPublicInstance>();
const baseVoiceSelectRef = shallowRef<ComponentPublicInstance>();
const sentenceSelectRef = shallowRef<ComponentPublicInstance>();

const selectedCharacter = computed(() => (
  characters.find(character => character.value === selectedCharacterId.value) ?? characters[0]
));
const selectedBaseVoice = computed(() => (
  baseVoices.find(voice => voice.value === selectedBaseVoiceId.value) ?? baseVoices[0]
));
const selectedSentence = computed(() => (
  previewSentences.find(sentence => sentence.value === selectedSentenceId.value) ?? previewSentences[0]
));
const selectedOverride = computed(() => (
  [localOverride.value, ...overrides].find(override => override?.id === selectedOverrideId.value) ?? overrides[0]
));
const selectedVersion = computed(() => (
  versions.find(version => version.id === selectedVersionId.value) ?? versions[0]
));

function selectOverride(overrideId: string): void {
  selectedOverrideId.value = overrideId;
}

function openOverrideDialog(): void {
  overrideAge.value = '青年期';
  overrideInjury.value = '轻伤';
  overrideMood.value = '克制';
  overrideDialogVisible.value = true;
}

function addLocalOverride(): void {
  const record: OverrideRecord = {
    id: 'local-override',
    label: `${overrideAge.value} · ${overrideInjury.value} · ${overrideMood.value}`,
    state: 'candidate',
    stateLabel: '本地候选',
    tags: [overrideAge.value, overrideInjury.value, overrideMood.value],
  };
  localOverride.value = record;
  selectedOverrideId.value = record.id;
  overrideDialogVisible.value = false;
  showDemoFeedback('状态覆盖已加入当前页面候选', 'success');
}

function selectVersion(versionId: VersionId): void {
  selectedVersionId.value = versionId;
}

function toggleVersionPlayback(versionId: VersionId): void {
  selectedVersionId.value = versionId;
  playingVersionId.value = playingVersionId.value === versionId ? null : versionId;
}

function saveCandidate(versionId: VersionId = selectedVersionId.value): void {
  selectedVersionId.value = versionId;
  candidateVersionId.value = versionId;
  savedCandidateVersionId.value = versionId;
  showDemoFeedback(`${versions.find(version => version.id === versionId)?.label ?? '当前版本'}已保存为候选，未激活`, 'success');
}

function requestActivation(versionId: VersionId = selectedVersionId.value): void {
  pendingActivationVersionId.value = versionId;
  activationDialogVisible.value = true;
}

function confirmActivation(): void {
  activeVersionId.value = pendingActivationVersionId.value;
  selectedVersionId.value = pendingActivationVersionId.value;
  hasActivatedLocally.value = true;
  activationDialogVisible.value = false;
  showDemoFeedback('当前版本已在预览中激活；不会重生成音频', 'success');
}

function showPreviewFeedback(): void {
  showDemoFeedback('生成试听仅为演示，不会调用 Provider 或音频生成');
}

function focusSelect(select: ComponentPublicInstance | undefined): void {
  const root = select?.$el as HTMLElement | undefined;
  const focusTarget = root?.matches('input, select, [role="combobox"]')
    ? root
    : root?.querySelector<HTMLElement>('input, select, [role="combobox"]');
  focusTarget?.focus();
}

function handleCharacterSelectTab(event: KeyboardEvent): void {
  event.preventDefault();
  if (event.shiftKey)
    pageRoot.value?.querySelector<HTMLElement>('[data-testid="request-activation-toolbar"]')?.focus();
  else
    focusSelect(baseVoiceSelectRef.value);
}

function handleBaseVoiceSelectTab(event: KeyboardEvent): void {
  event.preventDefault();
  focusSelect(event.shiftKey ? characterSelectRef.value : sentenceSelectRef.value);
}

function handleSentenceSelectTab(event: KeyboardEvent): void {
  event.preventDefault();
  if (event.shiftKey)
    focusSelect(baseVoiceSelectRef.value);
  else
    pageRoot.value?.querySelector<HTMLElement>('[data-override-id="young-injured-restrained"]')?.focus();
}
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main ref="pageRoot" class="workspace" aria-label="VoxWeaver 角色声音精修交互预览">
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
              <DemoPageButton page-slug="crowd-voice-pool" class="sidebar-item sidebar-item--review"><span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">路人声音池</span><span class="sidebar-count">24</span></DemoPageButton>
              <DemoPageButton page-slug="character-voice-refinement" class="sidebar-item sidebar-item--selected"><span class="sidebar-state" aria-hidden="true">✓</span><span class="sidebar-label">角色声音精修</span><span class="sidebar-count">12</span></DemoPageButton>
            </div>
            <section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
          </div>
          <div class="resize-handle" aria-disabled="true"><span></span></div>
        </aside>

        <section class="editor" aria-label="角色声音精修编辑区">
          <header class="editor-toolbar">
            <div class="toolbar-context"><strong>角色声音精修</strong><span>·</span><span>{{ selectedCharacter.label }} · 基础声音 {{ selectedBaseVoice.label }} · {{ versions.find(version => version.id === activeVersionId)?.label }} 当前激活</span></div>
            <div class="toolbar-actions" aria-label="角色声音精修操作">
              <ElDropdown trigger="click">
                <ElButton class="icon-button" aria-label="更多操作">⋯</ElButton>
                <template #dropdown><ElDropdownMenu><ElDropdownItem disabled>历史和已失效版本不可删除</ElDropdownItem></ElDropdownMenu></template>
              </ElDropdown>
              <ElButton class="toolbar-button toolbar-button--secondary" data-testid="generate-preview" @click="showPreviewFeedback">生成试听</ElButton>
              <ElButton class="toolbar-button toolbar-button--primary" data-testid="request-activation-toolbar" @click="requestActivation()">激活配置</ElButton>
            </div>
          </header>

          <div class="editor-content">
            <section class="selection-bar-detail" aria-label="角色与声音选择">
              <label class="selection-field selection-field--active selection-field--character"><span>主要角色</span><ElSelect ref="characterSelectRef" v-model="selectedCharacterId" aria-label="主要角色" data-testid="character-select" size="small" @keydown.tab.capture="handleCharacterSelectTab"><ElOption v-for="character in characters" :key="character.value" :label="character.label" :value="character.value" /></ElSelect></label>
              <label class="selection-field selection-field--active selection-field--voice"><span>当前基础声音</span><ElSelect ref="baseVoiceSelectRef" v-model="selectedBaseVoiceId" aria-label="当前基础声音" data-testid="base-voice-select" size="small" @keydown.tab.capture="handleBaseVoiceSelectTab"><ElOption v-for="voice in baseVoices" :key="voice.value" :label="voice.label" :value="voice.value" /></ElSelect></label>
              <label class="selection-field selection-field--sentence"><span>试听短句</span><ElSelect ref="sentenceSelectRef" v-model="selectedSentenceId" aria-label="试听短句" data-testid="sentence-select" size="small" @keydown.tab.capture="handleSentenceSelectTab"><ElOption v-for="sentence in previewSentences" :key="sentence.value" :label="sentence.label" :value="sentence.value" /></ElSelect></label>
              <div class="selection-summary"><strong>候选 2 · 历史 4 · 已失效 1</strong><span>Tab 顺序：角色 → 声音 → 短句</span></div>
            </section>

            <div class="detail-main refinement-main">
              <section class="refinement-panel refinement-panel--left" aria-label="基础声音与状态覆盖">
                <header class="panel-heading"><h2>基础声音 + 状态覆盖</h2><p>按实际状态新增覆盖项，不维护组合矩阵。</p></header>
                <div class="base-voice-card"><strong>{{ selectedBaseVoice.label.replace(' 当前生效', '') }}</strong><span class="active-copy">当前生效 · Provider: 示例声音包</span><span>基础语速 0% · 气息 18% · 稳定度 76%</span></div>
                <article
                  v-for="override in (localOverride ? [...overrides, localOverride] : overrides)"
                  :key="override.id"
                  class="override-card"
                  :class="[`override-card--${override.state}`, { 'override-card--selected': selectedOverride.id === override.id }]"
                  :data-override-id="override.id"
                  role="button"
                  tabindex="0"
                  @click="selectOverride(override.id)"
                  @keydown.enter.prevent="selectOverride(override.id)"
                  @keydown.space.prevent="selectOverride(override.id)"
                >
                  <div class="override-title"><strong>{{ override.label }}</strong><em>{{ override.stateLabel }}</em></div>
                  <div class="chip-row"><ElTag v-for="tag in override.tags" :key="tag" class="chip" effect="plain" round>{{ tag }}</ElTag></div>
                  <span>覆盖优先级：规则待确认</span>
                </article>
                <ElButton class="outline-action" data-testid="open-override-dialog" @click="openOverrideDialog">＋ 新增状态覆盖</ElButton>
                <div class="override-note"><strong>! 冲突覆盖优先级：规则待确认</strong><span>当前设计不假设自动覆盖顺序。</span></div>
              </section>

              <section class="refinement-panel refinement-panel--middle" aria-label="试听与版本对比">
                <header class="panel-heading"><h2>试听与版本 A/B 对比</h2><p>短句：{{ selectedSentence.text }}</p></header>
                <ElButton class="main-preview" data-testid="selected-version-play" @click="toggleVersionPlayback(selectedVersion.id)"><span class="audio-icon">{{ playingVersionId === selectedVersion.id ? 'Ⅱ' : '▶' }}</span><span class="audio-copy"><strong>{{ playingVersionId === selectedVersion.id ? '正在播放' : '可播放' }} · {{ selectedVersion.label }}</strong><span>{{ playingVersionId === selectedVersion.id ? '00:03 / 00:08' : '00:00 / 00:08' }} · {{ activeVersionId === selectedVersion.id ? '当前激活' : candidateVersionId === selectedVersion.id ? '候选' : '未激活' }}</span></span><span class="audio-action">{{ playingVersionId === selectedVersion.id ? '暂停' : '播放' }}</span></ElButton>
                <div class="ab-compare">
                  <article
                    v-for="version in versions"
                    :key="version.id"
                    class="version-card"
                    :class="[
                      version.id === activeVersionId ? 'version-card--active' : 'version-card--candidate',
                      { 'version-card--selected': version.id === selectedVersionId },
                    ]"
                    :data-version-id="version.id"
                    role="button"
                    tabindex="0"
                    @click="selectVersion(version.id)"
                    @keydown.enter.prevent="selectVersion(version.id)"
                    @keydown.space.prevent="selectVersion(version.id)"
                  >
                    <header class="version-title"><strong>{{ version.label }}</strong><ElTag effect="plain" size="small" :type="version.id === activeVersionId ? 'success' : 'warning'">{{ version.id === activeVersionId ? '当前激活' : version.id === candidateVersionId ? '候选' : '未激活' }}</ElTag></header>
                    <p class="version-copy">“{{ selectedSentence.text }}”</p>
                    <ElButton class="version-preview" :data-testid="`play-${version.id}`" @click.stop="toggleVersionPlayback(version.id)"><strong>{{ playingVersionId === version.id ? 'Ⅱ' : '▶' }}</strong><span>{{ playingVersionId === version.id ? '播放中 00:03' : '播放 00:08' }}</span></ElButton>
                    <p class="version-metrics">{{ version.metrics }}</p>
                    <ElButton v-if="version.id !== activeVersionId" link class="version-state" :data-testid="`save-${version.id}`" @click.stop="saveCandidate(version.id)">{{ version.id === savedCandidateVersionId ? '已保存为候选' : '保存为候选' }}</ElButton>
                    <span v-else class="version-state">当前激活</span>
                  </article>
                </div>
                <section class="version-history"><h3>版本状态</h3><div class="history-row"><span>历史 · v2</span><span>可回看，不生效</span></div><div class="history-row"><span>已失效 · v1</span><span>已被基础声音 v3 替换</span></div></section>
                <div class="impact-badge">↗ <span>仅影响 12 个引用段落</span></div>
                <div class="impact-note"><strong>影响范围：仅 12 个引用段落</strong><span>保存候选不自动重生成音频；激活后由后续任务处理。</span></div>
              </section>

              <aside class="refinement-panel refinement-panel--right" aria-label="上下文检查器">
                <header class="inspector-heading"><h2>上下文检查器</h2><p>配置当前状态组合并生成试听</p></header>
                <section class="inspector-box inspector-box--combination">
                  <h3>当前状态组合</h3>
                  <label class="combination-row"><span>年龄</span><ElSelect v-model="currentAge" aria-label="当前年龄" size="small"><ElOption label="青年" value="青年" /><ElOption label="成年" value="成年" /></ElSelect></label>
                  <label class="combination-row"><span>伤病</span><ElSelect v-model="currentInjury" aria-label="当前伤病" size="small"><ElOption label="轻咳" value="轻咳" /><ElOption label="无伤" value="无伤" /></ElSelect></label>
                  <label class="combination-row"><span>情绪 / 心情</span><ElSelect v-model="currentMood" aria-label="当前情绪" size="small"><ElOption label="克制 · 忧虑" value="克制 · 忧虑" /><ElOption label="焦虑" value="焦虑" /></ElSelect></label>
                  <p class="combination-note">覆盖优先级：规则待确认</p>
                </section>
                <section class="inspector-box inspector-box--parameters">
                  <h3>提示词 / 参数</h3>
                  <label class="parameter-field"><span>提示词</span><ElInput v-model="promptText" aria-label="提示词" data-testid="prompt-input" size="small" /></label>
                  <label class="parameter-field"><span>生成参数</span><ElInput v-model="parameterText" aria-label="生成参数" data-testid="parameter-input" size="small" /></label>
                </section>
                <div class="inspector-actions" aria-label="试听和保存操作"><ElButton class="small-action" @click="showPreviewFeedback">生成试听</ElButton><ElButton class="small-action" data-testid="save-candidate" @click="saveCandidate()">保存候选</ElButton><ElButton class="small-action small-action--primary" data-testid="request-activation" @click="requestActivation()">激活配置</ElButton></div>
                <div v-if="hasActivatedLocally" class="impact-badge" data-testid="activated-impact">↗ <span>激活后仅影响 12 个引用段落</span></div>
                <p class="activation-note">激活后保留候选与历史版本；下游结果不在此处自动重生成。</p>
              </aside>
            </div>
          </div>
        </section>
      </div>

      <ElDialog v-model="overrideDialogVisible" aria-label="新增状态覆盖" data-testid="override-dialog" title="新增状态覆盖" width="440px">
        <div class="role-dialog-form">
          <label><span>年龄阶段</span><ElSelect v-model="overrideAge" aria-label="覆盖年龄阶段"><ElOption label="青年期" value="青年期" /><ElOption label="成年期" value="成年期" /></ElSelect></label>
          <label><span>伤病状态</span><ElSelect v-model="overrideInjury" aria-label="覆盖伤病状态"><ElOption label="轻伤" value="轻伤" /><ElOption label="无伤" value="无伤" /><ElOption label="重伤" value="重伤" /></ElSelect></label>
          <label><span>情绪状态</span><ElSelect v-model="overrideMood" aria-label="覆盖情绪状态"><ElOption label="克制" value="克制" /><ElOption label="焦虑" value="焦虑" /><ElOption label="悲伤" value="悲伤" /></ElSelect></label>
          <p>新覆盖仅加入当前页面候选，不改变现有历史或已失效版本。</p>
        </div>
        <template #footer><ElButton @click="overrideDialogVisible = false">取消</ElButton><ElButton type="primary" data-testid="confirm-override" @click="addLocalOverride">添加到当前预览</ElButton></template>
      </ElDialog>

      <ElDialog v-model="activationDialogVisible" aria-label="确认激活配置" data-testid="activation-dialog" title="确认激活配置" width="440px">
        <p>确认后仅将 {{ versions.find(version => version.id === pendingActivationVersionId)?.label }} 标记为当前激活，不调用 Provider、不生成或重生成音频，也不删除候选、历史和已失效版本。</p>
        <div class="impact-badge">↗ <span>仅影响 12 个引用段落</span></div>
        <template #footer><ElButton data-testid="cancel-activation" @click="activationDialogVisible = false">取消</ElButton><ElButton type="primary" data-testid="confirm-activation" @click="confirmActivation">确认激活</ElButton></template>
      </ElDialog>
    </main>
  </PageDocument>
</template>
