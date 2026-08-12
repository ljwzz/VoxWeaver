import type { SelectionResult } from '@voxweaver/contracts';

import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { VoxWeaverError } from '@voxweaver/contracts';

export type SelectionKind = 'directory' | 'source';

interface StoredSelection {
  id: string;
  ownerWebContentsId: number;
  kind: SelectionKind;
  filePath: string;
  expiresAt: number;
}

export class SelectionStore {
  readonly #selections = new Map<string, StoredSelection>();
  readonly #ttlMilliseconds: number;
  readonly #now: () => number;

  constructor(ttlMilliseconds = 5 * 60 * 1_000, now: () => number = () => Date.now()) {
    this.#ttlMilliseconds = ttlMilliseconds;
    this.#now = now;
  }

  create(ownerWebContentsId: number, kind: SelectionKind, filePath: string): SelectionResult {
    this.#removeExpired();
    const id = randomUUID();
    const selection: StoredSelection = {
      id,
      ownerWebContentsId,
      kind,
      filePath,
      expiresAt: this.#now() + this.#ttlMilliseconds,
    };
    this.#selections.set(id, selection);

    return {
      selectionId: id,
      name: path.basename(filePath),
      displayPath: filePath,
    };
  }

  resolve(ownerWebContentsId: number, selectionId: string, kind: SelectionKind): string {
    this.#removeExpired();
    const selection = this.#selections.get(selectionId);

    if (!selection
      || selection.ownerWebContentsId !== ownerWebContentsId
      || selection.kind !== kind) {
      throw new VoxWeaverError(
        'SELECTION_INVALID',
        '文件或目录选择已失效，请重新选择。',
      );
    }

    return selection.filePath;
  }

  consume(...selectionIds: string[]): void {
    for (const selectionId of selectionIds)
      this.#selections.delete(selectionId);
  }

  clearOwner(ownerWebContentsId: number): void {
    for (const [selectionId, selection] of this.#selections) {
      if (selection.ownerWebContentsId === ownerWebContentsId)
        this.#selections.delete(selectionId);
    }
  }

  #removeExpired(): void {
    const now = this.#now();
    for (const [selectionId, selection] of this.#selections) {
      if (selection.expiresAt <= now)
        this.#selections.delete(selectionId);
    }
  }
}
