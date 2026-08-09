export interface DesktopMessageConnection {
  readonly receive: (
    listener: (message: unknown) => void,
  ) => () => void;
  readonly send: (message: unknown) => void;
}

export type DesktopMessageHandler = (
  message: unknown,
) => Promise<unknown> | unknown;

export interface DesktopMessageHostOptions {
  readonly onUnhandledError?: (
    error: unknown,
    message: unknown,
  ) => void;
}

export class DesktopMessageHost {
  readonly #connection: DesktopMessageConnection;
  readonly #handler: DesktopMessageHandler;
  readonly #onUnhandledError: (
    error: unknown,
    message: unknown,
  ) => void;

  #generation = 0;
  #release: (() => void) | undefined;

  constructor(
    connection: DesktopMessageConnection,
    handler: DesktopMessageHandler,
    options: DesktopMessageHostOptions = {},
  ) {
    this.#connection = connection;
    this.#handler = handler;
    this.#onUnhandledError = options.onUnhandledError ?? (() => {});
  }

  get running(): boolean {
    return this.#release !== undefined;
  }

  start(): void {
    if (this.#release)
      throw new Error('Desktop message host is already running.');

    const generation = ++this.#generation;
    this.#release = this.#connection.receive((message) => {
      void this.#handle(message, generation);
    });
  }

  stop(): void {
    this.#generation += 1;
    this.#release?.();
    this.#release = undefined;
  }

  async #handle(message: unknown, generation: number): Promise<void> {
    try {
      const response = await this.#handler(message);
      if (this.#release && this.#generation === generation)
        this.#connection.send(response);
    } catch (error) {
      this.#onUnhandledError(error, message);
    }
  }
}
