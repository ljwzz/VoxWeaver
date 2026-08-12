<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["audio-detail-view","chapter-parameters-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace audio-workspace" aria-label="音频生成章节参数静态页面">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver · 示例小说</p>
            <p class="window-context">项目工作台</p>
          </header>

          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组静态状态">
              <div class="activity-list">
                <div class="activity-item"><span class="activity-glyph">文</span></div>
                <div class="activity-item"><span class="activity-glyph">角</span></div>
                <div class="activity-item activity-item--selected"><span class="activity-glyph">音</span><span class="selection-bar" aria-hidden="true"></span></div>
                <div class="activity-item"><span class="activity-glyph">后</span></div>
              </div>
              <div class="activity-item"><span class="activity-glyph">设</span></div>
            </aside>

            <aside class="context-sidebar" aria-label="章节侧栏">
              <div class="sidebar-content">
                <div class="audio-sidebar-stack">
                  <header class="audio-sidebar-title"><h1>音频生成</h1><span>筛选与排序</span></header>
                  <div class="chapter-search"><strong>⌕</strong><span>搜索章节名或编号</span></div>
                  <div class="chapter-filters"><span class="chapter-filter">状态：全部⌄</span><span class="chapter-filter">范围：本卷⌄</span></div>
                  <div class="chapter-list-heading"><h2>章节列表</h2><span>5 章 · 5 种状态</span></div>
                  <div class="chapter-list">
                    <article class="chapter-card"><div class="chapter-info"><strong>第 10 章</strong><span>旧园重逢</span></div><span class="chapter-status">○ 未生成</span></article>
                    <article class="chapter-card chapter-card--generating"><div class="chapter-info"><strong>第 11 章</strong><span>风声渐起</span></div><span class="chapter-status">↻ 生成中</span></article>
                    <article class="chapter-card chapter-card--review chapter-card--selected"><div class="chapter-info"><strong>第 12 章</strong><span>雨夜来客</span></div><span class="chapter-status">! 待复核</span></article>
                    <article class="chapter-card chapter-card--complete"><div class="chapter-info"><strong>第 13 章</strong><span>灯下问答</span></div><span class="chapter-status">✓ 已完成</span></article>
                    <article class="chapter-card chapter-card--stale"><div class="chapter-info"><strong>第 14 章</strong><span>门外余音</span></div><span class="chapter-status">↺ 已失效</span></article>
                  </div>
                </div>
                <div class="chapter-summary">○ 未生成 1 · ↻ 生成中 1 · ! 待复核 1<br>✓ 已完成 1 · ↺ 已失效 1</div>
              </div>
              <div class="resize-handle" aria-hidden="true"><span></span></div>
            </aside>

            <section class="audio-editor" aria-label="剧本与章节检查器">
              <header class="chapter-toolbar">
                <div class="chapter-context"><strong>第 12 章</strong><span>雨夜来客</span></div>
                <div class="toolbar-summary"><span class="toolbar-summary-text">高匹配度 28 / 32 条音频</span><span class="static-button static-button--primary" aria-disabled="true">生成本章音频</span></div>
              </header>

              <div class="audio-editor-body">
                <section class="audio-script-pane" aria-label="剧本区，可独立滚动">
                  <header class="script-header"><h1>剧本 · 第 12 章</h1><p>32 段 · 当前无选区 · 行号仅用于视觉定位</p></header>
                  <div class="script-hint">拖动正文可选择整段、完整句子或段内文本；Tab 可到达键盘焦点行。</div>

                  <article class="audio-row">
                    <div class="row-gutter"><span class="play-control">▶</span><span class="row-number">18</span><span>⋮ 拖选</span></div>
                    <div class="row-content"><div class="row-meta"><strong class="row-speaker">旁白</strong><span class="paragraph-id">段落 para_12_018</span></div><p class="row-script">雨线斜斜地敲在檐上，门外忽然传来三声轻叩。</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">当前行</span></div></div>
                    <div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div>
                  </article>

                  <article class="audio-row audio-row--hover">
                    <div class="row-gutter"><span class="play-control">▶</span><span class="row-number">19</span><span>⋮ 拖选</span></div>
                    <div class="row-content"><div class="row-meta"><strong class="row-speaker">沈砚</strong><span class="paragraph-id">段落 para_12_019</span></div><p class="row-script">“谁？”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">悬停行</span></div></div>
                    <div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div>
                  </article>

                  <article class="audio-row audio-row--focus">
                    <div class="row-gutter"><span class="play-control">▶</span><span class="row-number">20</span><span>⋮ 拖选</span></div>
                    <div class="row-content"><div class="row-meta"><strong class="row-speaker">旁白</strong><span class="paragraph-id">段落 para_12_020</span></div><p class="row-script">门外的人没有回答，只将油纸伞往廊下一收。</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">键盘焦点</span></div></div>
                    <div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div>
                  </article>

                  <article class="audio-row audio-row--playing">
                    <div class="row-gutter"><span class="play-control">Ⅱ</span><span class="row-number">21</span><span>⋮ 拖选</span></div>
                    <div class="row-content"><div class="row-meta"><strong class="row-speaker">苏婉</strong><span class="paragraph-id">段落 para_12_021</span></div><p class="row-script">“是我。夜深了，仍要来叨扰。”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">播放中</span></div></div>
                    <div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div>
                  </article>

                  <article class="audio-row audio-row--success">
                    <div class="row-gutter"><span class="play-control">▶</span><span class="row-number">22</span><span>⋮ 拖选</span></div>
                    <div class="row-content"><div class="row-meta"><strong class="row-speaker">旁白</strong><span class="paragraph-id">段落 para_12_022</span></div><p class="row-script">沈砚沉默片刻，侧身让开门。</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">高匹配</span></div></div>
                    <div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div>
                  </article>

                  <article class="audio-row audio-row--stale audio-row--last">
                    <div class="row-gutter"><span class="play-control">▶</span><span class="row-number">23</span><span>⋮ 拖选</span></div>
                    <div class="row-content"><div class="row-meta"><strong class="row-speaker">苏婉</strong><span class="paragraph-id">段落 para_12_023</span></div><p class="row-script">“多谢。”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">需要重新生成</span></div></div>
                    <div class="row-audio-status"><span class="audio-version">历史音频 v2 · 已失效</span><span class="status-pill status-pill--stale">↺ 已失效</span><span class="audio-version">ASR 已解绑</span></div>
                  </article>
                </section>

                <div class="audio-inspector-divider" aria-hidden="true"></div>
                <aside class="audio-inspector" aria-label="章节参数，可独立滚动">
                  <header class="inspector-header"><div class="inspector-title-row"><h2>章节参数</h2><span>‹ 折叠</span></div><p>无选中文本 · 使用章节默认值</p></header>
                  <section class="inspector-card"><h3>章节默认生成设置</h3><p>声音：按角色当前激活配置</p><p>默认提示词：遵循角色与段落批注</p><p>段落最长字数：180 字</p><p>ASR Gate 阈值：90%</p></section>
                  <section class="inspector-card"><h3>本次整章生成范围</h3><p>第 12 章 · para_12_001–032</p><p>共 32 段；示例数量不作为默认值</p></section>
                  <section class="inspector-card"><h3>已有音频处理策略</h3><p>保留高匹配结果</p><p>待复核与已失效段落重新生成</p><p>不暴露未经规格确认的复杂模型参数</p></section>
                  <p class="inspector-link">进入项目设置 ↗</p>
                </aside>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
