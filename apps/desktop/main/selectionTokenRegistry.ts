import type { DirectorySelectionPurpose } from '@voxweaver/contracts';

import { randomBytes } from 'node:crypto';

/**
 * Directory selections are deliberately short lived.  The value is fixed
 * rather than configurable so callers cannot accidentally weaken the Main
 * process boundary in a production build.
 */
export const DIRECTORY_SELECTION_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface SelectionTokenRegistryOptions {
  /** Injectable only to make expiry behavior deterministic in tests. */
  readonly now?: () => number;
}

export interface IssueDirectorySelectionInput {
  readonly projectDirectory: string;
  readonly purpose: DirectorySelectionPurpose;
  readonly windowId: number;
}

/** Public, path-free result returned to the Renderer after a directory pick. */
export interface IssuedDirectorySelection {
  readonly expiresAt: string;
  readonly selectionToken: string;
}

export interface ReserveDirectorySelectionInput {
  readonly purpose: DirectorySelectionPurpose;
  readonly selectionToken: string;
  readonly windowId: number;
}

/**
 * Main/Core-only data. Never use this type in a preload or renderer API.
 */
export interface TrustedDirectorySelection {
  readonly projectDirectory: string;
  readonly selectionPurpose: DirectorySelectionPurpose;
  readonly selectionToken: string;
}

export type SelectionTokenUseOutcome
  = | 'completed'
    | 'confirmation-required'
    | 'failed';

interface SelectionTokenEntry extends TrustedDirectorySelection {
  readonly expiresAtMs: number;
  readonly windowId: number;
  leaseId?: string;
}

/**
 * An in-flight reservation. A lease is only produced after token, window and
 * purpose all match, and it can only be settled once by its owning registry.
 */
export class DirectorySelectionLease {
  readonly #leaseId: string;
  readonly #selection: TrustedDirectorySelection;

  constructor(
    leaseId: string,
    selection: TrustedDirectorySelection,
  ) {
    this.#leaseId = leaseId;
    this.#selection = selection;
  }

  get selection(): TrustedDirectorySelection {
    return this.#selection;
  }

  matches(leaseId: string): boolean {
    return this.#leaseId === leaseId;
  }
}

/**
 * Keeps real directory paths inside the Main process and turns them into
 * one-shot capabilities bound to a single Renderer window and intent.
 */
export class SelectionTokenRegistry {
  readonly #entries = new Map<string, SelectionTokenEntry>();
  readonly #now: () => number;

  constructor(options: SelectionTokenRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  issue(input: IssueDirectorySelectionInput): IssuedDirectorySelection {
    assertWindowId(input.windowId);
    assertNonEmpty(input.projectDirectory, 'A selected directory is required.');

    const issuedAt = this.#readNow();
    const expiresAtMs = issuedAt + DIRECTORY_SELECTION_TOKEN_TTL_MS;
    const selectionToken = this.#createUniqueToken();

    this.#entries.set(selectionToken, {
      expiresAtMs,
      projectDirectory: input.projectDirectory,
      selectionPurpose: input.purpose,
      selectionToken,
      windowId: input.windowId,
    });

    return {
      expiresAt: new Date(expiresAtMs).toISOString(),
      selectionToken,
    };
  }

  /**
   * Reserves a token for one Core request. A mismatched caller invalidates the
   * capability rather than leaving it available for a later replay attempt.
   */
  reserve(input: ReserveDirectorySelectionInput): DirectorySelectionLease | undefined {
    const entry = this.#entries.get(input.selectionToken);
    if (!entry)
      return undefined;

    if (this.#isExpired(entry)) {
      this.#entries.delete(input.selectionToken);
      return undefined;
    }

    if (
      entry.windowId !== input.windowId
      || entry.selectionPurpose !== input.purpose
    ) {
      this.#entries.delete(input.selectionToken);
      return undefined;
    }

    // Do not let two renderer invocations race on one capability.
    if (entry.leaseId)
      return undefined;

    const leaseId = this.#createUniqueLeaseId();
    entry.leaseId = leaseId;
    return new DirectorySelectionLease(leaseId, {
      projectDirectory: entry.projectDirectory,
      selectionPurpose: entry.selectionPurpose,
      selectionToken: entry.selectionToken,
    });
  }

  /**
   * A selected directory may only be retried after Core has explicitly asked
   * for migration or recoverable write-lock confirmation. Every other result
   * consumes the capability.
   */
  settle(
    lease: DirectorySelectionLease,
    outcome: SelectionTokenUseOutcome,
  ): void {
    const token = lease.selection.selectionToken;
    const entry = this.#entries.get(token);
    if (!entry || !entry.leaseId || !lease.matches(entry.leaseId))
      return;

    if (this.#isExpired(entry)) {
      this.#entries.delete(token);
      return;
    }

    if (outcome === 'confirmation-required') {
      entry.leaseId = undefined;
      return;
    }

    this.#entries.delete(token);
  }

  /** Invalidates every capability owned by a window when that window closes. */
  invalidateWindow(windowId: number): void {
    for (const [token, entry] of this.#entries) {
      if (entry.windowId === windowId)
        this.#entries.delete(token);
    }
  }

  /** Used when Main needs to discard a selection before it reaches Core. */
  invalidate(selectionToken: string): void {
    this.#entries.delete(selectionToken);
  }

  #isExpired(entry: SelectionTokenEntry): boolean {
    return this.#readNow() >= entry.expiresAtMs;
  }

  #readNow(): number {
    const now = this.#now();
    if (!Number.isFinite(now))
      throw new Error('The selection token clock must return a finite timestamp.');
    return now;
  }

  #createUniqueToken(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = randomBytes(32).toString('base64url');
      if (!this.#entries.has(token))
        return token;
    }

    throw new Error('Unable to create a unique directory selection token.');
  }

  #createUniqueLeaseId(): string {
    return randomBytes(24).toString('base64url');
  }
}

function assertWindowId(windowId: number): void {
  if (Number.isInteger(windowId) && windowId > 0)
    return;
  throw new Error('A valid window identifier is required.');
}

function assertNonEmpty(value: string, message: string): void {
  if (value.length > 0)
    return;
  throw new Error(message);
}
