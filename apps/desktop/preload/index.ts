import type {
  AppHealthResult,
  CreateProjectPayload,
  DesktopMethodName,
  DesktopMethodPayload,
  DesktopMethodResult,
  DesktopNovelImportErrorCode,
  DesktopNovelImportErrorV1,
  DesktopNovelImportEventType,
  DesktopNovelImportEventV1,
  DesktopNovelImportMethodName,
  DesktopNovelImportMethodPayload,
  DesktopNovelImportMethodResult,
  DirectorySelectionPurpose,
  OpenProjectPayload,
  ProjectSummaryDto,
  RecentProjectDto,
  RemoveRecentProjectPayload,
  SelectDirectoryResult,
} from '@voxweaver/contracts';

import {
  DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY,
  DESKTOP_NOVEL_IMPORT_EVENT_TYPES,
  DESKTOP_NOVEL_IMPORT_METHOD_NAMES,
  DESKTOP_PROTOCOL_VERSION,
  DesktopNovelImportValidationError,
  parseDesktopMethodPayload,
  parseDesktopMethodResult,
  parseDesktopNovelImportError,
  parseDesktopNovelImportEvent,
  parseDesktopNovelImportMethodPayload,
  parseDesktopNovelImportMethodResult,
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
  readonly currentArtifactRevisionId?: string;
  readonly operationId?: string;
  readonly retryable: boolean;
  readonly taskId?: string;
}

interface DesktopBridgeErrorInput extends DesktopBridgeErrorFields {
  readonly message: string;
}

export class DesktopBridgeError extends Error implements DesktopBridgeErrorFields {
  readonly code: string;
  readonly currentArtifactRevisionId?: string;
  readonly operationId?: string;
  readonly retryable: boolean;
  readonly taskId?: string;

  constructor(error: DesktopBridgeErrorInput) {
    const message = sanitizeErrorMessage(error);
    super(encodeDesktopBridgeError({
      code: error.code,
      ...(error.currentArtifactRevisionId === undefined
        ? {}
        : { currentArtifactRevisionId: error.currentArtifactRevisionId }),
      message,
      ...(error.operationId === undefined
        ? {}
        : { operationId: error.operationId }),
      retryable: error.retryable,
      ...(error.taskId === undefined ? {} : { taskId: error.taskId }),
    }));
    this.code = error.code;
    if (error.currentArtifactRevisionId !== undefined)
      this.currentArtifactRevisionId = error.currentArtifactRevisionId;
    this.name = 'DesktopBridgeError';
    if (error.operationId !== undefined)
      this.operationId = error.operationId;
    this.retryable = error.retryable;
    if (error.taskId !== undefined)
      this.taskId = error.taskId;
  }
}

type NovelImportMethodInvoker<TMethod extends DesktopNovelImportMethodName> = (
  payload: DesktopNovelImportMethodPayload<TMethod>,
) => Promise<DesktopNovelImportMethodResult<TMethod>>;

