<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["role-detail"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 路人声音池静态页面">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver · 示例小说</p>
            <p class="window-context">项目工作台</p>
          </header>

          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组展示状态">
              <div class="activity-list">
                <div class="activity-item"><span class="activity-glyph">文</span></div>
                <div class="activity-item activity-item--selected"><span class="activity-glyph">角</span><span class="selection-bar" aria-hidden="true"></span></div>
                <div class="activity-item"><span class="activity-glyph">音</span></div>
                <div class="activity-item"><span class="activity-glyph">后</span></div>
              </div>
              <div class="activity-item"><span class="activity-glyph">设</span></div>
            </aside>

            <aside class="context-sidebar" aria-label="角色管理上下文侧栏">
              <div class="sidebar-content">
                <div class="sidebar-top">
                  <header class="sidebar-header">
                    <div class="sidebar-heading-row"><h1>角色管理</h1><span class="sidebar-actions" aria-hidden="true"><span>＋</span><span>⋯</span></span></div>
                    <p class="sidebar-subtitle">3 个子功能 · 5 项待复核</p>
                  </header>
                  <div class="sidebar-item sidebar-item--default"><span class="sidebar-state"></span><span class="sidebar-label">主要角色标记</span><span class="sidebar-count">18</span></div>
                  <div class="sidebar-item sidebar-item--selected"><span class="sidebar-state">✓</span><span class="sidebar-label">路人声音池</span><span class="sidebar-count">24</span></div>
                  <div class="sidebar-item sidebar-item--review"><span class="sidebar-state">!</span><span class="sidebar-label">角色声音精修</span><span class="sidebar-count">12</span></div>
                </div>
                <section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-disabled="true"><span></span></div>
            </aside>

            <section class="editor" aria-label="路人声音池编辑区">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>路人声音池</strong><span>·</span><span>24 个声音 · 6 已使用 · 14 可用 · 4 待复核</span></div>
                <div class="toolbar-actions" aria-label="不可操作的展示入口">
                  <span class="icon-button" aria-disabled="true">⋯</span>
                  <span class="toolbar-button toolbar-button--secondary" aria-disabled="true">批量试听</span>
                  <span class="toolbar-button toolbar-button--primary" aria-disabled="true">添加声音候选</span>
                </div>
              </header>

              <div class="editor-content">
                <section class="pool-summary" aria-label="声音池摘要与静态筛选">
                  <div class="pool-stats">
                    <div class="pool-stat"><strong>24</strong><div class="stat-detail"><strong>声音池数量</strong><span>含 4 个待复核</span></div></div>
                    <div class="pool-stat pool-stat--success"><strong>6</strong><div class="stat-detail"><strong>已使用</strong><span>占用 9 个章节</span></div></div>
                    <div class="pool-stat pool-stat--accent"><strong>14</strong><div class="stat-detail"><strong>可用</strong><span>可临时分配</span></div></div>
                    <div class="pool-stat pool-stat--warning"><strong>4</strong><div class="stat-detail"><strong>待复核</strong><span>授权或区分度</span></div></div>
                  </div>
                  <div class="pool-filters">
                    <div class="filter-field"><span>年龄感</span><strong>全部 · 青年 / 成熟 / 年长</strong></div>
                    <div class="filter-field"><span>音色特征</span><strong>全部 · 清亮 / 低沉 / 粗粝</strong></div>
                    <div class="filter-field"><span>使用状态</span><strong>全部状态</strong></div>
                    <div class="filter-field"><span>搜索</span><strong>声音名 / 占用角色</strong></div>
                    <span class="filter-total">24 项</span>
                  </div>
                </section>

                <div class="detail-main pool-main">
                  <section class="voice-list" aria-label="固定声音候选列表">
                    <header class="section-header"><h2>声音候选 · 24</h2><span>紧凑列表 ↕</span></header>

                    <article class="voice-card">
                      <header class="voice-card-header"><div class="voice-identity"><span class="avatar">青</span><strong>青砚</strong></div><span class="voice-state">可用</span></header>
                      <div class="voice-features"><span class="chip">年龄感：成熟</span><span class="chip">音色：清亮</span><span class="chip">节奏：稳</span></div>
                      <div class="voice-card-meta"><span>未占用 · 可用于临时角色</span><span>项目授权音色包 · 授权已核验 · 当前版本 v2</span></div>
                      <div class="audio-preview" aria-disabled="true"><span class="audio-icon">▶</span><div class="audio-copy"><strong>可播放</strong><span>林黛玉试听 · 00:08</span></div><span class="audio-action">播放</span></div>
                    </article>

                    <article class="voice-card voice-card--selected">
                      <header class="voice-card-header"><div class="voice-identity"><span class="avatar">沉</span><strong>沉钟</strong></div><span class="voice-state">已使用</span></header>
                      <div class="voice-features"><span class="chip">年龄感：成熟</span><span class="chip">音色：清亮</span><span class="chip">节奏：稳</span></div>
                      <div class="voice-card-meta"><span>已占用：贾母 · 第 12–16 章</span><span>项目授权音色包 · 授权已核验 · 当前版本 v4</span></div>
                      <div class="audio-preview" aria-disabled="true"><span class="audio-icon">Ⅱ</span><div class="audio-copy"><strong>正在播放</strong><span>林黛玉试听 · 00:08</span></div><span class="audio-action">暂停</span></div>
                    </article>

                    <div class="notice notice--review"><strong>! 4 个候选待复核</strong><span>2 个授权状态待确认；2 个同场景区分度待复核。</span></div>
                    <div class="notice notice--processing"><strong>◌ 正在加载下一页试听</strong><span>已加载 2 / 24 个声音条目。</span></div>
                  </section>

                  <aside class="assignment-panel" aria-label="临时角色分配静态检查器">
                    <h2>临时角色分配</h2>
                    <p class="assignment-intro">为当前场景选择声音池候选；本步骤不会建立自动永久绑定。</p>
                    <div class="assignment-field"><span>临时角色</span><strong>丫鬟甲 · 第 18 章 · 2 行台词</strong><span>来源段落 para_18_042</span></div>
                    <div class="assignment-field"><span>声音池候选</span><strong>青禾 · v1 候选 ⌄</strong><span>年龄感：成熟 · 音色：清亮</span></div>
                    <div class="assignment-warning"><strong>≠ 区分度待复核</strong><span>青禾与同场景“青砚”音色过于接近；请试听后确认。</span></div>
                    <div class="assignment-field"><span>分配范围</span><strong>仅当前角色与第 18 章</strong><span>不扩展到其他章节</span></div>
                    <div class="assignment-info"><strong>未永久绑定</strong><span>保存后记录为临时候选；需人工确认后才能进入正式绑定流程。</span></div>
                    <div class="static-action" aria-disabled="true">分配为临时候选</div>
                  </aside>
                </div>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
