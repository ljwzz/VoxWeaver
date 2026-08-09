import type {
  DesktopNovelImportEventV1,
  DesktopNovelImportProjectSessionV1,
} from '@voxweaver/contracts';

import { parseDesktopNovelImportEvent } from '@voxweaver/contracts';

const IPC_CHANNEL_PREFIX = 'voxweaver:';
const UUID_V4_PATTERN
  = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

interface WindowEventBinding {
  lastSequence: number;
  readonly projectId: string;
  readonly projectSessionId: string;
}

export interface DesktopNovelImportEventSender {
  readonly send: (
    windowId: number,
    channel: string,
    envelope: {
      readonly event: DesktopNovelImportEventV1;
      readonly messageKind: 'event';
    },
  ) => void;
}

/**
 * Main owns the final trust boundary: only a session established by a
 * successful project lifecycle response can receive events. Core ordering is
 * checked again before the narrow event-specific IPC channel is used.
 */
export class DesktopNovelImportEventBridge {
  readonly #bindings = new Map<number, WindowEventBinding>();
  readonly #revisions = new Map<number, number>();
  readonly #sender: DesktopNovelImportEventSender;

  constructor(sender: DesktopNovelImportEventSender) {
    this.#sender = sender;
  }

  bindWindowSession(
    windowId: number,
    session: Pick<
      DesktopNovelImportProjectSessionV1,
      'projectId' | 'projectSessionId'
    >,
  ): void {
    if (!isWindowId(windowId) || !isSession(session))
      return;
    const current = this.#bindings.get(windowId);
    this.#advanceRevision(windowId);
    this.#bindings.set(windowId, {
      lastSequence: current?.projectId === session.projectId
        && current.projectSessionId === session.projectSessionId
        ? current.lastSequence
        : 0,
      projectId: session.projectId,
      projectSessionId: session.projectSessionId,
    });
  }

  clearWindowSession(windowId: number): void {
    if (!isWindowId(windowId))
      return;
    this.#advanceRevision(windowId);
    this.#bindings.delete(windowId);
  }

  /**
   * Temporarily drops events during close/switch. The returned callback restores
   * the old binding only if no newer lifecycle result replaced it.
   */
  suspendWindow(windowId: number): () => void {
    if (!isWindowId(windowId))
      return () => {};
    const previous = this.#bindings.get(windowId);
    const suspendedRevision = this.#advanceRevision(windowId);
    this.#bindings.delete(windowId);
    let pending = true;
    return () => {
      if (!pending)
        return;
      pending = false;
      if (this.#revisions.get(windowId) !== suspendedRevision)
        return;
      this.#advanceRevision(windowId);
      if (previous)
        this.#bindings.set(windowId, { ...previous });
    };
  }

  publish(input: unknown): number {
    let event: DesktopNovelImportEventV1;
    try {
      event = parseDesktopNovelImportEvent(input);
    } catch {
      return 0;
    }

    let delivered = 0;
    for (const [windowId, binding] of this.#bindings) {
      if (
        binding.projectId !== event.projectId
        || binding.projectSessionId !== event.projectSessionId
        || event.sequence <= binding.lastSequence
      ) {
        continue;
      }
      binding.lastSequence = event.sequence;
      try {
        this.#sender.send(
          windowId,
          `${IPC_CHANNEL_PREFIX}${event.eventType}`,
          { event, messageKind: 'event' },
        );
        delivered += 1;
      } catch {
        // A destroyed window cannot affect other matching window sessions.
      }
    }
    return delivered;
  }

  #advanceRevision(windowId: number): number {
    const next = (this.#revisions.get(windowId) ?? 0) + 1;
    this.#revisions.set(windowId, next);
    return next;
  }
}

function isWindowId(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) > 0;
}

function isSession(value: unknown): value is {
  readonly projectId: string;
  readonly projectSessionId: string;
} {
  return typeof value === 'object'
    && value !== null
    && typeof Reflect.get(value, 'projectId') === 'string'
    && UUID_V4_PATTERN.test(Reflect.get(value, 'projectId') as string)
    && typeof Reflect.get(value, 'projectSessionId') === 'string'
    && UUID_V4_PATTERN.test(Reflect.get(value, 'projectSessionId') as string);
}
