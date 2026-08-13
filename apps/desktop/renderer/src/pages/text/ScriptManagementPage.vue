<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import PageDocument from '@/components/PageDocument.vue';
import { getDemoPageRouteName } from '@/demo/navigation';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';
import TextDemoShell from './TextDemoShell.vue';

interface ScriptParagraph {
  expression: string;
  id: string;
  referenced: boolean;
  speaker: string;
  text: string;
}

const bodyClasses = ['text-page', 'script-page'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const router = useRouter();
const paragraphs = ref<ScriptParagraph[]>([
  { expression: '低声', id: 'para_01_017', referenced: false, speaker: '林舟', text: '雨声贴着窗沿落下。林舟停顿片刻，压低声音说：我们必须在天亮前离开这里。' },
  { expression: '低声', id: 'para_01_018', referenced: true, speaker: '林舟', text: '门轴发出一声轻响。林舟停在原地，雨水从衣角滴落。“别回头。”沈砚在身后说。林舟却已经看见门后的影子。' },
  { expression: '低声', id: 'para_01_021', referenced: false, speaker: '林舟', text: '林舟把散落在桌面的记录一页页重新排好，又将昨夜发生的事情从头复述了一遍。他刻意放慢速度，希望每个人都能听清，但这段文字已经超过当前段落最长字数配置，需要拆分后才能继续生成音频。' },
]);
const selectedParagraphId = ref('para_01_018');
const editing = ref(false);
const editDraft = ref('');
const historyDrawerOpen = ref(false);
const version = ref(7);
const localSplitPreview = ref<string[]>([]);

const selectedParagraph = computed(() => (
  paragraphs.value.find(paragraph => paragraph.id === selectedParagraphId.value) ?? paragraphs.value[0]!
));

function selectParagraph(paragraphId: string): void {
  selectedParagraphId.value = paragraphId;
  editing.value = false;
}

function beginEdit(): void {
  editDraft.value = selectedParagraph.value.text;
  editing.value = true;
}

function saveEdit(): void {
  const text = editDraft.value.trim();
  if (!text)
    return;
  selectedParagraph.value.text = text;
  editing.value = false;
  showDemoFeedback('段落文本已更新到当前页面状态', 'success');
}

function moveParagraph(direction: -1 | 1): void {
  const currentIndex = paragraphs.value.findIndex(paragraph => paragraph.id === selectedParagraphId.value);
  const nextIndex = currentIndex + direction;
  if (nextIndex < 0 || nextIndex >= paragraphs.value.length) {
    showDemoFeedback('当前段落已到达本地演示列表边界');
    return;
  }

  const target = paragraphs.value[nextIndex]!;
  paragraphs.value[nextIndex] = paragraphs.value[currentIndex]!;
  paragraphs.value[currentIndex] = target;
  showDemoFeedback(`段落已在当前页面${direction < 0 ? '上移' : '下移'}`);
}

function mergeWithPrevious(): void {
  const currentIndex = paragraphs.value.findIndex(paragraph => paragraph.id === selectedParagraphId.value);
  if (currentIndex <= 0) {
    showDemoFeedback('没有可合并的上一段', 'warning');
    return;
  }

  const previous = paragraphs.value[currentIndex - 1]!;
  previous.text = `${previous.text}${selectedParagraph.value.text}`;
  paragraphs.value.splice(currentIndex, 1);
  selectedParagraphId.value = previous.id;
  showDemoFeedback('段落已在当前页面合并，不会写入文件', 'success');
}

function splitParagraph(): void {
  if (selectedParagraph.value.referenced) {
    void router.push({ name: getDemoPageRouteName('text-downstream-stale-dialog') });
    return;
  }

  const text = selectedParagraph.value.text;
  const midpoint = Math.max(1, Math.round(text.length / 2));
  localSplitPreview.value = [text.slice(0, midpoint), text.slice(midpoint)];
  showDemoFeedback('已生成未引用段落的本地拆分预览');
}

function saveVersion(): void {
  version.value += 1;
  showDemoFeedback(`剧本版本标签已更新为 v${version.value}`, 'success');
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <TextDemoShell
      current-page="script-management"
      editor-aria-label="剧本管理编辑区"
      label="VoxWeaver 剧本管理演示页面"
      :toolbar-detail="`第 03 章 · 门后的影子 · 剧本 v${version} · 最长 200 字`"
      toolbar-title="剧本管理"
    >
      <template #toolbar-actions>
        <span class="icon-button" aria-disabled="true">⋯</span>
        <ElButton class="toolbar-button toolbar-button--secondary" data-testid="open-version-history" @click="historyDrawerOpen = true">版本历史</ElButton>
        <ElButton class="toolbar-button toolbar-button--primary" data-testid="save-script-version" @click="saveVersion">保存剧本版本</ElButton>
      </template>

      <div class="text-editor-content script-content">
        <div class="page-heading script-heading"><div class="page-heading-copy"><h2>剧本管理</h2><p>第 03 章 · 门后的影子 · 当前版本 v{{ version }} · 段落最长 200 字</p></div><span class="status-badge status-badge--review"><span>!</span><span>待复核</span></span></div>
        <div class="script-tool-row">
          <ElButton class="text-button" data-testid="split-script-paragraph" @click="splitParagraph"><span>拆分段落</span></ElButton>
          <ElButton class="text-button" @click="mergeWithPrevious"><span>合并上段</span></ElButton>
          <ElButton class="text-button" @click="moveParagraph(-1)"><span>上移</span></ElButton>
          <ElButton class="text-button" @click="moveParagraph(1)"><span>下移</span></ElButton>
          <ElButton class="text-button" @click="beginEdit"><span>编辑文本</span></ElButton>
          <span class="hint">选择已被下游引用的段落后，拆分将打开失效确认。</span>
        </div>

        <article
          v-for="(paragraph, index) in paragraphs"
          :key="paragraph.id"
          class="script-row" :class="[{ 'script-row--selected': paragraph.id === selectedParagraphId, 'script-row--error': paragraph.text.length > 200 }]"
          :data-testid="`script-paragraph-${paragraph.id}`"
          @click="selectParagraph(paragraph.id)"
        >
          <button class="script-meta script-select-control" type="button" :aria-label="`选择段落 ${paragraph.id}`" @click.stop="selectParagraph(paragraph.id)"><span class="script-meta-left"><span class="caption">第 {{ String(17 + index).padStart(3, '0') }} 行</span><strong>说话人：{{ paragraph.speaker }}</strong><span style="color: var(--vw-text-secondary)">表达：{{ paragraph.expression }}</span><span :style="{ color: paragraph.text.length > 200 ? 'var(--vw-state-error)' : 'var(--vw-accent-primary)' }">{{ paragraph.text.length > 200 ? '超长阻塞' : '默认' }}</span></span><span class="script-id">{{ paragraph.id }}</span></button>
          <ElInput v-if="editing && paragraph.id === selectedParagraphId" v-model="editDraft" aria-label="编辑选中段落文本" :rows="3" type="textarea" @click.stop />
          <p v-else class="script-copy">{{ paragraph.text }}</p>
          <div v-if="editing && paragraph.id === selectedParagraphId" class="card-actions" @click.stop><ElButton class="text-button" @click="editing = false">取消</ElButton><ElButton class="text-button text-button--primary" :disabled="!editDraft.trim()" @click="saveEdit">保存文本</ElButton></div>
          <div v-else class="script-annotations"><span class="annotation"><span>人</span><span>说话人：林砚</span></span><span class="annotation"><span>◇</span><span>情绪：紧张</span></span><span class="annotation annotation--reading"><span>↗</span><span>朗读：压低音量</span></span></div>
          <div class="script-status"><span class="script-status-copy" :class="[{ 'script-status-copy--error': paragraph.text.length > 200 }]">{{ paragraph.text.length > 200 ? `阻塞：超过最长字数 ${paragraph.text.length - 200} 字。请拆分段落或调整配置。` : '来源：第 3 章 · 18–24 行' }}</span><div class="script-flags"><span class="impact-badge" :class="[paragraph.referenced ? 'impact-badge--invalidated' : 'impact-badge--neutral']"><span>{{ paragraph.referenced ? '链' : '○' }}</span><span>{{ paragraph.referenced ? '音频与时间轴已引用' : '未引用' }}</span></span><span class="length-counter" :class="[{ 'length-counter--error': paragraph.text.length > 200 }]"><span>{{ paragraph.text.length > 200 ? '阻塞' : '正常' }}</span><span>{{ paragraph.text.length }} / 200</span></span><span class="status-badge" :class="[paragraph.text.length > 200 ? 'status-badge--error' : 'status-badge--neutral']"><span>{{ paragraph.text.length > 200 ? '×' : '•' }}</span><span>{{ paragraph.text.length > 200 ? '失败' : '默认' }}</span></span></div></div>
        </article>

        <section v-if="localSplitPreview.length" class="split-result">
          <div class="row-between"><strong>本地拆分预览</strong><span class="status-badge status-badge--success"><span>✓</span><span>已完成</span></span></div>
          <article v-for="(text, index) in localSplitPreview" :key="index" class="split-result-row"><div class="script-meta"><div class="script-meta-left"><span class="caption">预览 {{ index + 1 }}</span><strong>说话人：{{ selectedParagraph.speaker }}</strong><span class="caption">未生成稳定 ID</span></div></div><p class="script-copy">{{ text }}</p><p class="caption">当前页面局部状态；不继承或修改音频与时间轴。</p></article>
        </section>
      </div>

      <ElDrawer v-model="historyDrawerOpen" title="剧本版本历史" size="420px" append-to-body>
        <div class="version-history-list">
          <section v-for="item in [version, version - 1, version - 2]" :key="item" class="surface-card version-history-item"><strong>剧本 v{{ item }}</strong><span class="caption">{{ item === version ? '当前本地演示版本' : '固定历史展示' }}</span></section>
        </div>
      </ElDrawer>
    </TextDemoShell>
  </PageDocument>
</template>
