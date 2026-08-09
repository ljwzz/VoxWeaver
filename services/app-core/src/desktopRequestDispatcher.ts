import type {
  CreateProjectCommand,
  InspectProjectCommand,
  OpenProjectCommand,
  ProjectInspectionPreview,
} from '@voxweaver/application';
import type {
  CreateProjectPayload,
  DesktopError,
  DesktopMethodName,
  DesktopMethodPayload,
  DesktopMethodResult,
  DesktopRequest,
  DesktopResponse,
  DirectorySelectionPurpose,
  OpenProjectPayload,
  ProjectContext,
  ProjectSummaryDto,
  RecentProjectDto,
} from '@voxweaver/contracts';
import type {
  RecentProjectRecord,
  RecentProjectSummary,
} from './recentProjectStore.js';

import {
  DESKTOP_METHOD_NAMES,
  DESKTOP_PROTOCOL_VERSION,
  DesktopMessageValidationError,
  DesktopMethodValidationError,
  parseDesktopMethodPayload,
  parseDesktopMethodResult,
  parseDesktopRequest,
  parseDesktopResponse,
} from '@voxweaver/contracts';

const INVALID_REQUEST_ID = 'invalid-request';

export interface DesktopProjectCore {
  readonly assertActiveProjectSession: (command: {
    readonly projectId: string;
    readonly projectSessionId: string;
    readonly requiredAccess: 'read';
  }) => ProjectContext;
  readonly closeProject: () => Promise<void>;
  readonly createProject: (
    command: CreateProjectCommand,
  ) => Promise<ProjectContext>;
  readonly getActiveProject: () => ProjectContext | undefined;
  readonly inspectProject: (
    command: InspectProjectCommand,
  ) => Promise<ProjectInspectionPreview>;
  readonly openProject: (
    command: OpenProjectCommand,
  ) => Promise<ProjectContext>;
  readonly switchProject: (
    command: OpenProjectCommand,
  ) => Promise<ProjectContext>;
}

export interface RecentProjectPort {
  readonly get: (projectId: string) => Promise<RecentProjectRecord | undefined>;
  readonly list: () => Promise<readonly RecentProjectSummary[]>;
  readonly record: (project: ProjectContext) => Promise<void>;
  readonly remove: (projectId: string) => Promise<boolean>;
}

/**
 * Main-only context that accompanies a public request after sender/window and
 * selection-token validation. It is deliberately not part of the desktop
 * request envelope and must never be forwarded to the Renderer.
 */
export interface DesktopTrustedRequestContext {
  readonly projectDirectory?: string;
  readonly selectionPurpose?: DirectorySelectionPurpose;
  readonly selectionToken?: string;
}

export interface DesktopRequestDispatcherOptions {
  readonly core: DesktopProjectCore;
  readonly recentProjects: RecentProjectPort;
}

export class DesktopRequestDispatcher {
  readonly #core: DesktopProjectCore;
  readonly #recentProjects: RecentProjectPort;

  constructor(options: DesktopRequestDispatcherOptions) {
    this.#core = options.core;
    this.#recentProjects = options.recentProjects;
  }

  async dispatch(
    input: unknown,
    trustedContext: DesktopTrustedRequestContext = {},
  ): Promise<DesktopResponse> {
    let request: DesktopRequest;
    try {
      request = parseDesktopRequest(input);
    } catch (error) {
      return this.#failure(
        readRequestId(input),
        toDesktopError(error),
      );
    }

