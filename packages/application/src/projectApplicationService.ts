import type { ProjectContext } from '@voxweaver/contracts';

import type {
  AssertProjectSessionCommand,
  CreateProjectCommand,
  InspectProjectCommand,
  OpenProjectCommand,
  ProjectInspectionPreview,
  ProjectWorkspacePort,
} from './projectWorkspacePort.js';
import { ProjectApplicationError } from './projectApplicationError.js';

type ProjectOperation = 'activating' | 'closing' | 'switching';

interface ActiveProjectSession {
  readonly context: ProjectContext;
  readonly workspaceContext: ProjectContext;
}

type JsonContainer = Record<string, unknown> | unknown[];

interface JsonCloneWorkItem {
  readonly source: JsonContainer;
  readonly target: JsonContainer;
}

export class ProjectApplicationService {
  readonly #workspace: ProjectWorkspacePort;
  #activeProject: ActiveProjectSession | undefined;
  #activeSessionUseCount = 0;
  #operation: ProjectOperation | undefined;

  constructor(workspace: ProjectWorkspacePort) {
    this.#workspace = workspace;
  }

  assertActiveProjectSession(
    command: AssertProjectSessionCommand,
  ): ProjectContext {
    this.#assertNoOperation();

    if (
      command.requiredAccess !== 'read'
      && command.requiredAccess !== 'write'
    ) {
      throw new ProjectApplicationError(
        'PROJECT_SESSION_ACCESS_INVALID',
        'The required project access must be "read" or "write".',
      );
    }

    const activeProject = this.#activeProject?.context;

    if (
      !activeProject
      || activeProject.manifest.projectId !== command.projectId
      || activeProject.projectSessionId !== command.projectSessionId
    ) {
      throw new ProjectApplicationError(
        'PROJECT_SESSION_STALE',
        'The project session is no longer active.',
      );
    }

    if (
      command.requiredAccess === 'write'
      && activeProject.accessMode !== 'read-write'
    ) {
      throw new ProjectApplicationError(
        'PROJECT_READ_ONLY',
        'The active project session is read-only.',
      );
    }

    return activeProject;
  }

  async closeProject(): Promise<void> {
    this.#assertCanStartLifecycleOperation();

    const activeSession = this.#activeProject;
    if (!activeSession)
      return;

    this.#operation = 'closing';
    try {
      await this.#workspace.closeProject(activeSession.workspaceContext);
      this.#activeProject = undefined;
    } finally {
      this.#operation = undefined;
    }
  }

  async createProject(command: CreateProjectCommand): Promise<ProjectContext> {
    this.#beginActivation();
    try {
      const activeSession = createActiveProjectSession(
        await this.#workspace.createProject(command),
      );
      this.#activeProject = activeSession;
      return activeSession.context;
    } finally {
      this.#operation = undefined;
    }
  }

  getActiveProject(): ProjectContext | undefined {
    return this.#activeProject?.context;
  }

  async inspectProject(
    command: InspectProjectCommand,
  ): Promise<ProjectInspectionPreview> {
    this.#assertNoOperation();

    const preview = await this.#inspectWorkspaceProject(command);
    if (!preview) {
      throw new ProjectApplicationError(
        'PROJECT_INSPECTION_UNAVAILABLE',
        'The configured project workspace does not support project inspection.',
      );
    }

    return preview;
  }

  async runInActiveProjectSession<T>(
    command: AssertProjectSessionCommand,
    operation: (context: ProjectContext) => Promise<T>,
  ): Promise<T> {
    const context = this.assertActiveProjectSession(command);
    this.#activeSessionUseCount += 1;
    try {
      return await operation(context);
    } finally {
      this.#activeSessionUseCount -= 1;
    }
  }

  async openProject(command: OpenProjectCommand): Promise<ProjectContext> {
    this.#beginActivation();
    try {
      await this.#assertMigrationConfirmed(command);
      const activeSession = createActiveProjectSession(
        await this.#workspace.openProject(command),
      );
      this.#activeProject = activeSession;
      return activeSession.context;
    } finally {
      this.#operation = undefined;
    }
  }

