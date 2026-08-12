<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from './styles.css?inline';

const bodyClasses = ["workspace-view","workspace-view--post"] as const;
const styleSheets = [pageStyles1] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 后期处理静态展示">
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
                <div class="activity-item activity-item--selected" aria-label="后期处理，当前选中">
                  <span class="activity-glyph">后</span>
                  <span class="selection-bar" aria-hidden="true"></span>
                </div>
              </div>
              <div class="activity-item" aria-label="设置，展示状态"><span class="activity-glyph">设</span></div>
            </aside>

            <aside class="context-sidebar" aria-label="后期处理上下文侧栏">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header">
                    <div class="sidebar-heading-row">
                      <h1>后期处理</h1>
                      <span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span>
                    </div>
                    <p class="sidebar-subtitle">5 个视图 · 3 项已失效</p>
                  </header>

                  <div class="sidebar-item sidebar-item--selected" aria-label="时间轴，已选择">
                    <span class="sidebar-state" aria-hidden="true">✓</span><span class="sidebar-label">时间轴</span><span class="sidebar-count">1</span>
                  </div>
                  <div class="sidebar-item sidebar-item--processing" aria-label="片段拼接，处理中">
                    <span class="sidebar-state" aria-hidden="true">◔</span><span class="sidebar-label">片段拼接</span><span class="sidebar-count">7</span>
                  </div>
                  <div class="sidebar-item sidebar-item--review" aria-label="环境与效果，待复核">
                    <span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">环境与效果</span><span class="sidebar-count">3</span>
                  </div>
                  <div class="sidebar-item sidebar-item--failed" aria-label="响度检查，失败">
                    <span class="sidebar-state" aria-hidden="true">×</span><span class="sidebar-label">响度检查</span><span class="sidebar-count">1</span>
                  </div>
                  <div class="sidebar-item sidebar-item--stale" aria-label="导出检查，已失效">
                    <span class="sidebar-state" aria-hidden="true">↻</span><span class="sidebar-label">导出检查</span><span class="sidebar-count">3</span>
                  </div>
                </div>

                <section class="sidebar-summary" aria-label="项目摘要"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"><span aria-hidden="true"></span></div>
            </aside>

            <section class="editor" aria-label="时间轴编辑区">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>时间轴</strong><span>·</span><span>第 3 章 · 时间轴 v4</span></div>
                <div class="toolbar-actions" aria-label="编辑区操作展示状态">
                  <span class="icon-button" aria-disabled="true">⋯</span>
                  <span class="toolbar-button toolbar-button--secondary" aria-disabled="true">查看问题</span>
                  <span class="toolbar-button toolbar-button--primary" aria-disabled="true">提取文本</span>
                </div>
              </header>

              <div class="editor-content editor-content--overview">
                <p class="eyebrow">项目工作台</p>
                <h2>后期处理</h2>
                <p class="editor-description">当前时间轴包含已失效片段，需要重新生成或替换后继续。</p>
                <section class="context-state context-state--error" aria-label="包含失败或已失效结果">
                  <h3 class="context-state-title"><span class="context-state-icon" aria-hidden="true">×</span><span>包含失败或已失效结果</span></h3>
                  <p>不会自动删除历史结果；请先查看影响范围。</p>
                </section>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
