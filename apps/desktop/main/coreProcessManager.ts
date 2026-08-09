import type { CoreMessagePort, CoreTrustedRequestContext } from '../shared/coreTransport.js';
import { randomUUID } from 'node:crypto';

import {
  DESKTOP_PROTOCOL_VERSION,
  parseDesktopResponse,
} from '@voxweaver/contracts';
import {
  createCoreInitControlMessage,
  createCoreWireRequest,
  isCoreWireEvent,
  isCoreWireResponse,
  subscribeToCorePortClose,
  subscribeToCorePortMessages,
} from '../shared/coreTransport.js';

export const CORE_HEALTH_TIMEOUT_MS = 5_000;
export const CORE_REQUEST_TIMEOUT_MS = 60_000;

export type CoreProcessStatus
  = | 'ready'
    | 'starting'
    | 'stopped'
    | 'unavailable';

export type CoreProcessFailureCode
  = | 'DESKTOP_CORE_TIMEOUT'
    | 'DESKTOP_CORE_UNAVAILABLE';

export interface CoreProcessChild {
  readonly kill: () => boolean;
  readonly off?: (
    event: 'exit',
    listener: (exitCode: number) => void,
  ) => unknown;
  readonly on: (
    event: 'exit',
    listener: (exitCode: number) => void,
  ) => unknown;
  readonly postMessage: (
    message: unknown,
    transfer?: readonly CoreMessagePort[],
  ) => void;
}

export interface CoreMessageChannel {
  readonly port1: CoreMessagePort;
  readonly port2: CoreMessagePort;
}

export interface CoreProcessLauncher {
  readonly createMessageChannel: () => CoreMessageChannel;
  readonly fork: () => CoreProcessChild;
}

export interface CoreProcessStatusChange {
  readonly canRestart: boolean;
  readonly status: CoreProcessStatus;
}

export interface CoreProcessManagerOptions {
  readonly healthTimeoutMs?: number;
  readonly launcher: CoreProcessLauncher;
  readonly requestTimeoutMs?: number;
  readonly userDataDirectory: string;
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
  readonly resolve: (response: unknown) => void;
  readonly timeout: ReturnType<typeof setTimeout>;
}

interface CoreProcessSession {
  readonly child: CoreProcessChild;
  readonly generation: number;
  readonly pending: Map<string, PendingCoreRequest>;
  readonly port: CoreMessagePort;
  readonly releaseChildExit: () => void;
  readonly releasePortClose: () => void;
  readonly releasePortMessages: () => void;
}

/**
 * Owns a private Main-to-Core message channel. The Electron-specific fork and
 * MessageChannelMain construction are injected by Main so this manager remains
 * unit-testable and reusable by other local transports.
 */
export class CoreProcessManager {
  readonly #eventListeners = new Set<(event: unknown) => void>();
  readonly #healthTimeoutMs: number;
  readonly #launcher: CoreProcessLauncher;
  readonly #listeners = new Set<(change: CoreProcessStatusChange) => void>();
  readonly #requestTimeoutMs: number;
  readonly #userDataDirectory: string;

  #generation = 0;
  #hasStarted = false;
  #restartUsed = false;
  #session: CoreProcessSession | undefined;
  #startPromise: Promise<void> | undefined;
  #status: CoreProcessStatus = 'stopped';

