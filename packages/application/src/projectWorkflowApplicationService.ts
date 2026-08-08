import type {
  ArtifactDependency,
  ArtifactRecord,
  ArtifactScope,
  ExportSnapshotRecord,
  ProjectContext,
  ReviewDecisionRecord,
  SourceAssetRecord,
  StageRunRecord,
  StaleCause,
  TaskRecord,
} from '@voxweaver/contracts';
import type {
  ActivateArtifactRevisionCommand,
  ArtifactImpactPreview,
  CommitArtifactRevisionCommand,
  CreateExportSnapshotCommand,
  CreateStageRunCommand,
  EnqueueTaskCommand,
  EnqueueTaskResult,
  FailTaskCommand,
  PreviewArtifactImpactCommand,
  ProjectWorkflowPort,
  RecordReviewDecisionCommand,
  RegisterSourceAssetCommand,
  WorkflowRecoveryReport,
} from '@voxweaver/workflow-core';

import type { ProjectApplicationService } from './projectApplicationService.js';

export interface ProjectSessionIdentity {
  readonly projectId: string;
  readonly projectSessionId: string;
}

export type ProjectWorkflowCommand<T> = ProjectSessionIdentity & T;

export type ProjectWorkflowFactory = (
  context: ProjectContext,
) => ProjectWorkflowPort;

export class ProjectWorkflowApplicationService {
  readonly #factory: ProjectWorkflowFactory;
  readonly #projects: ProjectApplicationService;

  constructor(
    projects: ProjectApplicationService,
    factory: ProjectWorkflowFactory,
  ) {
    this.#factory = factory;
    this.#projects = projects;
  }

