<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["text-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 错别字与标点静态页面">
          <header class="window-titlebar"><img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt=""><p class="window-title">VoxWeaver · 示例小说</p><p class="window-context">项目工作台</p></header>
          <div class="workspace-body">
            <aside class="activity-rail"><div class="activity-list"><div class="activity-item activity-item--selected"><span class="activity-glyph">文</span><span class="selection-bar"></span></div><div class="activity-item activity-item--review"><span class="activity-glyph">角</span><span class="activity-marker">!</span></div><div class="activity-item activity-item--processing"><span class="activity-glyph">音</span><span class="activity-marker">◔</span></div><div class="activity-item activity-item--stale"><span class="activity-glyph">后</span><span class="activity-marker">↻</span></div></div><div class="activity-item"><span class="activity-glyph">设</span></div></aside>
            <aside class="context-sidebar">
              <div class="sidebar-content"><div class="sidebar-top">
                <header class="sidebar-header"><div class="sidebar-heading-row"><h1>文本整理</h1><span class="sidebar-actions"><span>＋</span><span>⋯</span></span></div><p class="sidebar-subtitle">5 个子功能 · 12 项待复核</p></header>
                <div class="sidebar-item sidebar-item--default"><span class="sidebar-state"></span><span class="sidebar-label">文本提取</span><span class="sidebar-count">1</span></div>
                <div class="sidebar-item sidebar-item--processing"><span class="sidebar-state">◔</span><span class="sidebar-label">章节切割</span><span class="sidebar-count">36</span></div>
                <div class="sidebar-item sidebar-item--selected"><span class="sidebar-state">✓</span><span class="sidebar-label">错别字与标点</span><span class="sidebar-count">12</span></div>
                <div class="sidebar-item sidebar-item--failed"><span class="sidebar-state">×</span><span class="sidebar-label">角色提取</span><span class="sidebar-count">2</span></div>
                <div class="sidebar-item sidebar-item--stale"><span class="sidebar-state">↻</span><span class="sidebar-label">剧本管理</span><span class="sidebar-count">3</span></div>
              </div><section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section></div><div class="resize-handle" aria-disabled="true"><span></span></div>
            </aside>
            <section class="editor">
              <header class="editor-toolbar"><div class="toolbar-context"><strong>错别字与标点</strong><span>·</span><span>第 3 章 · 已处理 18 / 待处理 7</span></div><div class="toolbar-actions"><span class="icon-button">⋯</span><span class="toolbar-button toolbar-button--secondary">批量操作</span><span class="toolbar-button toolbar-button--primary">下一项</span></div></header>
              <div class="text-editor-content text-editor-content--wide">
                <div class="page-heading"><div class="page-heading-copy"><h2>错别字与标点</h2><p>本章已处理 18 项 · 待处理 7 项</p></div><span class="status-badge status-badge--review">! 待复核</span></div>
                <div class="filter-row">
                  <div class="static-filter" style="width: 420px"><div class="static-filter-copy"><span class="static-filter-label">章节</span><span class="static-filter-value">第 3 章 · 门后的影子</span></div><span class="caption">⌄</span></div>
                  <div class="static-filter" style="width: 320px"><div class="static-filter-copy"><span class="static-filter-label">问题类型</span><span class="static-filter-value">错别字与标点</span></div><span class="caption">⌄</span></div>
                  <div class="static-filter" style="width: 336px"><div class="static-filter-copy"><span class="static-filter-label">置信状态</span><span class="static-filter-value">高置信 + 待确认</span></div><span class="caption">⌄</span></div>
                </div>
                <section class="surface-card proofreading-card">
                  <div class="row-between"><div style="display: flex; align-items: center; gap: 10px"><span class="strong">标点 · 高置信</span><span class="caption">第 3 章 · 显示行 1283</span></div><span class="status-badge status-badge--review">! 待复核</span></div>
                  <div class="comparison-grid">
                    <div class="comparison-cell"><span class="preview-tag" style="color: var(--vw-text-secondary)">原文</span><p class="body-large">他低声说道：“别回头。</p></div>
                    <div class="comparison-cell comparison-cell--candidate"><span class="preview-tag" style="color: var(--vw-text-secondary)">修改候选</span><p class="body-large">他低声说道：“别回头。”</p></div>
                    <div class="comparison-cell"><span class="preview-tag" style="color: var(--vw-text-secondary)">上下文</span><p class="body-large">雨声渐密，走廊尽头传来脚步。林舟却已经看见门缝后的影子。</p></div>
                  </div>
                  <div class="impact-callout"><span class="impact-badge">链&nbsp; 音频 2 · 时间轴 1</span><p class="body-copy">若接受，此修改可能影响剧本正文、已生成音频与后续时间轴；当前仅提示影响，尚未执行失效标记。</p></div>
                  <div class="card-actions"><span class="text-button">手动编辑</span><span class="text-button">保留原文</span><span class="text-button text-button--primary">接受建议</span></div>
                </section>
                <div class="section-header" style="width: 100%"><span class="strong">本章问题队列</span><span class="caption">已处理 18 · 待处理 7</span></div>
                <div class="issue-queue">
                  <div class="surface-card queue-row"><div class="queue-copy"><span class="caption">1284</span><span>“沈砚”疑似误写为“沈研”</span><span class="caption">系统候选 · 待复核</span></div><span class="status-badge status-badge--review">! 待复核</span></div>
                  <div class="surface-card queue-row"><div class="queue-copy"><span class="caption">1290</span><span>连续三个省略号可能需要规范</span><span class="caption">已保留原文</span></div><span class="status-badge status-badge--neutral">• 默认</span></div>
                  <div class="surface-card queue-row"><div class="queue-copy"><span class="caption">1302</span><span>句尾缺少闭合引号</span><span class="caption">建议已接受</span></div><span class="status-badge status-badge--success">✓ 已完成</span></div>
                </div>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
