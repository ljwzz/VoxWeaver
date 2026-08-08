import type {
  AssertProjectSessionCommand,
  CreateProjectCommand,
  OpenProjectCommand,
  ProjectWorkflowApplicationService,
  ProjectWorkflowFactory,
  ProjectWorkspacePort,
} from '@voxweaver/application';
import type { ProjectContext } from '@voxweaver/contracts';
import {
  ProjectApplicationService,
  ProjectWorkflowApplicationService as WorkflowApplicationService,
} from '@voxweaver/application';
import {
  NodeProjectWorkflow,
  NodeProjectWorkspace,
} from '@voxweaver/project-workspace';

export interface AppCoreServiceOptions {
  projectWorkspace?: ProjectWorkspacePort;
  projectWorkflowFactory?: ProjectWorkflowFactory;
}

export class AppCoreService {
  readonly #projects: ProjectApplicationService;
  readonly workflow: ProjectWorkflowApplicationService;

  constructor(options: AppCoreServiceOptions = {}) {
    this.#projects = new ProjectApplicationService(
      options.projectWorkspace ?? new NodeProjectWorkspace(),
    );
    this.workflow = new WorkflowApplicationService(
      this.#projects,
      options.projectWorkflowFactory
      ?? (context => new NodeProjectWorkflow(context)),
    );
  }

  assertActiveProjectSession(
    command: AssertProjectSessionCommand,
  ): ProjectContext {
    return this.#projects.assertActiveProjectSession(command);
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

  switchProject(command: OpenProjectCommand): Promise<ProjectContext> {
    return this.#projects.switchProject(command);
  }
}