    try {
      const payload = parseDesktopMethodPayload(request.method, request.payload);
      const result = await this.#dispatchMethod(
        request,
        request.method as DesktopMethodName,
        payload,
        trustedContext,
      );
      const parsedResult = parseDesktopMethodResult(
        request.method as DesktopMethodName,
        result,
      );
      return parseDesktopResponse({
        ok: true,
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        requestId: request.requestId,
        result: parsedResult,
      });
    } catch (error) {
      return this.#failure(request.requestId, toDesktopError(error));
    }
  }

  async #dispatchMethod(
    request: DesktopRequest,
    method: DesktopMethodName,
    payload: DesktopMethodPayload,
    trustedContext: DesktopTrustedRequestContext,
  ): Promise<DesktopMethodResult> {
    switch (method) {
      case DESKTOP_METHOD_NAMES.APP_GET_HEALTH:
        return { healthy: true };
      case DESKTOP_METHOD_NAMES.DIALOG_SELECT_DIRECTORY:
        throw new DesktopMethodValidationError(
          'DESKTOP_METHOD_NOT_FOUND',
          'Directory selection is only available in the desktop main process.',
        );
      case DESKTOP_METHOD_NAMES.PROJECT_CLOSE:
        this.#assertCurrentProjectContext(request);
        await this.#core.closeProject();
        return null;
      case DESKTOP_METHOD_NAMES.PROJECT_CREATE:
        return this.#createProject(payload as CreateProjectPayload, trustedContext);
      case DESKTOP_METHOD_NAMES.PROJECT_GET_SUMMARY:
        return toProjectSummary(this.#core.getActiveProject());
      case DESKTOP_METHOD_NAMES.PROJECT_LIST_RECENT:
        return {
          projects: (await this.#recentProjects.list()).map(toRecentProjectDto),
        };
      case DESKTOP_METHOD_NAMES.PROJECT_OPEN:
      case DESKTOP_METHOD_NAMES.PROJECT_SWITCH:
        if (method === DESKTOP_METHOD_NAMES.PROJECT_SWITCH) {
          this.#assertCurrentProjectContextWhenActive(request);
        }
        return this.#openProject(
          method,
          payload as OpenProjectPayload,
          trustedContext,
        );
      case DESKTOP_METHOD_NAMES.PROJECT_REMOVE_RECENT:
        return {
          removed: await this.#recentProjects.remove(
            (payload as { readonly projectId: string }).projectId,
          ),
        };
    }
  }

  async #createProject(
    payload: CreateProjectPayload,
    trustedContext: DesktopTrustedRequestContext,
  ): Promise<ProjectSummaryDto> {
    const parentDirectory = requireSelectionDirectory(
      payload.selectionToken,
      trustedContext,
      'create-project-parent',
    );
    const project = await this.#core.createProject({
      displayName: payload.displayName,
      parentDirectory,
    });
    await this.#recordRecentProject(project);
    return toRequiredProjectSummary(project);
  }

  async #openProject(
    method: typeof DESKTOP_METHOD_NAMES.PROJECT_OPEN | typeof DESKTOP_METHOD_NAMES.PROJECT_SWITCH,
    payload: OpenProjectPayload,
    trustedContext: DesktopTrustedRequestContext,
  ): Promise<ProjectSummaryDto> {
    const projectDirectory = await this.#resolveProjectDirectory(
      method,
      payload,
      trustedContext,
    );
    const preview = await this.#core.inspectProject({ projectDirectory });
    const accessMode = payload.accessMode ?? 'read-write';

    if (accessMode === 'read-only' && preview.migrationRequired) {
      throw new ProjectOpenBlockedError(
        'PROJECT_MIGRATION_REQUIRED',
        'This project must be migrated by a write session before read-only use.',
        false,
      );
    }

    if (preview.migrationRequired && payload.confirmMigration !== true) {
      throw new ProjectConfirmationRequiredError(
        'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
        'Project migration confirmation is required before opening this project.',
      );
    }

    if (
      accessMode === 'read-write'
      && preview.writeLock.status === 'recoverable'
      && payload.recoverStaleWriteLock !== true
    ) {
      throw new ProjectConfirmationRequiredError(
        'PROJECT_WRITE_LOCK_RECOVERY_REQUIRED',
        'Write-lock recovery confirmation is required before opening this project.',
      );
    }

    if (accessMode === 'read-write' && preview.writeLock.status === 'locked') {
      throw new ProjectOpenBlockedError(
        'PROJECT_WRITE_LOCKED',
        'This project is currently locked by another active session.',
        false,
      );
    }

    const command: OpenProjectCommand = {
      accessMode: payload.accessMode,
      confirmMigration: payload.confirmMigration,
      projectDirectory,
      recoverStaleWriteLock: payload.recoverStaleWriteLock,
    };
    const project = method === DESKTOP_METHOD_NAMES.PROJECT_OPEN
      ? await this.#core.openProject(command)
      : await this.#core.switchProject(command);
    await this.#recordRecentProject(project);
    return toRequiredProjectSummary(project);
  }

  /**
   * The recent-project index is a convenience cache. A local I/O error must not
   * roll back an already-successful Core lifecycle transition and leave Main
   * without the new session context needed to close it safely.
   */
  async #recordRecentProject(project: ProjectContext): Promise<void> {
    try {
      await this.#recentProjects.record(project);
    } catch {
      // The next successful lifecycle operation can repopulate this index.
    }
  }

  async #resolveProjectDirectory(
    method: typeof DESKTOP_METHOD_NAMES.PROJECT_OPEN | typeof DESKTOP_METHOD_NAMES.PROJECT_SWITCH,
    payload: OpenProjectPayload,
    trustedContext: DesktopTrustedRequestContext,
  ): Promise<string> {
    if (typeof payload.selectionToken === 'string') {
      return requireSelectionDirectory(
        payload.selectionToken,
        trustedContext,
        method === DESKTOP_METHOD_NAMES.PROJECT_OPEN
          ? 'open-project'
          : 'switch-project',
      );
    }

    const project = await this.#recentProjects.get(payload.recentProjectId);
    if (!project) {
      throw new DesktopSelectionError(
        'The selected recent project is no longer available.',
      );
    }
    return project.projectDirectory;
  }

  #assertCurrentProjectContext(request: DesktopRequest): void {
    const context = request.projectContext;
    if (!context) {
      throw new DesktopRequestContextError(
        'An active project context is required for this operation.',
      );
    }
    this.#core.assertActiveProjectSession({
      projectId: context.projectId,
      projectSessionId: context.projectSessionId,
      requiredAccess: 'read',
    });
  }

  #assertCurrentProjectContextWhenActive(request: DesktopRequest): void {
    if (!this.#core.getActiveProject())
      return;
    this.#assertCurrentProjectContext(request);
  }

  #failure(requestId: string, error: DesktopError): DesktopResponse {
    return parseDesktopResponse({
      error,
      ok: false,
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId,
    });
  }
}

