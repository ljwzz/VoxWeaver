import type { CreateProjectCommand, OpenProjectCommand, ProjectWorkspacePort } from '@voxweaver/application';
import type { ProjectContext } from '@voxweaver/contracts';
import { ProjectApplicationService } from '@voxweaver/application';
import { NodeProjectWorkspace } from '@voxweaver/project-workspace';

export interface AppCoreServiceOptions {
  projectWorkspace?: ProjectWorkspacePort;
}

export class AppCoreService {
  readonly #projects: ProjectApplicationService;

  constructor(options: AppCoreServiceOptions = {}) {
    this.#projects = new ProjectApplicationService(
      options.projectWorkspace ?? new NodeProjectWorkspace(),
    );
  }

  closeProject(): Promise<void> {
    return this.#projects.closeProject();
  }

  createProject(command: CreateProjectCommand): Promise<ProjectContext> {
    return this.#projects.createProject(command);
  }

  getActiveProject(): ProjectContext | undefined {
    return this.#projects.getActiveProject();
  }

  openProject(command: OpenProjectCommand): Promise<ProjectContext> {
    return this.#projects.openProject(command);
  }
}