  activateArtifactRevision(
    command: ProjectWorkflowCommand<ActivateArtifactRevisionCommand>,
  ): Promise<ArtifactRecord> {
    return this.#write(
      command,
      port => port.activateArtifactRevision(omitSession(command)),
    );
  }

  cancelTask(command: ProjectWorkflowCommand<{ taskId: string }>): Promise<TaskRecord> {
    return this.#write(command, port => port.cancelTask(command.taskId));
  }

  commitArtifactRevision(
    command: ProjectWorkflowCommand<CommitArtifactRevisionCommand>,
  ): Promise<ArtifactRecord> {
    return this.#write(
      command,
      port => port.commitArtifactRevision(omitSession(command)),
    );
  }

  createBackup(command: ProjectSessionIdentity): Promise<string> {
    return this.#write(command, port => port.createBackup());
  }

  createStageRun(
    command: ProjectWorkflowCommand<CreateStageRunCommand>,
  ): Promise<StageRunRecord> {
    return this.#write(
      command,
      port => port.createStageRun(omitSession(command)),
    );
  }

  createExportSnapshot(
    command: ProjectWorkflowCommand<CreateExportSnapshotCommand>,
  ): Promise<ExportSnapshotRecord> {
    return this.#write(
      command,
      port => port.createExportSnapshot(omitSession(command)),
    );
  }

  enqueueTask(
    command: ProjectWorkflowCommand<EnqueueTaskCommand>,
  ): Promise<EnqueueTaskResult> {
    return this.#write(
      command,
      port => port.enqueueTask(omitSession(command)),
    );
  }

  failTask(
    command: ProjectWorkflowCommand<FailTaskCommand>,
  ): Promise<TaskRecord> {
    return this.#write(
      command,
      port => port.failTask(omitSession(command)),
    );
  }

  findReusableRevision(
    command: ProjectWorkflowCommand<{
      inputFingerprint: string;
      processorId: string;
      scope: ArtifactScope;
    }>,
  ): Promise<ArtifactRecord | undefined> {
    return this.#read(
      command,
      port => port.findReusableRevision(
        command.inputFingerprint,
        command.processorId,
        command.scope,
      ),
    );
  }

  getArtifactRevision(
    command: ProjectWorkflowCommand<{ revisionId: string }>,
  ): Promise<ArtifactRecord | undefined> {
    return this.#read(
      command,
      port => port.getArtifactRevision(command.revisionId),
    );
  }

  getTask(
    command: ProjectWorkflowCommand<{ taskId: string }>,
  ): Promise<TaskRecord | undefined> {
    return this.#read(command, port => port.getTask(command.taskId));
  }

  getStageRun(
    command: ProjectWorkflowCommand<{ stageRunId: string }>,
  ): Promise<StageRunRecord | undefined> {
    return this.#read(
      command,
      port => port.getStageRun(command.stageRunId),
    );
  }

  listArtifactDependencies(
    command: ProjectWorkflowCommand<{ revisionId: string }>,
  ): Promise<readonly ArtifactDependency[]> {
    return this.#read(
      command,
      port => port.listArtifactDependencies(command.revisionId),
    );
  }

  listStaleCauses(
    command: ProjectWorkflowCommand<{ revisionId: string }>,
  ): Promise<readonly StaleCause[]> {
    return this.#read(
      command,
      port => port.listStaleCauses(command.revisionId),
    );
  }

  previewArtifactImpact(
    command: ProjectWorkflowCommand<PreviewArtifactImpactCommand>,
  ): Promise<ArtifactImpactPreview> {
    return this.#read(
      command,
      port => port.previewArtifactImpact(omitSession(command)),
    );
  }

  recover(command: ProjectSessionIdentity): Promise<WorkflowRecoveryReport> {
    return this.#write(command, port => port.recover());
  }

  registerSourceAsset(
    command: ProjectWorkflowCommand<RegisterSourceAssetCommand>,
  ): Promise<SourceAssetRecord> {
    return this.#write(
      command,
      port => port.registerSourceAsset(omitSession(command)),
    );
  }

  recordReviewDecision(
    command: ProjectWorkflowCommand<RecordReviewDecisionCommand>,
  ): Promise<ReviewDecisionRecord> {
    return this.#write(
      command,
      port => port.recordReviewDecision(omitSession(command)),
    );
  }

  resolveStaleCause(
    command: ProjectWorkflowCommand<{ staleCauseId: string }>,
  ): Promise<StaleCause> {
    return this.#write(
      command,
      port => port.resolveStaleCause(command.staleCauseId),
    );
  }

  startTask(command: ProjectWorkflowCommand<{ taskId: string }>): Promise<TaskRecord> {
    return this.#write(command, port => port.startTask(command.taskId));
  }

  startStageRun(
    command: ProjectWorkflowCommand<{ stageRunId: string }>,
  ): Promise<StageRunRecord> {
    return this.#write(
      command,
      port => port.startStageRun(command.stageRunId),
    );
  }

  finishStageRun(
    command: ProjectWorkflowCommand<{
      stageRunId: string;
      status: 'canceled' | 'failed' | 'succeeded';
    }>,
  ): Promise<StageRunRecord> {
    return this.#write(
      command,
      port => port.finishStageRun(command.stageRunId, command.status),
    );
  }

  #read<T>(
    identity: ProjectSessionIdentity,
    operation: (port: ProjectWorkflowPort) => Promise<T>,
  ): Promise<T> {
    return this.#run(identity, 'read', operation);
  }

  #write<T>(
    identity: ProjectSessionIdentity,
    operation: (port: ProjectWorkflowPort) => Promise<T>,
  ): Promise<T> {
    return this.#run(identity, 'write', operation);
  }

  #run<T>(
    identity: ProjectSessionIdentity,
    requiredAccess: 'read' | 'write',
    operation: (port: ProjectWorkflowPort) => Promise<T>,
  ): Promise<T> {
    return this.#projects.runInActiveProjectSession(
      {
        projectId: identity.projectId,
        projectSessionId: identity.projectSessionId,
        requiredAccess,
      },
      context => operation(this.#factory(context)),
    );
  }
}

function omitSession<T>(command: ProjectWorkflowCommand<T>): T {
  const {
    projectId: _projectId,
    projectSessionId: _projectSessionId,
    ...value
  } = command;
  return value as T;
}
