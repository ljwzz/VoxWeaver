import type { ParentPort } from 'electron';
import type { CoreMessagePort } from '../shared/coreTransport.js';

import { isCoreInitControlMessage } from '../shared/coreTransport.js';
import { startCoreRuntime } from './coreRuntime.js';
import { verifyCoreRuntimeCapabilities } from './runtimeCapabilityCheck.js';

let runtime: ReturnType<typeof startCoreRuntime> | undefined;
const parentPort = (process as NodeJS.Process & {
  readonly parentPort?: ParentPort;
}).parentPort;

if (!parentPort) {
  throw new Error('The Core entry must run inside an Electron utility process.');
}

parentPort.once('message', async (event) => {
  if (!isCoreInitControlMessage(event.data))
    return;

  const port = event.ports[0];
  if (!isCoreMessagePort(port))
    return;

  try {
    await verifyCoreRuntimeCapabilities(event.data.userDataDirectory);
    runtime = startCoreRuntime({
      port,
      userDataDirectory: event.data.userDataDirectory,
    });
  } catch {
    port.close?.();
    process.exitCode = 1;
  }
});

process.once('exit', () => {
  runtime?.stop();
});

function isCoreMessagePort(value: unknown): value is CoreMessagePort {
  return typeof value === 'object'
    && value !== null
    && 'postMessage' in value
    && typeof value.postMessage === 'function';
}
