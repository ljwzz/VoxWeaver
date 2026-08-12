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
    <main class="workspace" aria-label="VoxWeaver 角色声音精修静态页面">
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
                  <div class="sidebar-item sidebar-item--review"><span class="sidebar-state">!</span><span class="sidebar-label">路人声音池</span><span class="sidebar-count">24</span></div>
                  <div class="sidebar-item sidebar-item--selected"><span class="sidebar-state">✓</span><span class="sidebar-label">角色声音精修</span><span class="sidebar-count">12</span></div>
                </div>
                <section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section>
              </div>
              <div class="resize-handle" aria-disabled="true"><span></span></div>
            </aside>

            <section class="editor" aria-label="角色声音精修编辑区">
              <header class="editor-toolbar">
                <div class="toolbar-context"><strong>角色声音精修</strong><span>·</span><span>林黛玉 · 基础声音 青衣 · v3 当前生效</span></div>
                <div class="toolbar-actions" aria-label="不可操作的展示入口">
                  <span class="icon-button" aria-disabled="true">⋯</span>
                  <span class="toolbar-button toolbar-button--secondary" aria-disabled="true">生成试听</span>
                  <span class="toolbar-button toolbar-button--primary" aria-disabled="true">激活配置</span>
                </div>
              </header>

              <div class="editor-content">
                <section class="selection-bar-detail" aria-label="静态角色与声音选择">
                  <div class="selection-field selection-field--active selection-field--character"><span>主要角色</span><strong>林黛玉 ⌄</strong></div>
                  <div class="selection-field selection-field--active selection-field--voice"><span>当前基础声音</span><strong>青衣 · v3 当前生效 ⌄</strong></div>
                  <div class="selection-field selection-field--sentence"><span>试听短句</span><strong>第 12 章 · para_12_018 ⌄</strong></div>
                  <div class="selection-summary"><strong>候选 2 · 历史 4 · 已失效 1</strong><span>Tab 顺序：角色 → 声音 → 短句</span></div>
                </section>

                <div class="detail-main refinement-main">
                  <section class="refinement-panel refinement-panel--left" aria-label="基础声音与状态覆盖">
                    <header class="panel-heading"><h2>基础声音 + 状态覆盖</h2><p>按实际状态新增覆盖项，不维护组合矩阵。</p></header>
                    <div class="base-voice-card"><strong>青衣 · v3</strong><span class="active-copy">当前生效 · Provider: 示例声音包</span><span>基础语速 0% · 气息 18% · 稳定度 76%</span></div>
                    <div class="override-card override-card--active">
                      <div class="override-title"><strong>青年期 · 轻伤 · 克制</strong><em>当前生效</em></div>
                      <div class="chip-row"><span class="chip">青年期</span><span class="chip">轻伤</span><span class="chip">克制</span></div>
                      <span>覆盖优先级：规则待确认</span>
                    </div>
                    <div class="override-card override-card--candidate">
                      <div class="override-title"><strong>成年期 · 无伤 · 焦虑</strong><em>候选</em></div>
                      <div class="chip-row"><span class="chip">成年期</span><span class="chip">无伤</span><span class="chip">焦虑</span></div>
                      <span>覆盖优先级：规则待确认</span>
                    </div>
                    <div class="override-card override-card--stale">
                      <div class="override-title"><strong>青年期 · 重伤 · 悲伤</strong><em>已失效</em></div>
                      <div class="chip-row"><span class="chip">青年期</span><span class="chip">重伤</span><span class="chip">悲伤</span></div>
                      <span>覆盖优先级：规则待确认</span>
                    </div>
                    <div class="outline-action" aria-disabled="true">＋ 新增状态覆盖</div>
                    <div class="override-note"><strong>! 冲突覆盖优先级：规则待确认</strong><span>当前设计不假设自动覆盖顺序。</span></div>
                  </section>

                  <section class="refinement-panel refinement-panel--middle" aria-label="试听与版本对比">
                    <header class="panel-heading"><h2>试听与版本 A/B 对比</h2><p>短句：宝玉，你好好的罢，我再来看你。</p></header>
                    <div class="main-preview" aria-disabled="true"><span class="audio-icon">Ⅱ</span><div class="audio-copy"><strong>正在播放 · 青衣 v3</strong><span>00:03 / 00:08 · 当前生效</span></div><span class="audio-action">暂停</span></div>
                    <div class="ab-compare">
                      <article class="version-card version-card--active">
                        <header class="version-title"><strong>版本 A</strong><span>当前生效</span></header>
                        <p class="version-copy">“宝玉，你好好的罢，我再来看你。”</p>
                        <div class="version-preview" aria-disabled="true"><strong>Ⅱ</strong><span>播放中 00:03</span></div>
                        <p class="version-metrics">语速 0% · 气息 18%<br>稳定度 76%</p>
                        <span class="version-state">当前生效</span>
                      </article>
                      <article class="version-card version-card--candidate">
                        <header class="version-title"><strong>版本 B</strong><span>候选</span></header>
                        <p class="version-copy">“宝玉，你好好的罢，我再来看你。”</p>
                        <div class="version-preview" aria-disabled="true"><strong>▶</strong><span>播放 00:08</span></div>
                        <p class="version-metrics">语速 -4% · 气息 24%<br>稳定度 82%</p>
                        <span class="version-state">保存为候选</span>
                      </article>
                    </div>
                    <section class="version-history"><h3>版本状态</h3><div class="history-row"><span>历史 · v2</span><span>可回看，不生效</span></div><div class="history-row"><span>已失效 · v1</span><span>已被基础声音 v3 替换</span></div></section>
                    <div class="impact-badge">↗ <span>仅影响 12 个引用段落</span></div>
                    <div class="impact-note"><strong>影响范围：仅 12 个引用段落</strong><span>保存候选不自动重生成音频；激活后由后续任务处理。</span></div>
                  </section>

                  <aside class="refinement-panel refinement-panel--right" aria-label="上下文检查器">
                    <header class="inspector-heading"><h2>上下文检查器</h2><p>配置当前状态组合并生成试听</p></header>
                    <section class="inspector-box inspector-box--combination">
                      <h3>当前状态组合</h3>
                      <div class="combination-row"><span>年龄</span><strong>青年</strong></div>
                      <div class="combination-row"><span>伤病</span><strong>轻咳</strong></div>
                      <div class="combination-row"><span>情绪 / 心情</span><strong>克制 · 忧虑</strong></div>
                      <p class="combination-note">覆盖优先级：规则待确认</p>
                    </section>
                    <section class="inspector-box inspector-box--parameters">
                      <h3>提示词 / 参数</h3>
                      <div class="parameter-field"><span>提示词</span><strong>气息轻，句尾收束；悲而不弱。</strong></div>
                      <div class="parameter-field"><span>生成参数</span><strong>语速 0.92 · 音高 -1 · 稳定度 0.78</strong></div>
                    </section>
                    <div class="inspector-actions" aria-label="不可操作的试听和保存入口"><span class="small-action" aria-disabled="true">生成试听</span><span class="small-action" aria-disabled="true">保存候选</span><span class="small-action small-action--primary" aria-disabled="true">激活配置</span></div>
                    <div class="impact-badge">↗ <span>激活后仅影响 12 个引用段落</span></div>
                    <p class="activation-note">激活后保留候选与历史版本；下游结果不在此处自动重生成。</p>
                  </aside>
                </div>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
