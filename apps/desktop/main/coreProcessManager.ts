import type {
  AppErrorCode,
  CoreEventEnvelope,
  CoreResponseEnvelope,
  JsonValue,
} from '@voxweaver/contracts';
import type {
  CoreProcessHandle,
  CoreProcessLauncher,
  CoreProcessRequest,
} from '../shared/coreTransport.ts';

import { randomUUID } from 'node:crypto';
import {
  CORE_METHODS,
  CORE_PROTOCOL_VERSION,
  parseCoreEventEnvelope,
  parseCoreResponseEnvelope,
} from '@voxweaver/contracts';
import {
  createCoreRequestEnvelope,
  isCoreEventCandidate,
  readCoreRequestId,
} from '../shared/coreTransport.ts';

export const CORE_PROCESS_ENTRY_FILENAME = 'core.js';
export const CORE_HEALTH_TIMEOUT_MS = 5_000;
export const CORE_REQUEST_TIMEOUT_MS = 60_000;

export type CoreProcessStatus = 'ready' | 'starting' | 'stopped' | 'unavailable';
export type CoreProcessFailureCode = Extract<
  AppErrorCode,
  'CORE_PROTOCOL_MISMATCH' | 'CORE_TIMEOUT' | 'CORE_UNAVAILABLE'
>;

export interface CoreProcessStatusChange {
  readonly canRestart: boolean;
  readonly status: CoreProcessStatus;
}

export interface CoreProcessManagerOptions {
  readonly appInstanceId: string;
  readonly createRequestId?: () => string;
  readonly healthTimeoutMs?: number;
  readonly launcher: CoreProcessLauncher;
  readonly requestTimeoutMs?: number;
}

export class CoreProcessManagerError extends Error {
  readonly retryable = true;

  constructor(
    readonly code: CoreProcessFailureCode,
    message: string,
  ) {
    super(message);
    this.name = 'CoreProcessManagerError';
  }
}

interface PendingCoreRequest {
  readonly reject: (error: CoreProcessManagerError) => void;
  readonly resolve: (response: CoreResponseEnvelope) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface CoreProcessSession {
  readonly child: CoreProcessHandle;
  readonly onExit: (exitCode: number) => void;
  readonly onMessage: (message: unknown) => void;
  readonly pending: Map<string, PendingCoreRequest>;
}

export class CoreProcessManager {
  readonly #appInstanceId: string;
  readonly #createRequestId: () => string;
  readonly #eventListeners = new Set<(event: CoreEventEnvelope) => void>();
  readonly #healthTimeoutMs: number;
  readonly #launcher: CoreProcessLauncher;
  readonly #requestTimeoutMs: number;
  readonly #statusListeners = new Set<(change: CoreProcessStatusChange) => void>();

  #hasStarted = false;
  #restartUsed = false;
  #session: CoreProcessSession | undefined;
  #startPromise: Promise<void> | undefined;
  #status: CoreProcessStatus = 'stopped';

