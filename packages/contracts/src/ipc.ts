import type {
  NovelImportEventListener,
  NovelImportProbeDto,
  NovelImportReviewCommandInput,
  NovelImportReviewSnapshotDto,
  SourceTextPreviewDto,
  SourceTextPreviewRequest,
  StalePreviewDto,
  StartNovelImportInput,
  TextSliceDto,
  TextSliceRequest,
} from './novelImport.ts';
import type {
  AppResult,
  CreateProjectRequest,
  ProjectOpenOutcomeDto,
  ProjectSummaryDto,
  RecentProjectSummaryDto,
  SelectionResult,
} from './project.ts';
import type {
  CoreHealthDto,
  TaskSummaryDto,
  WorkspaceBootstrapDto,
  WorkspacePageKey,
} from './workspace.ts';

export const IPC_CHANNELS = Object.freeze({
  startupSelectProjectDirectory: 'startup:select-project-directory',
  startupSelectSourceFile: 'startup:select-source-file',
  startupCreateProject: 'startup:create-project',
  startupOpenProjectFromDialog: 'startup:open-project-from-dialog',
  startupOpenRecentProject: 'startup:open-recent-project',
  startupConfirmProjectOpen: 'startup:confirm-project-open',
  startupListRecentProjects: 'startup:list-recent-projects',
  startupRemoveRecentProject: 'startup:remove-recent-project',
  projectGetBootstrap: 'project:get-bootstrap',
  projectRecordLastPage: 'project:record-last-page',
  projectClose: 'project:close',
  novelImportProbe: 'novel-import:probe',
  novelImportStart: 'novel-import:start',
  novelImportGetTask: 'novel-import:get-task',
  novelImportCancelTask: 'novel-import:cancel-task',
  novelImportRetryTask: 'novel-import:retry-task',
  novelImportGetReviewSnapshot: 'novel-import:get-review-snapshot',
  novelImportGetSourcePreview: 'novel-import:get-source-preview',
  novelImportGetTextSlice: 'novel-import:get-text-slice',
  novelImportPreviewReview: 'novel-import:preview-review',
  novelImportApplyReview: 'novel-import:apply-review',
  novelImportEvent: 'novel-import:event',
  systemGetCoreHealth: 'system:get-core-health',
  systemRestartCore: 'system:restart-core',
} as const);

export interface DesktopApi {
  readonly startup: {
    readonly selectProjectDirectory: () => Promise<AppResult<SelectionResult | null>>;
    readonly selectSourceFile: () => Promise<AppResult<SelectionResult | null>>;
    readonly createProject: (input: CreateProjectRequest) => Promise<AppResult<ProjectSummaryDto>>;
    readonly openProjectFromDialog: () => Promise<AppResult<ProjectOpenOutcomeDto>>;
    readonly openRecentProject: (projectId: string) => Promise<AppResult<ProjectOpenOutcomeDto>>;
    readonly confirmProjectOpen: (confirmationToken: string) => Promise<AppResult<ProjectOpenOutcomeDto>>;
    readonly listRecentProjects: () => Promise<AppResult<RecentProjectSummaryDto[]>>;
    readonly removeRecentProject: (projectId: string) => Promise<AppResult<void>>;
  };
  readonly project: {
    readonly getBootstrap: () => Promise<AppResult<WorkspaceBootstrapDto>>;
    readonly recordLastPage: (pageKey: WorkspacePageKey) => Promise<AppResult<void>>;
    readonly close: () => Promise<AppResult<void>>;
  };
  readonly novelImport: {
    readonly probe: () => Promise<AppResult<NovelImportProbeDto>>;
    readonly start: (input: StartNovelImportInput) => Promise<AppResult<TaskSummaryDto>>;
    readonly getTask: (taskId: string) => Promise<AppResult<TaskSummaryDto>>;
    readonly cancelTask: (taskId: string) => Promise<AppResult<TaskSummaryDto>>;
    readonly retryTask: (taskId: string) => Promise<AppResult<TaskSummaryDto>>;
    readonly getReviewSnapshot: () => Promise<AppResult<NovelImportReviewSnapshotDto>>;
    readonly getSourcePreview: (input: SourceTextPreviewRequest) => Promise<AppResult<SourceTextPreviewDto>>;
    readonly getTextSlice: (input: TextSliceRequest) => Promise<AppResult<TextSliceDto>>;
    readonly previewReview: (command: NovelImportReviewCommandInput) => Promise<AppResult<StalePreviewDto>>;
    readonly applyReview: (command: NovelImportReviewCommandInput) => Promise<AppResult<NovelImportReviewSnapshotDto>>;
    readonly onEvent: (listener: NovelImportEventListener) => () => void;
  };
  readonly system: {
    readonly getCoreHealth: () => Promise<AppResult<CoreHealthDto>>;
    readonly restartCore: () => Promise<AppResult<void>>;
  };
}
