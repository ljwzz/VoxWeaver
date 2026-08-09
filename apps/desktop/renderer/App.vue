<script setup lang="ts">
import type {
  OpenProjectPayload,
  ProjectSummaryDto,
  RecentProjectDto,
} from '@voxweaver/contracts';
import type { CoreStateUpdate } from '../preload/index';
import { computed, onMounted, onUnmounted, ref, shallowRef } from 'vue';
import { decodeDesktopBridgeError } from '../shared/desktopBridgeError';

type OpenOperation = 'open' | 'switch';
type ConfirmationKind = 'migration' | 'write-lock-recovery';

interface PendingConfirmation {
  readonly kind: ConfirmationKind;
  readonly operation: OpenOperation;
  readonly payload: OpenProjectPayload;
}

interface UiError {
  readonly code: string;
  readonly message: string;
  readonly retryable: boolean;
}

const currentProject = shallowRef<ProjectSummaryDto | null>(null);
const recentProjects = shallowRef<readonly RecentProjectDto[]>([]);
const coreState = shallowRef<CoreStateUpdate>({
  canRestart: false,
  status: 'starting',
});
const pendingConfirmation = shallowRef<PendingConfirmation | null>(null);
const uiError = shallowRef<UiError | null>(null);
const busyAction = ref<string | null>(null);
const newProjectName = ref('');

let unsubscribeCoreState: (() => void) | undefined;
let refreshGeneration = 0;

const coreReady = computed(() => coreState.value.status === 'ready');
const coreUnavailable = computed(() => coreState.value.status === 'unavailable');
const isBusy = computed(() => busyAction.value !== null);
const primaryProjectAction = computed<OpenOperation>(() => (
  currentProject.value ? 'switch' : 'open'
));
const coreStatusLabel = computed(() => {
  switch (coreState.value.status) {
    case 'ready':
      return 'Core 已就绪';
    case 'unavailable':
      return 'Core 不可用';
    default:
      return 'Core 启动中';
  }
});

onMounted(() => {
  unsubscribeCoreState = window.voxweaver.onCoreState(handleCoreState);
  void bootstrap();
});

onUnmounted(() => {
  unsubscribeCoreState?.();
});

async function bootstrap(): Promise<void> {
  await withBusy('health', async () => {
    await window.voxweaver.app.getHealth();
    handleCoreState({ canRestart: false, status: 'ready' });
    await refreshWorkspace();
  });
  markUnavailableAfterFailedHealthCheck();
}

function handleCoreState(nextState: CoreStateUpdate): void {
  const previousStatus = coreState.value.status;
  coreState.value = nextState;

  if (nextState.status !== 'ready') {
    currentProject.value = null;
    pendingConfirmation.value = null;
    return;
  }

  if (previousStatus !== 'ready')
    void refreshWorkspace(true);
}

async function retryCoreConnection(): Promise<void> {
  await withBusy('health', async () => {
    await window.voxweaver.app.getHealth();
    handleCoreState({ canRestart: false, status: 'ready' });
    await refreshWorkspace();
  });
  markUnavailableAfterFailedHealthCheck();
}

function markUnavailableAfterFailedHealthCheck(): void {
  if (!uiError.value || coreState.value.status === 'ready')
    return;
  coreState.value = {
    canRestart: coreState.value.canRestart,
    status: 'unavailable',
  };
}

async function refreshWorkspace(silent = false): Promise<void> {
  const generation = ++refreshGeneration;
  try {
    const [project, projects] = await Promise.all([
      window.voxweaver.project.getSummary(),
      window.voxweaver.project.listRecent(),
    ]);

    if (generation !== refreshGeneration || coreState.value.status !== 'ready')
      return;

    currentProject.value = project;
    recentProjects.value = projects;
  } catch (error) {
    if (!silent)
      uiError.value = toUiError(error);
  }
}

async function refreshRecentProjects(silent = true): Promise<void> {
  try {
    recentProjects.value = await window.voxweaver.project.listRecent();
  } catch (error) {
    if (!silent)
      uiError.value = toUiError(error);
  }
}

