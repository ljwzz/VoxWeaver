<script setup lang="ts">
import type { SelectionResult } from '@voxweaver/contracts';

import { FileText, FolderOpen, Info } from '@lucide/vue';
import { normalizeProjectDisplayName, PROJECT_SOURCE_FILE_CONFIG } from '@voxweaver/contracts';
import { computed, shallowRef } from 'vue';
import { useRouter } from 'vue-router';
import PageDocument from '@/components/PageDocument.vue';
import pageStyles from './styles.css?inline';

type FormState = 'failed' | 'idle' | 'ready' | 'running' | 'succeeded';

const bodyClasses = ['startup-screen', 'startup-screen--new-project'] as const;
const styleSheets = [pageStyles] as const;
const router = useRouter();

const displayName = shallowRef('');
const directorySelection = shallowRef<SelectionResult>();
const sourceSelection = shallowRef<SelectionResult>();
const formState = shallowRef<FormState>('idle');
const errorMessage = shallowRef('');
const warningMessage = shallowRef('');
const projectCreatedWithoutWindow = shallowRef(false);
const supportedSourceFileExtensions = PROJECT_SOURCE_FILE_CONFIG.extensions
  .map(extension => `.${extension}`)
  .join('、');

const normalizedName = computed(() => displayName.value.trim());
const isNameValid = computed(() => {
  try {
    normalizeProjectDisplayName(displayName.value);
    return true;
  } catch {
    return false;
  }
});
const canCreate = computed(() => isNameValid.value
  && Boolean(directorySelection.value)
  && Boolean(sourceSelection.value)
  && formState.value !== 'running'
  && !projectCreatedWithoutWindow.value);

function updateReadyState(): void {
  if (formState.value === 'running' || formState.value === 'succeeded')
    return;
  formState.value = canCreate.value ? 'ready' : 'idle';
  errorMessage.value = '';
}

async function selectDirectory(): Promise<void> {
  const result = await window.voxweaver.startup.selectProjectDirectory();
  if (!result.ok) {
    formState.value = 'failed';
    errorMessage.value = result.error.message;
    return;
  }
  if (result.value)
    directorySelection.value = result.value;
  updateReadyState();
}

async function selectSourceFile(): Promise<void> {
  const result = await window.voxweaver.startup.selectSourceFile();
  if (!result.ok) {
    formState.value = 'failed';
    errorMessage.value = result.error.message;
    return;
  }
  if (result.value)
    sourceSelection.value = result.value;
  updateReadyState();
}

async function createProject(): Promise<void> {
  if (!canCreate.value || !directorySelection.value || !sourceSelection.value)
    return;

  formState.value = 'running';
  errorMessage.value = '';
  warningMessage.value = '';
  const result = await window.voxweaver.startup.createProject({
    displayName: normalizedName.value,
    directorySelectionId: directorySelection.value.selectionId,
    sourceSelectionId: sourceSelection.value.selectionId,
  });

  if (!result.ok) {
    formState.value = 'failed';
    errorMessage.value = result.error.message;
    projectCreatedWithoutWindow.value = result.error.code === 'PROJECT_WINDOW_OPEN_FAILED';
    return;
  }

  formState.value = 'succeeded';
  warningMessage.value = result.warnings?.join(' ') ?? '';
  await router.replace({
    path: '/startup',
    query: warningMessage.value ? { notice: warningMessage.value } : {},
  });
}

function cancel(): void {
  if (formState.value !== 'running')
    void router.push('/startup');
}

function handleNameInput(): void {
  updateReadyState();
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="startup-shell" aria-label="VoxWeaver 新建项目窗口">
      <header class="native-titlebar">
        <span>新建项目</span>
      </header>

      <form class="new-project-form" @submit.prevent="createProject">
        <div class="project-field">
          <label for="project-name">项目名称</label>
          <input
            id="project-name"
            v-model="displayName"
            type="text"
            autocomplete="off"
            :disabled="formState === 'running' || projectCreatedWithoutWindow"
            @input="handleNameInput"
          >
        </div>

        <div class="project-field">
          <label>项目目录</label>
          <div class="project-selector">
            <span :class="{ 'project-selector-placeholder': !directorySelection }" :title="directorySelection?.displayPath">
              {{ directorySelection?.displayPath ?? '请选择空文件夹' }}
            </span>
            <button type="button" :disabled="formState === 'running' || projectCreatedWithoutWindow" @click="selectDirectory">
              <FolderOpen :size="15" aria-hidden="true" />选择目录
            </button>
          </div>
        </div>

        <div class="project-field">
          <label>源文件</label>
          <span class="project-field-hint">当前仅支持 {{ supportedSourceFileExtensions }}</span>
          <div class="project-selector">
            <span :class="{ 'project-selector-placeholder': !sourceSelection }" :title="sourceSelection?.displayPath">
              {{ sourceSelection?.displayPath ?? '请选择小说源文件' }}
            </span>
            <button type="button" :disabled="formState === 'running' || projectCreatedWithoutWindow" @click="selectSourceFile">
              <FileText :size="15" aria-hidden="true" />选择文件
            </button>
          </div>
        </div>

        <p v-if="errorMessage" class="form-message form-message--error" role="alert">
          <Info :size="14" aria-hidden="true" />{{ errorMessage }}
        </p>
        <p v-else-if="warningMessage" class="form-message" role="status">
          <Info :size="14" aria-hidden="true" />{{ warningMessage }}
        </p>

        <footer class="new-project-actions">
          <div>
            <button class="button-secondary" type="button" :disabled="formState === 'running'" @click="cancel">
              {{ projectCreatedWithoutWindow ? '返回启动页' : '取消' }}
            </button>
            <button class="button-primary" type="submit" :disabled="!canCreate">
              {{ formState === 'running' ? '正在创建…' : '创建并打开项目' }}
            </button>
          </div>
        </footer>
      </form>
    </main>
  </PageDocument>
</template>
