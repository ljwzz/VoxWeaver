import type {
  DesktopError,
  DesktopMethodName,
  DesktopNovelImportErrorCode,
  DesktopNovelImportErrorV1,
  DesktopNovelImportMethodName,
  DesktopNovelImportMethodPayload,
  DesktopNovelImportMethodResult,
  DesktopRequest,
  DesktopResponse,
  DirectorySelectionPurpose,
  SelectDirectoryPayload,
} from '@voxweaver/contracts';

import type {
  IssuedNovelSourceSelection,
  NovelSourceSelectionLease,
  NovelSourceSelectionUseOutcome,
  TrustedNovelSourceSelection,
} from './novelSourceSelectionTokenRegistry.js';
import type {
  IssuedDirectorySelection,
  SelectionTokenUseOutcome,
  TrustedDirectorySelection,
} from './selectionTokenRegistry.js';

import { basename, isAbsolute } from 'node:path';

import {
  DESKTOP_METHOD_NAMES,
  DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
  DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY,
  DESKTOP_NOVEL_IMPORT_METHOD_NAMES,
  DESKTOP_PROTOCOL_VERSION,
  DesktopMessageValidationError,
  DesktopMethodValidationError,
  parseDesktopMethodPayload,
  parseDesktopMethodResult,
  parseDesktopNovelImportError,
  parseDesktopNovelImportMethodPayload,
  parseDesktopNovelImportMethodResult,
  parseDesktopRequest,
  parseDesktopResponse,
} from '@voxweaver/contracts';

import { NovelSourceSelectionTokenRegistry } from './novelSourceSelectionTokenRegistry.js';
import { SelectionTokenRegistry } from './selectionTokenRegistry.js';

const IPC_CHANNEL_PREFIX = 'voxweaver:';
const INVALID_REQUEST_ID = 'invalid-request';
const INVALID_PROJECT_ID = '00000000-0000-4000-8000-000000000000';
const INVALID_PROJECT_SESSION_ID = '00000000-0000-4000-8000-000000000001';
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

const CONFIRMATION_RETRY_CODES = new Set([
  'PROJECT_MIGRATION_CONFIRMATION_REQUIRED',
  'PROJECT_WRITE_LOCK_RECOVERY_REQUIRED',
]);

const PUBLIC_RETRYABLE_CODES = new Set([
  ...CONFIRMATION_RETRY_CODES,
  'DESKTOP_CORE_TIMEOUT',
  'DESKTOP_CORE_UNAVAILABLE',
]);

export interface DesktopCoreClient {
  /**
   * The first argument is Renderer-safe. The second is Main/Core-only and
   * carries the selected absolute directory when a token was reserved.
   */
  readonly dispatch: (
    request: DesktopRequest,
    trustedContext?: DesktopTrustedRequestContext,
  ) => Promise<unknown>;
  /**
   * M1-15A uses an independent, versioned envelope. The selected source path
   * is supplied only in the second, Main/Core-private argument.
   */
  readonly dispatchNovelImport?: (
    request: DesktopNovelImportPayloadEnvelope,
    trustedContext?: DesktopNovelImportTrustedRequestContext,
  ) => Promise<unknown>;
}

/** Private context that must never cross Main -> Preload -> Renderer. */
export interface DesktopTrustedRequestContext {
  readonly projectDirectory?: string;
  readonly selectionPurpose?: DirectorySelectionPurpose;
  readonly selectionToken?: string;
}

/** Private source capability that must never cross Core/Main -> Renderer. */
export interface DesktopNovelImportTrustedRequestContext {
  readonly originalName: string;
  readonly selectionToken: string;
  readonly sourceFilePath: string;
}

export interface DesktopNovelImportPayloadEnvelope<
  TMethod extends DesktopNovelImportMethodName = DesktopNovelImportMethodName,
> {
  readonly messageKind: 'payload';
  readonly method: TMethod;
  readonly payload: DesktopNovelImportMethodPayload<TMethod>;
}

export interface DesktopNovelImportResultEnvelope<
  TMethod extends DesktopNovelImportMethodName = DesktopNovelImportMethodName,
> {
  readonly messageKind: 'result';
  readonly method: TMethod;
  readonly result: DesktopNovelImportMethodResult<TMethod>;
}

export interface DesktopNovelImportErrorEnvelope {
  readonly messageKind: 'error';
  readonly error: DesktopNovelImportErrorV1;
}

export type DesktopNovelImportIpcResponse
  = | DesktopNovelImportErrorEnvelope
    | DesktopNovelImportResultEnvelope;