async function createProject(): Promise<void> {
  const displayName = newProjectName.value.trim();
  if (!displayName) {
    uiError.value = {
      code: 'DESKTOP_PAYLOAD_INVALID',
      message: '请输入项目名称。',
      retryable: false,
    };
    return;
  }

  await withBusy('create', async () => {
    const selection = await window.voxweaver.dialog.selectDirectory({
      purpose: 'create-project-parent',
    });
    if (selection.canceled)
      return;

    currentProject.value = await window.voxweaver.project.create({
      displayName,
      selectionToken: selection.selectionToken,
    });
    newProjectName.value = '';
    await refreshRecentProjects();
  });
}

async function selectProjectForOpening(
  accessMode: 'read-write' | 'read-only',
): Promise<void> {
  const operation = primaryProjectAction.value;
  await withBusy(operation, async () => {
    const selection = await window.voxweaver.dialog.selectDirectory({
      purpose: operation === 'open' ? 'open-project' : 'switch-project',
    });
    if (selection.canceled)
      return;

    await completeProjectOpening(operation, {
      accessMode,
      selectionToken: selection.selectionToken,
    });
  });
}

async function openRecentProject(project: RecentProjectDto): Promise<void> {
  if (project.availability === 'unavailable') {
    uiError.value = {
      code: 'PROJECT_DIRECTORY_INVALID',
      message: '该最近项目当前不可用；可将其从列表移除。',
      retryable: false,
    };
    return;
  }

  const operation = primaryProjectAction.value;
  await withBusy(operation, async () => {
    await completeProjectOpening(operation, {
      recentProjectId: project.projectId,
    });
  });
}

async function completeProjectOpening(
  operation: OpenOperation,
  payload: OpenProjectPayload,
): Promise<void> {
  try {
    const project = operation === 'open'
      ? await window.voxweaver.project.open(payload)
      : await window.voxweaver.project.switch(payload);
    currentProject.value = project;
    pendingConfirmation.value = null;
    await refreshRecentProjects();
  } catch (error) {
    if (queueRequiredConfirmation(error, operation, payload))
      return;
    throw error;
  }
}

function queueRequiredConfirmation(
  error: unknown,
  operation: OpenOperation,
  payload: OpenProjectPayload,
): boolean {
  const uiError = toUiError(error);
  if (uiError.code === 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED') {
    pendingConfirmation.value = {
      kind: 'migration',
      operation,
      payload,
    };
    return true;
  }

  if (uiError.code === 'PROJECT_WRITE_LOCK_RECOVERY_REQUIRED') {
    pendingConfirmation.value = {
      kind: 'write-lock-recovery',
      operation,
      payload,
    };
    return true;
  }

  return false;
}

async function confirmPendingOperation(): Promise<void> {
  const pending = pendingConfirmation.value;
  if (!pending)
    return;

  pendingConfirmation.value = null;
  await withBusy('confirmation', async () => {
    await completeProjectOpening(
      pending.operation,
      withConfirmation(pending),
    );
  });
}

function withConfirmation(pending: PendingConfirmation): OpenProjectPayload {
  const source = pending.payload;
  const options = {
    ...(source.accessMode === undefined ? {} : { accessMode: source.accessMode }),
    ...(pending.kind === 'migration'
      ? { confirmMigration: true }
      : { confirmMigration: source.confirmMigration === true }),
    ...(pending.kind === 'write-lock-recovery'
      ? { recoverStaleWriteLock: true }
      : { recoverStaleWriteLock: source.recoverStaleWriteLock === true }),
  };

  if ('selectionToken' in source && typeof source.selectionToken === 'string') {
    return {
      ...options,
      selectionToken: source.selectionToken,
    };
  }

  return {
    ...options,
    recentProjectId: source.recentProjectId,
  };
}

function cancelPendingOperation(): void {
  pendingConfirmation.value = null;
}

async function closeProject(): Promise<void> {
  await withBusy('close', async () => {
    await window.voxweaver.project.close();
    currentProject.value = null;
    pendingConfirmation.value = null;
    await refreshRecentProjects();
  });
}

async function removeRecentProject(projectId: string): Promise<void> {
  await withBusy('remove-recent', async () => {
    const removed = await window.voxweaver.project.removeRecent({ projectId });
    if (removed)
      await refreshRecentProjects();
  });
}

async function withBusy(
  action: string,
  operation: () => Promise<void>,
): Promise<void> {
  if (busyAction.value)
    return;

  busyAction.value = action;
  uiError.value = null;
  try {
    await operation();
  } catch (error) {
    uiError.value = toUiError(error);
  } finally {
    busyAction.value = null;
  }
}

