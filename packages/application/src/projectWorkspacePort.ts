import type { ProjectAccessMode, ProjectContext } from '@voxweaver/contracts';

export interface AssertProjectSessionCommand {
  projectId: string;
  projectSessionId: string;
  requiredAccess: 'read' | 'write';
}

export interface CreateProjectCommand {
  displayName: string;
  parentDirectory: string;
}

export interface OpenProjectCommand {
  accessMode?: ProjectAccessMode;
  confirmMigration?: boolean;
  projectDirectory: string;
  recoverStaleWriteLock?: boolean;
}

export interface InspectProjectCommand {
  projectDirectory: string;
}

export type ProjectWriteLockInspectionStatus
  = | 'available'
    | 'locked'
    | 'recoverable';

export interface ProjectWriteLockInspection {
  readonly recoveryAvailable: boolean;
  readonly status: ProjectWriteLockInspectionStatus;
}

export interface ProjectInspectionPreview {
  readonly displayName: string;
  readonly layoutVersion: number;
  readonly migrationRequired: boolean;
  readonly projectId: string;
  readonly writeLock: ProjectWriteLockInspection;
}

export interface ProjectWorkspacePort {
  /**
   * `project` is the exact context instance returned by this port when the
   * session was created or opened.
   *
   * A rejection must mean the project session remains active and usable.
   * Implementations must not reject after irreversibly releasing the session.
   */
  closeProject: (project: ProjectContext) => Promise<void>;
  createProject: (command: CreateProjectCommand) => Promise<ProjectContext>;
  /**
   * Reads and validates a project without acquiring a write lock, recovering
   * stale state, migrating data, or otherwise changing the workspace.
   *
   * Optional for compatibility with adapters created before inspection was
   * introduced. Application callers receive a stable error when it is absent.
   */
  inspectProject?: (
    command: InspectProjectCommand,
  ) => Promise<ProjectInspectionPreview>;
  openProject: (command: OpenProjectCommand) => Promise<ProjectContext>;
}