export interface DirectoryPicker {
  /** Return undefined on cancellation. Keep the absolute path private. */
  readonly selectDirectory: (input: {
    readonly purpose: DirectorySelectionPurpose;
    readonly windowId: number;
  }) => Promise<SelectedDirectory | undefined>;
}

export interface SelectedDirectory {
  readonly displayName: string;
  readonly projectDirectory: string;
}

export interface NovelSourceFilePicker {
  /** Return undefined on cancellation. Keep the absolute path private. */
  readonly selectSourceFile: (input: {
    readonly projectId: string;
    readonly projectSessionId: string;
    readonly windowId: number;
  }) => Promise<SelectedNovelSourceFile | undefined>;
}

export interface SelectedNovelSourceFile {
  readonly displayName: string;
  readonly sourceFilePath: string;
}

export interface DesktopMainControllerOptions {
  readonly coreClient: DesktopCoreClient;
  readonly directoryPicker: DirectoryPicker;
  readonly novelImportEventSessions?: NovelImportEventSessionRegistry;
  readonly novelSourceFilePicker?: NovelSourceFilePicker;
  readonly novelSourceSelections?: NovelSourceSelectionTokenRegistry;
  readonly selectionTokens?: SelectionTokenRegistry;
  /**
   * Main should pass BrowserWindow.fromWebContents(event.sender)?.id here.
   * The conservative default only supports tests and direct webContents IDs.
   */
  readonly windowIdFromIpcEvent?: (event: unknown) => number | undefined;
}

export interface NovelImportEventSessionRegistry {
  readonly bindWindowSession: (
    windowId: number,
    session: {
      readonly projectId: string;
      readonly projectSessionId: string;
    },
  ) => void;
  readonly clearWindowSession: (windowId: number) => void;
  readonly suspendWindow: (windowId: number) => () => void;
}

export interface IpcMainLike {
  readonly handle: (
    channel: string,
    listener: (event: unknown, request: unknown) => Promise<DesktopResponse>,
  ) => void;
}

export interface NovelImportIpcMainLike {
  readonly handle: (
    channel: string,
    listener: (
      event: unknown,
      request: unknown,
    ) => Promise<DesktopNovelImportIpcResponse>,
  ) => void;
}

/**
 * Validates Renderer requests, owns directory-selection capabilities, and
 * prevents absolute paths from entering a public desktop envelope.
 */
export class DesktopMainController {
  readonly #coreClient: DesktopCoreClient;
  readonly #directoryPicker: DirectoryPicker;
  readonly #novelImportEventSessions: NovelImportEventSessionRegistry | undefined;
  readonly #novelSourceFilePicker: NovelSourceFilePicker | undefined;
  readonly #novelSourceSelections: NovelSourceSelectionTokenRegistry;
  readonly #selectionTokens: SelectionTokenRegistry;
  readonly #windowIdFromIpcEvent: (event: unknown) => number | undefined;

  constructor(options: DesktopMainControllerOptions) {
    this.#coreClient = options.coreClient;
    this.#directoryPicker = options.directoryPicker;
    this.#novelImportEventSessions = options.novelImportEventSessions;
    this.#novelSourceFilePicker = options.novelSourceFilePicker;
    this.#novelSourceSelections = options.novelSourceSelections
      ?? new NovelSourceSelectionTokenRegistry();
    this.#selectionTokens = options.selectionTokens ?? new SelectionTokenRegistry();
    this.#windowIdFromIpcEvent = options.windowIdFromIpcEvent ?? readWebContentsId;
  }

