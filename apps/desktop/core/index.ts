import type { ParentPort } from 'electron';

import process from 'node:process';
import { AppCoreService, CoreRequestDispatcher } from '@voxweaver/app-core';
import {
  CORE_PROTOCOL_VERSION,
  parseCoreRequestEnvelope,
} from '@voxweaver/contracts';
import {
  createCoreFailureResponse,
  isCoreProtocolMismatch,
  readCoreParentMessage,
  readCoreRequestId,
} from '../shared/coreTransport.ts';

const parentPort = (process as NodeJS.Process & {
  readonly parentPort?: ParentPort;
}).parentPort;

if (!parentPort)
  throw new Error('The Core entry must run inside an Electron utility process.');

const userDataPath = process.argv[2];
const appInstanceId = process.argv[3];
if (!userDataPath || !appInstanceId)
  throw new Error('The Core entry requires its user-data path and app instance ID.');

const core = new AppCoreService(
  userDataPath,
  appInstanceId,
  event => parentPort.postMessage(event),
);
const dispatcher = new CoreRequestDispatcher(core);

parentPort.on('message', (event) => {
  const message = readCoreParentMessage(event);
  try {
    parseCoreRequestEnvelope(message);
  } catch {
    const requestId = readCoreRequestId(message);
    if (!requestId)
      return;
    parentPort.postMessage(createCoreFailureResponse(requestId, {
      code: isCoreProtocolMismatch(message)
        ? 'CORE_PROTOCOL_MISMATCH'
        : 'IPC_PAYLOAD_INVALID',
      message: 'The Core request envelope is invalid.',
      retryable: false,
    }));
    return;
  }

  void dispatcher.dispatch(message).then(response => parentPort.postMessage(response));
});

process.once('beforeExit', () => {
  void core.close();
});

void CORE_PROTOCOL_VERSION;
