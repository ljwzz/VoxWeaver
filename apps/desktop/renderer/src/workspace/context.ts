import type {
  AppError,
  CoreHealthDto,
  WorkspaceBootstrapDto,
} from '@voxweaver/contracts';
import type { InjectionKey, ShallowRef } from 'vue';

import { inject, shallowRef } from 'vue';

export type WorkspaceLoadState = 'error' | 'idle' | 'loading' | 'ready';

export interface WorkspaceContext {
  readonly bootstrap: ShallowRef<WorkspaceBootstrapDto | undefined>;
  readonly coreHealth: ShallowRef<CoreHealthDto | undefined>;
  readonly loadState: ShallowRef<WorkspaceLoadState>;
  readonly loadError: ShallowRef<AppError | undefined>;
  readonly ensureBootstrap: (force?: boolean) => Promise<WorkspaceBootstrapDto | undefined>;
  readonly refreshCoreHealth: () => Promise<CoreHealthDto | undefined>;
  readonly restartCore: () => Promise<boolean>;
}

export const workspaceContextKey: InjectionKey<WorkspaceContext> = Symbol('workspace-context');

export function createWorkspaceContext(): WorkspaceContext {
  const bootstrap = shallowRef<WorkspaceBootstrapDto>();
  const coreHealth = shallowRef<CoreHealthDto>();
  const loadState = shallowRef<WorkspaceLoadState>('idle');
  const loadError = shallowRef<AppError>();
  let pendingLoad: Promise<WorkspaceBootstrapDto | undefined> | undefined;

  async function loadBootstrap(): Promise<WorkspaceBootstrapDto | undefined> {
    loadState.value = 'loading';
    loadError.value = undefined;

    const result = await window.voxweaver.project.getBootstrap();
    if (!result.ok) {
      bootstrap.value = undefined;
      loadState.value = 'error';
      loadError.value = result.error;
      await refreshCoreHealth();
      return undefined;
    }

    bootstrap.value = result.value;
    coreHealth.value = result.value.coreHealth;
    loadState.value = 'ready';
    return result.value;
  }

  async function ensureBootstrap(force = false): Promise<WorkspaceBootstrapDto | undefined> {
    if (!force && bootstrap.value)
      return bootstrap.value;
    if (pendingLoad)
      return pendingLoad;

    pendingLoad = loadBootstrap().finally(() => {
      pendingLoad = undefined;
    });
    return pendingLoad;
  }

  async function restartCore(): Promise<boolean> {
    const result = await window.voxweaver.system.restartCore();
    if (!result.ok) {
      loadState.value = 'error';
      loadError.value = result.error;
      return false;
    }

    return Boolean(await ensureBootstrap(true));
  }

  async function refreshCoreHealth(): Promise<CoreHealthDto | undefined> {
    const result = await window.voxweaver.system.getCoreHealth();
    if (!result.ok)
      return undefined;
    coreHealth.value = result.value;
    if (bootstrap.value) {
      bootstrap.value = {
        ...bootstrap.value,
        coreHealth: result.value,
      };
    }
    return result.value;
  }

  return {
    bootstrap,
    coreHealth,
    loadState,
    loadError,
    ensureBootstrap,
    refreshCoreHealth,
    restartCore,
  };
}

export function useWorkspaceContext(): WorkspaceContext {
  const context = inject(workspaceContextKey);
  if (!context)
    throw new Error('Workspace context is only available below ProjectWorkspaceLayout.');
  return context;
}
