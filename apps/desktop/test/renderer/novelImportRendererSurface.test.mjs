/* eslint-disable test/no-import-node-test */

import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';

import { compileTemplate, parse } from '@vue/compiler-sfc';

const PANEL_PATH = 'renderer/features/novelImport/NovelImportReviewPanel.vue';
const CONTROLLER_PATH = 'renderer/features/novelImport/novelImportController.ts';

test('mounts the novel-import feature by project session and compiles its Vue template', async () => {
  const [app, panel] = await Promise.all([
    readDesktopSource('renderer/App.vue'),
    readDesktopSource(PANEL_PATH),
  ]);

  assert.match(app, /import NovelImportReviewPanel from '.\/features\/novelImport\/NovelImportReviewPanel\.vue'/);
  assert.match(app, /:key="currentProject\.projectSessionId"/);
  assert.match(app, /:project="currentProject"/);

  const parsed = parse(panel, { filename: PANEL_PATH });
  assert.deepEqual(parsed.errors, []);
  assert.equal(parsed.descriptor.scriptSetup?.lang, 'ts');
  const compiled = compileTemplate({
    filename: PANEL_PATH,
    id: 'novel-import-review-panel',
    source: parsed.descriptor.template?.content ?? '',
  });
  assert.deepEqual(compiled.errors, []);
});

test('renders every M1-15D review surface with explicit stale confirmation and read-only gates', async () => {
  const panel = await readDesktopSource(PANEL_PATH);

  for (const requiredSurface of [
    '选择 TXT',
    '源编码',
    '开始导入',
    '取消任务',
    '重试失败任务',
    'raw / canonical / normalized 差异',
    '章节与覆盖率',
    '预览边界影响',
    '未覆盖范围分类',
    'normalized proposal',
    '候选、问题与目录证据',
    '确认审核写入',
    '确认并提交 revision',
  ]) {
    assert.match(panel, new RegExp(requiredSurface));
  }

  assert.match(panel, /const state = shallowRef\(controller\.state\)/);
  assert.match(panel, /props\.project\.accessMode === 'read-only'/);
  assert.match(panel, /:disabled="writeDisabled/);
  assert.match(panel, /:disabled="!canSelectSource"/);
  assert.match(panel, /:disabled="!canStart"/);
  assert.match(panel, /const canRetry = computed\(\(\) => \([\s\S]*&& !activeTask\.value/);
  assert.match(panel, /controller\.prepareBoundaryAdjustment/);
  assert.match(panel, /controller\.prepareRangeClassification/);
  assert.match(panel, /controller\.prepareNormalizationDecision/);
  assert.match(panel, /controller\.confirmPendingReview/);
  assert.match(panel, /window\.addEventListener\('keydown', handleKeyboard\)/);
  assert.match(panel, /window\.removeEventListener\('keydown', handleKeyboard\)/);
});

test('uses only the narrow preload API and keeps task recovery free of source tokens and text', async () => {
  const [panel, controller] = await Promise.all([
    readDesktopSource(PANEL_PATH),
    readDesktopSource(CONTROLLER_PATH),
  ]);
  const productSource = `${panel}\n${controller}`;

  assert.match(panel, /api: window\.voxweaver\.novelImport/);
  assert.match(controller, /#api\.selectSource/);
  assert.match(controller, /#api\.start/);
  assert.match(controller, /#api\.getTask/);
  assert.match(controller, /#api\.cancelTask/);
  assert.match(controller, /#api\.retryTask/);
  assert.match(controller, /#api\.inspect/);
  assert.match(controller, /#api\.previewStaleImpact/);
  assert.match(controller, /#api\.executeReviewCommand/);
  assert.match(controller, /import \{ decodeDesktopBridgeError \} from '.+desktopBridgeError\.js'/);
  assert.ok(
    controller.indexOf('decodeDesktopBridgeError(error)')
    < controller.indexOf('if (!isErrorFields(error))'),
  );
  assert.match(controller, /projectId: project\.projectId/);
  assert.match(controller, /projectSessionId: project\.projectSessionId/);
  assert.match(controller, /taskId/);
  assert.doesNotMatch(productSource, /\bipcRenderer\b|node:fs|node:sqlite|sourceFilePath|absolutePath|projectDirectory|providerProfileId/);

  const storeTaskBody = controller.slice(
    controller.lastIndexOf('\n  #storeTask('),
    controller.lastIndexOf('\n  #removeStoredTask('),
  );
  assert.doesNotMatch(storeTaskBody, /selectionToken|displayName|snapshot|beforeText|afterText/);
});

async function readDesktopSource(relativePath) {
  return readFile(new URL(`../../${relativePath}`, import.meta.url), 'utf8');
}
