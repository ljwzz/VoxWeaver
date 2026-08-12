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
    <main class="workspace" aria-label="VoxWeaver 文本提取静态页面">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver · 示例小说</p>
            <p class="window-context">项目工作台</p>
          </header>

          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组状态">
              <div class="activity-list">
                <div class="activity-item activity-item--selected"><span class="activity-glyph">文</span><span class="selection-bar"></span></div>
                <div class="activity-item activity-item--review"><span class="activity-glyph">角</span><span class="activity-marker">!</span></div>
                <div class="activity-item activity-item--processing"><span class="activity-glyph">音</span><span class="activity-marker">◔</span></div>
                <div class="activity-item activity-item--stale"><span class="activity-glyph">后</span><span class="activity-marker">↻</span></div>
              </div>
              <div class="activity-item"><span class="activity-glyph">设</span></div>
            </aside>

            <aside class="context-sidebar" aria-label="文本整理子功能">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header">
                    <div class="sidebar-heading-row"><h1>文本整理</h1><span class="sidebar-actions"><span>＋</span><span>⋯</span></span></div>
                    <p class="sidebar-subtitle">5 个子功能 · 12 项待复核</p>
                  </header>
                  <div class="sidebar-item sidebar-item--selected"><span class="sidebar-state">✓</span><span class="sidebar-label">文本提取</span><span class="sidebar-count">1</span></div>
                  <div class="sidebar-item sidebar-item--processing"><span class="sidebar-state">◔</span><span class="sidebar-label">章节切割</span><span class="sidebar-count">36</span></div>
                  <div class="sidebar-item sidebar-item--review"><span class="sidebar-state">!</span><span class="sidebar-label">错别字与标点</span><span class="sidebar-count">12</span></div>
                  <div class="sidebar-item sidebar-item--failed"><span class="sidebar-state">×</span><span class="sidebar-label">角色提取</span><span class="sidebar-count">2</span></div>
                  <div class="sidebar-item sidebar-item--stale"><span class="sidebar-state">↻</span><span class="sidebar-label">剧本管理</span><span class="sidebar-count">3</span></div>
                </div>
                <section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"><span></span></div>
            </aside>

            <section class="editor" aria-label="文本提取编辑区">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>文本提取</strong><span>·</span><span>示例小说.epub · EPUB · UTF-8 已识别</span></div>
                <div class="toolbar-actions"><span class="icon-button" aria-disabled="true">⋯</span><span class="toolbar-button toolbar-button--secondary" aria-disabled="true">查看警告</span><span class="toolbar-button toolbar-button--primary" aria-disabled="true">提取文本</span></div>
              </header>

              <div class="text-editor-content extraction-content">
                <div class="page-heading">
                  <div class="page-heading-copy"><h2>文本提取</h2><p>源文件保持只读；提取结果进入审核流程。</p></div>
                  <span class="status-badge status-badge--processing">◔ <span>处理中</span></span>
                </div>

                <section class="processing-banner">
                  <div class="processing-copy">
                    <h3>处理中 · 72%</h3>
                    <p class="body-copy" style="color: var(--vw-text-secondary)">当前阶段：解析 EPUB 章节索引。警告 2 项；失败阶段可单独重试，不回写源文件。</p>
                    <div class="progress-wrap"><div class="progress-track"><div class="progress-value"></div></div></div>
                  </div>
                  <span class="text-button" aria-disabled="true">重试失败阶段</span>
                </section>

                <div class="preview-grid">
                  <section class="surface-card preview-card preview-card--source">
                    <div class="card-header"><h3 class="card-title">项目内源文件预览</h3><span class="preview-tag" style="color: var(--vw-text-secondary)">只读源内容</span></div>
                    <p class="caption">1.8 MB · EPUB · UTF-8 · 未修改</p>
                    <div class="preview-text">
                      <p>第一章　雨夜</p>
                      <p aria-hidden="true">&nbsp;</p>
                      <p>雨声从檐角落下，像一条断断续续的线。<br>林舟站在门边，没有回头。</p>
                      <p aria-hidden="true">&nbsp;</p>
                      <p>第二章　旧信</p>
                      <p aria-hidden="true">&nbsp;</p>
                      <p>信封边缘已经发黄，署名只剩一个模糊的“沈”字。</p>
                    </div>
                  </section>
                  <section class="surface-card preview-card">
                    <div class="card-header"><h3 class="card-title">提取文本预览</h3><span class="preview-tag preview-tag--accent">可审核结果</span></div>
                    <p class="caption">已解析 22 / 36 章 · 当前结果未确认</p>
                    <div class="preview-text">
                      <p>第一章　雨夜</p>
                      <p aria-hidden="true">&nbsp;</p>
                      <p>雨声从檐角落下，像一条断断续续的线。林舟站在门边，没有回头。</p>
                      <p aria-hidden="true">&nbsp;</p>
                      <p>第二章　旧信</p>
                      <p aria-hidden="true">&nbsp;</p>
                      <p>信封边缘已经发黄，署名只剩一个模糊的“沈”字。</p>
                    </div>
                    <p class="preview-warning">!&nbsp; 2 处疑似脚注顺序异常，等待审核。</p>
                  </section>
                </div>

                <h3 class="state-example-title">组件状态示例</h3>
                <div class="state-grid">
                  <section class="surface-card state-card"><div class="row-between"><span class="strong">尚未提取</span><span class="status-badge status-badge--neutral">• 默认</span></div><p class="caption">选择源文件后开始</p></section>
                  <section class="surface-card state-card"><div class="row-between"><span class="strong">提取中</span><span class="status-badge status-badge--processing">◔ 处理中</span></div><p class="caption">72% · 解析章节索引</p></section>
                  <section class="surface-card state-card state-card--error"><div class="row-between"><span class="strong">提取失败</span><span class="status-badge status-badge--error">× 失败</span></div><p class="caption">阶段：解析 EPUB 索引</p></section>
                  <section class="surface-card state-card state-card--success"><div class="row-between"><span class="strong">提取成功</span><span class="status-badge status-badge--success">✓ 已完成</span></div><p class="caption">36 章 · 等待审核</p></section>
                </div>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
