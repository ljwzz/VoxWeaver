<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["settings-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="settings-workspace" aria-label="项目备份静态页面">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver / Project Workspace</p>
            <p class="window-context"><span class="viewport-1440">1440 × 900</span><span class="viewport-1280">1280 × 800</span></p>
          </header>

          <div class="settings-shell">
            <aside class="settings-rail" aria-label="功能分组">
              <div class="settings-rail-list">
                <span class="settings-activity static-control" tabindex="-1">文</span>
                <span class="settings-activity static-control" tabindex="-1">角</span>
                <span class="settings-activity static-control" tabindex="-1">音</span>
                <span class="settings-activity static-control" tabindex="-1">后</span>
              </div>
              <span class="settings-activity settings-activity--selected static-control" aria-current="page">设</span>
            </aside>

            <aside class="settings-sidebar" aria-label="设置子功能">
              <div class="settings-sidebar-content">
                <div class="settings-sidebar-top">
                  <header class="settings-sidebar-header"><h1>设置</h1><p>项目与软件配置</p></header>
                  <span class="settings-nav-item settings-nav-item--selected static-control" aria-current="page"><span class="settings-nav-state">✓</span><span class="settings-nav-label">项目备份</span></span>
                  <span class="settings-nav-item static-control"><span class="settings-nav-state">•</span><span class="settings-nav-label">项目设置</span></span>
                  <span class="settings-nav-item static-control"><span class="settings-nav-state">•</span><span class="settings-nav-label">软件设置</span></span>
                </div>
                <div class="settings-sidebar-summary"><strong>Project VoxWeaver</strong><span>设置按作用范围分层</span></div>
              </div>
              <div class="settings-resize-handle" aria-label="侧栏宽度调整入口，仅展示"></div>
            </aside>

            <section class="settings-editor" aria-label="项目备份编辑区">
              <header class="settings-toolbar"><strong>项目备份</strong><span>·</span><span>当前项目 · 完整制作状态恢复</span></header>
              <div class="settings-content">
                <section class="settings-card backup-header" aria-label="当前项目备份摘要">
                  <div class="backup-field backup-field--project"><span class="label">当前项目</span><strong>Project VoxWeaver</strong><span class="hint">当前打开的本地项目</span></div>
                  <div class="backup-field backup-field--path"><span class="label">项目位置</span><strong>/Projects/VoxWeaver/Demo</strong><span class="hint">示例路径 · 完整路径可查看</span></div>
                  <div class="backup-field backup-field--last"><span class="label">最近一次成功备份</span><strong>2026-08-11 10:42</strong><span class="hint">v0.9.12 · 1.84 GB</span></div>
                  <span class="backup-header-spacer"></span>
                  <span class="primary-action static-control">立即备份<span class="shortcut">⌘↵</span></span>
                </section>

                <section class="backup-boundary" aria-label="备份与导出的边界说明"><span class="info-mark">i</span><span>项目备份用于恢复完整制作状态；后期处理中的导出用于交付成品。</span></section>

                <section class="settings-card backup-target" aria-label="备份目标位置">
                  <div class="backup-target-copy"><span>备份目标位置</span><strong>/Volumes/Archive/VoxWeaver/Backups（示例）</strong></div>
                  <span class="chip chip--warning">位置选择方式待确认</span>
                </section>

                <header class="backup-heading">
                  <div class="backup-heading-copy"><h2>备份历史</h2><p>版本、大小、状态、失败原因与恢复入口</p></div>
                  <div class="backup-legend" aria-label="备份状态图例"><span class="chip chip--success">成功</span><span class="chip chip--warning">备份中</span><span class="chip chip--error">失败</span></div>
                </header>

                <section class="backup-list" aria-label="备份历史固定数据">
                  <article class="backup-row">
                    <span class="backup-status-icon backup-status-icon--success">✓</span>
                    <div class="backup-identity"><strong>v0.9.12</strong><span>2026-08-11 10:42</span></div>
                    <span class="backup-size">1.84 GB</span>
                    <div class="backup-status-copy backup-status-copy--success"><strong>备份成功</strong><small>完整状态可用于恢复</small></div>
                    <p class="backup-reason">—</p>
                    <div class="backup-actions"><span>恢复</span><span>打开所在位置</span><span>删除（候选）</span></div>
                  </article>

                  <article class="backup-row">
                    <span class="backup-status-icon backup-status-icon--progress">…</span>
                    <div class="backup-identity"><strong>v0.9.13</strong><span>2026-08-11 12:06</span></div>
                    <span class="backup-size">计算中</span>
                    <div class="backup-status-copy backup-status-copy--progress"><strong>备份中</strong><small>正在校验并写入制作状态</small></div>
                    <p class="backup-reason">阶段 2/4 · 正在写入音频索引</p>
                    <div class="backup-actions"><span>恢复</span><span>打开所在位置</span><span>删除（候选）</span></div>
                  </article>

                  <article class="backup-row">
                    <span class="backup-status-icon backup-status-icon--error">!</span>
                    <div class="backup-identity"><strong>v0.9.11</strong><span>2026-08-10 22:18</span></div>
                    <span class="backup-size">—</span>
                    <div class="backup-status-copy backup-status-copy--error"><strong>备份失败</strong><small>目标磁盘空间不足；当前项目未受影响</small></div>
                    <p class="backup-reason">失败原因：目标磁盘空间不足</p>
                    <div class="backup-actions"><span>恢复</span><span>打开所在位置</span><span>删除（候选）</span></div>
                  </article>

                  <article class="backup-row backup-row--selected">
                    <span class="backup-status-icon backup-status-icon--restore">↺</span>
                    <div class="backup-identity"><strong>v0.9.10</strong><span>2026-08-10 18:25</span></div>
                    <span class="backup-size">1.78 GB</span>
                    <div class="backup-status-copy backup-status-copy--restore"><strong>可恢复</strong><small>已选择该版本，恢复前需要确认</small></div>
                    <p class="backup-reason">恢复将覆盖当前未备份的制作状态</p>
                    <div class="backup-actions"><span>恢复</span><span>打开所在位置</span><span>删除（候选）</span></div>
                  </article>
                </section>

                <p class="scope-note"><span class="info-mark">ⓘ</span><span>备份容器格式、保留策略与删除恢复能力均待确认；删除仅作为候选操作。</span></p>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
