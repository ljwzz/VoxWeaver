import type {
  AppHealthResult,
  CreateProjectPayload,
  DesktopError,
  DesktopMethodName,
  DesktopMethodPayload,
  DesktopMethodResult,
  DirectorySelectionPurpose,
  OpenProjectPayload,
  ProjectSummaryDto,
  RecentProjectDto,
  RemoveRecentProjectPayload,
  SelectDirectoryResult,
} from '@voxweaver/contracts';

import {
  DESKTOP_PROTOCOL_VERSION,
  parseDesktopMethodPayload,
  parseDesktopMethodResult,
  parseDesktopResponse,
} from '@voxweaver/contracts';
import { contextBridge, ipcRenderer } from 'electron';
import { encodeDesktopBridgeError } from '../shared/desktopBridgeError.js';

const IPC_CHANNEL_PREFIX = 'voxweaver:';
const CORE_STATE_CHANNEL = 'voxweaver:core-state';

let activeProjectContext: ProjectContext | undefined;
let requestSequence = 0;

export type CoreStatus = 'starting' | 'ready' | 'unavailable';

export interface CoreStateUpdate {
  readonly canRestart: boolean;
  readonly status: CoreStatus;
}

export interface ProjectContext {
  readonly projectId: string;
  readonly projectSessionId: string;
}

export interface DesktopBridgeErrorFields {
  readonly code: string;
  readonly retryable: boolean;
}

export class DesktopBridgeError extends Error implements DesktopBridgeErrorFields {
  readonly code: string;
  readonly retryable: boolean;

  constructor(error: DesktopError) {
    const message = sanitizeErrorMessage(error);
    super(encodeDesktopBridgeError({
      code: error.code,
      message,
      retryable: error.retryable,
    }));
    this.code = error.code;
    this.name = 'DesktopBridgeError';
    this.retryable = error.retryable;
  }
}

export interface VoxWeaverDesktopApi {
  readonly app: {
    readonly getHealth: () => Promise<AppHealthResult>;
  };
  readonly dialog: {
    readonly selectDirectory: (payload: {
      readonly purpose: DirectorySelectionPurpose;
    }) => Promise<SelectDirectoryResult>;
  };
  readonly project: {
    readonly close: () => Promise<void>;
    readonly create: (payload: CreateProjectPayload) => Promise<ProjectSummaryDto>;
    readonly getSummary: () => Promise<ProjectSummaryDto | null>;
    readonly listRecent: () => Promise<readonly RecentProjectDto[]>;
    readonly open: (payload: OpenProjectPayload) => Promise<ProjectSummaryDto>;
    readonly removeRecent: (payload: RemoveRecentProjectPayload) => Promise<boolean>;
    readonly switch: (payload: OpenProjectPayload) => Promise<ProjectSummaryDto>;
  };
  readonly onCoreState: (listener: (state: CoreStateUpdate) => void) => () => void;
}

const desktopApi: VoxWeaverDesktopApi = {
  app: {
    getHealth: async () => invokeDesktopMethod('app.getHealth', {}),
  },
  dialog: {
    selectDirectory: async payload => invokeDesktopMethod(
      'dialog.selectDirectory',
      normalizeSelectDirectoryPayload(payload),
    ),
  },
  onCoreState,
  project: {
    close: async () => {
      await invokeDesktopMethod('project.close', {});
    },
    create: async payload => invokeDesktopMethod(
      'project.create',
      normalizeCreateProjectPayload(payload),
    ),
    getSummary: async () => invokeDesktopMethod('project.getSummary', {}),
    listRecent: async () => {
      const result = await invokeDesktopMethod('project.listRecent', {});
      return result.projects;
    },
    open: async payload => invokeDesktopMethod(
      'project.open',
      normalizeOpenProjectPayload(payload),
    ),
    removeRecent: async (payload) => {
      const result = await invokeDesktopMethod(
        'project.removeRecent',
        normalizeRemoveRecentProjectPayload(payload),
      );
      return result.removed;
    },
    switch: async payload => invokeDesktopMethod(
      'project.switch',
      normalizeOpenProjectPayload(payload),
    ),
  },
};

contextBridge.exposeInMainWorld('voxweaver', desktopApi);

function onCoreState(listener: (state: CoreStateUpdate) => void): () => void {
  if (typeof listener !== 'function')
    throw new TypeError('Core-state listener must be a function.');

  const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
    const state = parseCoreState(value);
    if (!state)
      return;

    if (state.status !== 'ready')
      activeProjectContext = undefined;

    listener(state);
  };

  ipcRenderer.on(CORE_STATE_CHANNEL, wrappedListener);
  return () => {
    ipcRenderer.removeListener(CORE_STATE_CHANNEL, wrappedListener);
  };
}