class DesktopSelectionError extends Error {
  readonly code = 'DESKTOP_SELECTION_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'DesktopSelectionError';
  }
}

class DesktopRequestContextError extends Error {
  readonly code = 'DESKTOP_PAYLOAD_INVALID';

  constructor(message: string) {
    super(message);
    this.name = 'DesktopRequestContextError';
  }
}

class ProjectConfirmationRequiredError extends Error {
  readonly retryable = true;

  constructor(
    readonly code:
      | 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED'
      | 'PROJECT_WRITE_LOCK_RECOVERY_REQUIRED',
    message: string,
  ) {
    super(message);
    this.name = 'ProjectConfirmationRequiredError';
  }
}

class ProjectOpenBlockedError extends Error {
  constructor(
    readonly code: 'PROJECT_MIGRATION_REQUIRED' | 'PROJECT_WRITE_LOCKED',
    message: string,
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'ProjectOpenBlockedError';
  }
}

function requireSelectionDirectory(
  selectionToken: string,
  trustedContext: DesktopTrustedRequestContext,
  expectedPurpose: DirectorySelectionPurpose,
): string {
  if (
    trustedContext.selectionToken !== selectionToken
    || trustedContext.selectionPurpose !== expectedPurpose
    || !trustedContext.projectDirectory
  ) {
    throw new DesktopSelectionError(
      'The selected directory cannot be used for this operation.',
    );
  }
  return trustedContext.projectDirectory;
}