  /** Registers one narrow IPC handler per published desktop method. */
  registerIpcHandlers(ipcMain: IpcMainLike): void {
    for (const method of Object.values(DESKTOP_METHOD_NAMES)) {
      ipcMain.handle(
        desktopIpcChannel(method),
        async (event, input) => {
          const windowId = this.#windowIdFromIpcEvent(event);
          if (!isWindowId(windowId)) {
            return this.#failure(
              readRequestId(input),
              'DESKTOP_PAYLOAD_INVALID',
              false,
            );
          }

          return this.#dispatchForChannel(windowId, method, input);
        },
      );
    }
  }

  /** Registers the independent M1-15A method channels. */
  registerNovelImportIpcHandlers(ipcMain: NovelImportIpcMainLike): void {
    for (const method of Object.values(DESKTOP_NOVEL_IMPORT_METHOD_NAMES)) {
      ipcMain.handle(
        desktopNovelImportIpcChannel(method),
        async (event, input) => {
          const windowId = this.#windowIdFromIpcEvent(event);
          if (!isWindowId(windowId)) {
            return this.#novelImportFailure(
              method,
              readNovelImportSession(input),
              'DESKTOP_PAYLOAD_INVALID',
            );
          }
          return this.#dispatchNovelImportForChannel(windowId, method, input);
        },
      );
    }
  }

  /**
   * Direct seam for Main tests and for IPC adapters that already resolved a
   * BrowserWindow. The input remains an untrusted Renderer envelope.
   */
  async dispatch(windowId: number, input: unknown): Promise<DesktopResponse> {
    if (!isWindowId(windowId)) {
      return this.#failure(
        readRequestId(input),
        'DESKTOP_PAYLOAD_INVALID',
        false,
      );
    }

    return this.#dispatchForChannel(windowId, undefined, input);
  }

  /** Direct Main test seam for one M1-15A payload envelope. */
  async dispatchNovelImport(
    windowId: number,
    method: DesktopNovelImportMethodName,
    input: unknown,
  ): Promise<DesktopNovelImportIpcResponse> {
    if (!isWindowId(windowId)) {
      return this.#novelImportFailure(
        method,
        readNovelImportSession(input),
        'DESKTOP_PAYLOAD_INVALID',
      );
    }
    return this.#dispatchNovelImportForChannel(windowId, method, input);
  }

  /** Call this from BrowserWindow's `closed` event. */
  handleWindowClosed(windowId: number): void {
    if (isWindowId(windowId)) {
      this.#selectionTokens.invalidateWindow(windowId);
      this.#novelSourceSelections.invalidateWindow(windowId);
      safelyObserve(() => this.#novelImportEventSessions?.clearWindowSession(windowId));
    }
  }

  async #dispatchNovelImportForChannel(
    windowId: number,
    method: DesktopNovelImportMethodName,
    input: unknown,
  ): Promise<DesktopNovelImportIpcResponse> {
    let request: DesktopNovelImportPayloadEnvelope;
    try {
      request = parseNovelImportPayloadEnvelope(method, input);
    } catch (error) {
      return this.#novelImportFailure(
        method,
        readNovelImportSession(input),
        novelImportInputErrorCode(error),
      );
    }

    if (method === DESKTOP_NOVEL_IMPORT_METHOD_NAMES.SELECT_SOURCE) {
      return this.#selectNovelSource(windowId, request);
    }

    let reservation: NovelSourceSelectionLease | undefined;
    if (method === DESKTOP_NOVEL_IMPORT_METHOD_NAMES.START) {
      reservation = this.#reserveNovelSource(windowId, request);
      if (!reservation) {
        return this.#novelImportFailure(
          method,
          request.payload,
          'DESKTOP_SELECTION_INVALID',
        );
      }
    }

    const trustedContext = reservation
      ? toNovelImportTrustedContext(reservation.selection)
      : undefined;
    let selectionOutcome: NovelSourceSelectionUseOutcome = 'failed';
    try {
      const response = await this.#dispatchNovelImportCore(request, trustedContext);
      selectionOutcome = novelSourceSelectionOutcome(response);
      return response;
    } catch {
      return this.#novelImportFailure(
        method,
        request.payload,
        'DESKTOP_CORE_UNAVAILABLE',
      );
    } finally {
      if (reservation)
        this.#novelSourceSelections.settle(reservation, selectionOutcome);
    }
  }

  async #selectNovelSource(
    windowId: number,
    request: DesktopNovelImportPayloadEnvelope,
  ): Promise<DesktopNovelImportIpcResponse> {
    const picker = this.#novelSourceFilePicker;
    if (!picker) {
      return this.#novelImportFailure(
        request.method,
        request.payload,
        'DESKTOP_CORE_UNAVAILABLE',
      );
    }

    let selected: SelectedNovelSourceFile | undefined;
    try {
      selected = await picker.selectSourceFile({
        projectId: request.payload.projectId,
        projectSessionId: request.payload.projectSessionId,
        windowId,
      });
    } catch {
      return this.#novelImportFailure(
        request.method,
        request.payload,
        'DESKTOP_CORE_UNAVAILABLE',
      );
    }

    if (!selected) {
      return this.#novelImportSuccess(request.method, {
        contractVersion: DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
        projectId: request.payload.projectId,
        projectSessionId: request.payload.projectSessionId,
        canceled: true,
      });
    }

    let issued: IssuedNovelSourceSelection | undefined;
    try {
      assertSelectedNovelSource(selected);
      issued = this.#novelSourceSelections.issue({
        displayName: selected.displayName,
        projectId: request.payload.projectId,
        projectSessionId: request.payload.projectSessionId,
        sourceFilePath: selected.sourceFilePath,
        windowId,
      });
      return this.#novelImportSuccess(request.method, {
        contractVersion: DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
        projectId: request.payload.projectId,
        projectSessionId: request.payload.projectSessionId,
        canceled: false,
        displayName: selected.displayName,
        expiresAt: issued.expiresAt,
        selectionToken: issued.selectionToken,
      });
    } catch {
      if (issued)
        this.#novelSourceSelections.invalidate(issued.selectionToken);
      return this.#novelImportFailure(
        request.method,
        request.payload,
        'DESKTOP_SELECTION_INVALID',
      );
    }
  }

  #reserveNovelSource(
    windowId: number,
    request: DesktopNovelImportPayloadEnvelope,
  ): NovelSourceSelectionLease | undefined {
    const selectionToken = Reflect.get(request.payload, 'selectionToken');
    if (typeof selectionToken !== 'string')
      return undefined;
    return this.#novelSourceSelections.reserve({
      projectId: request.payload.projectId,
      projectSessionId: request.payload.projectSessionId,
      selectionToken,
      windowId,
    });
  }

  async #dispatchNovelImportCore(
    request: DesktopNovelImportPayloadEnvelope,
    trustedContext: DesktopNovelImportTrustedRequestContext | undefined,
  ): Promise<DesktopNovelImportIpcResponse> {
    if (!this.#coreClient.dispatchNovelImport)
      throw new Error('The Core novel import route is unavailable.');

    const rawResponse = await this.#coreClient.dispatchNovelImport(
      request,
      trustedContext,
    );
    if (!isRecord(rawResponse))
      throw new Error('Core returned an invalid novel import response.');

    if (rawResponse.messageKind === 'result') {
      if (!hasExactKeys(rawResponse, ['messageKind', 'method', 'result']))
        throw new Error('Core returned an invalid novel import result envelope.');
      if (rawResponse.method !== request.method)
        throw new Error('Core returned a result for another novel import method.');
      const result = parseDesktopNovelImportMethodResult(
        request.method,
        rawResponse.result,
      );
      assertSameNovelImportSession(request.payload, result);
      return {
        messageKind: 'result',
        method: request.method,
        result,
      } as DesktopNovelImportResultEnvelope;
    }

    if (rawResponse.messageKind === 'error') {
      if (!hasExactKeys(rawResponse, ['messageKind', 'error']))
        throw new Error('Core returned an invalid novel import error envelope.');
      const error = parseDesktopNovelImportError(rawResponse.error);
      assertSameNovelImportSession(request.payload, error);
      if (error.method && error.method !== request.method)
        throw new Error('Core returned an error for another novel import method.');
      return {
        messageKind: 'error',
        error: sanitizeNovelImportError(request.method, error),
      };
    }

    throw new Error('Core returned an unknown novel import message kind.');
  }

  #novelImportSuccess(
    method: DesktopNovelImportMethodName,
    result: unknown,
  ): DesktopNovelImportResultEnvelope {
    return {
      messageKind: 'result',
      method,
      result: parseDesktopNovelImportMethodResult(method, result),
    } as DesktopNovelImportResultEnvelope;
  }

  #novelImportFailure(
    method: DesktopNovelImportMethodName,
    session: NovelImportSession,
    code: DesktopNovelImportErrorCode,
  ): DesktopNovelImportErrorEnvelope {
    return {
      messageKind: 'error',
      error: parseDesktopNovelImportError({
        code,
        contractVersion: DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
        message: 'The novel import request could not be completed.',
        method,
        projectId: session.projectId,
        projectSessionId: session.projectSessionId,
        retryable: DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY[code],
      }),
    };
  }

  async #dispatchForChannel(
    windowId: number,
    expectedMethod: DesktopMethodName | undefined,
    input: unknown,
  ): Promise<DesktopResponse> {
    let request: DesktopRequest;
    try {
      request = parseDesktopRequest(input);
      if (expectedMethod && request.method !== expectedMethod) {
        throw new DesktopMethodValidationError(
          'DESKTOP_METHOD_PAYLOAD_INVALID',
          'The IPC channel does not match the desktop method.',
        );
      }

      const payload = parseDesktopMethodPayload(request.method, request.payload);
      assertPathFreeValue(payload);
      if (request.projectContext)
        assertPathFreeValue(request.projectContext);

      // Construct a new envelope instead of forwarding caller-owned fields.
      request = parseDesktopRequest({
        ...(request.projectContext ? { projectContext: request.projectContext } : {}),
        method: request.method,
        payload,
        protocolVersion: DESKTOP_PROTOCOL_VERSION,
        requestId: request.requestId,
      });
    } catch (error) {
      return this.#failure(
        readRequestId(input),
        desktopInputErrorCode(error),
        false,
      );
    }

    if (request.method === DESKTOP_METHOD_NAMES.DIALOG_SELECT_DIRECTORY) {
      return this.#selectDirectory(
        windowId,
        request,
        request.payload as SelectDirectoryPayload,
      );
    }

    const reservation = this.#reserveSelection(windowId, request);
    if (reservation === 'invalid') {
      return this.#failure(
        request.requestId,
        'DESKTOP_SELECTION_INVALID',
        false,
      );
    }

    const trustedContext = reservation
      ? toTrustedRequestContext(reservation.selection)
      : undefined;
    const restoreEventSession = shouldSuspendEventSession(request.method)
      ? safelySuspend(this.#novelImportEventSessions, windowId)
      : undefined;

    let response: DesktopResponse;
    let outcome: SelectionTokenUseOutcome = 'failed';
    try {
      response = await this.#dispatchCore(request, trustedContext);
      outcome = selectionOutcome(response);
    } catch (error) {
      response = this.#failure(
        request.requestId,
        desktopCoreFailureCode(error),
        true,
      );
    } finally {
      if (reservation)
        this.#selectionTokens.settle(reservation, outcome);
    }

    this.#settleEventSession(
      windowId,
      request.method as DesktopMethodName,
      response,
      restoreEventSession,
    );
    return response;
  }

  #settleEventSession(
    windowId: number,
    method: DesktopMethodName,
    response: DesktopResponse,
    restoreEventSession: (() => void) | undefined,
  ): void {
    if (!response.ok) {
      if (
        method === DESKTOP_METHOD_NAMES.PROJECT_SWITCH
        && response.error.code === 'PROJECT_SWITCH_OPEN_FAILED'
      ) {
        safelyObserve(() => this.#novelImportEventSessions?.clearWindowSession(windowId));
      } else {
        safelyObserve(restoreEventSession);
      }
      return;
    }
    if (method === DESKTOP_METHOD_NAMES.PROJECT_CLOSE) {
      safelyObserve(() => this.#novelImportEventSessions?.clearWindowSession(windowId));
      return;
    }
    if (
      method !== DESKTOP_METHOD_NAMES.PROJECT_CREATE
      && method !== DESKTOP_METHOD_NAMES.PROJECT_OPEN
      && method !== DESKTOP_METHOD_NAMES.PROJECT_SWITCH
    ) {
      safelyObserve(restoreEventSession);
      return;
    }
    const session = readProjectSessionResult(response.result);
    if (!session) {
      safelyObserve(restoreEventSession);
      return;
    }
    safelyObserve(() => this.#novelImportEventSessions?.bindWindowSession(
      windowId,
      session,
    ));
  }

  async #selectDirectory(
    windowId: number,
    request: DesktopRequest,
    payload: SelectDirectoryPayload,
  ): Promise<DesktopResponse> {
    let issued: IssuedDirectorySelection | undefined;
    try {
      const selected = await this.#directoryPicker.selectDirectory({
        purpose: payload.purpose,
        windowId,
      });

      if (!selected) {
        return this.#success(
          request.requestId,
          request.method as DesktopMethodName,
          { canceled: true },
        );
      }

      assertSelectedDirectory(selected);
      issued = this.#selectionTokens.issue({
        projectDirectory: selected.projectDirectory,
        purpose: payload.purpose,
        windowId,
      });
      return this.#success(
        request.requestId,
        request.method as DesktopMethodName,
        toDirectorySelectionResult(selected, issued),
      );
    } catch {
      if (issued)
        this.#selectionTokens.invalidate(issued.selectionToken);
      return this.#failure(
        request.requestId,
        'DESKTOP_CORE_UNAVAILABLE',
        true,
      );
    }
  }

  #reserveSelection(
    windowId: number,
    request: DesktopRequest,
  ) {
    const selection = readSelectionRequest(request);
    if (!selection)
      return undefined;

    return this.#selectionTokens.reserve({
      purpose: selection.purpose,
      selectionToken: selection.selectionToken,
      windowId,
    }) ?? 'invalid';
  }

  async #dispatchCore(
    request: DesktopRequest,
    trustedContext: DesktopTrustedRequestContext | undefined,
  ): Promise<DesktopResponse> {
    const rawResponse = await this.#coreClient.dispatch(request, trustedContext);
    const parsedResponse = parseDesktopResponse(rawResponse);
    if (parsedResponse.requestId !== request.requestId) {
      throw new DesktopMessageValidationError(
        'Core returned a response for another desktop request.',
      );
    }

    if (!parsedResponse.ok)
      return this.#sanitizedCoreFailure(request.requestId, parsedResponse.error);

    const result = parseDesktopMethodResult(request.method, parsedResponse.result);
    assertPathFreeValue(result);
    return this.#success(request.requestId, request.method as DesktopMethodName, result);
  }

  #success(
    requestId: string,
    method: DesktopMethodName,
    result: unknown,
  ): DesktopResponse {
    const parsedResult = parseDesktopMethodResult(method, result);
    assertPathFreeValue(parsedResult);
    return parseDesktopResponse({
      ok: true,
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId,
      result: parsedResult,
    });
  }

  #sanitizedCoreFailure(
    requestId: string,
    error: DesktopError,
  ): DesktopResponse {
    const code = isSafeErrorCode(error.code)
      ? error.code
      : 'DESKTOP_CORE_UNAVAILABLE';
    return this.#failure(
      requestId,
      code,
      PUBLIC_RETRYABLE_CODES.has(code),
    );
  }

  #failure(
    requestId: string,
    code: string,
    retryable: boolean,
  ): DesktopResponse {
    return parseDesktopResponse({
      error: {
        code,
        message: publicErrorMessage(code),
        retryable,
      },
      ok: false,
      protocolVersion: DESKTOP_PROTOCOL_VERSION,
      requestId,
    });
  }
}

