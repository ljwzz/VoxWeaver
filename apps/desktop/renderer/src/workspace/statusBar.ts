import type { CoreHealthStatus } from '@voxweaver/contracts';

export type WorkspaceStatusRegion = 'application' | 'project';

export type WorkspaceStatusIcon = 'error' | 'loading' | 'ok';

export const WORKSPACE_APPLICATION_STATUS_ORDER = {
  core: 10,
  tts: 20,
  asr: 30,
} as const;

export const WORKSPACE_PROJECT_STATUS_ORDER = {
  novelImport: 10,
} as const;

export interface WorkspaceStatusBarItem {
  readonly key: string;
  readonly region: WorkspaceStatusRegion;
  readonly order: number;
  readonly label: string;
  readonly value: string;
  readonly icon?: WorkspaceStatusIcon;
  readonly interactive?: boolean;
  readonly title?: string;
}

export interface WorkspaceStatusBarGroups {
  readonly application: readonly WorkspaceStatusBarItem[];
  readonly project: readonly WorkspaceStatusBarItem[];
}

export interface WorkspaceCoreStatusPresentation {
  readonly icon: WorkspaceStatusIcon;
  readonly value: string;
}

function compareKeys(left: string, right: string): number {
  if (left < right)
    return -1;
  if (left > right)
    return 1;
  return 0;
}

export function groupWorkspaceStatusBarItems(
  items: readonly WorkspaceStatusBarItem[],
): WorkspaceStatusBarGroups {
  const application = items
    .filter(item => item.region === 'application')
    .sort((left, right) => left.order - right.order || compareKeys(left.key, right.key));
  const project = items
    .filter(item => item.region === 'project')
    .sort((left, right) => right.order - left.order || compareKeys(left.key, right.key));

  return { application, project };
}

export function getWorkspaceCoreStatusPresentation(
  status: CoreHealthStatus | undefined,
): WorkspaceCoreStatusPresentation {
  switch (status) {
    case 'healthy':
      return { icon: 'ok', value: '正常' };
    case 'starting':
      return { icon: 'loading', value: '启动中' };
    case 'unavailable':
      return { icon: 'error', value: '不可用' };
    default:
      return { icon: 'loading', value: '读取中' };
  }
}