function toProjectSummary(
  project: ProjectContext | undefined,
): ProjectSummaryDto | null {
  if (!project)
    return null;

  return {
    accessMode: project.accessMode,
    displayName: project.manifest.displayName,
    layoutVersion: project.manifest.layoutVersion,
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
  };
}

function toRequiredProjectSummary(project: ProjectContext): ProjectSummaryDto {
  return {
    accessMode: project.accessMode,
    displayName: project.manifest.displayName,
    layoutVersion: project.manifest.layoutVersion,
    projectId: project.manifest.projectId,
    projectSessionId: project.projectSessionId,
  };
}

function toRecentProjectDto(
  project: RecentProjectSummary,
): RecentProjectDto {
  return {
    availability: project.availability === 'available'
      ? 'available'
      : 'unavailable',
    displayName: project.displayName,
    lastOpenedAt: project.lastOpenedAt,
    projectId: project.projectId,
  };
}

function readRequestId(value: unknown): string {
  if (!isRecord(value))
    return INVALID_REQUEST_ID;
  const requestId = value.requestId;
  return typeof requestId === 'string' && requestId.length > 0
    ? requestId
    : INVALID_REQUEST_ID;
}

function toDesktopError(error: unknown): DesktopError {
  if (error instanceof DesktopRequestContextError) {
    return {
      code: error.code,
      message: 'The desktop request payload is invalid.',
      retryable: false,
    };
  }

  if (error instanceof DesktopSelectionError) {
    return {
      code: error.code,
      message: error.message,
      retryable: false,
    };
  }

  if (error instanceof ProjectConfirmationRequiredError) {
    return {
      code: error.code,
      message: error.message,
      retryable: true,
    };
  }

  if (error instanceof ProjectOpenBlockedError) {
    return {
      code: error.code,
      message: error.message,
      retryable: error.retryable,
    };
  }

  if (error instanceof DesktopMethodValidationError) {
    if (error.code === 'DESKTOP_METHOD_RESULT_INVALID') {
      return {
        code: 'DESKTOP_CORE_UNAVAILABLE',
        message: 'The application core could not complete the request.',
        retryable: true,
      };
    }
    return {
      code: error.code === 'DESKTOP_METHOD_PAYLOAD_INVALID'
        ? 'DESKTOP_PAYLOAD_INVALID'
        : error.code,
      message: error.code === 'DESKTOP_METHOD_NOT_FOUND'
        ? 'The requested desktop method is not available.'
        : 'The desktop method payload is invalid.',
      retryable: false,
    };
  }

  if (error instanceof DesktopMessageValidationError) {
    return {
      code: 'DESKTOP_PAYLOAD_INVALID',
      message: 'The desktop request envelope is invalid.',
      retryable: false,
    };
  }

  const code = readProjectErrorCode(error);
  if (code) {
    return {
      code,
      message: projectErrorMessage(code),
      retryable: false,
    };
  }

  return {
    code: 'DESKTOP_CORE_UNAVAILABLE',
    message: 'The application core could not complete the request.',
    retryable: true,
  };
}

function readProjectErrorCode(error: unknown): string | undefined {
  if (!isRecord(error) || typeof error.code !== 'string')
    return undefined;
  return error.code.startsWith('PROJECT_') ? error.code : undefined;
}

function projectErrorMessage(code: string): string {
  switch (code) {
    case 'PROJECT_MIGRATION_REQUIRED':
    case 'PROJECT_STATE_MIGRATION_REQUIRED':
      return 'This project must be migrated before it can be opened in the requested mode.';
    case 'PROJECT_WRITE_LOCKED':
      return 'This project is currently locked by another active session.';
    default:
      return 'The project request could not be completed.';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