export function desktopIpcChannel(method: DesktopMethodName): string {
  return `${IPC_CHANNEL_PREFIX}${method}`;
}

export function desktopNovelImportIpcChannel(
  method: DesktopNovelImportMethodName,
): string {
  return `${IPC_CHANNEL_PREFIX}${method}`;
}

interface NovelImportSession {
  readonly projectId: string;
  readonly projectSessionId: string;
}

function parseNovelImportPayloadEnvelope(
  expectedMethod: DesktopNovelImportMethodName,
  input: unknown,
): DesktopNovelImportPayloadEnvelope {
  if (
    !isRecord(input)
    || !hasExactKeys(input, ['messageKind', 'method', 'payload'])
    || input.messageKind !== 'payload'
    || input.method !== expectedMethod
  ) {
    throw new Error('The novel import payload envelope is invalid.');
  }

  return {
    messageKind: 'payload',
    method: expectedMethod,
    payload: parseDesktopNovelImportMethodPayload(
      expectedMethod,
      input.payload,
    ),
  } as DesktopNovelImportPayloadEnvelope;
}

function novelImportInputErrorCode(
  error: unknown,
): DesktopNovelImportErrorCode {
  return isRecord(error)
    && Reflect.get(error, 'code') === 'DESKTOP_NOVEL_IMPORT_VERSION_UNSUPPORTED'
    ? 'DESKTOP_PROTOCOL_UNSUPPORTED'
    : 'DESKTOP_PAYLOAD_INVALID';
}

