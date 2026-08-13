<script setup lang="ts">
import { computed, ref } from 'vue';
import { useRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import PostWorkbenchFrame from './PostWorkbenchFrame.vue';

type ExportScope = 'chapter-12-13' | 'chapter-12';
type ExportState = 'blocked' | 'idle' | 'running' | 'success';

interface ExportArtifact {
  detail: string;
  label: string;
  status: 'missing' | 'ready' | 'stale';
}

const router = useRouter();
const exportScope = ref<ExportScope>('chapter-12-13');
const activeState = ref<ExportState>('blocked');
const checkMessage = ref('尚未重新检查');

const artifactsByScope: Record<ExportScope, readonly ExportArtifact[]> = {
  'chapter-12-13': [
    { detail: 'offline/index.html · 文件名待确认', label: '离线浏览器页面', status: 'ready' },
    { detail: 'chapter-13.webp · 已失效', label: '章节绘图', status: 'stale' },
    { detail: 'chapter-12.vtt · 格式待确认', label: '时间轴歌词 / 字幕', status: 'ready' },
    { detail: 'chapter-13.wav · 缺失', label: '音频文件', status: 'missing' },
  ],
  'chapter-12': [
    { detail: 'offline/index.html · 文件名待确认', label: '离线浏览器页面', status: 'ready' },
    { detail: 'chapter-12.webp · 当前有效', label: '章节绘图', status: 'ready' },
    { detail: 'chapter-12.vtt · 格式待确认', label: '时间轴歌词 / 字幕', status: 'ready' },
    { detail: 'chapter-12.wav · 当前有效', label: '音频文件', status: 'ready' },
  ],
};

const currentArtifacts = computed(() => artifactsByScope[exportScope.value]);
const blockers = computed(() => currentArtifacts.value.filter(artifact => artifact.status !== 'ready'));
const isExportBlocked = computed(() => blockers.value.length > 0);
const exportReason = computed(() => isExportBlocked.value
  ? `存在 ${blockers.value.length} 项缺失或已失效产物，不能导出`
  : '当前范围无页面内阻塞；主按钮仍只进入演示状态');
const scopeLabel = computed(() => exportScope.value === 'chapter-12-13' ? '第 12–13 章' : '仅第 12 章');

function artifactClass(status: ExportArtifact['status']): string {
  if (status === 'ready')
    return 'is-success';
  if (status === 'stale')
    return 'is-stale';
  return 'is-error';
}

function artifactMark(status: ExportArtifact['status']): string {
  if (status === 'ready')
    return '✓';
  if (status === 'stale')
    return 'ⓧ';
  return '!';
}

function recheckArtifacts(): void {
  checkMessage.value = `已按当前页面固定产物重新计算：${blockers.value.length} 项阻塞`;
  activeState.value = isExportBlocked.value ? 'blocked' : 'idle';
  showDemoFeedback(checkMessage.value, isExportBlocked.value ? 'warning' : 'success');
}

function startExportDemo(): void {
  if (isExportBlocked.value)
    return;

  activeState.value = 'running';
  showDemoFeedback('已进入导出中演示状态，不会生成文件', 'info');
}

function cancelExportDemo(): void {
  activeState.value = isExportBlocked.value ? 'blocked' : 'idle';
  showDemoFeedback('已取消导出演示', 'info');
}

function openLocationDemo(): void {
  showDemoFeedback('打开所在位置入口已触发，不调用文件系统', 'info');
}

function navigateToOfflinePlayer(): void {
  void router.push({ name: getDemoPageRouteName('offline-player-export') });
}

function navigateToBackup(): void {
  void router.push({ name: getDemoPageRouteName('project-backup') });
}
</script>

<template>
  <PostWorkbenchFrame editor-label="tar 导出区">
    <header class="chapter-toolbar">
      <div class="chapter-context">
        <h2>导出 tar 包</h2>
        <p>范围：{{ scopeLabel }} · 输出位置仅作展示</p>
      </div>
      <div class="toolbar-spacer"></div>
      <ElTag :type="isExportBlocked ? 'danger' : 'success'" effect="plain">{{ blockers.length }} 项阻塞</ElTag>
      <ElButton data-testid="recheck-artifacts" @click="recheckArtifacts">重新检查产物</ElButton>
      <ElTooltip :content="exportReason" placement="bottom">
        <span>
          <ElButton
            data-testid="export-tar"
            :disabled="isExportBlocked"
            type="primary"
            @click="startExportDemo"
          >
            导出 tar 包
          </ElButton>
        </span>
      </ElTooltip>
    </header>

    <div class="post-content">
      <div class="post-content-inner export-layout">
        <section class="export-readiness" aria-label="导出清单">
          <article class="export-scope card">
            <header class="panel-header"><h3 class="section-title">导出范围与有效版本</h3></header>
            <div class="scope-selector">
              <ElButton
                :type="exportScope === 'chapter-12-13' ? 'primary' : 'default'"
                data-testid="scope-chapters-12-13"
                @click="exportScope = 'chapter-12-13'; activeState = 'blocked'"
              >
                第 12–13 章
              </ElButton>
              <ElButton
                :type="exportScope === 'chapter-12' ? 'primary' : 'default'"
                data-testid="scope-chapter-12"
                @click="exportScope = 'chapter-12'; activeState = 'idle'"
              >
                仅第 12 章
              </ElButton>
            </div>
            <div class="scope-grid">
              <div class="scope-card">
                <div class="scope-block"><span class="caption">章节</span><strong>{{ scopeLabel }}</strong></div>
                <div class="scope-block"><span class="caption">剧本</span><strong class="state-success">v18 · 当前有效</strong></div>
                <div class="scope-block"><span class="caption">章节摘要</span><strong class="state-success">v3 · 当前有效</strong></div>
              </div>
              <div class="scope-card is-wide">
                <div class="scope-block"><span class="caption">章节音频</span><strong :class="isExportBlocked ? 'state-error' : 'state-success'">{{ isExportBlocked ? '第 13 章缺失' : '第 12 章当前有效' }}</strong></div>
                <div class="scope-block"><span class="caption">章节封面</span><strong :class="isExportBlocked ? 'state-stale' : 'state-success'">{{ isExportBlocked ? '第 13 章已失效' : '候选 02 当前有效' }}</strong></div>
                <div class="scope-block"><span class="caption">输出位置</span><strong>~/Exports/VoxWeaver/</strong></div>
              </div>
            </div>
          </article>

          <article class="required-files card">
            <header class="panel-header"><h3 class="section-title">文件清单</h3><span class="caption">4 类必需产物</span></header>
            <div class="file-list">
              <div v-for="artifact in currentArtifacts" :key="artifact.label" class="file-row" :class="artifactClass(artifact.status)">
                <span>{{ artifactMark(artifact.status) }}</span><strong>{{ artifact.label }}</strong><span>{{ artifact.detail }}<template v-if="artifact.status !== 'ready'"> · 阻塞</template></span>
              </div>
            </div>
          </article>

          <article class="blocking-list card" :class="{ 'is-clear': !isExportBlocked }">
            <header class="panel-header">
              <h3 class="section-title">阻塞清单</h3>
              <strong class="label">{{ isExportBlocked ? '不能导出成功包' : '无页面内阻塞' }}</strong>
            </header>
            <template v-if="isExportBlocked">
              <span v-for="blocker in blockers" :key="blocker.label" class="caption">{{ artifactMark(blocker.status) }} {{ blocker.label }}：{{ blocker.detail }}</span>
            </template>
            <span v-else class="caption state-success">✓ 固定产物均为当前有效展示状态</span>
            <span class="caption" data-testid="export-check-message">{{ checkMessage }}</span>
          </article>

          <article class="tar-tree card">
            <header class="tree-header"><h3 class="section-title">tar 目录预览</h3><span class="caption state-warning">格式与实际文件名待确认</span></header>
            <div class="tree-box">
              <div class="tree-line">▾ voxweaver-chapters.tar · 仅展示</div>
              <div class="tree-line indent-1">▾ offline/</div>
              <button class="tree-line indent-2 tree-link" type="button" @click="navigateToOfflinePlayer">• index.html · 打开离线播放器预览 ↗</button>
              <div class="tree-line indent-1">▾ artwork/</div>
              <div class="tree-line indent-2" :class="isExportBlocked ? 'state-stale' : 'state-success'">• chapter.webp · {{ isExportBlocked ? '已失效 · 阻塞' : '当前有效' }}</div>
              <div class="tree-line indent-1">▾ timeline/</div>
              <div class="tree-line indent-2">• chapter.vtt · 时间轴字幕 · 待确认</div>
              <div class="tree-line indent-1">▾ audio/</div>
              <div class="tree-line indent-2" :class="isExportBlocked ? 'state-error' : 'state-success'">• chapter.wav · {{ isExportBlocked ? '缺失 · 阻塞' : '当前有效' }}</div>
              <div class="tree-line" :class="isExportBlocked ? 'state-error' : 'state-success'">{{ exportReason }}</div>
            </div>
          </article>
        </section>

        <aside class="export-states" aria-label="导出状态视图">
          <ElTabs v-model="activeState" class="export-tabs" stretch>
            <ElTabPane :label="isExportBlocked ? '阻塞' : '空闲'" :name="isExportBlocked ? 'blocked' : 'idle'">
              <article class="export-state-card card" :class="isExportBlocked ? 'is-error' : 'is-idle'">
                <h3 class="section-title">{{ isExportBlocked ? '当前范围：导出已阻塞' : '当前范围：空闲演示状态' }}</h3>
                <p class="body-text">{{ exportReason }}</p>
                <ElButton @click="navigateToOfflinePlayer">预览离线播放器</ElButton>
              </article>
            </ElTabPane>
            <ElTabPane label="导出中" name="running">
              <article class="export-state-card is-running card">
                <header class="panel-header"><h3 class="section-title">导出中 · 演示状态</h3><strong class="label">62%</strong></header>
                <div class="progress-track"></div>
                <strong class="body-strong">当前阶段：复制音频文件（视觉）</strong>
                <span class="caption">不会读取或生成任何文件</span>
                <div class="stage-box"><span class="state-success">✓ 离线页面　·　✓ 章节绘图</span><span>… 时间轴字幕　·　○ 音频文件</span></div>
                <ElButton data-testid="cancel-export" @click="cancelExportDemo">取消</ElButton>
              </article>
            </ElTabPane>
            <ElTabPane label="上次成功" name="success">
              <article class="export-state-card is-success card">
                <h3 class="section-title">上一次导出成功</h3>
                <strong class="body-strong">第 12 章 · 4 类产物 · 无阻塞</strong>
                <span class="caption">/Users/example/Exports/chapter-12.tar</span>
                <span class="body-text">大小与校验值均为既有展示数据</span>
                <div class="checksum-box">校验摘要：38 个音频片段<br>离线页 / 绘图 / 字幕 / 音频完整</div>
                <ElButton @click="openLocationDemo">打开所在位置</ElButton>
              </article>
            </ElTabPane>
          </ElTabs>

          <article class="export-state-card is-neutral card">
            <h3 class="section-title">成品导出与项目备份</h3>
            <p class="body-text">此处不包含项目备份。</p>
            <span class="caption">项目备份策略、位置与恢复说明由设置页面管理。</span>
            <ElButton text type="primary" data-testid="navigate-backup" @click="navigateToBackup">前往设置查看备份说明 ↗</ElButton>
          </article>
        </aside>
      </div>
    </div>
  </PostWorkbenchFrame>
</template>
