import type { DesktopTrustedRequestContext } from '@voxweaver/app-core';

import type { CoreMessagePort } from '../shared/coreTransport.js';
import {
  AppCoreService,
  DesktopMessageHost,
  DesktopRequestDispatcher,
  NodeRecentProjectStore,
} from '@voxweaver/app-core';
import {
  createCoreWireResponse,
  isCoreWireRequest,
  subscribeToCorePortMessages,
} from '../shared/coreTransport.js';

interface CoreDispatcher {
  readonly dispatch: (
    request: unknown,
    trustedContext?: DesktopTrustedRequestContext,
  ) => Promise<unknown>;
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
  host.start();

  return {
    stop() {
      host.stop();
      options.port.close?.();
    },
  };
}

function createDesktopDispatcher(userDataDirectory: string): DesktopRequestDispatcher {
  const core = new AppCoreService();
  const recentProjects = new NodeRecentProjectStore(userDataDirectory);
  return new DesktopRequestDispatcher({ core, recentProjects });
}
