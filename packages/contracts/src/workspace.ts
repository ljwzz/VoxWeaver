import type { ProjectSummaryDto, SourceAssetManifest } from './project.ts';

export const WORKSPACE_PAGE_KEYS = [
  'text-extraction',
  'chapter-splitting',
  'proofreading',
  'script-management',
  'character-extraction',
  'primary-character-marking',
  'crowd-voice-pool',
  'character-voice-refinement',
  'chapter-parameters',
  'selection-requirements',
  'chapter-generation',
  'stale-propagation',
  'asr-review',
  'loudness-consistency',
  'timeline-alignment',
  'chapter-summary',
  'chapter-cover',
  'tar-export',
  'offline-player-export',
  'project-settings',
  'project-backup',
  'software-settings',
] as const;

export type WorkspacePageKey = typeof WORKSPACE_PAGE_KEYS[number];
export type WorkspaceModuleKey = 'text' | 'role' | 'audio' | 'post' | 'settings';
export type WorkflowStageId = '01' | '02' | '03' | '04' | '05' | '06' | '07' | '08' | '09' | '10' | '11';

export type StageStatus
  = | 'not-started'
    | 'ready'
    | 'running'
    | 'review-required'
    | 'completed'
    | 'blocked'
    | 'failed'
    | 'stale';

export interface StageStateDto {
  readonly stageId: WorkflowStageId;
  readonly status: StageStatus;
  readonly title: string;
  readonly detail: string;
  readonly updatedAt?: string;
}

export type CapabilityGateReason
  = | 'available'
    | 'prerequisite'
    | 'not-implemented'
    | 'core-unavailable';

export interface WorkspaceCapabilityDto {
  readonly available: boolean;
  readonly reason: CapabilityGateReason;
  readonly requiredStage?: WorkflowStageId;
  readonly prerequisitePageKey?: WorkspacePageKey;
  readonly message: string;
}

export type TaskExecutionStatus = 'pending' | 'running' | 'succeeded' | 'failed' | 'canceled';
export type TaskRecoveryStatus = 'none' | 'resumable' | 'retryable' | 'manual';

export interface TaskProgressDto {
  readonly completed: number;
  readonly total: number;
  readonly percent: number;
  readonly message: string;
}

export interface TaskSummaryDto {
  readonly taskId: string;
  readonly taskType: 'novel-import';
  readonly status: TaskExecutionStatus;
  readonly recoveryStatus: TaskRecoveryStatus;
  readonly attempt: number;
  readonly progress: TaskProgressDto;
  readonly canCancel: boolean;
  readonly canRetry: boolean;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly startedAt?: string;
  readonly finishedAt?: string;
  readonly errorCode?: string;
  readonly errorMessage?: string;
}

export type CoreHealthStatus = 'healthy' | 'starting' | 'unavailable';

export interface CoreHealthDto {
  readonly status: CoreHealthStatus;
  readonly canRestart: boolean;
  readonly protocolVersion: 1;
}

export interface WorkspaceBootstrapDto {
  readonly project: ProjectSummaryDto;
  readonly sourceAsset: SourceAssetManifest;
  readonly stages: readonly StageStateDto[];
  readonly capabilities: Readonly<Record<WorkspacePageKey, WorkspaceCapabilityDto>>;
  readonly currentTask?: TaskSummaryDto;
  readonly recoverableTasks: readonly TaskSummaryDto[];
  readonly lastPage?: WorkspacePageKey;
  readonly recommendedPage: WorkspacePageKey;
  readonly coreHealth: CoreHealthDto;
}

export function isWorkspacePageKey(value: unknown): value is WorkspacePageKey {
  return typeof value === 'string'
    && (WORKSPACE_PAGE_KEYS as readonly string[]).includes(value);
}