async function invokeDesktopMethod<TMethod extends DesktopMethodName>(
  method: TMethod,
  payload: DesktopMethodPayload<TMethod>,
): Promise<DesktopMethodResult<TMethod>> {
  let safePayload: DesktopMethodPayload<TMethod>;
  try {
    safePayload = parseDesktopMethodPayload(method, payload);
  } catch {
    throw createPayloadError();
  }

  const requestId = createRequestId();
  let response;
  try {
    response = parseDesktopResponse(await ipcRenderer.invoke(
      `${IPC_CHANNEL_PREFIX}${method}`,
      createDesktopRequest(method, requestId, safePayload),
    ));
  } catch {
    throw createCoreUnavailableError();
  }

  if (response.requestId !== requestId) {
    throw createCoreUnavailableError();
  }

  if (!response.ok)
    throw new DesktopBridgeError(response.error);

  let parsedResult: DesktopMethodResult<TMethod>;
  try {
    parsedResult = parseDesktopMethodResult(method, response.result);
  } catch {
    throw createCoreUnavailableError();
  }
  const safeResult = sanitizeMethodResult(method, parsedResult);
  updateActiveProjectContext(method, safeResult);
  return safeResult;
}

function createPayloadError(): DesktopBridgeError {
  return new DesktopBridgeError({
    code: 'DESKTOP_PAYLOAD_INVALID',
    message: 'The desktop request payload is invalid.',
    retryable: false,
  });
}

function createCoreUnavailableError(): DesktopBridgeError {
  return new DesktopBridgeError({
    code: 'DESKTOP_CORE_UNAVAILABLE',
    message: 'The desktop request could not be completed.',
    retryable: true,
  });
}

function createDesktopRequest<TMethod extends DesktopMethodName>(
  method: TMethod,
  requestId: string,
  payload: DesktopMethodPayload<TMethod>,
) {
  const request = {
    method,
    payload,
    protocolVersion: DESKTOP_PROTOCOL_VERSION,
    requestId,
  } as {
    method: TMethod;
    payload: DesktopMethodPayload<TMethod>;
    protocolVersion: typeof DESKTOP_PROTOCOL_VERSION;
    requestId: string;
    projectContext?: ProjectContext;
  };

  if (
    activeProjectContext
    && (method === 'project.close' || method === 'project.switch')
  ) {
    request.projectContext = activeProjectContext;
  }

  return request;
}

function sanitizeMethodResult<TMethod extends DesktopMethodName>(
  method: TMethod,
  result: DesktopMethodResult<TMethod>,
): DesktopMethodResult<TMethod> {
  switch (method) {
    case 'app.getHealth':
      return { healthy: true } as DesktopMethodResult<TMethod>;
    case 'dialog.selectDirectory':
      return sanitizeDirectorySelection(result as SelectDirectoryResult) as DesktopMethodResult<TMethod>;
    case 'project.create':
    case 'project.open':
    case 'project.switch':
      return sanitizeProjectSummary(result as ProjectSummaryDto) as DesktopMethodResult<TMethod>;
    case 'project.getSummary':
      return result === null
        ? null as DesktopMethodResult<TMethod>
        : sanitizeProjectSummary(result as ProjectSummaryDto) as DesktopMethodResult<TMethod>;
    case 'project.listRecent':
      return {
        projects: (result as { readonly projects: readonly RecentProjectDto[] }).projects.map(sanitizeRecentProject),
      } as unknown as DesktopMethodResult<TMethod>;
    case 'project.removeRecent':
      return {
        removed: (result as { readonly removed: boolean }).removed === true,
      } as DesktopMethodResult<TMethod>;
    case 'project.close':
      return null as DesktopMethodResult<TMethod>;
  }
}

function updateActiveProjectContext<TMethod extends DesktopMethodName>(
  method: TMethod,
  result: DesktopMethodResult<TMethod>,
): void {
  if (method === 'project.close') {
    activeProjectContext = undefined;
    return;
  }

  if (method === 'project.getSummary') {
    activeProjectContext = result === null
      ? undefined
      : toProjectContext(result as ProjectSummaryDto);
    return;
  }

  if (
    method === 'project.create'
    || method === 'project.open'
    || method === 'project.switch'
  ) {
    activeProjectContext = toProjectContext(result as ProjectSummaryDto);
  }
}

function normalizeSelectDirectoryPayload(value: unknown): {
  readonly purpose: DirectorySelectionPurpose;
} {
  return {
    purpose: readDirectorySelectionPurpose(value),
  };
}

