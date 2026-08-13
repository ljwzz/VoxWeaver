<script setup lang="ts">
import type {
  NovelImportProbeDto,
  TaskSummaryDto,
  UserSelectedTxtSourceEncoding,
} from '@voxweaver/contracts';

import { computed, onMounted, onUnmounted, shallowRef, watch } from 'vue';
import { useRouter } from 'vue-router';
import CapabilityGate from '@/components/workspace/CapabilityGate.vue';
import WorkspacePageHeader from '@/components/workspace/WorkspacePageHeader.vue';
import { useWorkspaceContext } from '@/workspace/context';
import { getProjectPageRouteName, getWorkspacePage } from '@/workspace/navigation';

type RequestState = 'error' | 'idle' | 'loading' | 'ready';

const page = getWorkspacePage('text-extraction');
const router = useRouter();
const workspace = useWorkspaceContext();
const requestState = shallowRef<RequestState>('idle');
const probe = shallowRef<NovelImportProbeDto>();
const task = shallowRef<TaskSummaryDto>();
const selectedEncoding = shallowRef<UserSelectedTxtSourceEncoding>();
const errorMessage = shallowRef('');
const runningAction = shallowRef<'cancel' | 'retry' | 'start'>();
let unsubscribe: (() => void) | undefined;

const capabilityAvailable = computed(() => (
  workspace.bootstrap.value?.capabilities['text-extraction'].available === true
));
const encodingSelectionRequired = computed(() => probe.value?.encoding.status === 'selection-required');
const canStart = computed(() => {
  const encoding = probe.value?.encoding;
  if (!encoding || task.value?.status === 'pending' || task.value?.status === 'running')
    return false;
  if (encoding.status === 'rejected')
    return false;
  return encoding.status === 'confirmed' || Boolean(selectedEncoding.value);
});

function formatBytes(byteLength: number): string {
  if (byteLength < 1024)
    return `${byteLength} B`;
  if (byteLength < 1024 * 1024)
    return `${(byteLength / 1024).toFixed(1)} KiB`;
  return `${(byteLength / 1024 / 1024).toFixed(1)} MiB`;
}

function encodingLabel(value: string): string {
  return value.toUpperCase().replace('UTF-', 'UTF-');
}

async function loadProbe(): Promise<void> {
  if (requestState.value === 'loading')
    return;

  requestState.value = 'loading';
  errorMessage.value = '';
  const result = await window.voxweaver.novelImport.probe();
  if (!result.ok) {
    requestState.value = 'error';
    errorMessage.value = result.error.message;
    return;
  }

  probe.value = result.value;
  task.value = result.value.activeTask;
  if (result.value.encoding.status === 'selection-required')
    selectedEncoding.value = result.value.encoding.allowedEncodings[0];
  requestState.value = 'ready';
}

async function startImport(): Promise<void> {
  if (!canStart.value)
    return;

  runningAction.value = 'start';
  errorMessage.value = '';
  const sourceEncoding = encodingSelectionRequired.value ? selectedEncoding.value : undefined;
  const result = await window.voxweaver.novelImport.start(
    sourceEncoding ? { sourceEncoding } : {},
  );
  runningAction.value = undefined;

  if (!result.ok) {
    errorMessage.value = result.error.message;
    return;
  }

  task.value = result.value;
}

async function cancelTask(): Promise<void> {
  if (!task.value?.canCancel)
    return;

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
}

function openReview(): void {
  void router.push({ name: getProjectPageRouteName('chapter-splitting') });
}

watch(capabilityAvailable, (available) => {
  if (available)
    void loadProbe();
}, { immediate: true });

watch(
  () => workspace.coreHealth.value?.status,
  (status, previousStatus) => {
    if (status === 'healthy' && previousStatus === 'unavailable')
      void loadProbe();
  },
);

onMounted(() => {
  unsubscribe = window.voxweaver.novelImport.onEvent((event) => {
    if (!task.value || event.task.taskId === task.value.taskId) {
      task.value = event.task;
      if (event.eventType === 'task-completed')
        void workspace.ensureBootstrap(true);
    }
  });
});

onUnmounted(() => {
  unsubscribe?.();
});
</script>