function readNovelImportSession(input: unknown): NovelImportSession {
  const payload = isRecord(input) && isRecord(input.payload)
    ? input.payload
    : input;
  if (!isRecord(payload)) {
    return {
      projectId: INVALID_PROJECT_ID,
      projectSessionId: INVALID_PROJECT_SESSION_ID,
    };
  }

  return {
    projectId: isUuidV4(payload.projectId)
      ? payload.projectId
      : INVALID_PROJECT_ID,
    projectSessionId: isUuidV4(payload.projectSessionId)
      ? payload.projectSessionId
      : INVALID_PROJECT_SESSION_ID,
  };
}

function toNovelImportTrustedContext(
  selection: TrustedNovelSourceSelection,
): DesktopNovelImportTrustedRequestContext {
  return {
    originalName: selection.displayName,
    selectionToken: selection.selectionToken,
    sourceFilePath: selection.sourceFilePath,
  };
}

function assertSelectedNovelSource(value: SelectedNovelSourceFile): void {
  if (
    value.displayName.length === 0
    || !isAbsolute(value.sourceFilePath)
    || basename(value.sourceFilePath) !== value.displayName
  ) {
    throw new Error('The source picker returned an invalid file selection.');
  }
}

function assertSameNovelImportSession(
  expected: NovelImportSession,
  actual: NovelImportSession,
): void {
  if (
    actual.projectId !== expected.projectId
    || actual.projectSessionId !== expected.projectSessionId
  ) {
    throw new Error('Core returned a novel import response for another project session.');
  }
}

