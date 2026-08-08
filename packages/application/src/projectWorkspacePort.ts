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
  projectDirectory: string;
  recoverStaleWriteLock?: boolean;
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
  openProject: (command: OpenProjectCommand) => Promise<ProjectContext>;
}