<template>
  <article class="project-controller-page">
    <WorkspacePageHeader
      :description="page.description"
      :stage-id="page.stageId"
      :title="page.label"
    >
      <template #actions>
        <ElButton :loading="requestState === 'loading'" @click="loadProbe">重新探测</ElButton>
      </template>
    </WorkspacePageHeader>

    <CapabilityGate page-key="text-extraction">
      <div class="controller-content">
        <ElAlert
          v-if="errorMessage"
          :closable="false"
          show-icon
          :title="errorMessage"
          type="error"
        />

        <section v-if="probe" class="source-card">
          <header>
            <div>
              <p>项目不可变 SourceAsset</p>
              <h2>{{ probe.source.originalName }}</h2>
            </div>
            <ElTag effect="plain">TXT</ElTag>
          </header>
          <dl>
            <div><dt>大小</dt><dd>{{ formatBytes(probe.source.byteLength) }}</dd></div>
            <div><dt>SHA-256</dt><dd class="hash-value">{{ probe.source.sha256 }}</dd></div>
          </dl>
        </section>

        <section v-if="probe?.encoding.status === 'confirmed'" class="encoding-card">
          <div>
            <p class="section-eyebrow">编码已确认</p>
            <h2>{{ encodingLabel(probe.encoding.encoding) }}</h2>
            <p>{{ probe.encoding.method === 'bom' ? '由 BOM 自动确认' : '通过严格 UTF-8 解码确认' }}</p>
          </div>
          <ElTag type="success">可开始导入</ElTag>
        </section>

        <section v-else-if="probe?.encoding.status === 'selection-required'" class="encoding-card">
          <div class="encoding-selection">
            <p class="section-eyebrow">需要手动选择编码</p>
            <h2>自动检测无法安全确认编码</h2>
            <p>{{ probe.encoding.message }}</p>
            <ElSelect v-model="selectedEncoding" aria-label="源文本编码" placeholder="选择编码">
              <ElOption
                v-for="encoding in probe.encoding.allowedEncodings"
                :key="encoding"
                :label="encodingLabel(encoding)"
                :value="encoding"
              />
            </ElSelect>
          </div>
          <ElTag type="warning">绑定当前源哈希</ElTag>
        </section>

        <ElAlert
          v-else-if="probe?.encoding.status === 'rejected'"
          :closable="false"
          show-icon
          :title="probe.encoding.message"
          type="error"
        />

        <section v-if="task" class="task-detail-card" aria-label="导入任务">
          <header>
            <div>
              <p class="section-eyebrow">导入任务</p>
              <h2>{{ task.progress.message }}</h2>
            </div>
            <ElTag effect="plain">{{ task.status }}</ElTag>
          </header>
          <ElProgress :percentage="task.progress.percent" />
          <p v-if="task.errorMessage" class="task-error" role="alert">{{ task.errorMessage }}</p>
          <footer>
            <ElButton
              v-if="task.canCancel"
              :loading="runningAction === 'cancel'"
              @click="cancelTask"
            >
              取消任务
            </ElButton>
            <ElButton
              v-if="task.canRetry"
              :loading="runningAction === 'retry'"
              type="primary"
              @click="retryTask"
            >
              重试任务
            </ElButton>
            <ElButton v-if="task.status === 'succeeded'" type="primary" @click="openReview">
              进入章节复核
            </ElButton>
          </footer>
        </section>

        <div v-if="probe && !task" class="controller-actions">
          <p>导入读取项目内源资产，不会再次选择或改写外部文件。</p>
          <ElButton
            :disabled="!canStart"
            :loading="runningAction === 'start'"
            type="primary"
            @click="startImport"
          >
            开始文本提取
          </ElButton>
        </div>
      </div>
    </CapabilityGate>
  </article>
</template>

<style scoped>
.project-controller-page {
  min-height: 100%;
  background: #f7f8f6;
}

.controller-content {
  display: grid;
  max-width: 920px;
  gap: 16px;
  padding: 24px;
}

.source-card,
.encoding-card,
.task-detail-card {
  padding: 18px;
  border: 1px solid #d9ddd7;
  border-radius: 8px;
  background: #fff;
}

.source-card header,
.encoding-card,
.task-detail-card header,
.task-detail-card footer,
.controller-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
}

.source-card p,
.source-card h2,
.encoding-card p,
.encoding-card h2,
.task-detail-card p,
.task-detail-card h2,
.controller-actions p {
  margin: 0;
}

.source-card h2,
.encoding-card h2,
.task-detail-card h2 {
  margin-top: 4px;
  font-size: 16px;
  line-height: 24px;
}

.source-card dl {
  display: grid;
  gap: 8px;
  margin: 16px 0 0;
}

.source-card dl > div {
  display: grid;
  grid-template-columns: 88px minmax(0, 1fr);
  gap: 12px;
  color: #6a726e;
  font-size: 12px;
}

.source-card dd {
  min-width: 0;
  margin: 0;
  color: #202522;
}

.hash-value {
  overflow: hidden;
  font-family: ui-monospace, monospace;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.section-eyebrow {
  color: #6a726e;
  font-size: 11px;
}

.encoding-card p:last-child {
  margin-top: 5px;
  color: #6a726e;
  font-size: 12px;
}

.encoding-selection {
  display: grid;
  min-width: 0;
  gap: 8px;
}

.encoding-selection .el-select {
  width: 240px;
  margin-top: 4px;
}

.task-detail-card {
  display: grid;
  gap: 16px;
}

.task-detail-card footer {
  justify-content: flex-end;
}

.task-error {
  color: #b34444;
  font-size: 12px;
}

.controller-actions {
  justify-content: flex-end;
}

.controller-actions p {
  color: #6a726e;
  font-size: 12px;
}
</style>