  async switchProject(command: OpenProjectCommand): Promise<ProjectContext> {
    this.#assertCanStartLifecycleOperation();
    this.#operation = 'switching';

    try {
      await this.#assertMigrationConfirmed(command);
      const activeSession = this.#activeProject;
      if (activeSession) {
        await this.#workspace.closeProject(activeSession.workspaceContext);
        this.#activeProject = undefined;
      }

      try {
        const nextSession = createActiveProjectSession(
          await this.#workspace.openProject(command),
        );
        this.#activeProject = nextSession;
        return nextSession.context;
      } catch (error) {
        if (!activeSession)
          throw error;

        throw new ProjectApplicationError(
          'PROJECT_SWITCH_OPEN_FAILED',
          'The active project was closed, but the target project could not be opened.',
          { cause: error },
        );
      }
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

  #assertCanStartLifecycleOperation(): void {
    this.#assertNoOperation();
    if (this.#activeSessionUseCount > 0) {
      throw new ProjectApplicationError(
        'PROJECT_OPERATION_IN_PROGRESS',
        'The active project session is still in use.',
      );
    }
  }

  async #assertMigrationConfirmed(command: OpenProjectCommand): Promise<void> {
    const preview = await this.#inspectWorkspaceProject({
      projectDirectory: command.projectDirectory,
    });
    if (preview?.migrationRequired && command.confirmMigration !== true) {
      throw new ProjectApplicationError(
        'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
        'Project migration requires explicit confirmation.',
      );
    }
  }

  #beginActivation(): void {
    this.#assertCanStartLifecycleOperation();

    if (this.#activeProject) {
      throw new ProjectApplicationError(
        'PROJECT_ALREADY_ACTIVE',
        'A project is already active.',
      );
    }

    this.#operation = 'activating';
  }

  async #inspectWorkspaceProject(
    command: InspectProjectCommand,
  ): Promise<ProjectInspectionPreview | undefined> {
    const inspectProject = this.#workspace.inspectProject;
    if (!inspectProject)
      return undefined;

    const preview = await inspectProject.call(this.#workspace, command);
    return Object.freeze({
      displayName: preview.displayName,
      layoutVersion: preview.layoutVersion,
      migrationRequired: preview.migrationRequired,
      projectId: preview.projectId,
      writeLock: Object.freeze({
        recoveryAvailable: preview.writeLock.recoveryAvailable,
        status: preview.writeLock.status,
      }),
    });
  }
}

function createActiveProjectSession(
  workspaceContext: ProjectContext,
): ActiveProjectSession {
  const manifest = cloneAndFreezeJson(workspaceContext.manifest);
  const context = Object.freeze({ ...workspaceContext, manifest });

  return { context, workspaceContext };
}

function cloneAndFreezeJson<T>(value: T): T {
  if (!isJsonContainer(value))
    return value;

  const root = createJsonContainer(value);
  const clones = new WeakMap<object, JsonContainer>([[value, root]]);
  const pending: JsonCloneWorkItem[] = [{ source: value, target: root }];
  const containers = [root];

  while (pending.length > 0) {
    const current = pending.pop();
    if (!current)
      break;

    for (const [key, item] of Object.entries(current.source)) {
      if (!isJsonContainer(item)) {
        defineJsonValue(current.target, key, item);
        continue;
      }

      let clonedItem = clones.get(item);
      if (!clonedItem) {
        clonedItem = createJsonContainer(item);
        clones.set(item, clonedItem);
        pending.push({ source: item, target: clonedItem });
        containers.push(clonedItem);
      }
      defineJsonValue(current.target, key, clonedItem);
    }
  }

  for (let index = containers.length - 1; index >= 0; index -= 1)
    Object.freeze(containers[index]);

  return root as T;
}

function createJsonContainer(value: JsonContainer): JsonContainer {
  return Array.isArray(value) ? Array.from({ length: value.length }) : {};
}

function defineJsonValue(
  target: JsonContainer,
  key: string,
  value: unknown,
): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    value,
    writable: true,
  });
}

function isJsonContainer(value: unknown): value is JsonContainer {
  return value !== null && typeof value === 'object';
}
