import type { ProjectContext } from '@voxweaver/contracts';

import type {
  CreateProjectCommand,
  OpenProjectCommand,
  ProjectWorkspacePort,
} from './projectWorkspacePort.js';

export class ProjectApplicationService {
  readonly #workspace: ProjectWorkspacePort;
  #activeProject: ProjectContext | undefined;

  constructor(workspace: ProjectWorkspacePort) {
    this.#workspace = workspace;
  }

  async closeProject(): Promise<void> {
    if (!this.#activeProject)
      return;

    await this.#workspace.closeProject(this.#activeProject);
    this.#activeProject = undefined;
  }

  async createProject(command: CreateProjectCommand): Promise<ProjectContext> {
    const project = await this.#workspace.createProject(command);
    this.#activeProject = project;
    return project;
  }

  getActiveProject(): ProjectContext | undefined {
    return this.#activeProject;
  }

  async openProject(command: OpenProjectCommand): Promise<ProjectContext> {
    const project = await this.#workspace.openProject(command);
    this.#activeProject = project;
    return project;
  }
}