function toUiError(error: unknown): UiError {
  const bridgedError = decodeDesktopBridgeError(error);
  if (bridgedError)
    return bridgedError;

  if (isBridgeError(error)) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  return {
    code: 'DESKTOP_CORE_UNAVAILABLE',
    message: '桌面 Core 当前无法完成该请求。',
    retryable: true,
  };
}

function isBridgeError(error: unknown): error is UiError {
  return typeof error === 'object'
    && error !== null
    && typeof (error as { code?: unknown }).code === 'string'
    && typeof (error as { message?: unknown }).message === 'string'
    && typeof (error as { retryable?: unknown }).retryable === 'boolean';
}

function formatLastOpenedAt(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.valueOf()))
    return '时间未知';

  return new Intl.DateTimeFormat('zh-CN', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date);
}
</script>

<template>
  <main class="project-entry">
    <header class="app-header">
      <div>
        <p class="eyebrow">
          VOXWEAVER DESKTOP
        </p>
        <h1>项目入口</h1>
      </div>
      <p class="core-status" :data-status="coreState.status" role="status">
        <span class="status-dot" aria-hidden="true" />
        {{ coreStatusLabel }}
      </p>
    </header>

    <section v-if="coreUnavailable" class="recovery-card" aria-labelledby="recovery-title">
      <p class="eyebrow">
        RECOVERY
      </p>
      <h2 id="recovery-title">
        Application Core 当前不可用
      </h2>
      <p>
        {{ coreState.canRestart ? '可执行一次受控重启；完成后不会自动重新打开项目。' : '受控重启额度已用尽，请重启应用。' }}
      </p>
      <button class="button primary" :disabled="isBusy || !coreState.canRestart" type="button" @click="retryCoreConnection">
        {{ isBusy ? '检查中…' : coreState.canRestart ? '重启并检查 Core' : '需要重启应用' }}
      </button>
    </section>

    <template v-else>
      <section v-if="uiError" class="error-banner" role="alert">
        <div>
          <strong>{{ uiError.code }}</strong>
          <p>{{ uiError.message }}</p>
        </div>
        <button type="button" aria-label="关闭错误提示" @click="uiError = null">
          关闭
        </button>
      </section>

      <section v-if="pendingConfirmation" class="confirmation-card" role="alertdialog" aria-modal="false" aria-labelledby="confirmation-title">
        <p class="eyebrow">
          CONFIRMATION REQUIRED
        </p>
        <h2 id="confirmation-title">
          {{ pendingConfirmation.kind === 'migration' ? '确认迁移项目' : '确认恢复失效写锁' }}
        </h2>
        <p>
          {{ pendingConfirmation.kind === 'migration'
            ? '此操作会按已选定的项目和操作类型继续。确认后才允许迁移。'
            : '此操作会按已选定的项目和操作类型恢复可恢复的写锁。' }}
        </p>
        <div class="button-row">
          <button class="button primary" :disabled="isBusy" type="button" @click="confirmPendingOperation">
            确认继续
          </button>
          <button class="button secondary" :disabled="isBusy" type="button" @click="cancelPendingOperation">
            取消
          </button>
        </div>
      </section>

      <section class="workspace-grid" :aria-busy="isBusy">
        <article class="panel active-project-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">
                CURRENT PROJECT
              </p>
              <h2>{{ currentProject ? currentProject.displayName : '尚未打开项目' }}</h2>
            </div>
            <span v-if="currentProject" class="access-badge">{{ currentProject.accessMode === 'read-only' ? '只读' : '可写' }}</span>
          </div>

          <template v-if="currentProject">
            <dl class="project-facts">
              <div>
                <dt>项目 ID</dt>
                <dd>{{ currentProject.projectId }}</dd>
              </div>
              <div>
                <dt>布局版本</dt>
                <dd>v{{ currentProject.layoutVersion }}</dd>
              </div>
            </dl>
            <div class="button-row">
              <button class="button secondary" :disabled="isBusy || !coreReady" type="button" @click="selectProjectForOpening('read-write')">
                切换项目
              </button>
              <button class="button danger" :disabled="isBusy || !coreReady" type="button" @click="closeProject">
                关闭项目
              </button>
            </div>
          </template>
          <p v-else class="muted">
            从最近项目中打开，或创建一个新项目。
          </p>
        </article>

        <article class="panel create-panel">
          <p class="eyebrow">
            CREATE OR OPEN
          </p>
          <h2>开始一个项目</h2>
          <label class="field-label" for="new-project-name">新项目名称</label>
          <input id="new-project-name" v-model="newProjectName" :disabled="isBusy || !coreReady" autocomplete="off" maxlength="160" placeholder="例如：第一章试制" type="text">
          <div class="button-stack">
            <button class="button primary" :disabled="isBusy || !coreReady || currentProject !== null" type="button" @click="createProject">
              创建项目
            </button>
            <button class="button secondary" :disabled="isBusy || !coreReady" type="button" @click="selectProjectForOpening('read-write')">
              {{ currentProject ? '选择并切换项目' : '打开项目' }}
            </button>
            <button class="button secondary" :disabled="isBusy || !coreReady" type="button" @click="selectProjectForOpening('read-only')">
              {{ currentProject ? '以只读方式切换' : '只读打开项目' }}
            </button>
          </div>
        </article>

        <article class="panel recent-projects-panel">
          <div class="panel-heading">
            <div>
              <p class="eyebrow">
                RECENT PROJECTS
              </p>
              <h2>最近项目</h2>
            </div>
            <button class="text-button" :disabled="isBusy || !coreReady" type="button" @click="() => refreshWorkspace()">
              刷新
            </button>
          </div>

          <p v-if="recentProjects.length === 0" class="muted">
            尚无最近项目记录。
          </p>
          <ul v-else class="recent-list">
            <li v-for="project in recentProjects" :key="project.projectId">
              <div class="recent-project-copy">
                <strong>{{ project.displayName }}</strong>
                <span>{{ formatLastOpenedAt(project.lastOpenedAt) }}</span>
                <span class="availability" :class="[project.availability]">
                  {{ project.availability === 'available' ? '可用' : '不可用' }}
                </span>
              </div>
              <div class="recent-actions">
                <button class="text-button" :disabled="isBusy || !coreReady || project.availability === 'unavailable'" type="button" @click="openRecentProject(project)">
                  {{ currentProject ? '切换' : '打开' }}
                </button>
                <button class="text-button danger-text" :disabled="isBusy || !coreReady" type="button" @click="removeRecentProject(project.projectId)">
                  移除
                </button>
              </div>
            </li>
          </ul>
        </article>
      </section>
    </template>
  </main>