function sanitizeNovelImportError(
  method: DesktopNovelImportMethodName,
  error: DesktopNovelImportErrorV1,
): DesktopNovelImportErrorV1 {
  return parseDesktopNovelImportError({
    code: error.code,
    contractVersion: DESKTOP_NOVEL_IMPORT_CONTRACT_VERSION,
    ...(error.currentArtifactRevisionId
      ? { currentArtifactRevisionId: error.currentArtifactRevisionId }
      : {}),
    message: 'The novel import request could not be completed.',
    method,
    ...(error.operationId ? { operationId: error.operationId } : {}),
    projectId: error.projectId,
    projectSessionId: error.projectSessionId,
    retryable: DESKTOP_NOVEL_IMPORT_ERROR_RETRYABILITY[error.code],
    ...(error.taskId ? { taskId: error.taskId } : {}),
  });
}

function novelSourceSelectionOutcome(
  response: DesktopNovelImportIpcResponse,
): NovelSourceSelectionUseOutcome {
  return response.messageKind === 'error'
    && response.error.code === 'NOVEL_IMPORT_ENCODING_REQUIRED'
    ? 'encoding-required'
    : response.messageKind === 'result'
      ? 'completed'
      : 'failed';
}

function hasExactKeys(
  value: Record<string, unknown>,
  expected: readonly string[],
): boolean {
  const keys = Object.keys(value);
  return keys.length === expected.length
    && expected.every(key => Object.hasOwn(value, key));
}

