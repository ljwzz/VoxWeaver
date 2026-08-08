import type { ProjectContext } from '@voxweaver/contracts';

import type {
  CreateProjectCommand,
  OpenProjectCommand,
  ProjectWorkspacePort,
} from './projectWorkspacePort.js';
import { ProjectApplicationError } from './projectApplicationError.js';

type ProjectOperation = 'activating' | 'closing';

export class ProjectApplicationService {
  readonly #workspace: ProjectWorkspacePort;
  #activeProject: ProjectContext | undefined;
  #operation: ProjectOperation | undefined;

  constructor(workspace: ProjectWorkspacePort) {
    this.#workspace = workspace;
  }

  async closeProject(): Promise<void> {
    this.#assertNoOperation();

    const activeProject = this.#activeProject;
    if (!activeProject)
      return;

    this.#operation = 'closing';
    try {
      await this.#workspace.closeProject(activeProject);
      this.#activeProject = undefined;
    } finally {
      this.#operation = undefined;
    }
  }

  async createProject(command: CreateProjectCommand): Promise<ProjectContext> {
    this.#beginActivation();
    try {
      const project = await this.#workspace.createProject(command);
      this.#activeProject = project;
      return project;
    } finally {
      this.#operation = undefined;
    }
  }

  getActiveProject(): ProjectContext | undefined {
    return this.#activeProject;
  }

  async openProject(command: OpenProjectCommand): Promise<ProjectContext> {
    this.#beginActivation();
    try {
      const project = await this.#workspace.openProject(command);
      this.#activeProject = project;
      return project;
    } finally {
      this.#operation = undefined;
    }
  }

  #assertNoOperation(): void {
    if (this.#operation) {
      throw new ProjectApplicationError(
        'PROJECT_OPERATION_IN_PROGRESS',
        `Project operation "${this.#operation}" is already in progress.`,
      );
    }
  }

  #beginActivation(): void {
    this.#assertNoOperation();

    if (this.#activeProject) {
      throw new ProjectApplicationError(
        'PROJECT_ALREADY_ACTIVE',
        'A project is already active.',
      );
    }

    this.#operation = 'activating';
  }
}
