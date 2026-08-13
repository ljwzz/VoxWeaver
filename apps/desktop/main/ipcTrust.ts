export interface IpcSenderFacts {
  readonly browserWindowExists: boolean;
  readonly browserWindowWebContentsId?: number;
  readonly contextExists: boolean;
  readonly senderFrameIsMainFrame: boolean;
  readonly senderFrameUrl: string;
  readonly senderId: number;
  readonly senderUrl: string;
}

export interface ProjectEventTargetFacts {
  readonly destroyed: boolean;
  readonly projectId: string;
  readonly projectSessionId: string;
}

export function isTrustedIpcSender(facts: IpcSenderFacts): boolean {
  return facts.browserWindowExists
    && facts.contextExists
    && facts.browserWindowWebContentsId === facts.senderId
    && facts.senderFrameIsMainFrame
    && facts.senderFrameUrl === facts.senderUrl;
}

export function matchesProjectEventTarget(
  target: ProjectEventTargetFacts | undefined,
  event: { readonly projectId: string; readonly projectSessionId: string },
): boolean {
  return target !== undefined
    && !target.destroyed
    && target.projectId === event.projectId
    && target.projectSessionId === event.projectSessionId;
}
