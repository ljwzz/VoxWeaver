<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from './styles.css?inline';

const bodyClasses = ["workspace-view","workspace-view--settings"] as const;
const styleSheets = [pageStyles1] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 项目设置静态展示">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver · 示例小说</p>
            <p class="window-context">项目工作台</p>
          </header>

          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组展示状态">
              <div class="activity-list">
                <div class="activity-item" aria-label="文本整理，展示状态"><span class="activity-glyph">文</span></div>
                <div class="activity-item" aria-label="角色管理，展示状态"><span class="activity-glyph">角</span></div>
                <div class="activity-item" aria-label="音频生成，展示状态"><span class="activity-glyph">音</span></div>
                <div class="activity-item" aria-label="后期处理，展示状态"><span class="activity-glyph">后</span></div>
              </div>
              <div class="activity-item activity-item--selected" aria-label="设置，当前选中">
                <span class="activity-glyph">设</span>
                <span class="selection-bar" aria-hidden="true"></span>
              </div>
            </aside>

            <aside class="context-sidebar" aria-label="设置上下文侧栏">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header">
                    <div class="sidebar-heading-row">
                      <h1>设置</h1>
                      <span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span>
                    </div>
                    <p class="sidebar-subtitle">本地项目配置</p>
                  </header>

                  <div class="sidebar-item sidebar-item--selected" aria-label="Provider 接入，已选择">
                    <span class="sidebar-state" aria-hidden="true">✓</span><span class="sidebar-label">Provider 接入</span><span class="sidebar-count">2</span>
                  </div>
                  <div class="sidebar-item sidebar-item--default" aria-label="项目与存储，展示状态">
                    <span class="sidebar-state" aria-hidden="true"></span><span class="sidebar-label">项目与存储</span><span class="sidebar-count">1</span>
                  </div>
                  <div class="sidebar-item sidebar-item--default" aria-label="音频与导出，展示状态">
                    <span class="sidebar-state" aria-hidden="true"></span><span class="sidebar-label">音频与导出</span><span class="sidebar-count">4</span>
                  </div>
                  <div class="sidebar-item sidebar-item--default" aria-label="快捷键，展示状态">
                    <span class="sidebar-state" aria-hidden="true"></span><span class="sidebar-label">快捷键</span><span class="sidebar-count">12</span>
                  </div>
                  <div class="sidebar-item sidebar-item--review" aria-label="辅助功能，待复核">
                    <span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">辅助功能</span><span class="sidebar-count">2</span>
                  </div>
                </div>

                <section class="sidebar-summary" aria-label="项目摘要"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"><span aria-hidden="true"></span></div>
            </aside>

            <section class="editor" aria-label="项目设置编辑区">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>设置</strong><span>·</span><span>仅作用于当前项目</span></div>
                <div class="toolbar-actions" aria-label="编辑区操作展示状态">
                  <span class="icon-button" aria-disabled="true">⋯</span>
                  <span class="toolbar-button toolbar-button--secondary" aria-disabled="true">查看问题</span>
                  <span class="toolbar-button toolbar-button--primary" aria-disabled="true">提取文本</span>
                </div>
              </header>

              <div class="editor-content editor-content--overview">
                <p class="eyebrow">项目工作台</p>
                <h2>项目设置</h2>
                <p class="editor-description">配置 Provider、存储、导出与键盘操作。设置入口始终固定在功能栏左下角。</p>
                <section class="context-state context-state--settings" aria-label="项目级设置">
                  <h3 class="context-state-title"><span class="context-state-icon" aria-hidden="true">⌘</span><span>项目级设置</span></h3>
                  <p>键盘焦点、Provider 与导出配置集中在此。</p>
                </section>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
