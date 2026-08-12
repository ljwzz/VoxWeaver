<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["workspace-view","workspace-view--text","workspace-view--sidebar-expanded"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 侧栏扩展静态展示">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver · 示例小说</p>
            <p class="window-context">项目工作台</p>
          </header>

          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组展示状态">
              <div class="activity-list">
                <div class="activity-item activity-item--selected" aria-label="文本整理，当前选中">
                  <span class="activity-glyph">文</span><span class="selection-bar" aria-hidden="true"></span>
                </div>
                <div class="activity-item activity-item--review" aria-label="角色管理，待复核">
                  <span class="activity-glyph">角</span><span class="activity-marker" aria-hidden="true">!</span>
                </div>
                <div class="activity-item activity-item--processing" aria-label="音频生成，处理中">
                  <span class="activity-glyph">音</span><span class="activity-marker" aria-hidden="true">◔</span>
                </div>
                <div class="activity-item activity-item--stale" aria-label="后期处理，已失效">
                  <span class="activity-glyph">后</span><span class="activity-marker" aria-hidden="true">↻</span>
                </div>
              </div>
              <div class="activity-item" aria-label="设置，展示状态"><span class="activity-glyph">设</span></div>
            </aside>

            <aside class="context-sidebar" aria-label="300 像素文本整理上下文侧栏">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header">
                    <div class="sidebar-heading-row">
                      <h1>文本整理</h1>
                      <span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span>
                    </div>
                    <p class="sidebar-subtitle">300 px · 编辑区仍为 Fill container</p>
                  </header>
                  <div class="sidebar-item sidebar-item--selected" aria-label="文本提取，已选择">
                    <span class="sidebar-state" aria-hidden="true">✓</span><span class="sidebar-label">文本提取</span><span class="sidebar-count">1</span>
                  </div>
                  <div class="sidebar-item sidebar-item--processing" aria-label="章节切割，处理中">
                    <span class="sidebar-state" aria-hidden="true">◔</span><span class="sidebar-label">章节切割</span><span class="sidebar-count">36</span>
                  </div>
                  <div class="sidebar-item sidebar-item--review" aria-label="错别字与标点，待复核">
                    <span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">错别字与标点</span><span class="sidebar-count">12</span>
                  </div>
                  <div class="sidebar-item sidebar-item--failed" aria-label="角色提取，失败">
                    <span class="sidebar-state" aria-hidden="true">×</span><span class="sidebar-label">角色提取</span><span class="sidebar-count">2</span>
                  </div>
                  <div class="sidebar-item sidebar-item--stale" aria-label="剧本管理，已失效">
                    <span class="sidebar-state" aria-hidden="true">↻</span><span class="sidebar-label">剧本管理</span><span class="sidebar-count">3</span>
                  </div>
                </div>
                <section class="sidebar-summary" aria-label="项目摘要"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-label="侧栏宽度调整把手，固定展示" aria-disabled="true"><span aria-hidden="true"></span></div>
            </aside>

            <section class="editor" aria-label="文本提取编辑区">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>文本提取</strong><span>·</span><span>示例小说.epub · 侧栏 300 px</span></div>
                <div class="toolbar-actions" aria-label="编辑区操作展示状态">
                  <span class="icon-button" aria-disabled="true">⋯</span>
                  <span class="toolbar-button toolbar-button--secondary" aria-disabled="true">查看问题</span>
                  <span class="toolbar-button toolbar-button--primary" aria-disabled="true">提取文本</span>
                </div>
              </header>
              <div class="editor-content">
                <p class="eyebrow">项目工作台</p>
                <h2>继续整理《示例小说》</h2>
                <p class="editor-description">当前停留在第 3 章。工作台壳层用于承载导航、状态和上下文，不替代具体业务页面。</p>
                <section class="state-summary" aria-label="项目状态摘要">
                  <article class="summary-card"><p>当前章节</p><strong>第 3 章 · 雨夜</strong></article>
                  <article class="summary-card"><p>总进度</p><strong>62% · 22 / 36 章</strong></article>
                  <article class="summary-card"><p>待复核</p><strong>12 项</strong></article>
                  <article class="summary-card"><p>已失效</p><strong>3 项</strong></article>
                </section>
                <section class="continue-card" aria-label="继续上次工作，仅展示"><h3>继续上次工作</h3><p>章节切割 · 第 3 章边界待确认</p></section>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
