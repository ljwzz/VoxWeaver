<script setup lang="ts">
import type {
  NovelImportEventDto,
  NovelImportProbeDto,
  TaskSummaryDto,
  TxtSourceEncoding,
} from '@voxweaver/contracts';

import { TXT_SOURCE_ENCODINGS } from '@voxweaver/contracts';
import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import SourceTextPreview from '@/components/text-extraction/SourceTextPreview.vue';
import TextExtractionActionBar from '@/components/text-extraction/TextExtractionActionBar.vue';
import CapabilityGate from '@/components/workspace/CapabilityGate.vue';
import { useSourceTextPreview } from '@/composables/useSourceTextPreview';
import { useWorkspaceContext } from '@/workspace/context';
import { getProjectPageRouteName } from '@/workspace/navigation';

type RequestState = 'error' | 'idle' | 'loading' | 'ready';

const router = useRouter();
const workspace = useWorkspaceContext();
const preview = useSourceTextPreview();
const requestState = shallowRef<RequestState>('idle');
const probe = shallowRef<NovelImportProbeDto>();
const task = shallowRef<TaskSummaryDto>();
const selectedEncoding = shallowRef<TxtSourceEncoding>();
const errorMessage = shallowRef('');
const runningAction = shallowRef<'cancel' | 'retry' | 'start'>();
const dismissedCompletedRevision = shallowRef(false);
const pendingReviewTaskId = shallowRef<string>();
let ignoredTaskId: string | undefined;
let unsubscribe: (() => void) | undefined;

const capabilityAvailable = computed(() => (
  workspace.bootstrap.value?.capabilities['text-extraction'].available === true
));
const taskRunning = computed(() => (
  task.value?.status === 'pending' || task.value?.status === 'running'
));
const previewAvailable = computed(() => (
  probe.value?.encoding.status !== 'rejected' && Boolean(probe.value && selectedEncoding.value)
));
const canConfirm = computed(() => (
  previewAvailable.value
  && preview.ready.value
  && !taskRunning.value
  && runningAction.value !== 'start'
));
const completedRevisionAvailable = computed(() => (
  Boolean(probe.value?.latestReviewRevisionId) && !dismissedCompletedRevision.value
));
const encodingOptions = computed(() => TXT_SOURCE_ENCODINGS.map(value => ({
  label: encodingLabel(value),
  value,
})));

function formatBytes(byteLength: number): string {
  if (byteLength < 1024)
    return `${byteLength} B`;
  if (byteLength < 1024 * 1024)
    return `${(byteLength / 1024).toFixed(1)} KiB`;
  return `${(byteLength / 1024 / 1024).toFixed(1)} MiB`;
}

function encodingLabel(value: TxtSourceEncoding): string {
  const labels: Record<TxtSourceEncoding, string> = {
    'utf-8': 'UTF-8',
    'utf-16le': 'UTF-16LE',
    'utf-16be': 'UTF-16BE',
    'gb2312': 'GB2312',
    'gbk': 'GBK',
    'gb18030': 'GB18030',
    'big5': 'Big5',
  };
  const isDetectedBom = probe.value?.encoding.status === 'confirmed'
    && probe.value.encoding.method === 'bom'
    && probe.value.encoding.encoding === value;
  return `${labels[value]}${isDetectedBom ? ' BOM' : ''}`;
}

function setProbeSelection(value: NovelImportProbeDto): void {
  if (value.encoding.status === 'confirmed') {
    selectedEncoding.value = value.encoding.encoding;
    return;
  }
  if (value.encoding.status === 'selection-required') {
    selectedEncoding.value = value.encoding.recommendedEncoding;
    return;
  }
  selectedEncoding.value = undefined;
}

async function loadProbe(): Promise<void> {
  if (requestState.value === 'loading')
    return;

  const previousSourceHash = probe.value?.source.sha256;
  const previousEncoding = selectedEncoding.value;
  requestState.value = 'loading';
  errorMessage.value = '';
  const result = await window.voxweaver.novelImport.probe();
  if (!result.ok) {
    requestState.value = 'error';
    errorMessage.value = result.error.message;
    probe.value = undefined;
    task.value = undefined;
    selectedEncoding.value = undefined;
    preview.setSource();
    return;
  }

  probe.value = result.value;
  task.value = result.value.activeTask;
  pendingReviewTaskId.value = taskRunning.value ? task.value?.taskId : undefined;
  dismissedCompletedRevision.value = false;
  ignoredTaskId = undefined;
  setProbeSelection(result.value);
  if (previousSourceHash === result.value.source.sha256
    && previousEncoding === selectedEncoding.value) {
    preview.setSource(result.value.source.sha256, selectedEncoding.value);
  }
  requestState.value = 'ready';
}

function onEncodingChanged(): void {
  dismissedCompletedRevision.value = true;
  pendingReviewTaskId.value = undefined;
  if (task.value && !taskRunning.value) {
    ignoredTaskId = task.value.taskId;
    task.value = undefined;
  }
  errorMessage.value = '';
}

async function openReview(): Promise<void> {
  await router.push({ name: getProjectPageRouteName('chapter-splitting') });
}

async function openReviewForSucceededTask(completedTask: TaskSummaryDto): Promise<void> {
  if (completedTask.status !== 'succeeded'
    || pendingReviewTaskId.value !== completedTask.taskId) {
    return;
  }

  pendingReviewTaskId.value = undefined;
  await workspace.ensureBootstrap(true);
  await openReview();
}

