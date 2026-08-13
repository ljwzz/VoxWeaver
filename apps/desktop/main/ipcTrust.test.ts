// @vitest-environment node

import { describe, expect, it } from 'vitest';
import { isTrustedIpcSender, matchesProjectEventTarget } from './ipcTrust.ts';

const sender = {
  browserWindowExists: true,
  browserWindowWebContentsId: 7,
  contextExists: true,
  senderFrameIsMainFrame: true,
  senderFrameUrl: 'file:///app/index.html',
  senderId: 7,
  senderUrl: 'file:///app/index.html',
} as const;

describe('ipc trust boundary', () => {
  it('仅接受已登记 BrowserWindow 的同一主 frame', () => {
    expect(isTrustedIpcSender(sender)).toBe(true);
    expect(isTrustedIpcSender({ ...sender, contextExists: false })).toBe(false);
    expect(isTrustedIpcSender({ ...sender, browserWindowWebContentsId: 8 })).toBe(false);
    expect(isTrustedIpcSender({ ...sender, senderFrameIsMainFrame: false })).toBe(false);
    expect(isTrustedIpcSender({ ...sender, senderFrameUrl: 'file:///app/embedded.html' })).toBe(false);
  });

  it('core 事件必须同时匹配项目 ID、会话 ID 且目标窗口存活', () => {
    const target = {
      destroyed: false,
      projectId: 'project-1',
      projectSessionId: 'session-1',
    };
    expect(matchesProjectEventTarget(target, target)).toBe(true);
    expect(matchesProjectEventTarget(target, { ...target, projectId: 'project-2' })).toBe(false);
    expect(matchesProjectEventTarget(target, { ...target, projectSessionId: 'session-2' })).toBe(false);
    expect(matchesProjectEventTarget({ ...target, destroyed: true }, target)).toBe(false);
    expect(matchesProjectEventTarget(undefined, target)).toBe(false);
  });
});
