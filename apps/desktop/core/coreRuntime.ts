import type { DesktopNovelImportEventV1 } from '@voxweaver/contracts';

import type {
  CoreMessagePort,
  CoreTrustedRequestContext,
} from '../shared/coreTransport.js';
import {
  AppCoreService,
  DesktopMessageHost,
  DesktopRequestDispatcher,
  NodeRecentProjectStore,
} from '@voxweaver/app-core';
import {
  createCoreWireEvent,
  createCoreWireResponse,
  isCoreWireRequest,
  subscribeToCorePortMessages,
} from '../shared/coreTransport.js';
import { DesktopNovelImportCoreDispatcher } from './desktopNovelImportCoreDispatcher.js';

interface CoreDispatcher {
  readonly dispatch: (
    request: unknown,
    trustedContext?: CoreTrustedRequestContext,
  ) => Promise<unknown>;
  readonly subscribe?: (
    listener: (event: DesktopNovelImportEventV1) => void,
  ) => () => void;
}

export interface CoreRuntimeOptions {
  readonly dispatcher?: CoreDispatcher;
  readonly port: CoreMessagePort;
  readonly userDataDirectory: string;
}

export interface CoreRuntime {
  readonly stop: () => void;
}

/**
 * Attaches the transport-neutral Application Core dispatcher to one private
 * MessagePort. The trusted path context is accepted only on this wire and is
 * never included in the dispatcher response.
 */
export function startCoreRuntime(options: CoreRuntimeOptions): CoreRuntime {
  const dispatcher = options.dispatcher ?? createDesktopDispatcher(
    options.userDataDirectory,
  );
  const host = new DesktopMessageHost(
    {
      receive(listener) {
        return subscribeToCorePortMessages(options.port, listener);
      },
      send(message) {
        options.port.postMessage(message);
      },
    },
    async (message) => {
      if (!isCoreWireRequest(message))
        throw new TypeError('The private Core request is invalid.');

      return createCoreWireResponse(
        message.messageId,
        await dispatcher.dispatch(message.request, message.trustedContext),
      );
    },
  );
  const releaseEvents = dispatcher.subscribe?.((event) => {
    options.port.postMessage(createCoreWireEvent(event));
  }) ?? (() => {});
  host.start();

  return {
    stop() {
      releaseEvents();
      host.stop();
      options.port.close?.();
    },
  };
}

function createDesktopDispatcher(
  userDataDirectory: string,
): DesktopNovelImportCoreDispatcher {
  const core = new AppCoreService();
  const recentProjects = new NodeRecentProjectStore(userDataDirectory);
  return new DesktopNovelImportCoreDispatcher({
    core,
    fallback: new DesktopRequestDispatcher({ core, recentProjects }),
  });
}
