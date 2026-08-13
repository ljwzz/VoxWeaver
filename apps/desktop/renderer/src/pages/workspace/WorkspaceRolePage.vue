<script setup lang="ts">
import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';
import DemoPageButton from '@/components/demo/DemoPageButton.vue';
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from './styles.css?inline';

const bodyClasses = ['workspace-view', 'workspace-view--role'] as const;
const styleSheets = [pageStyles1] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 角色管理交互预览">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver · 示例小说</p>
            <p class="window-context">项目工作台</p>
          </header>

          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组导航">
              <div class="activity-list">
                <DemoModuleButton module-key="text" class="activity-item">
                  <span class="activity-glyph">文</span>
                </DemoModuleButton>
                <DemoModuleButton module-key="role" class="activity-item activity-item--selected">
                  <span class="activity-glyph">角</span>
                  <span class="selection-bar" aria-hidden="true"></span>
                </DemoModuleButton>
                <DemoModuleButton module-key="audio" class="activity-item">
                  <span class="activity-glyph">音</span>
                </DemoModuleButton>
                <DemoModuleButton module-key="post" class="activity-item">
                  <span class="activity-glyph">后</span>
                </DemoModuleButton>
              </div>
              <DemoModuleButton module-key="settings" class="activity-item">
                <span class="activity-glyph">设</span>
              </DemoModuleButton>
            </aside>

            <aside class="context-sidebar" aria-label="角色管理上下文侧栏">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header">
                    <div class="sidebar-heading-row">
                      <h1>角色管理</h1>
                      <span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span>
                    </div>
                    <p class="sidebar-subtitle">3 个子功能 · 5 项待复核</p>
                  </header>

                  <DemoPageButton page-slug="primary-character-marking" class="sidebar-item sidebar-item--default">
                    <span class="sidebar-state" aria-hidden="true"></span><span class="sidebar-label">主要角色标记</span><span class="sidebar-count">18</span>
                  </DemoPageButton>
                  <DemoPageButton page-slug="crowd-voice-pool" class="sidebar-item sidebar-item--review">
                    <span class="sidebar-state" aria-hidden="true">!</span><span class="sidebar-label">路人声音池</span><span class="sidebar-count">24</span>
                  </DemoPageButton>
                  <DemoPageButton page-slug="character-voice-refinement" class="sidebar-item sidebar-item--processing">
                    <span class="sidebar-state" aria-hidden="true">◔</span><span class="sidebar-label">角色声音精修</span><span class="sidebar-count">12</span>
                  </DemoPageButton>
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
