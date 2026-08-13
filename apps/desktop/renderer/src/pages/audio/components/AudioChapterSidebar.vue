<script setup lang="ts">
import { computed, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';

type ChapterStatus = 'complete' | 'generating' | 'not-generated' | 'review' | 'stale';
type ChapterRange = 'actionable' | 'current' | 'volume';

interface ChapterItem {
  id: string;
  number: string;
  title: string;
  status: ChapterStatus;
}

const props = withDefaults(defineProps<{
  chapterTwelveStatus?: ChapterStatus;
  selectedChapterId?: string;
}>(), {
  chapterTwelveStatus: 'review',
  selectedChapterId: '12',
});

const emit = defineEmits<{
  select: [chapterId: string, chapterTitle: string];
}>();
const route = useRoute();

const pageNavItems = [
  { label: '章节参数', slug: 'audio-chapter-parameters' },
  { label: '选区要求', slug: 'audio-selection-requirements' },
  { label: 'ASR 复核', slug: 'audio-asr-review' },
  { label: '整章生成', slug: 'audio-chapter-generation' },
  { label: '失效传播', slug: 'audio-stale-propagation' },
] as const;

const sourceChapters: readonly ChapterItem[] = [
  { id: '10', number: '第 10 章', title: '旧园重逢', status: 'not-generated' },
  { id: '11', number: '第 11 章', title: '风声渐起', status: 'generating' },
  { id: '12', number: '第 12 章', title: '雨夜来客', status: 'review' },
  { id: '13', number: '第 13 章', title: '灯下问答', status: 'complete' },
  { id: '14', number: '第 14 章', title: '门外余音', status: 'stale' },
];

const statusOptions: readonly { label: string; value: ChapterStatus | 'all' }[] = [
  { label: '全部状态', value: 'all' },
  { label: '未生成', value: 'not-generated' },
  { label: '生成中', value: 'generating' },
  { label: '待复核', value: 'review' },
  { label: '已完成', value: 'complete' },
  { label: '已失效', value: 'stale' },
];

const rangeOptions: readonly { label: string; value: ChapterRange }[] = [
  { label: '本卷', value: 'volume' },
  { label: '当前章节', value: 'current' },
  { label: '需处理', value: 'actionable' },
];

const statusPresentation: Record<ChapterStatus, { className: string; label: string }> = {
  'complete': { className: 'chapter-card--complete', label: '✓ 已完成' },
  'generating': { className: 'chapter-card--generating', label: '↻ 生成中' },
  'not-generated': { className: '', label: '○ 未生成' },
  'review': { className: 'chapter-card--review', label: '! 待复核' },
  'stale': { className: 'chapter-card--stale', label: '↺ 已失效' },
};

const searchQuery = shallowRef('');
const selectedStatus = shallowRef<ChapterStatus | 'all'>('all');
const selectedRange = shallowRef<ChapterRange>('volume');
const selectedChapterId = shallowRef(props.selectedChapterId);

const chapters = computed<ChapterItem[]>(() => sourceChapters.map(chapter => ({
  ...chapter,
  status: resolveChapterStatus(chapter),
})));

const visibleChapters = computed(() => {
  const query = searchQuery.value.trim().toLocaleLowerCase('zh-CN');

  return chapters.value.filter((chapter) => {
    const matchesSearch = !query
      || chapter.number.toLocaleLowerCase('zh-CN').includes(query)
      || chapter.title.toLocaleLowerCase('zh-CN').includes(query)
      || chapter.id.includes(query);
    const matchesStatus = selectedStatus.value === 'all'
      || chapter.status === selectedStatus.value;
    const matchesRange = selectedRange.value === 'volume'
      || (selectedRange.value === 'current' && chapter.id === selectedChapterId.value)
      || (selectedRange.value === 'actionable' && chapter.status !== 'complete');

    return matchesSearch && matchesStatus && matchesRange;
  });
});

const statusSummary = computed(() => chapters.value.reduce<Record<ChapterStatus, number>>((summary, chapter) => {
  summary[chapter.status] += 1;
  return summary;
}, {
  'complete': 0,
  'generating': 0,
  'not-generated': 0,
  'review': 0,
  'stale': 0,
}));

watch(() => props.selectedChapterId, (chapterId) => {
  selectedChapterId.value = chapterId;
});

function selectChapter(chapter: ChapterItem): void {
  selectedChapterId.value = chapter.id;
  emit('select', chapter.id, chapter.title);
}

function resolveChapterStatus(chapter: ChapterItem): ChapterStatus {
  if (chapter.id === '12')
    return props.chapterTwelveStatus;
  if (props.chapterTwelveStatus === 'generating' && chapter.id === '11')
    return 'review';
  if (props.chapterTwelveStatus === 'stale' && chapter.id === '14')
    return 'review';
  return chapter.status;
}

function isResponsiveChapterParameters(slug: typeof pageNavItems[number]['slug']): boolean {
  return route.meta.pageSlug === 'audio-chapter-parameters-1280'
    && slug === 'audio-chapter-parameters';
}
</script>

<template>
  <aside class="context-sidebar" aria-label="音频生成章节与页面导航">
    <div class="sidebar-content audio-sidebar-content">
      <div class="audio-sidebar-stack">
        <header class="audio-sidebar-title">
          <h1>音频生成</h1>
          <span>本地交互预览</span>
        </header>

        <nav class="audio-page-nav" aria-label="音频子页面">
          <DemoPageButton
            v-for="item in pageNavItems"
            :key="item.slug"
            class="audio-page-link"
            :class="{ 'audio-page-link--equivalent': isResponsiveChapterParameters(item.slug) }"
            :data-page-slug="item.slug"
            :page-slug="item.slug"
          >
            {{ item.label }}
          </DemoPageButton>
        </nav>

        <ElInput
          v-model="searchQuery"
          aria-label="搜索章节名或编号"
          clearable
          data-testid="audio-chapter-search"
          placeholder="搜索章节名或编号"
          size="small"
        />

        <div class="chapter-filters">
          <ElSelect
            v-model="selectedStatus"
            aria-label="按章节状态筛选"
            data-testid="audio-status-filter"
            size="small"
          >
            <ElOption
              v-for="option in statusOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </ElSelect>
          <ElSelect
            v-model="selectedRange"
            aria-label="按章节范围筛选"
            data-testid="audio-range-filter"
            size="small"
          >
            <ElOption
              v-for="option in rangeOptions"
              :key="option.value"
              :label="option.label"
              :value="option.value"
            />
          </ElSelect>
        </div>

        <div class="chapter-list-heading">
          <h2>章节列表</h2>
          <span>{{ visibleChapters.length }} / {{ chapters.length }} 章</span>
        </div>

        <div class="chapter-list" role="listbox" aria-label="章节列表">
          <button
            v-for="chapter in visibleChapters"
            :key="chapter.id"
            class="chapter-card"
            :class="[
              statusPresentation[chapter.status].className,
              { 'chapter-card--selected': chapter.id === selectedChapterId },
            ]"
            :aria-selected="chapter.id === selectedChapterId"
            :data-chapter-id="chapter.id"
            role="option"
            type="button"
            @click="selectChapter(chapter)"
          >
            <span class="chapter-info">
              <strong>{{ chapter.number }}</strong>
              <span>{{ chapter.title }}</span>
            </span>
            <span class="chapter-status">{{ statusPresentation[chapter.status].label }}</span>
          </button>
          <p v-if="visibleChapters.length === 0" class="chapter-empty" role="status">
            没有符合条件的章节
          </p>
        </div>
      </div>

      <div class="chapter-summary" aria-label="章节状态摘要">
        ○ 未生成 {{ statusSummary['not-generated'] }} · ↻ 生成中 {{ statusSummary.generating }} · ! 待复核 {{ statusSummary.review }}<br>
        ✓ 已完成 {{ statusSummary.complete }} · ↺ 已失效 {{ statusSummary.stale }}
      </div>
    </div>
    <div class="resize-handle" aria-hidden="true"><span></span></div>
  </aside>
</template>
