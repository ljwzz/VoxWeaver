<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import PostWorkbenchFrame from './PostWorkbenchFrame.vue';

type TimelineClipStatus = 'duplicate' | 'missing' | 'stale' | 'unreviewed' | 'valid';

interface TimelineClip {
  end: string;
  id: string;
  left: number;
  paragraph: string;
  speaker: string;
  start: string;
  status: TimelineClipStatus;
  statusLabel: string;
  text: string;
}

interface TimelineTick {
  clipId: string;
  label: string;
  left: number;
  time: string;
}

const timelineClips: readonly TimelineClip[] = [
  { end: '00:09.200', id: 'P-018', left: 20, paragraph: '段落 18', speaker: '旁白', start: '00:00.000', status: 'valid', statusLabel: '有效', text: '雨线斜斜地敲在檐上，旧宅只亮着一盏灯。' },
  { end: '--:--.---', id: 'P-019', left: 194, paragraph: '段落 19', speaker: '沈砚', start: '00:09.600', status: 'missing', statusLabel: '缺失', text: '沈砚起身走向门边，脚步在门后停住。' },
  { end: '00:19.200', id: 'P-020', left: 368, paragraph: '段落 20', speaker: '旁白', start: '00:15.400', status: 'duplicate', statusLabel: '重复', text: '门外传来三声轻叩，又被重复片段覆盖。' },
  { end: '00:29.400', id: 'P-021', left: 542, paragraph: '段落 21', speaker: '苏婉', start: '00:19.800', status: 'unreviewed', statusLabel: '未审核', text: '“是我。”门外的声音隔着雨幕传来。' },
  { end: '00:39.800', id: 'P-022', left: 716, paragraph: '段落 22', speaker: '旁白', start: '00:30.100', status: 'stale', statusLabel: '已失效', text: '门外的人收起油纸伞，旧结果因剧本更新而失效。' },
  { end: '00:46.800', id: 'P-023', left: 890, paragraph: '段落 23', speaker: '苏婉', start: '00:40.200', status: 'valid', statusLabel: '有效', text: '“多谢。”门外的雨声暂歇，角色在片段末尾停顿。' },
  { end: '00:56.100', id: 'P-024', left: 1100, paragraph: '段落 24', speaker: '旁白', start: '00:47.600', status: 'valid', statusLabel: '有效', text: '沈砚沉默片刻，侧身让开门。' },
];

const timelineTicks: readonly TimelineTick[] = [
  { clipId: 'P-018', label: '00:00', left: 19, time: '00:00.000' },
  { clipId: 'P-020', label: '00:30', left: 249, time: '00:15.400' },
  { clipId: 'P-021', label: '01:00', left: 479, time: '00:19.800' },
  { clipId: 'P-022', label: '01:30', left: 709, time: '00:30.100' },
  { clipId: 'P-023', label: '02:00', left: 899, time: '00:42.680' },
];

const selectedClipId = ref('P-023');
const currentTime = ref('00:42.680');
const isPlaying = ref(true);
const snapEnabled = ref(true);
const zoom = ref(100);
const actionState = ref('尚未执行本地调整');

const editForm = reactive({
  end: '00:46.800',
  postPause: 0.8,
  prePause: 0.4,
  start: '00:40.200',
});

const selectedClip = computed<TimelineClip>(() => (
  timelineClips.find(clip => clip.id === selectedClipId.value) ?? timelineClips[0]!
));
const timelineScale = computed(() => zoom.value / 100);
const timelineCanvasStyle = computed(() => ({ width: `${1480 * timelineScale.value}px` }));
const waveformCursorLeft = computed(() => `${63 + selectedClip.value.left / 1480 * 909}px`);
const playheadLeft = computed(() => `${selectedClip.value.left * timelineScale.value + 56}px`);

function clipStateClass(status: TimelineClipStatus): string {
  if (status === 'valid')
    return 'is-success';
  if (status === 'missing')
    return 'is-error';
  if (status === 'stale')
    return 'is-stale';
  return 'is-warning';
}

function stateTextClass(status: TimelineClipStatus): string {
  if (status === 'valid')
    return 'state-success';
  if (status === 'missing')
    return 'state-error';
  if (status === 'stale')
    return 'state-stale';
  return 'state-warning';
}

