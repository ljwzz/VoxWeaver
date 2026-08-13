import assert from 'node:assert/strict';
import test from 'node:test';
import {
  CORE_METHODS,
  CORE_PROTOCOL_VERSION,
  CoreEnvelopeValidationError,
  parseCoreEventEnvelope,
  parseCoreRequestEnvelope,
  parseCoreResponseEnvelope,
} from './coreProtocol.ts';

const request = {
  protocolVersion: CORE_PROTOCOL_VERSION,
  requestId: 'request-1',
  method: CORE_METHODS.getHealth,
  trustedContext: {
    appInstanceId: 'app-1',
    webContentsId: 7,
    windowKind: 'startup',
  },
  payload: {},
  futureField: 'retained-by-transport',
};

test('Core request 接受未知字段但拒绝未知方法和错误协议', () => {
  assert.equal(parseCoreRequestEnvelope(request).requestId, 'request-1');

  for (const malformed of [
    { ...request, protocolVersion: 2 },
    { ...request, method: 'unknown.method' },
    { ...request, payload: Number.NaN },
  ]) {
    assert.throws(
      () => parseCoreRequestEnvelope(malformed),
      CoreEnvelopeValidationError,
    );
  }
});

test('项目请求要求完整的 Main 可信会话', () => {
  assert.throws(
    () => parseCoreRequestEnvelope({
      ...request,
      trustedContext: {
        appInstanceId: 'app-1',
        webContentsId: 7,
        windowKind: 'project',
      },
    }),
    CoreEnvelopeValidationError,
  );
  assert.throws(
    () => parseCoreResponseEnvelope({
      protocolVersion: CORE_PROTOCOL_VERSION,
      requestId: 'request-1',
      ok: false,
      error: { code: 'UNKNOWN_ERROR', message: 'invalid', retryable: false },
    }),
    CoreEnvelopeValidationError,
  );
});

test('Core response 保持严格判别联合', () => {
  assert.deepEqual(parseCoreResponseEnvelope({
    protocolVersion: CORE_PROTOCOL_VERSION,
    requestId: 'request-1',
    ok: true,
    result: { healthy: true },
    futureField: true,
  }), {
    protocolVersion: CORE_PROTOCOL_VERSION,
    requestId: 'request-1',
    ok: true,
    result: { healthy: true },
  });

  assert.throws(
    () => parseCoreResponseEnvelope({
      protocolVersion: CORE_PROTOCOL_VERSION,
      requestId: 'request-1',
      ok: true,
      result: null,
      error: { code: 'CORE_UNAVAILABLE', message: 'unavailable', retryable: true },
    }),
    CoreEnvelopeValidationError,
  );
});

test('Core event 校验项目会话、时间和 JSON payload', () => {
  const event = parseCoreEventEnvelope({
    protocolVersion: CORE_PROTOCOL_VERSION,
    eventId: 'event-1',
    eventType: 'novelImport.progress',
    occurredAt: '2026-08-13T08:00:00.000Z',
    projectId: 'project-1',
    projectSessionId: 'session-1',
    payload: { percent: 50 },
  });
  assert.equal(event.eventType, 'novelImport.progress');
});
