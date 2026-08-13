<script setup lang="ts">
import { computed } from 'vue';

type AudioRowVariant = 'current'
  | 'error'
  | 'focus'
  | 'generation-failed'
  | 'generating'
  | 'hover'
  | 'low-match'
  | 'new'
  | 'pending'
  | 'selection'
  | 'stale'
  | 'stopped'
  | 'success';
type StatusTone = 'error' | 'low-match' | 'neutral' | 'stale' | 'success' | 'warning';

const props = withDefaults(defineProps<{
  audioVersion?: string;
  disabled?: boolean;
  number: string;
  paragraphId: string;
  playable?: boolean;
  playing?: boolean;
  script: string;
  secondaryStatus?: string;
  selected?: boolean;
  speaker: string;
  stateText: string;
  status?: string;
  statusTone?: StatusTone;
  variant?: AudioRowVariant;
}>(), {
  audioVersion: '音频 v3',
  disabled: false,
  playable: true,
  playing: false,
  secondaryStatus: '',
  selected: false,
  status: '✓ 高匹配',
  statusTone: 'success',
  variant: 'current',
});

const emit = defineEmits<{
  select: [paragraphId: string];
  togglePlay: [paragraphId: string];
}>();

const rowClasses = computed(() => ({
  [`audio-row--${props.variant}`]: props.variant !== 'current',
  'audio-row--playing': props.playing,
  'audio-row--selected': props.selected,
}));

const statusClasses = computed(() => ({
  'status-pill--error': props.statusTone === 'error',
  'status-pill--low-match': props.statusTone === 'low-match',
  'status-pill--neutral': props.statusTone === 'neutral',
  'status-pill--stale': props.statusTone === 'stale',
  'status-pill--warning': props.statusTone === 'warning',
}));

function selectRow(): void {
  if (!props.disabled)
    emit('select', props.paragraphId);
}

function togglePlayback(): void {
  if (props.playable && !props.disabled)
    emit('togglePlay', props.paragraphId);
}
</script>

<template>
  <article
    class="audio-row"
    :class="rowClasses"
    :aria-selected="props.selected"
    :data-row-id="props.paragraphId"
    role="option"
    :tabindex="props.disabled ? -1 : 0"
    @click="selectRow"
    @keydown.enter.prevent="selectRow"
    @keydown.space.prevent="selectRow"
  >
    <div class="row-gutter">
      <button
        class="play-control"
        :aria-label="props.playing ? `暂停第 ${props.number} 行视觉预览` : `播放第 ${props.number} 行视觉预览`"
        :disabled="!props.playable || props.disabled"
        type="button"
        @click.stop="togglePlayback"
      >
        {{ props.playable ? (props.playing ? 'Ⅱ' : '▶') : '' }}
      </button>
      <span class="row-number">{{ props.number }}</span>
      <span>⋮ 拖选</span>
    </div>

    <div class="row-content">
      <div class="row-meta">
        <strong class="row-speaker">{{ props.speaker }}</strong>
        <span class="paragraph-id">段落 {{ props.paragraphId }}</span>
      </div>
      <p class="row-script">{{ props.script }}</p>
      <div class="annotations">
        <slot name="annotations">
          <span class="annotation">◇ 情绪：紧张</span>
          <span class="annotation annotation--reading">↗ 朗读：压低音量</span>
        </slot>
        <span class="row-state-text">{{ props.stateText }}</span>
      </div>
    </div>

    <div class="row-audio-status">
      <slot name="status">
        <span class="audio-version">{{ props.audioVersion }}</span>
        <span class="status-pill" :class="statusClasses">{{ props.status }}</span>
        <span
          v-if="props.secondaryStatus"
          class="status-pill status-pill--wide"
          :class="statusClasses"
        >
          {{ props.secondaryStatus }}
        </span>
      </slot>
    </div>
  </article>
</template>