function selectClip(clipId: string, time?: string): void {
  const clip = timelineClips.find(candidate => candidate.id === clipId);
  if (!clip)
    return;

  selectedClipId.value = clip.id;
  currentTime.value = time ?? clip.start;
  editForm.start = clip.start;
  editForm.end = clip.end;
  editForm.prePause = clip.id === 'P-023' ? 0.4 : 0;
  editForm.postPause = clip.id === 'P-023' ? 0.8 : 0;
  actionState.value = `${clip.id} 已定位；${clip.statusLabel}状态保持不变`;
}

function togglePlayback(): void {
  isPlaying.value = !isPlaying.value;
}

function decreaseZoom(): void {
  zoom.value = Math.max(75, zoom.value - 25);
}

function increaseZoom(): void {
  zoom.value = Math.min(150, zoom.value + 25);
}

function applyPauseDraft(): void {
  actionState.value = `${selectedClip.value.id} 的停顿草稿已更新（仅本页）`;
  showDemoFeedback('停顿草稿已更新', 'success');
}

function replaceClipDraft(): void {
  actionState.value = `${selectedClip.value.id} 已进入替换演示；${selectedClip.value.statusLabel}状态未自动变更`;
  showDemoFeedback('替换片段仅更新本地演示状态', 'warning');
}

function generateChapterDraft(): void {
  actionState.value = '章节音频生成演示已触发；缺失、重复、未审核和已失效门禁仍保留';
  showDemoFeedback('未生成真实章节音频，现有门禁保持不变', 'warning');
}
</script>

