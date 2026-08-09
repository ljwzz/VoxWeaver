import assert from 'node:assert/strict';
import test from 'node:test';

import * as packageEntry from '../dist/index.js';

test('exposes only the M1-04 TXT adapter runtime API', () => {
  assert.deepEqual(Object.keys(packageEntry), [
    'NovelSourceAdapterError',
    'TXT_IMPORT_PROCESSOR_ID',
    'TXT_IMPORT_PROCESSOR_VERSION',
    'TXT_SOURCE_ADAPTER_ID',
    'TXT_SOURCE_ADAPTER_VERSION',
    'TxtSourceAdapter',
    'probeTxtDecoderCapabilities',
  ]);
});