function isUuidV4(value: unknown): value is string {
  return typeof value === 'string' && UUID_V4_PATTERN.test(value);
}

function readSelectionRequest(request: DesktopRequest): {
  readonly purpose: DirectorySelectionPurpose;
  readonly selectionToken: string;
} | undefined {
  switch (request.method) {
    case DESKTOP_METHOD_NAMES.PROJECT_CREATE:
      return {
        purpose: 'create-project-parent',
        selectionToken: readRequiredSelectionToken(request.payload),
      };
    case DESKTOP_METHOD_NAMES.PROJECT_OPEN:
      return readOptionalSelectionToken(request.payload, 'open-project');
    case DESKTOP_METHOD_NAMES.PROJECT_SWITCH:
      return readOptionalSelectionToken(request.payload, 'switch-project');
    default:
      return undefined;
  }
}

function readRequiredSelectionToken(payload: unknown): string {
  if (!isRecord(payload) || typeof payload.selectionToken !== 'string')
    throw new Error('A directory selection token is required.');
  return payload.selectionToken;
}

function readOptionalSelectionToken(
  payload: unknown,
  purpose: DirectorySelectionPurpose,
): { readonly purpose: DirectorySelectionPurpose; readonly selectionToken: string } | undefined {
  if (!isRecord(payload) || typeof payload.selectionToken !== 'string')
    return undefined;
  return { purpose, selectionToken: payload.selectionToken };
}

function toTrustedRequestContext(
  selection: TrustedDirectorySelection,
): DesktopTrustedRequestContext {
  return {
    projectDirectory: selection.projectDirectory,
    selectionPurpose: selection.selectionPurpose,
    selectionToken: selection.selectionToken,
  };
}

function toDirectorySelectionResult(
  selected: SelectedDirectory,
  issued: IssuedDirectorySelection,
) {
  return {
    canceled: false,
    displayName: selected.displayName,
    expiresAt: issued.expiresAt,
    selectionToken: issued.selectionToken,
  } as const;
}

function selectionOutcome(response: DesktopResponse): SelectionTokenUseOutcome {
  if (response.ok)
    return 'completed';
  return CONFIRMATION_RETRY_CODES.has(response.error.code)
    ? 'confirmation-required'
    : 'failed';
}

function desktopInputErrorCode(error: unknown): string {
  if (
    error instanceof DesktopMethodValidationError
    && error.code === 'DESKTOP_METHOD_NOT_FOUND'
  ) {
    return 'DESKTOP_METHOD_NOT_FOUND';
  }
  return 'DESKTOP_PAYLOAD_INVALID';
}

function shouldSuspendEventSession(method: string): boolean {
  return method === DESKTOP_METHOD_NAMES.PROJECT_CLOSE
    || method === DESKTOP_METHOD_NAMES.PROJECT_SWITCH;
}

