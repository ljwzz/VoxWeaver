<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["workspace-view","workspace-view--keyboard-focus"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 键盘焦点顺序静态展示">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver · 示例小说</p>
            <p class="window-context">项目工作台</p>
          </header>

          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组焦点状态展示">
              <div class="activity-list">
                <div class="activity-item activity-item--focus" aria-label="文本整理，键盘焦点状态"><span class="activity-glyph">文</span></div>
                <div class="activity-item activity-item--review" aria-label="角色管理，待复核"><span class="activity-glyph">角</span><span class="activity-marker" aria-hidden="true">!</span></div>
                <div class="activity-item activity-item--processing" aria-label="音频生成，处理中"><span class="activity-glyph">音</span><span class="activity-marker" aria-hidden="true">◔</span></div>
                <div class="activity-item activity-item--stale" aria-label="后期处理，已失效"><span class="activity-glyph">后</span><span class="activity-marker" aria-hidden="true">↻</span></div>
              </div>
              <div class="activity-item" aria-label="设置，展示状态"><span class="activity-glyph">设</span></div>
            </aside>

            <aside class="context-sidebar" aria-label="文本整理上下文侧栏">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header">
                    <div class="sidebar-heading-row"><h1>文本整理</h1><span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span></div>
                    <p class="sidebar-subtitle">5 个子功能 · 12 项待复核</p>
                  </header>
                  <div class="sidebar-item sidebar-item--focus" aria-label="文本提取，键盘焦点状态"><span class="sidebar-state" aria-hidden="true">⌁</span><span class="sidebar-label">文本提取</span><span class="sidebar-count">1</span></div>
                  <div class="sidebar-item sidebar-item--processing" aria-label="章节切割，处理中"><span class="sidebar-state" aria-hidden="true">◔</span><span class="sidebar-label">章节切割</span><span class="sidebar-count">36</span></div>
                  <div class="sidebar-item sidebar-item--review" aria-label="错别字与标点，待复核"><span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">错别字与标点</span><span class="sidebar-count">12</span></div>
                  <div class="sidebar-item sidebar-item--failed" aria-label="角色提取，失败"><span class="sidebar-state" aria-hidden="true">×</span><span class="sidebar-label">角色提取</span><span class="sidebar-count">2</span></div>
                  <div class="sidebar-item sidebar-item--stale" aria-label="剧本管理，已失效"><span class="sidebar-state" aria-hidden="true">↻</span><span class="sidebar-label">剧本管理</span><span class="sidebar-count">3</span></div>
                </div>
                <section class="sidebar-summary" aria-label="项目摘要"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-label="侧栏宽度调整把手，固定展示" aria-disabled="true"><span aria-hidden="true"></span></div>
            </aside>

            <section class="editor" aria-label="键盘焦点顺序说明">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>文本提取</strong><span>·</span><span>示例小说.epub · EPUB / UTF-8</span></div>
                <div class="toolbar-actions" aria-label="编辑区操作焦点状态展示">
                  <span class="icon-button" aria-disabled="true">⋯</span>
                  <span class="toolbar-button toolbar-button--secondary" aria-disabled="true">查看问题</span>
                  <span class="toolbar-button toolbar-button--primary toolbar-button--focus" aria-disabled="true">提取文本</span>
                </div>
              </header>
              <div class="editor-content">
                <p class="eyebrow">键盘操作</p>
                <h2>可见的键盘焦点顺序</h2>
                <p class="editor-description">焦点样式同时使用外轮廓与顺序编号，不依赖悬停或颜色。Tab 与 Shift+Tab 依次移动。</p>
                <section class="focus-order-guide" aria-label="固定展示的键盘焦点顺序">
                  <p class="focus-step"><span class="focus-step-number">1</span><span>功能分组：文本整理</span></p>
                  <p class="focus-step"><span class="focus-step-number">2</span><span>子功能：文本提取</span></p>
                  <p class="focus-step"><span class="focus-step-number">3</span><span>上下文操作：添加 / 更多</span></p>
                  <p class="focus-step"><span class="focus-step-number">4</span><span>编辑区工具栏：更多</span></p>
                  <p class="focus-step"><span class="focus-step-number">5</span><span>编辑区次要操作：查看问题</span></p>
                  <p class="focus-step"><span class="focus-step-number">6</span><span>编辑区主操作：提取文本</span></p>
                  <p class="focus-step"><span class="focus-step-number">7</span><span>正文可交互内容</span></p>
                  <p class="focus-step"><span class="focus-step-number">8</span><span>左下设置</span></p>
                </section>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