  constructor(options: CoreProcessManagerOptions) {
    if (!options.appInstanceId)
      throw new TypeError('The Core app instance ID is required.');

    this.#appInstanceId = options.appInstanceId;
    this.#createRequestId = options.createRequestId ?? randomUUID;
    this.#healthTimeoutMs = readTimeout(
      options.healthTimeoutMs,
      CORE_HEALTH_TIMEOUT_MS,
      'health',
    );
    this.#launcher = options.launcher;
    this.#requestTimeoutMs = readTimeout(
      options.requestTimeoutMs,
      CORE_REQUEST_TIMEOUT_MS,
      'request',
    );
  }

  get status(): CoreProcessStatus {
    return this.#status;
  }

  get canRestart(): boolean {
    return this.#hasStarted
      && this.#status === 'unavailable'
      && !this.#restartUsed
      && this.#startPromise === undefined;
  }

  subscribeStatus(listener: (change: CoreProcessStatusChange) => void): () => void {
    this.#statusListeners.add(listener);
    listener(this.#statusChange());
    return () => this.#statusListeners.delete(listener);
  }

  subscribeEvents(listener: (event: CoreEventEnvelope) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.#status === 'ready')
      return;
    if (this.#startPromise)
      return this.#startPromise;
    if (this.#hasStarted) {
      throw unavailableError(
        'The application core is unavailable. Restart it explicitly before retrying.',
      );
    }

    this.#hasStarted = true;
    return this.#beginLaunch();
  }

  async restartOnce(): Promise<void> {
    if (this.#startPromise)
      return this.#startPromise;
    if (!this.#hasStarted || this.#status !== 'unavailable') {
      throw unavailableError('The application core is not available for restart.');
    }
    if (this.#restartUsed) {
      throw unavailableError('The application core restart limit has been reached.');
    }

    this.#restartUsed = true;
    return this.#beginLaunch();
  }

  async request<TResult extends JsonValue = JsonValue>(
    request: CoreProcessRequest,
  ): Promise<CoreResponseEnvelope<TResult>> {
    const session = this.#session;
    if (!session || this.#status !== 'ready')
      throw unavailableError('The application core is unavailable.');

    return this.#requestWithSession(
      session,
      request,
      this.#requestTimeoutMs,
    ) as Promise<CoreResponseEnvelope<TResult>>;
  }

  stop(): void {
    const session = this.#session;
    if (session) {
      this.#closeSession(
        session,
        unavailableError('The application core was stopped.'),
        true,
      );
    }
    this.#setStatus('stopped');
  }

  async #beginLaunch(): Promise<void> {
    const launchPromise = this.#launch();
    this.#startPromise = launchPromise;
    try {
      await launchPromise;
    } finally {
      if (this.#startPromise === launchPromise) {
        this.#startPromise = undefined;
        if (this.#status === 'unavailable')
          this.#emitStatusChange();
      }
    }
  }

  async #launch(): Promise<void> {
    this.#setStatus('starting');

    let child: CoreProcessHandle;
    try {
      child = this.#launcher.fork();
    } catch {
      this.#setStatus('unavailable');
      throw unavailableError('The application core could not be started.');
    }

    let session!: CoreProcessSession;
    const onExit = () => this.#handleCoreFailure(session);
    const onMessage = (message: unknown) => this.#handleMessage(session, message);
    session = {
      child,
      onExit,
      onMessage,
      pending: new Map(),
    };
    child.on('exit', onExit);
    child.on('message', onMessage);
    this.#session = session;

    try {
      const health = await this.#requestWithSession(
        session,
        {
          method: CORE_METHODS.getHealth,
          payload: {},
          trustedContext: {
            appInstanceId: this.#appInstanceId,
            webContentsId: 0,
            windowKind: 'startup',
          },
        },
        this.#healthTimeoutMs,
      );
      if (!isHealthyResponse(health)) {
        throw unavailableError('The application core health check failed.');
      }
      if (this.#session !== session)
        throw unavailableError('The application core is unavailable.');

      this.#setStatus('ready');
    } catch (error) {
      if (this.#session === session) {
        this.#closeSession(
          session,
          unavailableError('The application core is unavailable.'),
          true,
        );
        this.#setStatus('unavailable');
      }
      throw toCoreProcessManagerError(error);
    }
  }

  #handleMessage(session: CoreProcessSession, message: unknown): void {
    if (this.#session !== session)
      return;

    if (isCoreEventCandidate(message)) {
      let event: CoreEventEnvelope;
      try {
        event = parseCoreEventEnvelope(message);
      } catch {
        return;
      }

      for (const listener of this.#eventListeners) {
        try {
          listener(event);
        } catch {
          // A Main-side event consumer cannot interrupt the private Core channel.
        }
      }
      return;
    }

    const requestId = readCoreRequestId(message);
    if (!requestId)
      return;
    const pending = session.pending.get(requestId);
    if (!pending)
      return;

    let response: CoreResponseEnvelope;
    try {
      response = parseCoreResponseEnvelope(message);
    } catch {
      session.pending.delete(requestId);
      clearTimeout(pending.timeout);
      pending.reject(new CoreProcessManagerError(
        'CORE_PROTOCOL_MISMATCH',
        'The application core returned an invalid protocol response.',
      ));
      return;
    }

    session.pending.delete(requestId);
    clearTimeout(pending.timeout);
    pending.resolve(response);
  }

  #handleCoreFailure(session: CoreProcessSession): void {
    if (this.#session !== session)
      return;

    this.#closeSession(
      session,
      unavailableError('The application core is unavailable.'),
      false,
    );
    this.#setStatus('unavailable');
  }

  #closeSession(
    session: CoreProcessSession,
    error: CoreProcessManagerError,
    terminateChild: boolean,
  ): void {
    if (this.#session === session)
      this.#session = undefined;

    session.child.off('exit', session.onExit);
    session.child.off('message', session.onMessage);
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    session.pending.clear();
    if (terminateChild) {
      try {
        session.child.kill();
      } catch {
        // The process can already be gone while its failure is being observed.
      }
    }
  }

  #requestWithSession(
    session: CoreProcessSession,
    request: CoreProcessRequest,
    timeoutMs: number,
  ): Promise<CoreResponseEnvelope> {
    if (this.#session !== session)
      return Promise.reject(unavailableError('The application core is unavailable.'));

    const requestId = this.#createRequestId();
    const envelope = createCoreRequestEnvelope(requestId, request);
    return new Promise<CoreResponseEnvelope>((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pending.delete(requestId);
        reject(new CoreProcessManagerError(
          'CORE_TIMEOUT',
          'The application core did not respond before the request timed out.',
        ));
      }, timeoutMs);
      session.pending.set(requestId, { reject, resolve, timeout });

      try {
        session.child.postMessage(envelope);
      } catch {
        this.#handleCoreFailure(session);
      }
    });
  }

  #setStatus(status: CoreProcessStatus): void {
    if (this.#status === status)
      return;

    this.#status = status;
    this.#emitStatusChange();
  }

  #emitStatusChange(): void {
    const change = this.#statusChange();
    for (const listener of this.#statusListeners) {
      try {
        listener(change);
      } catch {
        // A status observer cannot interrupt Core lifecycle cleanup.
      }
    }
  }

  #statusChange(): CoreProcessStatusChange {
    return {
      canRestart: this.canRestart,
      status: this.#status,
    };
  }
}

function isHealthyResponse(response: CoreResponseEnvelope): boolean {
  if (!response.ok || !isRecord(response.result))
    return false;

  return response.result.status === 'healthy'
    && response.result.protocolVersion === CORE_PROTOCOL_VERSION
    && typeof response.result.canRestart === 'boolean';
}

function readTimeout(value: number | undefined, fallback: number, label: string): number {
  const timeout = value ?? fallback;
  if (!Number.isSafeInteger(timeout) || timeout <= 0)
    throw new TypeError(`The Core ${label} timeout must be a positive integer.`);

  return timeout;
}

function unavailableError(message: string): CoreProcessManagerError {
  return new CoreProcessManagerError('CORE_UNAVAILABLE', message);
}

function toCoreProcessManagerError(error: unknown): CoreProcessManagerError {
  if (error instanceof CoreProcessManagerError)
    return error;

  return unavailableError('The application core is unavailable.');
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
