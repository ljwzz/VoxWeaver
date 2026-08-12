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
    <main class="workspace" aria-label="VoxWeaver 主要角色标记静态页面">
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
                  <div class="sidebar-item sidebar-item--selected"><span class="sidebar-state">✓</span><span class="sidebar-label">主要角色标记</span><span class="sidebar-count">18</span></div>
                  <div class="sidebar-item sidebar-item--review"><span class="sidebar-state">!</span><span class="sidebar-label">路人声音池</span><span class="sidebar-count">24</span></div>
                  <div class="sidebar-item sidebar-item--processing"><span class="sidebar-state">◔</span><span class="sidebar-label">角色声音精修</span><span class="sidebar-count">12</span></div>
                </div>
                <section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-disabled="true"><span></span></div>
            </aside>

            <section class="editor" aria-label="主要角色标记编辑区">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>主要角色标记</strong><span>·</span><span>18 个角色 · 4 待确认 · 2 声音冲突</span></div>
                <div class="toolbar-actions" aria-label="不可操作的展示入口">
                  <span class="icon-button" aria-disabled="true">⋯</span>
                  <span class="toolbar-button toolbar-button--secondary" aria-disabled="true">检查冲突</span>
                  <span class="toolbar-button toolbar-button--primary" aria-disabled="true">保存主要角色标记</span>
                </div>
              </header>

              <div class="editor-content">
                <section class="filter-bar" aria-label="静态筛选条件">
                  <div class="filter-field filter-field--search"><span>搜索</span><strong>角色名 / 别名 / 化身</strong></div>
                  <div class="filter-field filter-field--chapters"><span>章节范围</span><strong>全书 · 1–36 章</strong></div>
                  <div class="filter-field filter-field--confirm"><span>确认状态</span><strong>全部状态</strong></div>
                  <div class="filter-field filter-field--voice"><span>声音状态</span><strong>全部声音状态</strong></div>
                  <div class="filter-summary"><strong>已显示 18 / 18 个角色</strong><span>⌘F 搜索 · Tab 顺序 1–4</span></div>
                </section>

                <div class="detail-main">
                  <section class="character-list" aria-label="固定角色列表">
                    <header class="section-header"><h2>角色列表 · 18</h2><span>按重要度排序 ↓</span></header>

                    <article class="character-row character-row--selected">
                      <div class="character-top">
                        <span class="avatar">黛</span>
                        <div class="character-identity"><strong>林黛玉</strong><span>黛玉、潇湘妃子、林姑娘</span><span>来源证据 26 处 · 首见第 3 章</span></div>
                        <div class="row-action" aria-disabled="true"><strong>主要角色</strong><span>取消主要角色</span></div>
                      </div>
                      <div class="character-meta">
                        <div class="meta-cell"><span>出场章节</span><strong>3–36 章</strong></div>
                        <div class="meta-cell meta-cell--importance"><span>重要度</span><strong>高</strong></div>
                        <div class="meta-cell"><span>状态阶段</span><strong>人工已确认</strong></div>
                        <div class="meta-cell"><span>声音配置</span><strong>青衣 · v3 当前生效</strong></div>
                        <div class="meta-cell meta-cell--conflict is-clear"><span>冲突数</span><strong>0</strong></div>
                      </div>
                    </article>

                    <article class="character-row character-row--selected">
                      <div class="character-top">
                        <span class="avatar">黛</span>
                        <div class="character-identity"><strong>贾宝玉</strong><span>宝玉、怡红公子、绛洞花主</span><span>来源证据 34 处 · 首见第 2 章</span></div>
                        <div class="row-action" aria-disabled="true"><strong>主要角色</strong><span>取消主要角色</span></div>
                      </div>
                      <div class="character-meta">
                        <div class="meta-cell"><span>出场章节</span><strong>2–36 章</strong></div>
                        <div class="meta-cell meta-cell--importance"><span>重要度</span><strong>高</strong></div>
                        <div class="meta-cell"><span>状态阶段</span><strong>人工已确认</strong></div>
                        <div class="meta-cell"><span>声音配置</span><strong>清朗少年 · v2</strong></div>
                        <div class="meta-cell meta-cell--conflict is-clear"><span>冲突数</span><strong>0</strong></div>
                      </div>
                    </article>

                    <article class="character-row">
                      <div class="character-top">
                        <span class="avatar">黛</span>
                        <div class="character-identity"><strong>王熙凤</strong><span>凤姐、琏二奶奶、凤辣子</span><span>来源证据 19 处 · 首见第 6 章</span></div>
                        <div class="row-action" aria-disabled="true"><strong>待确认</strong><span>设为主要角色</span></div>
                      </div>
                      <div class="character-meta">
                        <div class="meta-cell"><span>出场章节</span><strong>6–34 章</strong></div>
                        <div class="meta-cell meta-cell--importance"><span>重要度</span><strong>中</strong></div>
                        <div class="meta-cell"><span>状态阶段</span><strong>冲突待确认</strong></div>
                        <div class="meta-cell"><span>声音配置</span><strong>明快女声 · 候选</strong></div>
                        <div class="meta-cell meta-cell--conflict"><span>冲突数</span><strong>2</strong></div>
                      </div>
                    </article>

                    <article class="character-row">
                      <div class="character-top">
                        <span class="avatar">黛</span>
                        <div class="character-identity"><strong>刘姥姥（第二次进府时期）</strong><span>姥姥、刘老老、村妇称谓</span><span>来源证据 11 处 · 首见第 6 章</span></div>
                        <div class="row-action" aria-disabled="true"><strong>待确认</strong><span>设为主要角色</span></div>
                      </div>
                      <div class="character-meta">
                        <div class="meta-cell"><span>出场章节</span><strong>6–31 章</strong></div>
                        <div class="meta-cell meta-cell--importance"><span>重要度</span><strong>中</strong></div>
                        <div class="meta-cell"><span>状态阶段</span><strong>待确认</strong></div>
                        <div class="meta-cell"><span>声音配置</span><strong>暂无声音配置</strong></div>
                        <div class="meta-cell meta-cell--conflict"><span>冲突数</span><strong>1</strong></div>
                      </div>
                    </article>

                    <div class="notice notice--review"><strong>! 2 个声音配置冲突待复核</strong><span>切换主要角色标记不会删除角色身份、别名或来源证据。</span></div>
                    <div class="notice notice--processing"><strong>◌ 正在核对 4 个待确认角色</strong><span>完成后仅更新标记建议，不自动绑定声音。</span></div>
                  </section>

                  <aside class="character-inspector" aria-label="林黛玉检查器">
                    <section class="inspector-card">
                      <header class="inspector-identity"><span class="avatar">黛</span><div class="inspector-name"><strong>林黛玉</strong><span>主要角色 · 人工已确认</span></div></header>
                      <div class="detail-section detail-section--large"><h3>角色来源</h3><p>第 3 章首次出现；原文证据 26 处。来源身份在标记切换后保持不变。</p></div>
                      <div class="detail-section detail-section--large detail-section--warning"><h3>别名关系</h3><p>林黛玉 ← 黛玉 / 林姑娘；潇湘妃子为诗社称号。</p></div>
                      <div class="detail-section detail-section--large"><h3>年龄阶段</h3><p>青年期（第 3–28 章）→ 成年期候选（第 29–36 章）。</p></div>
                      <div class="detail-section detail-section--small detail-section--accent"><h3>关联剧本段落</h3><p>42 个段落；其中 12 个引用当前声音配置。</p></div>
                    </section>
                    <div class="status-card status-card--accent"><strong>主要角色标记：已保存于草稿</strong><span>点击工具栏“保存主要角色标记”后才写入当前项目版本。</span></div>
                    <div class="status-card status-card--success"><strong>声音冲突 0</strong><span>当前声音配置无冲突；12 个关联段落仅为引用信息。</span></div>
                  </aside>
                </div>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
