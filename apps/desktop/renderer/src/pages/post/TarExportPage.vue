<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["post-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main aria-label="VoxWeaver 后期处理 tar 导出静态页面">
          <header class="post-titlebar"><img src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true"><strong>VoxWeaver · 示例小说</strong><span>项目工作台</span></header>
          <div class="post-shell">
            <aside class="post-activity" aria-label="功能分组展示状态"><div class="activity-stack"><span class="post-activity-item">文</span><span class="post-activity-item">角</span><span class="post-activity-item">音</span><span class="post-activity-item is-current">后</span></div><span class="post-activity-item">设</span></aside>
            <aside class="post-sidebar" aria-label="后期处理导航展示状态"><div class="post-sidebar-main"><header class="post-sidebar-header"><div class="post-sidebar-heading"><h1>后期处理</h1><span class="post-sidebar-actions static-control" aria-disabled="true"><span>＋</span><span>⋯</span></span></div><p>章节后期处理 · 导出</p></header><p class="post-nav-group">章节后期处理</p>
              <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">▾ 章节音频合并</span><span class="post-nav-count">2</span></div><div class="post-nav-item is-child"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">时间轴对齐</span><span class="post-nav-count">3</span></div><div class="post-nav-item is-child"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">响度一致性</span><span class="post-nav-count">4</span></div><div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">章节摘要生成</span><span class="post-nav-count">1</span></div><div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">章节封面生成</span><span class="post-nav-count">2</span></div><div class="post-nav-divider"></div><p class="post-nav-group">导出</p><div class="post-nav-item is-current"><span class="post-nav-mark">✓</span><span class="post-nav-label">导出 tar 包</span><span class="post-nav-count">2</span></div><div class="post-sidebar-spacer"></div><div class="post-sidebar-summary"><span>第 12 章 · 38 个有效片段</span><span>2 缺失 · 1 已失效</span></div>
            </div><div class="post-resize-handle static-control" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"></div></aside>
            <section class="post-editor" aria-label="tar 导出区">
              <header class="chapter-toolbar"><div class="chapter-context" style="width:430px"><h2>导出 tar 包</h2><p>范围：第 12–13 章 · 输出：~/Exports/VoxWeaver/</p></div><div class="toolbar-spacer"></div><span class="chip is-error">2 项阻塞</span><span class="display-button static-control" aria-disabled="true">重新检查产物</span><span class="display-button is-disabled static-control" aria-disabled="true">导出 tar 包</span></header>
              <div class="post-content"><div class="post-content-inner export-layout">
                <section class="export-readiness" aria-label="导出清单固定数据">
                  <article class="export-scope card"><header class="panel-header"><h3 class="section-title">导出范围与有效版本</h3></header><div class="scope-grid"><div class="scope-card"><div class="scope-block"><span class="caption">章节</span><strong>第 12–13 章</strong></div><div class="scope-block"><span class="caption">剧本</span><strong class="state-success">v18 · 当前有效</strong></div><div class="scope-block"><span class="caption">章节摘要</span><strong class="state-success">v3 · 当前有效</strong></div></div><div class="scope-card is-wide"><div class="scope-block"><span class="caption">章节音频</span><strong class="state-error">v7 · 第 13 章缺失</strong></div><div class="scope-block"><span class="caption">章节封面</span><strong class="state-stale">候选 02 · 第 13 章已失效</strong></div><div class="scope-block"><span class="caption">输出位置</span><strong>~/Exports/VoxWeaver/</strong></div></div></div></article>
                  <article class="required-files card"><header class="panel-header"><h3 class="section-title">文件清单</h3><span class="caption">4 类必需产物</span></header><div class="file-list"><div class="file-row is-success"><span>✓</span><strong>离线浏览器页面</strong><span>offline/index.html · 文件名待确认</span></div><div class="file-row is-stale"><span>ⓧ</span><strong>章节绘图</strong><span>chapter-13.webp · 已失效 · 阻塞</span></div><div class="file-row is-success"><span>✓</span><strong>时间轴歌词 / 字幕</strong><span>chapter-12.vtt · 格式待确认</span></div><div class="file-row is-error"><span>!</span><strong>音频文件</strong><span>chapter-13.wav · 缺失 · 阻塞</span></div></div></article>
                  <article class="blocking-list card"><header class="panel-header"><h3 class="section-title">阻塞清单</h3><strong class="label">不能导出成功包</strong></header><span class="caption state-stale">ⓧ 第 13 章封面：输入摘要已更新，产物已失效</span><span class="caption state-error">! 第 13 章音频：章节音频尚未生成</span></article>
                  <article class="tar-tree card"><header class="tree-header"><h3 class="section-title">tar 目录预览</h3><span class="caption state-warning">格式与实际文件名待确认</span></header><div class="tree-box"><div class="tree-line">▾ voxweaver-chapters-12-13.tar · 格式待确认</div><div class="tree-line indent-1">▾ offline/</div><div class="tree-line indent-2">• index.html · 文件名待确认</div><div class="tree-line indent-1">▾ artwork/</div><div class="tree-line indent-2 state-stale">• chapter-12.webp · ⓧ 已失效 · 阻塞</div><div class="tree-line indent-1">▾ timeline/</div><div class="tree-line indent-2">• chapter-12.vtt · 时间轴歌词/字幕 · 待确认</div><div class="tree-line indent-1">▾ audio/</div><div class="tree-line indent-2 state-error">• chapter-12.wav · ! 缺失 · 阻塞</div><div class="tree-line state-error">× 2 项阻塞：不能导出成功包</div></div></article>
                </section>
                <aside class="export-states" aria-label="导出运行状态固定示例">
                  <article class="export-state-card is-error card"><h3 class="section-title">当前范围：导出已阻塞</h3><p class="body-text">主按钮保持禁用；修复 2 项产物后重新检查。</p></article>
                  <article class="export-state-card is-running card"><header class="panel-header"><h3 class="section-title">导出中 · 运行态示例</h3><strong class="label">62%</strong></header><div class="progress-track"></div><strong class="body-strong">当前阶段：复制音频文件</strong><span class="caption">audio/chapter-12.wav · 24 / 38 个片段</span><div class="stage-box"><span class="state-success">✓ 离线页面　·　✓ 章节绘图</span><span>… 时间轴字幕　·　○ 音频文件</span></div><span class="display-button static-control" style="align-self:flex-start" aria-disabled="true">取消</span></article>
                  <article class="export-state-card is-success card"><h3 class="section-title">上一次导出成功</h3><strong class="body-strong">第 12 章 · 4 类产物 · 无阻塞</strong><span class="caption">/Users/example/Exports/chapter-12.tar</span><span class="body-text">大小：48.6 MB</span><span class="caption">SHA-256：9f2a…c817</span><div class="checksum-box">校验摘要：38 个音频片段<br>离线页 / 绘图 / 字幕 / 音频完整</div><span class="display-button static-control" style="align-self:flex-start" aria-disabled="true">打开所在位置</span></article>
                  <article class="export-state-card is-neutral card"><h3 class="section-title">成品导出与项目备份</h3><p class="body-text">此处只生成可交付的 tar 包，不包含项目备份入口。</p><span class="caption">项目备份策略、备份位置与恢复说明由设置页面管理。</span><span class="caption state-accent">前往设置查看备份说明 ↗</span></article>
                </aside>
              </div></div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
