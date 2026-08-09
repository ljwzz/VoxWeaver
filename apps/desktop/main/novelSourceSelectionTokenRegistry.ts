import { randomBytes } from 'node:crypto';

/**
 * Novel source selections are deliberately short lived. The fixed value keeps
 * production callers from weakening the Main-process capability boundary.
 */
export const NOVEL_SOURCE_SELECTION_TOKEN_TTL_MS = 5 * 60 * 1000;

export interface NovelSourceSelectionTokenRegistryOptions {
  /** Injectable only for deterministic expiry tests. */
  readonly now?: () => number;
}

export interface IssueNovelSourceSelectionInput {
  readonly displayName: string;
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly sourceFilePath: string;
  readonly windowId: number;
}

/** Public, path-free result returned after a file picker succeeds. */
export interface IssuedNovelSourceSelection {
  readonly expiresAt: string;
  readonly selectionToken: string;
}

export interface ReserveNovelSourceSelectionInput {
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly selectionToken: string;
  readonly windowId: number;
}

/** Main/Core-only source capability. Never expose this type through Preload. */
export interface TrustedNovelSourceSelection {
  readonly displayName: string;
  readonly projectId: string;
  readonly projectSessionId: string;
  readonly selectionToken: string;
  readonly sourceFilePath: string;
}

export type NovelSourceSelectionUseOutcome
  = | 'completed'
    | 'encoding-required'
    | 'failed';

interface NovelSourceSelectionEntry extends TrustedNovelSourceSelection {
  readonly expiresAtMs: number;
  readonly windowId: number;
  leaseId?: string;
}

export class NovelSourceSelectionLease {
  readonly #leaseId: string;
  readonly #selection: TrustedNovelSourceSelection;

  constructor(leaseId: string, selection: TrustedNovelSourceSelection) {
    this.#leaseId = leaseId;
    this.#selection = selection;
  }

  get selection(): TrustedNovelSourceSelection {
    return this.#selection;
  }

  matches(leaseId: string): boolean {
    return this.#leaseId === leaseId;
  }
}

/**
 * Owns one-shot source-file capabilities bound to one window and one exact
 * project session. A mismatched reservation invalidates the token to prevent a
 * later replay against the original session.
 */
export class NovelSourceSelectionTokenRegistry {
  readonly #entries = new Map<string, NovelSourceSelectionEntry>();
  readonly #now: () => number;

  constructor(options: NovelSourceSelectionTokenRegistryOptions = {}) {
    this.#now = options.now ?? Date.now;
  }

  issue(input: IssueNovelSourceSelectionInput): IssuedNovelSourceSelection {
    assertWindowId(input.windowId);
    assertNonEmpty(input.displayName, 'A source display name is required.');
    assertNonEmpty(input.projectId, 'A source project ID is required.');
    assertNonEmpty(input.projectSessionId, 'A source project session ID is required.');
    assertNonEmpty(input.sourceFilePath, 'A selected source file is required.');

    const issuedAt = this.#readNow();
    const expiresAtMs = issuedAt + NOVEL_SOURCE_SELECTION_TOKEN_TTL_MS;
    const expiresAt = new Date(expiresAtMs).toISOString();
    const selectionToken = this.#createUniqueToken();
    this.#entries.set(selectionToken, {
      displayName: input.displayName,
      expiresAtMs,
      projectId: input.projectId,
      projectSessionId: input.projectSessionId,
      selectionToken,
      sourceFilePath: input.sourceFilePath,
      windowId: input.windowId,
    });

    return {
      expiresAt,
      selectionToken,
    };
  }

  reserve(
    input: ReserveNovelSourceSelectionInput,
  ): NovelSourceSelectionLease | undefined {
    const entry = this.#entries.get(input.selectionToken);
    if (!entry)
      return undefined;

    if (this.#isExpired(entry)) {
      this.#entries.delete(input.selectionToken);
      return undefined;
    }

    if (
      entry.windowId !== input.windowId
      || entry.projectId !== input.projectId
      || entry.projectSessionId !== input.projectSessionId
    ) {
      this.#entries.delete(input.selectionToken);
      return undefined;
    }

    if (entry.leaseId)
      return undefined;

    const leaseId = randomBytes(24).toString('base64url');
    entry.leaseId = leaseId;
    return new NovelSourceSelectionLease(leaseId, {
      displayName: entry.displayName,
      projectId: entry.projectId,
      projectSessionId: entry.projectSessionId,
      selectionToken: entry.selectionToken,
      sourceFilePath: entry.sourceFilePath,
    });
  }

  /**
   * Encoding choice is the only response that retains the capability, so the
   * same selected bytes can be retried with an explicit encoding. Every other
   * outcome consumes it.
   */
  settle(
    lease: NovelSourceSelectionLease,
    outcome: NovelSourceSelectionUseOutcome,
  ): void {
    const token = lease.selection.selectionToken;
    const entry = this.#entries.get(token);
    if (!entry || !entry.leaseId || !lease.matches(entry.leaseId))
      return;

    if (this.#isExpired(entry)) {
      this.#entries.delete(token);
      return;
    }
    if (outcome === 'encoding-required') {
      entry.leaseId = undefined;
      return;
    }
    this.#entries.delete(token);
  }

  invalidate(selectionToken: string): void {
    this.#entries.delete(selectionToken);
  }

  invalidateWindow(windowId: number): void {
    for (const [token, entry] of this.#entries) {
      if (entry.windowId === windowId)
        this.#entries.delete(token);
    }
  }

  #isExpired(entry: NovelSourceSelectionEntry): boolean {
    return this.#readNow() >= entry.expiresAtMs;
  }

  #readNow(): number {
    const now = this.#now();
    if (!Number.isFinite(now))
      throw new Error('The source selection clock must return a finite timestamp.');
    return now;
  }

  #createUniqueToken(): string {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const token = randomBytes(32).toString('base64url');
      if (!this.#entries.has(token))
        return token;
    }
    throw new Error('Unable to create a unique source selection token.');
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