  constructor(options: CoreProcessManagerOptions) {
    if (!options.userDataDirectory)
      throw new TypeError('The Core user-data directory is required.');

    this.#healthTimeoutMs = options.healthTimeoutMs ?? CORE_HEALTH_TIMEOUT_MS;
    this.#launcher = options.launcher;
    this.#requestTimeoutMs = options.requestTimeoutMs ?? CORE_REQUEST_TIMEOUT_MS;
    this.#userDataDirectory = options.userDataDirectory;
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

  subscribe(listener: (change: CoreProcessStatusChange) => void): () => void {
    this.#listeners.add(listener);
    listener(this.#statusChange());
    return () => this.#listeners.delete(listener);
  }

  subscribeEvents(listener: (event: unknown) => void): () => void {
    this.#eventListeners.add(listener);
    return () => this.#eventListeners.delete(listener);
  }

  async start(): Promise<void> {
    if (this.#status === 'ready')
      return;
    if (this.#startPromise)
      return this.#startPromise;
    if (this.#hasStarted) {
      throw new CoreProcessManagerError(
        'DESKTOP_CORE_UNAVAILABLE',
        'The application core is unavailable. Restart it explicitly before retrying.',
      );
    }

    this.#hasStarted = true;
    this.#startPromise = this.#launch();
    try {
      await this.#startPromise;
    } finally {
      this.#startPromise = undefined;
    }
  }

  async restartOnce(): Promise<void> {
    if (!this.#hasStarted) {
      await this.start();
      return;
    }
    if (this.#restartUsed) {
      throw new CoreProcessManagerError(
        'DESKTOP_CORE_UNAVAILABLE',
        'The application core restart limit has been reached.',
      );
    }
    if (this.#status !== 'unavailable') {
      throw new CoreProcessManagerError(
        'DESKTOP_CORE_UNAVAILABLE',
        'The application core is not available for restart.',
      );
    }

    this.#restartUsed = true;
    this.#startPromise = this.#launch();
    try {
      await this.#startPromise;
    } finally {
      this.#startPromise = undefined;
    }
  }

  async request(
    request: unknown,
    trustedContext?: CoreTrustedRequestContext,
  ): Promise<unknown> {
    const session = this.#session;
    if (!session || this.#status !== 'ready') {
      throw new CoreProcessManagerError(
        'DESKTOP_CORE_UNAVAILABLE',
        'The application core is unavailable.',
      );
    }

    return this.#requestWithSession(
      session,
      request,
      trustedContext,
      this.#requestTimeoutMs,
    );
  }

  stop(): void {
    const session = this.#session;
    if (session) {
      this.#closeSession(
        session,
        new CoreProcessManagerError(
          'DESKTOP_CORE_UNAVAILABLE',
          'The application core was stopped.',
        ),
        true,
      );
    }
    this.#setStatus('stopped');
  }

  async #launch(): Promise<void> {
    const channel = this.#launcher.createMessageChannel();
    const child = this.#launcher.fork();
    const generation = ++this.#generation;
    const pending = new Map<string, PendingCoreRequest>();
    let session!: CoreProcessSession;

    const releasePortMessages = subscribeToCorePortMessages(
      channel.port1,
      message => this.#handlePortMessage(session, message),
    );
    const releasePortClose = subscribeToCorePortClose(
      channel.port1,
      () => this.#handleCoreFailure(session),
    );
    const onExit = () => this.#handleCoreFailure(session);
    child.on('exit', onExit);
    const releaseChildExit = () => child.off?.('exit', onExit);
    session = {
      child,
      generation,
      pending,
      port: channel.port1,
      releaseChildExit,
      releasePortClose,
      releasePortMessages,
    };

    this.#session = session;
    this.#setStatus('starting');

    try {
      child.postMessage(
        createCoreInitControlMessage(this.#userDataDirectory),
        [channel.port2],
      );
      const healthRequest = createHealthRequest();
      const health = await this.#requestWithSession(
        session,
        healthRequest,
        undefined,
        this.#healthTimeoutMs,
      );
      if (!isHealthyResponse(health, healthRequest.requestId)) {
        throw new CoreProcessManagerError(
          'DESKTOP_CORE_UNAVAILABLE',
          'The application core health check failed.',
        );
      }
      if (this.#session !== session) {
        throw new CoreProcessManagerError(
          'DESKTOP_CORE_UNAVAILABLE',
          'The application core is unavailable.',
        );
      }
      this.#setStatus('ready');
    } catch (error) {
      this.#handleCoreFailure(session);
      throw toCoreProcessManagerError(error);
    }
  }

  #handlePortMessage(session: CoreProcessSession, message: unknown): void {
    if (this.#session !== session)
      return;

    if (isCoreWireEvent(message)) {
      for (const listener of this.#eventListeners) {
        try {
          listener(message.event);
        } catch {
          // A Main-side consumer cannot interrupt the private response channel.
        }
      }
      return;
    }
    if (!isCoreWireResponse(message))
      return;

    const pending = session.pending.get(message.messageId);
    if (!pending)
      return;

    session.pending.delete(message.messageId);
    clearTimeout(pending.timeout);
    pending.resolve(message.response);
  }

  #handleCoreFailure(session: CoreProcessSession): void {
    if (this.#session !== session)
      return;

    this.#closeSession(
      session,
      new CoreProcessManagerError(
        'DESKTOP_CORE_UNAVAILABLE',
        'The application core is unavailable.',
      ),
      true,
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

    session.releaseChildExit();
    session.releasePortClose();
    session.releasePortMessages();
    session.port.close?.();
    for (const pending of session.pending.values()) {
      clearTimeout(pending.timeout);
      pending.reject(error);
    }
    session.pending.clear();
    if (terminateChild)
      session.child.kill();
  }

  #requestWithSession(
    session: CoreProcessSession,
    request: unknown,
    trustedContext: CoreTrustedRequestContext | undefined,
    timeoutMs: number,
  ): Promise<unknown> {
    if (this.#session !== session) {
      return Promise.reject(new CoreProcessManagerError(
        'DESKTOP_CORE_UNAVAILABLE',
        'The application core is unavailable.',
      ));
    }

    const messageId = randomUUID();
    return new Promise<unknown>((resolve, reject) => {
      const timeout = setTimeout(() => {
        session.pending.delete(messageId);
        reject(new CoreProcessManagerError(
          'DESKTOP_CORE_TIMEOUT',
          'The application core did not respond before the request timed out.',
        ));
      }, timeoutMs);
      session.pending.set(messageId, { reject, resolve, timeout });

      try {
        session.port.postMessage(createCoreWireRequest(
          messageId,
          request,
          trustedContext,
        ));
      } catch (error) {
        session.pending.delete(messageId);
        clearTimeout(timeout);
        reject(toCoreProcessManagerError(error));
      }
    });
  }

  #setStatus(status: CoreProcessStatus): void {
    if (this.#status === status)
      return;

    this.#status = status;
    const change = this.#statusChange();
    for (const listener of this.#listeners)
      listener(change);
  }

  #statusChange(): CoreProcessStatusChange {
    return {
      canRestart: this.canRestart,
      status: this.#status,
    };
  }
}

function createHealthRequest() {
  return {
    method: 'app.getHealth',
    payload: {},
    protocolVersion: DESKTOP_PROTOCOL_VERSION,
    requestId: `core-health-${randomUUID()}`,
  };
}

function isHealthyResponse(value: unknown, requestId: string): boolean {
  let response;
  try {
    response = parseDesktopResponse(value);
  } catch {
    return false;
  }
  return response.ok
    && response.protocolVersion === DESKTOP_PROTOCOL_VERSION
    && response.requestId === requestId
    && isRecord(response.result)
    && response.result.healthy === true;
}

function toCoreProcessManagerError(error: unknown): CoreProcessManagerError {
  if (error instanceof CoreProcessManagerError)
    return error;
  return new CoreProcessManagerError(
    'DESKTOP_CORE_UNAVAILABLE',
    'The application core is unavailable.',
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