function normalizeCreateProjectPayload(value: unknown): CreateProjectPayload {
  return {
    displayName: readStringProperty(value, 'displayName'),
    selectionToken: readStringProperty(value, 'selectionToken'),
  };
}

function normalizeOpenProjectPayload(value: unknown): OpenProjectPayload {
  const selectionToken = readOptionalStringProperty(value, 'selectionToken');
  const recentProjectId = readOptionalStringProperty(value, 'recentProjectId');
  const accessMode = readOptionalAccessMode(value);
  const confirmMigration = readOptionalBooleanProperty(value, 'confirmMigration');
  const recoverStaleWriteLock = readOptionalBooleanProperty(value, 'recoverStaleWriteLock');

  const optionalProperties = {
    ...(accessMode === undefined ? {} : { accessMode }),
    ...(confirmMigration === undefined ? {} : { confirmMigration }),
    ...(recoverStaleWriteLock === undefined ? {} : { recoverStaleWriteLock }),
  };

  if (selectionToken !== undefined && recentProjectId === undefined) {
    return {
      ...optionalProperties,
      selectionToken,
    };
  }

  if (recentProjectId !== undefined && selectionToken === undefined) {
    return {
      ...optionalProperties,
      recentProjectId,
    };
  }

  return optionalProperties as OpenProjectPayload;
}

function normalizeRemoveRecentProjectPayload(value: unknown): RemoveRecentProjectPayload {
  return {
    projectId: readStringProperty(value, 'projectId'),
  };
}

function sanitizeDirectorySelection(
  result: SelectDirectoryResult,
): SelectDirectoryResult {
  if (result.canceled)
    return { canceled: true };

  return {
    canceled: false,
    displayName: result.displayName,
    expiresAt: result.expiresAt,
    selectionToken: result.selectionToken,
  };
}

function sanitizeProjectSummary(result: ProjectSummaryDto): ProjectSummaryDto {
  return {
    accessMode: result.accessMode,
    displayName: result.displayName,
    layoutVersion: result.layoutVersion,
    projectId: result.projectId,
    projectSessionId: result.projectSessionId,
  };
}

function sanitizeRecentProject(result: RecentProjectDto): RecentProjectDto {
  return {
    availability: result.availability,
    displayName: result.displayName,
    lastOpenedAt: result.lastOpenedAt,
    projectId: result.projectId,
  };
}

function toProjectContext(project: ProjectSummaryDto): ProjectContext {
  return {
    projectId: project.projectId,
    projectSessionId: project.projectSessionId,
  };
}

function parseCoreState(value: unknown): CoreStateUpdate | undefined {
  if (!isRecord(value))
    return undefined;

  const status = value.status;
  if (status !== 'starting' && status !== 'ready' && status !== 'unavailable')
    return undefined;

  if (typeof value.canRestart !== 'boolean')
    return undefined;

  return {
    canRestart: value.canRestart,
    status,
  };
}

function createRequestId(): string {
  requestSequence += 1;
  const randomId = globalThis.crypto?.randomUUID?.();
  return randomId ?? `desktop-${Date.now()}-${requestSequence}`;
}

function readDirectorySelectionPurpose(value: unknown): DirectorySelectionPurpose {
  const purpose = readProperty(value, 'purpose');
  if (
    purpose === 'create-project-parent'
    || purpose === 'open-project'
    || purpose === 'switch-project'
  ) {
    return purpose;
  }
  return purpose as DirectorySelectionPurpose;
}

function readOptionalAccessMode(value: unknown): 'read-write' | 'read-only' | undefined {
  const accessMode = readProperty(value, 'accessMode');
  if (accessMode === undefined || accessMode === 'read-write' || accessMode === 'read-only')
    return accessMode;
  return accessMode as 'read-write' | 'read-only';
}

function readStringProperty(value: unknown, property: string): string {
  return readProperty(value, property) as string;
}

function readOptionalStringProperty(value: unknown, property: string): string | undefined {
  const propertyValue = readProperty(value, property);
  return propertyValue === undefined ? undefined : propertyValue as string;
}

function readOptionalBooleanProperty(value: unknown, property: string): boolean | undefined {
  const propertyValue = readProperty(value, property);
  return propertyValue === undefined ? undefined : propertyValue as boolean;
}

function readProperty(value: unknown, property: string): unknown {
  return isRecord(value) ? value[property] : undefined;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sanitizeErrorMessage(error: DesktopError): string {
  if (containsAbsolutePath(error.message))
    return 'The desktop request could not be completed.';
  return error.message;
}

function containsAbsolutePath(value: string): boolean {
  return /(?:^|[\s"'(])\/\S*|[A-Z]:[\\/]/i.test(value);
}
