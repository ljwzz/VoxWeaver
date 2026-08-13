<script setup lang="ts">
import { computed, ref } from 'vue';
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

interface OfflineSegment {
  id: string;
  left: number;
  speaker: string;
  summary: string;
  time: string;
  title: string;
  width: number;
}

const bodyClasses = ['offline-page'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;

const offlineSegments: readonly OfflineSegment[] = [
  { id: 'P-018', left: 7, speaker: '旁白', summary: '雨线斜斜地敲在檐上，旧宅只亮着一盏灯。', time: '00:00.000', title: '雨夜旧宅', width: 88 },
  { id: 'P-019', left: 103, speaker: '沈砚', summary: '沈砚起身走向门边，脚步在门后停住。', time: '00:12.000', title: '门后脚步', width: 112 },
  { id: 'P-020', left: 223, speaker: '旁白', summary: '门外传来三声轻叩。', time: '00:24.000', title: '三声轻叩', width: 76 },
  { id: 'P-021', left: 307, speaker: '沈砚', summary: '“谁？”声音从门后传来，短促而克制。', time: '00:31.000', title: '门后回应', width: 144 },
  { id: 'P-022', left: 459, speaker: '旁白', summary: '门外的人没有回答，只将油纸伞往廊下一收。', time: '00:37.000', title: '收起油纸伞', width: 92 },
  { id: 'P-023', left: 559, speaker: '苏婉', summary: '“是我。夜深了，仍要来叨扰。”', time: '00:42.680', title: '楼道里的脚步声', width: 126 },
  { id: 'P-024', left: 693, speaker: '旁白', summary: '沈砚沉默片刻，侧身让开门。', time: '00:51.000', title: '让开门', width: 84 },
  { id: 'P-025', left: 785, speaker: '苏婉', summary: '“多谢。”雨水从伞沿落成一线。', time: '01:03.000', title: '雨水成线', width: 92 },
];

const selectedSegmentId = ref('P-023');
const currentTime = ref('00:42.680');
const isPlaying = ref(true);
const selectedSegment = computed<OfflineSegment>(() => (
  offlineSegments.find(segment => segment.id === selectedSegmentId.value) ?? offlineSegments[0]!
));
const playheadLeft = computed(() => `${selectedSegment.value.left + selectedSegment.value.width / 2 + 35}px`);

function selectSegment(segmentId: string): void {
  const segment = offlineSegments.find(candidate => candidate.id === segmentId);
  if (!segment)
    return;

  selectedSegmentId.value = segment.id;
  currentTime.value = segment.time;
}

function selectRulerPoint(segmentId: string, time: string): void {
  selectSegment(segmentId);
  currentTime.value = time;
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="offline-stage" aria-label="导出离线播放页假交互预览">
      <section class="offline-header" aria-label="离线章节播放器">
        <div class="offline-player">
          <img class="offline-artwork" src="./assets/offline-chapter-artwork.svg" width="112" height="112" alt="第 12 章抽象封面">
          <span class="offline-resource caption">离线可打开 · ./audio/chapter-12.wav · ./artwork/chapter-12.webp（路径仅展示）</span>
          <h1 class="offline-chapter">第 12 章 · 雨夜来客</h1>
          <strong class="offline-segment body-strong" data-testid="offline-title-summary">
            {{ isPlaying ? '播放中' : '已暂停' }} · {{ selectedSegment.id }} · {{ selectedSegment.title }}
          </strong>
          <ElButton
            class="offline-play-button"
            circle
            data-testid="offline-play"
            type="primary"
            @click="isPlaying = !isPlaying"
          >
            {{ isPlaying ? 'Ⅱ' : '▶' }}
          </ElButton>
          <strong class="offline-time body-strong" data-testid="offline-current-time">{{ currentTime }} / 08:36.200</strong>
          <div class="segment-strip" aria-label="片段时间条">
            <button
              v-for="segment in offlineSegments"
              :key="segment.id"
              class="segment-block"
              :class="{ 'is-current': segment.id === selectedSegment.id }"
              :data-segment-id="segment.id"
              :style="{ left: `${segment.left}px`, width: `${segment.width}px` }"
              :aria-label="`${segment.id} ${segment.title}`"
              type="button"
              @click="selectSegment(segment.id)"
            ></button>
          </div>
        </div>
        <span class="offline-relative caption">相对资源：./timeline/chapter-12.vtt · 不实际读取</span>
      </section>

      <section class="offline-timeline" aria-label="章节时间轴">
        <header class="offline-panel-header"><h2 class="section-title">章节时间轴</h2><span class="caption">点击刻度或段落节点跳转</span></header>
        <div class="offline-ruler">
          <button class="offline-tick-button is-major" style="left:23.75px" type="button" @click="selectRulerPoint('P-018', '00:00.000')"><span>00:00</span></button>
          <button class="offline-tick-button is-major" style="left:311.25px" type="button" @click="selectRulerPoint('P-021', '00:30.000')"><span>00:30</span></button>
          <button class="offline-tick-button is-major" style="left:598.75px" type="button" @click="selectRulerPoint('P-024', '01:00.000')"><span>01:00</span></button>
          <button class="offline-tick-button is-major" style="left:886.25px" type="button" @click="selectRulerPoint('P-025', '01:30.000')"><span>01:30</span></button>
          <button class="offline-tick-button is-major" style="left:1123.75px" type="button" @click="selectRulerPoint('P-025', '02:00.000')"><span>02:00</span></button>
        </div>
        <button
          v-for="segment in offlineSegments"
          :key="segment.id"
          class="paragraph-node"
          :class="{ 'is-current': segment.id === selectedSegment.id }"
          :data-node-id="segment.id"
          :style="{ left: `${59 + offlineSegments.indexOf(segment) * 158}px` }"
          type="button"
          @click="selectSegment(segment.id)"
        >
          <strong>{{ segment.id }}</strong><span>{{ segment.time.slice(0, 5) }}</span>
        </button>
        <div class="offline-ruler-playhead" :style="{ left: playheadLeft }">
          <span>{{ currentTime }}</span><img src="./assets/offline-handle.svg" alt="" aria-hidden="true">
        </div>
      </section>

      <section class="offline-transcript" aria-label="滚动剧本文本">
        <header class="offline-panel-header">
          <h2 class="section-title">滚动剧本文本</h2>
          <span class="caption state-accent">当前 {{ selectedSegment.id }} · {{ currentTime }} · 任一行可点击跳转</span>
        </header>
        <div class="transcript-lines">
          <button
            v-for="segment in offlineSegments.slice(3)"
            :key="segment.id"
            class="transcript-line"
            :class="{ 'is-current': segment.id === selectedSegment.id }"
            :data-transcript-id="segment.id"
            type="button"
            @click="selectSegment(segment.id)"
          >
            <span>{{ segment.time.slice(0, 5) }}</span><strong>{{ segment.speaker }}</strong><span>{{ segment.summary }}</span><span class="jump">点击跳转 ↗</span>
          </button>
        </div>
      </section>
    </main>
  </PageDocument>
</template>
