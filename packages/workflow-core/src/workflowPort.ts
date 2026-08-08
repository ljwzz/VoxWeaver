import type {
  ArtifactDependency,
  ArtifactDependencyType,
  ArtifactRecord,
  ArtifactRevisionDependency,
  ArtifactScope,
  ArtifactSelector,
  ArtifactStorageKind,
  ExportSnapshotRecord,
  JsonValue,
  ReviewDecisionRecord,
  SourceAssetRecord,
  StageRunRecord,
  StaleCause,
  TaskRecord,
} from '@voxweaver/contracts';

export interface ArtifactDependencyInput extends ArtifactRevisionDependency {}

export interface ActivateArtifactRevisionCommand {
  readonly changeSelector?: ArtifactSelector;
  readonly revisionId: string;
}

export interface ArtifactImpactItem {
  readonly consumerArtifactId: string;
  readonly consumerRevisionId: string;
  readonly dependencyType: ArtifactDependencyType;
  readonly depth: number;
  readonly producerArtifactId: string;
  readonly producerRevisionId: string;
  readonly selector?: ArtifactSelector;
}

export interface ArtifactImpactPreview {
  readonly changeSelector?: ArtifactSelector;
  readonly impacts: readonly ArtifactImpactItem[];
  readonly producerArtifactId: string;
  readonly producerRevisionId: string;
}

export interface PreviewArtifactImpactCommand {
  readonly changeSelector?: ArtifactSelector;
  readonly producerArtifactId: string;
}

export interface CommitArtifactRevisionCommand {
  readonly activate?: boolean;
  readonly artifactId?: string;
  readonly artifactType: string;
  readonly changeSelector?: ArtifactSelector;
  readonly createdBy: string;
  readonly dependencies?: readonly ArtifactDependencyInput[];
  readonly inputFingerprint: string;
  readonly lineageId?: string;
  readonly outputDirectory: string;
  readonly parameters: JsonValue;
  readonly processorId: string;
  readonly processorVersion: string;
  readonly revisionId?: string;
  readonly reviewRequired?: boolean;
  readonly scope: ArtifactScope;
  readonly storageKind: ArtifactStorageKind;
  readonly taskId?: string;
}

export interface EnqueueTaskCommand {
  readonly inputFingerprint: string;
  readonly outputScope: ArtifactScope;
  readonly processorId: string;
}

export interface CreateStageRunCommand {
  readonly inputFingerprint: string;
  readonly stageId: string;
}

export interface FailTaskCommand {
  readonly errorCode: string;
  readonly errorMessage: string;
  readonly taskId: string;
}

export interface RegisterSourceAssetCommand {
  readonly createdBy: string;
  readonly originalName: string;
  readonly relativePath: string;
  readonly sourceAssetId?: string;
  readonly sourceType: string;
}

export interface RecordReviewDecisionCommand {
  readonly artifactId: string;
  readonly decidedBy: string;
  readonly decision: 'approved' | 'rejected';
  readonly note?: string;
  readonly revisionId: string;
}

export interface CreateExportSnapshotCommand {
  readonly createdBy: string;
  readonly revisionIds: readonly string[];
  readonly staleWaiverReason?: string;
}

export interface WorkflowRecoveryReport {
  readonly interruptedStageRunIds: readonly string[];
  readonly interruptedTaskIds: readonly string[];
  readonly missingRevisionIds: readonly string[];
  readonly orphanArtifactPaths: readonly string[];
  readonly orphanTemporaryPaths: readonly string[];
  readonly resumableTaskIds: readonly string[];
  readonly restoredRevisionIds: readonly string[];
  readonly retryableTaskIds: readonly string[];
}

export interface EnqueueTaskResult {
  readonly reused: boolean;
  readonly task: TaskRecord;
}

export interface ProjectWorkflowPort {
  readonly activateArtifactRevision: (
    command: ActivateArtifactRevisionCommand,
  ) => Promise<ArtifactRecord>;
  readonly cancelTask: (taskId: string) => Promise<TaskRecord>;
  readonly commitArtifactRevision: (
    command: CommitArtifactRevisionCommand,
  ) => Promise<ArtifactRecord>;
  readonly createBackup: () => Promise<string>;
  readonly createStageRun: (
    command: CreateStageRunCommand,
  ) => Promise<StageRunRecord>;
  readonly createExportSnapshot: (
    command: CreateExportSnapshotCommand,
  ) => Promise<ExportSnapshotRecord>;
  readonly enqueueTask: (
    command: EnqueueTaskCommand,
  ) => Promise<EnqueueTaskResult>;
  readonly failTask: (command: FailTaskCommand) => Promise<TaskRecord>;
  readonly findReusableRevision: (
    inputFingerprint: string,
    processorId: string,
    scope: ArtifactScope,
  ) => Promise<ArtifactRecord | undefined>;
  readonly getArtifactRevision: (
    revisionId: string,
  ) => Promise<ArtifactRecord | undefined>;
  readonly getTask: (taskId: string) => Promise<TaskRecord | undefined>;
  readonly getStageRun: (
    stageRunId: string,
  ) => Promise<StageRunRecord | undefined>;
  readonly listArtifactDependencies: (
    revisionId: string,
  ) => Promise<readonly ArtifactDependency[]>;
  readonly listStaleCauses: (
    revisionId: string,
  ) => Promise<readonly StaleCause[]>;
  readonly previewArtifactImpact: (
    command: PreviewArtifactImpactCommand,
  ) => Promise<ArtifactImpactPreview>;
  readonly recover: () => Promise<WorkflowRecoveryReport>;
  readonly registerSourceAsset: (
    command: RegisterSourceAssetCommand,
  ) => Promise<SourceAssetRecord>;
  readonly recordReviewDecision: (
    command: RecordReviewDecisionCommand,
  ) => Promise<ReviewDecisionRecord>;
  readonly resolveStaleCause: (staleCauseId: string) => Promise<StaleCause>;
  readonly startTask: (taskId: string) => Promise<TaskRecord>;
  readonly startStageRun: (stageRunId: string) => Promise<StageRunRecord>;
  readonly finishStageRun: (
    stageRunId: string,
    status: 'canceled' | 'failed' | 'succeeded',
  ) => Promise<StageRunRecord>;
}
