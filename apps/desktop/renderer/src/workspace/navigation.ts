import type {
  WorkflowStageId,
  WorkspaceModuleKey,
  WorkspacePageKey,
} from '@voxweaver/contracts';
import type { Component } from 'vue';

export type WorkspacePageImplementation
  = | 'chapter-splitting'
    | 'gated'
    | 'project-settings'
    | 'text-extraction';

export interface WorkspacePageDefinition {
  readonly key: WorkspacePageKey;
  readonly moduleKey: WorkspaceModuleKey;
  readonly label: string;
  readonly description: string;
  readonly stageId?: WorkflowStageId;
  readonly implementation: WorkspacePageImplementation;
  readonly component: () => Promise<Component>;
}

export interface WorkspaceModuleDefinition {
  readonly key: WorkspaceModuleKey;
  readonly label: string;
  readonly shortLabel: string;
  readonly defaultPageKey: WorkspacePageKey;
  readonly pages: readonly WorkspacePageDefinition[];
}

interface WorkspacePageSeed {
  readonly key: WorkspacePageKey;
  readonly moduleKey: WorkspaceModuleKey;
  readonly label: string;
  readonly description: string;
  readonly stageId?: WorkflowStageId;
  readonly implementation?: Exclude<WorkspacePageImplementation, 'gated'>;
}

const loadTextExtractionPage = async () => (await import('@/pages/project/TextExtractionPage.vue')).default;
const loadChapterSplittingPage = async () => (await import('@/pages/project/ChapterSplittingPage.vue')).default;
const loadProjectSettingsPage = async () => (await import('@/pages/project/ProjectSettingsPage.vue')).default;
const loadGatedWorkspacePage = async () => (await import('@/pages/project/GatedWorkspacePage.vue')).default;

const pageSeeds = [
  {
    key: 'text-extraction',
    moduleKey: 'text',
    label: '文本提取',
    description: '检查不可变源资产的编码并启动小说导入任务。',
    stageId: '01',
    implementation: 'text-extraction',
  },
  {
    key: 'chapter-splitting',
    moduleKey: 'text',
    label: '章节切割',
    description: '复核章节候选、覆盖范围、规范化提案与版本差异。',
    stageId: '01',
    implementation: 'chapter-splitting',
  },
  {
    key: 'proofreading',
    moduleKey: 'text',
    label: '文本校对',
    description: '阶段 02 的文本问题检查与修订入口。',
    stageId: '02',
  },
  {
    key: 'script-management',
    moduleKey: 'text',
    label: '剧本管理',
    description: '阶段 03 的段落与剧本版本管理入口。',
    stageId: '03',
  },
  {
    key: 'character-extraction',
    moduleKey: 'text',
    label: '角色提取',
    description: '阶段 04 的角色候选提取入口。',
    stageId: '04',
  },
  {
    key: 'primary-character-marking',
    moduleKey: 'role',
    label: '主要角色标记',
    description: '阶段 04 的主要角色确认入口。',
    stageId: '04',
  },
  {
    key: 'crowd-voice-pool',
    moduleKey: 'role',
    label: '群杂音色池',
    description: '阶段 05 的群杂角色音色池入口。',
    stageId: '05',
  },
  {
    key: 'character-voice-refinement',
    moduleKey: 'role',
    label: '角色音色细化',
    description: '阶段 05 的角色音色细化入口。',
    stageId: '05',
  },
  {
    key: 'chapter-parameters',
    moduleKey: 'audio',
    label: '章节参数',
    description: '阶段 07 的章节级音频参数入口。',
    stageId: '07',
  },
  {
    key: 'selection-requirements',
    moduleKey: 'audio',
    label: '选区要求',
    description: '阶段 07 的局部生成要求入口。',
    stageId: '07',
  },
  {
    key: 'chapter-generation',
    moduleKey: 'audio',
    label: '章节生成',
    description: '阶段 07 的章节音频生成入口。',
    stageId: '07',
  },
  {
    key: 'stale-propagation',
    moduleKey: 'audio',
    label: '失效传播',
    description: '阶段 07 的下游结果失效影响入口。',
    stageId: '07',
  },
  {
    key: 'asr-review',
    moduleKey: 'audio',
    label: 'ASR 复核',
    description: '阶段 08 的语音识别结果复核入口。',
    stageId: '08',
  },
  {
    key: 'loudness-consistency',
    moduleKey: 'post',
    label: '响度一致性',
    description: '阶段 09 的响度检查入口。',
    stageId: '09',
  },
  {
    key: 'timeline-alignment',
    moduleKey: 'post',
    label: '时间轴对齐',
    description: '阶段 10 的时间轴对齐入口。',
    stageId: '10',
  },
  {
    key: 'chapter-summary',
    moduleKey: 'post',
    label: '章节摘要',
    description: '阶段 11 的章节摘要入口。',
    stageId: '11',
  },
  {
    key: 'chapter-cover',
    moduleKey: 'post',
    label: '章节封面',
    description: '阶段 11 的章节封面入口。',
    stageId: '11',
  },
  {
    key: 'tar-export',
    moduleKey: 'post',
    label: 'TAR 导出',
    description: '阶段 11 的归档导出入口。',
    stageId: '11',
  },
  {
    key: 'offline-player-export',
    moduleKey: 'post',
    label: '离线播放器导出',
    description: '阶段 11 的离线播放器导出入口。',
    stageId: '11',
  },
  {
    key: 'project-settings',
    moduleKey: 'settings',
    label: '项目设置',
    description: '查看当前项目、源资产、布局版本与 Core 状态。',
    implementation: 'project-settings',
  },
  {
    key: 'project-backup',
    moduleKey: 'settings',
    label: '项目备份',
    description: '阶段 11 的完整工程备份与恢复入口。',
    stageId: '11',
  },
  {
    key: 'software-settings',
    moduleKey: 'settings',
    label: '软件设置',
    description: '软件级正式配置契约尚未开放。',
  },
] as const satisfies readonly WorkspacePageSeed[];

