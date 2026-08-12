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
    <main class="workspace" aria-label="VoxWeaver 章节切割静态页面">
          <header class="window-titlebar"><img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt=""><p class="window-title">VoxWeaver · 示例小说</p><p class="window-context">项目工作台</p></header>
          <div class="workspace-body">
            <aside class="activity-rail">
              <div class="activity-list">
                <div class="activity-item activity-item--selected"><span class="activity-glyph">文</span><span class="selection-bar"></span></div>
                <div class="activity-item activity-item--review"><span class="activity-glyph">角</span><span class="activity-marker">!</span></div>
                <div class="activity-item activity-item--processing"><span class="activity-glyph">音</span><span class="activity-marker">◔</span></div>
                <div class="activity-item activity-item--stale"><span class="activity-glyph">后</span><span class="activity-marker">↻</span></div>
              </div><div class="activity-item"><span class="activity-glyph">设</span></div>
            </aside>
            <aside class="context-sidebar">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header"><div class="sidebar-heading-row"><h1>文本整理</h1><span class="sidebar-actions"><span>＋</span><span>⋯</span></span></div><p class="sidebar-subtitle">5 个子功能 · 12 项待复核</p></header>
                  <div class="sidebar-item sidebar-item--default"><span class="sidebar-state"></span><span class="sidebar-label">文本提取</span><span class="sidebar-count">1</span></div>
                  <div class="sidebar-item sidebar-item--selected"><span class="sidebar-state">✓</span><span class="sidebar-label">章节切割</span><span class="sidebar-count">36</span></div>
                  <div class="sidebar-item sidebar-item--review"><span class="sidebar-state">!</span><span class="sidebar-label">错别字与标点</span><span class="sidebar-count">12</span></div>
                  <div class="sidebar-item sidebar-item--failed"><span class="sidebar-state">×</span><span class="sidebar-label">角色提取</span><span class="sidebar-count">2</span></div>
                  <div class="sidebar-item sidebar-item--stale"><span class="sidebar-state">↻</span><span class="sidebar-label">剧本管理</span><span class="sidebar-count">3</span></div>
                </div>
                <section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div><div class="resize-handle" aria-disabled="true"><span></span></div>
            </aside>
            <section class="editor">
              <header class="editor-toolbar"><div class="toolbar-context"><strong>章节切割</strong><span>·</span><span>36 章 · 未归属文本 218 字</span></div><div class="toolbar-actions"><span class="icon-button">⋯</span><span class="toolbar-button toolbar-button--secondary">自动检测边界</span><span class="toolbar-button toolbar-button--primary">确认章节结构</span></div></header>
              <div class="text-editor-content text-editor-content--wide">
                <div class="page-heading"><div class="page-heading-copy"><h2>章节切割</h2><p>章节序号与行号仅用于显示，不作为稳定 ID。</p></div><span class="status-badge status-badge--review">! 待复核</span></div>
                <div class="chapter-workspace">
                  <section class="chapter-tree">
                    <div class="card-header"><span class="strong">卷 / 章节树</span><span class="caption">2 卷 · 36 章</span></div>
                    <div class="tree-row"><span>⌄</span><span class="strong">第一卷 · 雨城</span><span></span></div>
                    <div class="tree-row tree-row--chapter"><span>01</span><span>第一章 · 雨夜</span><span></span></div>
                    <div class="tree-row tree-row--chapter"><span>02</span><span>第二章 · 旧信</span><span></span></div>
                    <div class="tree-row tree-row--chapter tree-row--selected"><span>03</span><span>第三章 · 门后的影子</span><span></span></div>
                    <div class="tree-row tree-row--chapter tree-row--issue"><span>04</span><span>第四章 · 空章节</span><span>!</span></div>
                    <div class="tree-row tree-row--issue"><span>⌄</span><span class="strong">第二卷 · 北境</span><span>!</span></div>
                    <div class="tree-row tree-row--chapter tree-row--issue"><span>19</span><span>第十九章 · 边界重叠</span><span>!</span></div>
                  </section>
                  <section class="surface-card chapter-editor-card">
                    <div class="row-between"><div class="chapter-editor-heading"><h3 class="card-title">第三章 · 门后的影子</h3><p class="caption">显示序号 03 · 1,280–2,140 字符</p></div><div class="chapter-editor-actions"><span class="text-button">修改章节名</span><span class="text-button">调整顺序</span><span class="text-button">拆分</span><span class="text-button">合并</span></div></div>
                    <div class="boundary"><span>上边界 · 第 1280 字</span><span>⋮⋮　拖动边界</span></div>
                    <div class="chapter-lines"><div class="line-numbers">1280<br>1281<br>1282<br>1283<br>1284<br>1285<br>1286</div><div class="chapter-copy-lines">门轴发出一声轻响。<br>林舟停在原地，雨水从衣角滴落。<br>走廊深处没有灯，只有一线冷风从门缝钻出。<br><br>“别回头。”沈砚在身后说。<br><br>林舟却已经看见门后的影子。</div></div>
                    <div class="boundary"><span>下边界 · 第 2140 字</span><span>⋮⋮　拖动边界</span></div>
                    <p class="body-copy" style="color: var(--vw-text-secondary)">边界调整会重新计算章节内容范围；保存前问题列表必须清零。</p>
                  </section>
                </div>
                <div class="section-header" style="width: 100%"><span class="strong">章节结构问题</span><span class="caption" style="color: var(--vw-state-error)">3 项需要处理</span></div>
                <div class="issue-grid">
                  <section class="surface-card issue-card issue-card--error"><div class="row-between"><span class="strong">空章节</span><span class="status-badge status-badge--error">× 失败</span></div><p class="body-copy" style="color: var(--vw-text-secondary)">第四章没有归属文本</p></section>
                  <section class="surface-card issue-card issue-card--error"><div class="row-between"><span class="strong">重叠边界</span><span class="status-badge status-badge--error">× 失败</span></div><p class="body-copy" style="color: var(--vw-text-secondary)">第 18 / 19 章重叠 42 字</p></section>
                  <section class="surface-card issue-card issue-card--stale"><div class="row-between"><span class="strong">未归属文本</span><span class="status-badge status-badge--stale">↻ 已失效</span></div><p class="body-copy" style="color: var(--vw-text-secondary)">卷首 218 字尚未归属</p></section>
                </div>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