</template>

<style>
:root {
  color: #eaf0f7;
  background: #10141d;
  font-family:
    Inter,
    ui-sans-serif,
    -apple-system,
    BlinkMacSystemFont,
    'Segoe UI',
    sans-serif;
  color-scheme: dark;
}

* {
  box-sizing: border-box;
}

body {
  min-width: 320px;
  min-height: 100vh;
  margin: 0;
}

button,
input {
  font: inherit;
}

button {
  cursor: pointer;
}

button:disabled {
  cursor: not-allowed;
  opacity: 0.52;
}

.project-entry {
  min-height: 100vh;
  padding: clamp(24px, 5vw, 64px);
  background:
    radial-gradient(circle at 12% 8%, rgb(74 123 255 / 18%), transparent 31%),
    radial-gradient(circle at 90% 90%, rgb(91 229 190 / 10%), transparent 34%), #10141d;
}

.app-header,
.workspace-grid,
.recovery-card,
.confirmation-card,
.error-banner {
  width: min(100%, 1120px);
  margin-right: auto;
  margin-left: auto;
}

.app-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 24px;
  margin-bottom: 28px;
}

.eyebrow {
  margin: 0 0 10px;
  color: #89a6c8;
  font-size: 11px;
  font-weight: 750;
  letter-spacing: 0.16em;
}

h1,
h2,
p {
  margin-top: 0;
}

h1 {
  margin-bottom: 0;
  font-size: clamp(32px, 5vw, 48px);
  letter-spacing: -0.045em;
}

h2 {
  margin-bottom: 10px;
  font-size: 24px;
  letter-spacing: -0.03em;
}

.core-status,
.access-badge,
.availability {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  margin: 0;
  border: 1px solid rgb(255 255 255 / 12%);
  border-radius: 999px;
  padding: 8px 12px;
  color: #aabbd0;
  background: rgb(19 26 38 / 78%);
  font-size: 12px;
  font-weight: 700;
}

.core-status[data-status='ready'] {
  color: #78e6c0;
}