function componentFor(seed: WorkspacePageSeed): WorkspacePageDefinition['component'] {
  switch (seed.implementation) {
    case 'text-extraction':
      return loadTextExtractionPage;
    case 'chapter-splitting':
      return loadChapterSplittingPage;
    case 'project-settings':
      return loadProjectSettingsPage;
    default:
      return loadGatedWorkspacePage;
  }
}

function createWorkspacePage(seed: WorkspacePageSeed): WorkspacePageDefinition {
  return Object.freeze({
    ...seed,
    implementation: seed.implementation ?? 'gated',
    component: componentFor(seed),
  });
}

export const workspacePages: readonly WorkspacePageDefinition[] = Object.freeze(
  pageSeeds.map(createWorkspacePage),
);

const moduleSeeds = [
  { key: 'text', label: '文本整理', shortLabel: '文本', defaultPageKey: 'text-extraction' },
  { key: 'role', label: '角色管理', shortLabel: '角色', defaultPageKey: 'primary-character-marking' },
  { key: 'audio', label: '音频生成', shortLabel: '音频', defaultPageKey: 'chapter-parameters' },
  { key: 'post', label: '后期处理', shortLabel: '后期', defaultPageKey: 'timeline-alignment' },
  { key: 'settings', label: '设置', shortLabel: '设置', defaultPageKey: 'project-settings' },
] as const satisfies readonly {
  readonly key: WorkspaceModuleKey;
  readonly label: string;
  readonly shortLabel: string;
  readonly defaultPageKey: WorkspacePageKey;
}[];

export const workspaceModules: readonly WorkspaceModuleDefinition[] = Object.freeze(
  moduleSeeds.map(seed => Object.freeze({
    ...seed,
    pages: Object.freeze(workspacePages.filter(page => page.moduleKey === seed.key)),
  })),
);

const pagesByKey = new Map(workspacePages.map(page => [page.key, page]));
const modulesByKey = new Map(workspaceModules.map(module => [module.key, module]));

export function getWorkspacePage(pageKey: WorkspacePageKey): WorkspacePageDefinition {
  const page = pagesByKey.get(pageKey);
  if (!page)
    throw new Error(`Unknown workspace page: ${pageKey}`);
  return page;
}

export function getWorkspaceModule(moduleKey: WorkspaceModuleKey): WorkspaceModuleDefinition {
  const workspaceModule = modulesByKey.get(moduleKey);
  if (!workspaceModule)
    throw new Error(`Unknown workspace module: ${moduleKey}`);
  return workspaceModule;
}

export function getProjectPageRouteName<TPageKey extends WorkspacePageKey>(
  pageKey: TPageKey,
): `project-${TPageKey}` {
  return `project-${pageKey}`;
}

export function getProjectPagePath(pageKey: WorkspacePageKey): `/project/${WorkspacePageKey}` {
  return `/project/${pageKey}`;
}

export function getFirstWorkspacePageForStage(
  stageId: WorkflowStageId,
): WorkspacePageDefinition | undefined {
  return workspacePages.find(page => page.stageId === stageId);
}
