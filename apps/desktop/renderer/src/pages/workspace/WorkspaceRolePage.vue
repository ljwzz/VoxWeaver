<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from './styles.css?inline';

const bodyClasses = ["workspace-view","workspace-view--role"] as const;
const styleSheets = [pageStyles1] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 角色管理静态展示">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver · 示例小说</p>
            <p class="window-context">项目工作台</p>
          </header>

          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组展示状态">
              <div class="activity-list">
                <div class="activity-item" aria-label="文本整理，展示状态"><span class="activity-glyph">文</span></div>
                <div class="activity-item activity-item--selected" aria-label="角色管理，当前选中">
                  <span class="activity-glyph">角</span>
                  <span class="selection-bar" aria-hidden="true"></span>
                </div>
                <div class="activity-item" aria-label="音频生成，展示状态"><span class="activity-glyph">音</span></div>
                <div class="activity-item" aria-label="后期处理，展示状态"><span class="activity-glyph">后</span></div>
              </div>
              <div class="activity-item" aria-label="设置，展示状态"><span class="activity-glyph">设</span></div>
            </aside>

            <aside class="context-sidebar" aria-label="角色管理上下文侧栏">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header">
                    <div class="sidebar-heading-row">
                      <h1>角色管理</h1>
                      <span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span>
                    </div>
                    <p class="sidebar-subtitle">5 个视图 · 4 项待确认</p>
                  </header>

                  <div class="sidebar-item sidebar-item--selected" aria-label="角色档案，已选择">
                    <span class="sidebar-state" aria-hidden="true">✓</span><span class="sidebar-label">角色档案</span><span class="sidebar-count">18</span>
                  </div>
                  <div class="sidebar-item sidebar-item--review" aria-label="别名与称谓，待确认">
                    <span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">别名与称谓</span><span class="sidebar-count">4</span>
                  </div>
                  <div class="sidebar-item sidebar-item--default" aria-label="声线配置，展示状态">
                    <span class="sidebar-state" aria-hidden="true"></span><span class="sidebar-label">声线配置</span><span class="sidebar-count">12</span>
                  </div>
                  <div class="sidebar-item sidebar-item--processing" aria-label="关系与模仿，处理中">
                    <span class="sidebar-state" aria-hidden="true">◔</span><span class="sidebar-label">关系与模仿</span><span class="sidebar-count">2</span>
                  </div>
                  <div class="sidebar-item sidebar-item--failed" aria-label="冲突待确认，失败">
                    <span class="sidebar-state" aria-hidden="true">×</span><span class="sidebar-label">冲突待确认</span><span class="sidebar-count">1</span>
                  </div>
                </div>

                <section class="sidebar-summary" aria-label="项目摘要"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"><span aria-hidden="true"></span></div>
            </aside>

            <section class="editor" aria-label="角色档案编辑区">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>角色档案</strong><span>·</span><span>18 个角色 · 4 项待确认</span></div>
                <div class="toolbar-actions" aria-label="编辑区操作展示状态">
                  <span class="icon-button" aria-disabled="true">⋯</span>
                  <span class="toolbar-button toolbar-button--secondary" aria-disabled="true">查看问题</span>
                  <span class="toolbar-button toolbar-button--primary" aria-disabled="true">提取文本</span>
                </div>
              </header>

              <div class="editor-content editor-content--overview">
                <p class="eyebrow">项目工作台</p>
                <h2>角色管理</h2>
                <p class="editor-description">选择角色或确认候选后，在此编辑档案、称谓与声线约束。</p>
                <section class="context-state context-state--empty" aria-label="尚无选中内容">
                  <h3 class="context-state-title"><span class="context-state-icon" aria-hidden="true">○</span><span>尚无选中内容</span></h3>
                  <p>选择左侧项目后继续。</p>
                </section>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