async function proceedToReview(): Promise<void> {
  if (task.value?.status === 'succeeded' || completedRevisionAvailable.value) {
    await openReview();
    return;
  }

  const currentProbe = probe.value;
  const sourceEncoding = selectedEncoding.value;
  if (!canConfirm.value || !currentProbe || !sourceEncoding)
    return;

  runningAction.value = 'start';
  errorMessage.value = '';
  const keepAutomaticDetection = currentProbe.encoding.status === 'confirmed'
    && currentProbe.encoding.encoding === sourceEncoding;
  const result = await window.voxweaver.novelImport.start(
    keepAutomaticDetection ? {} : { sourceEncoding },
  );
  runningAction.value = undefined;

  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }

  ignoredTaskId = undefined;
  task.value = result.value;
  pendingReviewTaskId.value = result.value.taskId;
  await openReviewForSucceededTask(result.value);
}

async function cancelTask(): Promise<void> {
  if (!task.value?.canCancel)
    return;

  pendingReviewTaskId.value = undefined;
  runningAction.value = 'cancel';
  const result = await window.voxweaver.novelImport.cancelTask(task.value.taskId);
  runningAction.value = undefined;
  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }
  task.value = result.value;
}

async function retryTask(): Promise<void> {
  if (!task.value?.canRetry)
    return;

  runningAction.value = 'retry';
  const result = await window.voxweaver.novelImport.retryTask(task.value.taskId);
  runningAction.value = undefined;
  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }
  task.value = result.value;
  pendingReviewTaskId.value = result.value.taskId;
  await openReviewForSucceededTask(result.value);
}

async function handleNovelImportEvent(event: NovelImportEventDto): Promise<void> {
  if (event.task.taskId === ignoredTaskId)
    return;
  if (task.value && event.task.taskId !== task.value.taskId)
    return;

  task.value = event.task;
  if (event.eventType === 'task-completed') {
    const shouldOpenReview = pendingReviewTaskId.value === event.task.taskId
      && event.task.status === 'succeeded';
    await workspace.ensureBootstrap(true);
    if (shouldOpenReview) {
      pendingReviewTaskId.value = undefined;
      await openReview();
    }
    return;
  }

  if ((event.eventType === 'task-failed' || event.eventType === 'task-canceled')
    && pendingReviewTaskId.value === event.task.taskId) {
    pendingReviewTaskId.value = undefined;
  }
}

watch(capabilityAvailable, (available) => {
  if (available)
    void loadProbe();
}, { immediate: true });

watch(
  [() => probe.value?.source.sha256, selectedEncoding],
  ([sourceHash, sourceEncoding]) => {
    preview.setSource(sourceHash, sourceEncoding);
  },
  { flush: 'post' },
);

watch(
  () => workspace.coreHealth.value?.status,
  (status, previousStatus) => {
    if (status === 'healthy' && previousStatus === 'unavailable')
      void loadProbe();
  },
);

onMounted(() => {
  unsubscribe = window.voxweaver.novelImport.onEvent((event) => {
    void handleNovelImportEvent(event);
  });
});

onUnmounted(() => {
  unsubscribe?.();
});
</script>

<template>
  <article class="text-extraction-page">
    <CapabilityGate page-key="text-extraction">
      <div class="extraction-workspace">
        <main class="preview-area">
          <ElAlert
            v-if="errorMessage"
            :closable="false"
            show-icon
            :title="errorMessage"
            type="error"
          />
          <ElAlert
            v-if="probe?.encoding.status === 'selection-required' && !selectedEncoding"
            :closable="false"
            show-icon
            :title="probe.encoding.message"
            type="warning"
          />
          <ElAlert
            v-else-if="probe?.encoding.status === 'rejected'"
            :closable="false"
            show-icon
            :title="probe.encoding.message"
            type="error"
          />

          <SourceTextPreview
            v-if="previewAvailable"
            :done="preview.done.value"
            :error-message="preview.errorMessage.value"
            :loading="preview.loading.value"
            :reset-key="preview.generation.value"
            :text="preview.text.value"
            @request-lines="preview.loadMore"
          />
          <div v-else-if="requestState === 'loading'" class="empty-preview">
            正在检测源文件编码…
          </div>
          <div v-else-if="probe?.encoding.status !== 'rejected'" class="empty-preview">
            选择源文本编码后将显示正文预览。
          </div>
        </main>

        <TextExtractionActionBar
          v-model:encoding="selectedEncoding"
          :can-confirm="canConfirm"
          :encoding-options="probe ? encodingOptions : []"
          :error-message="preview.errorMessage.value || errorMessage"
          :has-completed-revision="completedRevisionAvailable"
          :probe-loading="requestState === 'loading'"
          :running-action="runningAction"
          :source-name="probe?.source.originalName"
          :source-size="probe ? formatBytes(probe.source.byteLength) : undefined"
          :task="task"
          @cancel="cancelTask"
          @encoding-changed="onEncodingChanged"
          @proceed="proceedToReview"
          @redetect="loadProbe"
          @retry="retryTask"
        />
      </div>
    </CapabilityGate>
  </article>
</template>

<style scoped>
.text-extraction-page {
  display: flex;
  height: 100%;
  min-height: 0;
  flex-direction: column;
  background: #f7f8f6;
  overflow: hidden;
}

.extraction-workspace {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  overflow: hidden;
}

.preview-area {
  display: flex;
  min-height: 0;
  flex: 1;
  flex-direction: column;
  gap: 12px;
  padding: 16px 24px;
  overflow: hidden;
}

.empty-preview {
  display: grid;
  min-height: 0;
  flex: 1;
  place-items: center;
  border: 1px dashed #cbd0ca;
  border-radius: 8px;
  color: #6a726e;
  background: #fff;
  font-size: 13px;
}
</style>