export interface NovelImportDesktopApi {
  readonly cancelTask: NovelImportMethodInvoker<
    typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK
  >;
  readonly executeReviewCommand: NovelImportMethodInvoker<
    typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND
  >;
  readonly getTask: NovelImportMethodInvoker<
    typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK
  >;
  readonly inspect: NovelImportMethodInvoker<
    typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT
  >;
  readonly onEvent: (
    listener: (event: DesktopNovelImportEventV1) => void,
  ) => () => void;
  readonly previewStaleImpact: NovelImportMethodInvoker<
    typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT
  >;
  readonly retryTask: NovelImportMethodInvoker<
    typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES.RETRY_TASK
  >;
  readonly selectSource: NovelImportMethodInvoker<
    typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE
  >;
  readonly start: NovelImportMethodInvoker<
    typeof DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START
  >;
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
  readonly novelImport: NovelImportDesktopApi;
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
  novelImport: {
    cancelTask: async payload => invokeNovelImportMethod(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.CANCEL_TASK,
      payload,
    ),
    executeReviewCommand: async payload => invokeNovelImportMethod(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.EXECUTE_REVIEW_COMMAND,
      payload,
    ),
    getTask: async payload => invokeNovelImportMethod(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.GET_TASK,
      payload,
    ),
    inspect: async payload => invokeNovelImportMethod(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.INSPECT,
      payload,
    ),
    onEvent: onNovelImportEvent,
    previewStaleImpact: async payload => invokeNovelImportMethod(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.PREVIEW_STALE_IMPACT,
      payload,
    ),
    retryTask: async payload => invokeNovelImportMethod(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.RETRY_TASK,
      payload,
    ),
    selectSource: async payload => invokeNovelImportMethod(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE,
      payload,
    ),
    start: async payload => invokeNovelImportMethod(
      DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START,
      payload,
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

function onNovelImportEvent(
  listener: (event: DesktopNovelImportEventV1) => void,
): () => void {
  if (typeof listener !== 'function')
    throw new TypeError('Novel-import event listener must be a function.');

  const registrations = Object.values(DESKTOP_NOVEL_IMPORT_EVENT_TYPES).map(
    (eventType) => {
      const channel = desktopNovelImportIpcChannel(eventType);
      const wrappedListener = (
        _event: Electron.IpcRendererEvent,
        value: unknown,
      ) => {
        let event: DesktopNovelImportEventV1;
        try {
          event = parseNovelImportEventEnvelope(eventType, value);
        } catch {
          return;
        }
        if (!isActiveNovelImportSession(event))
          return;
        listener(event);
      };
      ipcRenderer.on(channel, wrappedListener);
      return { channel, wrappedListener };
    },
  );
  let subscribed = true;

  return () => {
    if (!subscribed)
      return;
    subscribed = false;
    for (const registration of registrations) {
      ipcRenderer.removeListener(
        registration.channel,
        registration.wrappedListener,
      );
    }
  };
}

async function invokeNovelImportMethod<
  TMethod extends DesktopNovelImportMethodName,
>(
  method: TMethod,
  payload: DesktopNovelImportMethodPayload<TMethod>,
): Promise<DesktopNovelImportMethodResult<TMethod>> {
  let safePayload: DesktopNovelImportMethodPayload<TMethod>;
  try {
    safePayload = parseDesktopNovelImportMethodPayload(method, payload);
  } catch (error) {
    throw createNovelImportPayloadError(error);
  }

  const requestedSession = toProjectContext(safePayload);
  assertActiveNovelImportSession(requestedSession);

  let rawResponse: unknown;
  try {
    rawResponse = await ipcRenderer.invoke(
      desktopNovelImportIpcChannel(method),
      {
        messageKind: 'payload',
        method,
        payload: safePayload,
      },
    );
  } catch {
    assertActiveNovelImportSession(requestedSession);
    throw createNovelImportBridgeError('DESKTOP_CORE_UNAVAILABLE');
  }

  assertActiveNovelImportSession(requestedSession);
  let response: ParsedNovelImportResponse<TMethod>;
  try {
    response = parseNovelImportIpcResponse(method, requestedSession, rawResponse);
  } catch {
    throw createNovelImportBridgeError('DESKTOP_CORE_UNAVAILABLE');
  }
  if (!response.ok) {
    throw new DesktopBridgeError(response.error);
  }
  return response.result;
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

  if (!response.ok) {
    throw new DesktopBridgeError({
      code: response.error.code,
      message: response.error.message,
      retryable: response.error.retryable,
    });
  }

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

function createNovelImportPayloadError(error: unknown): DesktopBridgeError {
  const code = error instanceof DesktopNovelImportValidationError
    && error.code === 'DESKTOP_NOVEL_IMPORT_VERSION_UNSUPPORTED'
    ? 'DESKTOP_PROTOCOL_UNSUPPORTED'
    : 'DESKTOP_PAYLOAD_INVALID';
  return createNovelImportBridgeError(code);
}

function createNovelImportBridgeError(
  code: DesktopNovelImportErrorCode,
): DesktopBridgeError {
  return new DesktopBridgeError({
    code,
    message: 'The novel import request could not be completed.',
    retryable: DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY[code],
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

function toProjectContext(project: ProjectContext): ProjectContext {
  return {
    projectId: project.projectId,
    projectSessionId: project.projectSessionId,
  };
}

type ParsedNovelImportResponse<TMethod extends DesktopNovelImportMethodName>
  = | {
    readonly ok: true;
    readonly result: DesktopNovelImportMethodResult<TMethod>;
  }
  | {
    readonly ok: false;
    readonly error: DesktopNovelImportErrorV1;
  };

function parseNovelImportIpcResponse<
  TMethod extends DesktopNovelImportMethodName,
>(
  method: TMethod,
  expectedSession: ProjectContext,
  value: unknown,
): ParsedNovelImportResponse<TMethod> {
  if (!isRecord(value))
    throw new TypeError('Novel-import IPC response must be an object.');

  if (value.messageKind === 'result') {
    if (
      !hasExactKeys(value, ['messageKind', 'method', 'result'])
      || value.method !== method
    ) {
      throw new TypeError('Novel-import result envelope is invalid.');
    }
    const result = parseDesktopNovelImportMethodResult(method, value.result);
    assertSameNovelImportSession(expectedSession, result);
    return { ok: true, result };
  }

  if (value.messageKind === 'error') {
    if (!hasExactKeys(value, ['messageKind', 'error']))
      throw new TypeError('Novel-import error envelope is invalid.');
    const error = parseDesktopNovelImportError(value.error);
    if (error.method !== method)
      throw new TypeError('Novel-import error method does not match its request.');
    assertSameNovelImportSession(expectedSession, error);
    return { ok: false, error };
  }

  throw new TypeError('Novel-import IPC response kind is invalid.');
}

function parseNovelImportEventEnvelope(
  expectedType: DesktopNovelImportEventType,
  value: unknown,
): DesktopNovelImportEventV1 {
  if (
    !isRecord(value)
    || !hasExactKeys(value, ['messageKind', 'event'])
    || value.messageKind !== 'event'
  ) {
    throw new TypeError('Novel-import event envelope is invalid.');
  }
  const event = parseDesktopNovelImportEvent(value.event);
  if (event.eventType !== expectedType)
    throw new TypeError('Novel-import event channel does not match its type.');
  return event;
}

function desktopNovelImportIpcChannel(
  name: DesktopNovelImportMethodName | DesktopNovelImportEventType,
): string {
  return `${IPC_CHANNEL_PREFIX}${name}`;
}

function assertActiveNovelImportSession(session: ProjectContext): void {
  if (isActiveNovelImportSession(session))
    return;
  throw createNovelImportBridgeError('PROJECT_SESSION_STALE');
}

function isActiveNovelImportSession(session: ProjectContext): boolean {
  return activeProjectContext?.projectId === session.projectId
    && activeProjectContext.projectSessionId === session.projectSessionId;
}

function assertSameNovelImportSession(
  expected: ProjectContext,
  actual: ProjectContext,
): void {
  if (
    actual.projectId !== expected.projectId
    || actual.projectSessionId !== expected.projectSessionId
  ) {
    throw new TypeError('Novel-import response project session is invalid.');
  }
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

function hasExactKeys(
  value: Record<string, unknown>,
  expectedKeys: readonly string[],
): boolean {
  const actualKeys = Object.keys(value);
  return actualKeys.length === expectedKeys.length
    && expectedKeys.every(key => Object.hasOwn(value, key));
}

function sanitizeErrorMessage(error: DesktopBridgeErrorInput): string {
  if (containsAbsolutePath(error.message))
    return 'The desktop request could not be completed.';
  return error.message;
}

function containsAbsolutePath(value: string): boolean {
  return /(?:^|[\s"'(])\/\S*|[A-Z]:[\\/]/i.test(value);
}