<template>
  <PostWorkbenchFrame editor-label="时间轴对齐编辑区">
    <header class="chapter-toolbar">
      <div class="chapter-context">
        <h2>第 12 章 · 雨夜来客</h2>
        <p>章节音频合并 / 时间轴对齐</p>
      </div>
      <div class="toolbar-spacer"></div>
      <ElTag effect="plain" type="success">38 有效</ElTag>
      <ElTag effect="plain" type="danger">2 缺失 / 1 已失效</ElTag>
      <ElButton type="primary" data-testid="generate-chapter-audio" @click="generateChapterDraft">
        生成章节音频
      </ElButton>
    </header>

    <div class="post-content">
      <div class="post-content-inner timeline-content">
        <section class="waveform-card" aria-label="章节波形视觉预览">
          <ElButton
            class="waveform-control"
            circle
            :aria-label="isPlaying ? '暂停视觉预览' : '播放视觉预览'"
            :aria-pressed="isPlaying"
            data-testid="timeline-play"
            type="primary"
            @click="togglePlayback"
          >
            {{ isPlaying ? 'Ⅱ' : '▶' }}
          </ElButton>
          <span class="waveform-caption">第 12 章 · 有效音频 38</span>
          <span class="waveform-time" data-testid="timeline-current-time">{{ currentTime }} / 08:36.200</span>
          <img class="waveform-graphic" src="./assets/waveform.svg" alt="固定章节波形">
          <span class="waveform-line" :style="{ left: waveformCursorLeft }" aria-hidden="true"></span>
          <span class="waveform-state">{{ isPlaying ? '播放中（视觉）' : '已暂停（视觉）' }}</span>
        </section>

        <div class="timeline-controls">
          <label class="snap-control">
            <span>磁吸：{{ snapEnabled ? '开启' : '关闭' }}</span>
            <ElSwitch v-model="snapEnabled" aria-label="磁吸" data-testid="snap-switch" />
          </label>
          <ElTag effect="plain">精度：10 ms</ElTag>
          <div class="zoom-control" aria-label="时间轴缩放">
            <ElButton aria-label="缩小时间轴" data-testid="zoom-out" :disabled="zoom <= 75" @click="decreaseZoom">−</ElButton>
            <span data-testid="zoom-value">缩放 {{ zoom }}%</span>
            <ElButton aria-label="放大时间轴" data-testid="zoom-in" :disabled="zoom >= 150" @click="increaseZoom">＋</ElButton>
          </div>
          <span class="caption">保持片段最小宽度 · 横向滚动 / 缩放</span>
        </div>

        <section class="timeline-viewport" aria-label="章节时间轴">
          <div class="timeline-canvas" :style="timelineCanvasStyle">
            <div class="timeline-ruler">
              <button
                v-for="tick in timelineTicks"
                :key="tick.clipId"
                class="timeline-tick-button is-major"
                :data-tick-id="tick.clipId"
                :style="{ left: `${tick.left * timelineScale}px` }"
                type="button"
                @click="selectClip(tick.clipId, tick.time)"
              >
                <span>{{ tick.label }}</span>
              </button>
            </div>

            <button
              v-for="clip in timelineClips"
              :key="clip.id"
              class="timeline-clip"
              :class="[clipStateClass(clip.status), { 'is-selected': clip.id === selectedClip.id }]"
              :data-clip-id="clip.id"
              :style="{ left: `${clip.left * timelineScale}px`, width: `${165 * timelineScale}px` }"
              type="button"
              @click="selectClip(clip.id, clip.id === 'P-023' ? '00:42.680' : clip.start)"
            >
              <span class="timeline-clip-header">
                <span>{{ clip.speaker }}</span>
                <span :class="stateTextClass(clip.status)">{{ clip.statusLabel }}<template v-if="clip.id === selectedClip.id"> · 当前</template></span>
              </span>
              <span class="timeline-clip-id">{{ clip.id }}</span>
              <span class="timeline-clip-time"><span>{{ clip.start }}</span><span>→ {{ clip.end }}</span></span>
            </button>

            <div class="timeline-playhead" :style="{ left: playheadLeft }">
              <span>{{ currentTime }}</span>
              <img src="./assets/playhead-handle.svg" alt="" aria-hidden="true">
            </div>
          </div>
        </section>

        <div class="timeline-scrollbar" aria-hidden="true"></div>

        <section class="current-clip-panel" aria-label="当前片段与本地参数">
          <div class="current-script">
            <span class="label state-accent">
              ▶ 当前指针 {{ currentTime }} · <span data-testid="current-clip-id">{{ selectedClip.id }}</span>
            </span>
            <div class="script-summary-list" aria-label="剧本文本摘要">
              <button
                v-for="clip in timelineClips"
                :key="clip.id"
                :class="{ 'is-current': clip.id === selectedClip.id }"
                :data-script-id="clip.id"
                type="button"
                @click="selectClip(clip.id, clip.id === 'P-023' ? '00:42.680' : clip.start)"
              >
                <strong>{{ clip.id }}</strong>
                <span>{{ clip.text }}</span>
              </button>
            </div>
            <strong class="body-strong">{{ selectedClip.speaker }} · {{ selectedClip.paragraph }} · {{ selectedClip.statusLabel }}</strong>
            <blockquote>{{ selectedClip.text }}</blockquote>
            <span class="caption" data-testid="timeline-action-state">{{ actionState }}</span>
          </div>

          <div class="exact-controls">
            <div class="time-inputs">
              <label class="time-input">
                <span class="caption">开始时间</span>
                <ElInput v-model="editForm.start" aria-label="开始时间" size="small" />
              </label>
              <label class="time-input">
                <span class="caption">结束时间</span>
                <ElInput v-model="editForm.end" aria-label="结束时间" size="small" />
              </label>
              <label class="time-input">
                <span class="caption">前置停顿（秒）</span>
                <ElInputNumber v-model="editForm.prePause" :max="5" :min="0" :precision="3" :step="0.1" size="small" />
              </label>
              <label class="time-input">
                <span class="caption">后置停顿（秒）</span>
                <ElInputNumber v-model="editForm.postPause" :max="5" :min="0" :precision="3" :step="0.1" size="small" />
              </label>
            </div>
            <div class="clip-actions">
              <ElButton @click="applyPauseDraft">调整停顿</ElButton>
              <ElButton @click="replaceClipDraft">替换片段</ElButton>
              <ElTag effect="plain">{{ snapEnabled ? '拖动后自动吸附' : '自由移动演示' }}</ElTag>
            </div>
            <span class="caption">仅更新本页选择与表单草稿；不会读取、写入或生成音频。</span>
          </div>
        </section>
      </div>
    </div>
  </PostWorkbenchFrame>
</template>