.core-status[data-status='unavailable'] {
  color: #ff9d9d;
}

.status-dot {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: currentColor;
  box-shadow: 0 0 0 5px rgb(120 230 192 / 8%);
}

.workspace-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 18px;
}

.panel,
.recovery-card,
.confirmation-card,
.error-banner {
  border: 1px solid rgb(255 255 255 / 10%);
  border-radius: 22px;
  background: rgb(20 27 39 / 87%);
  box-shadow: 0 24px 60px rgb(0 0 0 / 24%);
}

.panel {
  padding: 28px;
}

.recent-projects-panel {
  grid-column: 1 / -1;
}

.panel-heading {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 16px;
}

.panel-heading h2 {
  margin-bottom: 0;
}

.project-facts {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 14px;
  margin: 26px 0;
}

.project-facts div {
  min-width: 0;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 14px;
  padding: 13px;
  background: rgb(255 255 255 / 3%);
}

dt {
  margin-bottom: 6px;
  color: #89a6c8;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.08em;
}

dd {
  overflow: hidden;
  margin: 0;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.field-label {
  display: block;
  margin: 24px 0 8px;
  color: #b8c8db;
  font-size: 13px;
  font-weight: 650;
}

input {
  width: 100%;
  border: 1px solid rgb(255 255 255 / 14%);
  border-radius: 12px;
  padding: 12px 14px;
  color: inherit;
  background: rgb(6 10 16 / 45%);
  outline: none;
}

input:focus {
  border-color: #78e6c0;
  box-shadow: 0 0 0 3px rgb(120 230 192 / 13%);
}

.button-row,
.button-stack,
.recent-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 10px;
}

.button-stack {
  flex-direction: column;
  margin-top: 18px;
}

.button {
  border: 1px solid transparent;
  border-radius: 10px;
  padding: 10px 14px;
  font-size: 13px;
  font-weight: 720;
}

.primary {
  color: #0d1720;
  background: #78e6c0;
}

.secondary {
  border-color: rgb(255 255 255 / 13%);
  color: #dbe7f3;
  background: rgb(255 255 255 / 6%);
}

.danger {
  color: #ffd0d0;
  background: rgb(206 89 89 / 18%);
}

.text-button {
  border: 0;
  padding: 4px 0;
  color: #8fc5ff;
  background: transparent;
  font-size: 13px;
  font-weight: 700;
}

.danger-text {
  color: #ffaaaa;
}

.muted {
  margin: 26px 0 0;
  color: #9bacc0;
  line-height: 1.65;
}

.recent-list {
  display: grid;
  gap: 10px;
  padding: 0;
  margin: 24px 0 0;
  list-style: none;
}

.recent-list li {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 18px;
  border: 1px solid rgb(255 255 255 / 8%);
  border-radius: 14px;
  padding: 15px;
  background: rgb(255 255 255 / 3%);
}

.recent-project-copy {
  display: grid;
  min-width: 0;
  gap: 4px;
}

.recent-project-copy strong {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.recent-project-copy span:not(.availability) {
  color: #8fa2b8;
  font-size: 12px;
}

.availability {
  width: max-content;
  padding: 3px 7px;
  color: #78e6c0;
  font-size: 11px;
}

.availability.unavailable {
  color: #ffaaaa;
}

.recovery-card,
.confirmation-card {
  max-width: 720px;
  padding: 34px;
}

.recovery-card p:not(.eyebrow),
.confirmation-card p:not(.eyebrow) {
  max-width: 620px;
  color: #b3c2d4;
  line-height: 1.65;
}

.error-banner {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 18px;
  margin-bottom: 18px;
  border-color: rgb(231 116 116 / 36%);
  padding: 16px 18px;
  color: #ffd3d3;
  background: rgb(115 38 42 / 35%);
}

.error-banner p {
  margin-bottom: 0;
  color: inherit;
  line-height: 1.5;
}

.error-banner button {
  border: 0;
  padding: 3px 0;
  color: inherit;
  background: transparent;
}

@media (max-width: 760px) {
  .project-entry {
    padding: 24px 18px;
  }

  .app-header,
  .recent-list li {
    align-items: flex-start;
    flex-direction: column;
  }

  .workspace-grid {
    grid-template-columns: 1fr;
  }

  .recent-projects-panel {
    grid-column: auto;
  }

  .project-facts {
    grid-template-columns: 1fr;
  }
}
</style>
