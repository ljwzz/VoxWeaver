import type { ProjectContext } from '@voxweaver/contracts';

export interface CreateProjectCommand {
  displayName: string;
  parentDirectory: string;
}

export interface OpenProjectCommand {
  projectDirectory: string;
}

export interface ProjectWorkspacePort {
  closeProject: (project: ProjectContext) => Promise<void>;
  createProject: (command: CreateProjectCommand) => Promise<ProjectContext>;
  openProject: (command: OpenProjectCommand) => Promise<ProjectContext>;
}