function safelySuspend(
  registry: NovelImportEventSessionRegistry | undefined,
  windowId: number,
): (() => void) | undefined {
  try {
    return registry?.suspendWindow(windowId);
  } catch {
    return undefined;
  }
}

function safelyObserve(observer: (() => unknown) | undefined): void {
  try {
    observer?.();
  } catch {
    // Event-session bookkeeping is auxiliary to the validated Core response.
  }
}

function readProjectSessionResult(value: unknown): {
  readonly projectId: string;
  readonly projectSessionId: string;
} | undefined {
  if (!isRecord(value))
    return undefined;
  const projectId = value.projectId;
  const projectSessionId = value.projectSessionId;
  if (
    typeof projectId !== 'string'
    || !UUID_V4_PATTERN.test(projectId)
    || typeof projectSessionId !== 'string'
    || !UUID_V4_PATTERN.test(projectSessionId)
  ) {
    return undefined;
  }
  return { projectId, projectSessionId };
}

function desktopCoreFailureCode(error: unknown): string {
  return isRecord(error) && error.code === 'DESKTOP_CORE_TIMEOUT'
    ? 'DESKTOP_CORE_TIMEOUT'
    : 'DESKTOP_CORE_UNAVAILABLE';
}

function publicErrorMessage(code: string): string {
  switch (code) {
    case 'DESKTOP_METHOD_NOT_FOUND':
      return 'The requested desktop method is not available.';
    case 'DESKTOP_SELECTION_INVALID':
      return 'The selected directory cannot be used for this operation.';
    case 'DESKTOP_CORE_UNAVAILABLE':
      return 'The application core is currently unavailable.';
    case 'DESKTOP_CORE_TIMEOUT':
      return 'The application core did not respond before the request timed out.';
    case 'PROJECT_MIGRATION_CONFIRMATION_REQUIRED':
      return 'Project migration confirmation is required before opening this project.';
    case 'PROJECT_WRITE_LOCK_RECOVERY_REQUIRED':
      return 'Write-lock recovery confirmation is required before opening this project.';
    case 'PROJECT_WRITE_LOCKED':
      return 'This project is currently locked by another active session.';
    case 'PROJECT_MIGRATION_REQUIRED':
      return 'This project must be migrated before it can be opened.';
    default:
      return code.startsWith('PROJECT_')
        ? 'The project request could not be completed.'
        : 'The desktop request payload is invalid.';
  }
}

function assertSelectedDirectory(value: SelectedDirectory): void {
  if (value.displayName.length === 0 || value.projectDirectory.length === 0)
    throw new Error('The directory picker returned an invalid selection.');
}

/**
 * Renderers cannot supply a filesystem path in an extension field either. The
 * public desktop protocol carries identifiers and display values only.
 */
function assertPathFreeValue(value: unknown): void {
  if (containsFilesystemPath(value))
    throw new Error('Desktop public messages must not contain filesystem paths.');
}

function containsFilesystemPath(value: unknown): boolean {
  if (typeof value === 'string')
    return looksLikeFilesystemPath(value);
  if (!isRecord(value) && !Array.isArray(value))
    return false;

  if (Array.isArray(value))
    return value.some(item => containsFilesystemPath(item));

  return Object.entries(value).some(([key, item]) => (
    isPathFieldName(key) || containsFilesystemPath(item)
  ));
}

function looksLikeFilesystemPath(value: string): boolean {
  return value.startsWith('/')
    || value.startsWith('\\\\')
    || value.startsWith('~/')
    || value.startsWith('file:')
    || /^[a-z]:[\\/]/i.test(value);
}

function isPathFieldName(value: string): boolean {
  return value === 'absolutePath'
    || value === 'directoryPath'
    || value === 'filePath'
    || value === 'parentDirectory'
    || value === 'path'
    || value === 'projectDirectory';
}

function isSafeErrorCode(value: string): boolean {
  return /^[A-Z][A-Z0-9_]*$/.test(value);
}

function readRequestId(value: unknown): string {
  if (!isRecord(value))
    return INVALID_REQUEST_ID;
  return typeof value.requestId === 'string' && value.requestId.length > 0
    ? value.requestId
    : INVALID_REQUEST_ID;
}

function readWebContentsId(event: unknown): number | undefined {
  if (!isRecord(event) || !isRecord(event.sender))
    return undefined;
  return typeof event.sender.id === 'number' ? event.sender.id : undefined;
}

function isWindowId(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value > 0;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
