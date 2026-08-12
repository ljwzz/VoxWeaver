<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["audio-detail-view"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace audio-workspace" aria-label="段落拆分失效传播静态页面">
          <header class="window-titlebar"><img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true"><p class="window-title">VoxWeaver · 示例小说</p><p class="window-context">项目工作台</p></header>
          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组静态状态"><div class="activity-list"><div class="activity-item"><span class="activity-glyph">文</span></div><div class="activity-item"><span class="activity-glyph">角</span></div><div class="activity-item activity-item--selected"><span class="activity-glyph">音</span><span class="selection-bar" aria-hidden="true"></span></div><div class="activity-item"><span class="activity-glyph">后</span></div></div><div class="activity-item"><span class="activity-glyph">设</span></div></aside>
            <aside class="context-sidebar" aria-label="章节侧栏"><div class="sidebar-content"><div class="audio-sidebar-stack"><header class="audio-sidebar-title"><h1>音频生成</h1><span>筛选与排序</span></header><div class="chapter-search"><strong>⌕</strong><span>搜索章节名或编号</span></div><div class="chapter-filters"><span class="chapter-filter">状态：全部⌄</span><span class="chapter-filter">范围：本卷⌄</span></div><div class="chapter-list-heading"><h2>章节列表</h2><span>5 章 · 5 种状态</span></div><div class="chapter-list"><article class="chapter-card"><div class="chapter-info"><strong>第 10 章</strong><span>旧园重逢</span></div><span class="chapter-status">○ 未生成</span></article><article class="chapter-card chapter-card--generating"><div class="chapter-info"><strong>第 11 章</strong><span>风声渐起</span></div><span class="chapter-status">↻ 生成中</span></article><article class="chapter-card chapter-card--stale chapter-card--selected"><div class="chapter-info"><strong>第 12 章</strong><span>雨夜来客</span></div><span class="chapter-status">↺ 已失效</span></article><article class="chapter-card chapter-card--complete"><div class="chapter-info"><strong>第 13 章</strong><span>灯下问答</span></div><span class="chapter-status">✓ 已完成</span></article><article class="chapter-card chapter-card--review"><div class="chapter-info"><strong>第 14 章</strong><span>门外余音</span></div><span class="chapter-status">! 待复核</span></article></div></div><div class="chapter-summary">○ 未生成 1 · ↻ 生成中 1 · ! 待复核 1<br>✓ 已完成 1 · ↺ 已失效 1</div></div><div class="resize-handle" aria-hidden="true"><span></span></div></aside>

            <section class="audio-editor" aria-label="失效传播详情与检查器">
              <header class="chapter-toolbar"><div class="chapter-context"><strong>第 12 章</strong><span>雨夜来客</span></div><div class="toolbar-summary"><span class="toolbar-summary-text">高匹配度 28 / 32 条音频</span><span class="static-button static-button--primary" aria-disabled="true">生成本章音频</span></div></header>
              <div class="audio-editor-body">
                <section class="audio-script-pane" aria-label="失效传播详情，可独立滚动">
                  <header class="script-header script-header--propagation"><h1>段落拆分后的失效传播</h1><p>旧 para_12_018 → 新 para_12_018a + para_12_018b</p></header>
                  <div class="inheritance-note"><strong>继承：说话人、来源信息、仍适用的基础批注</strong><span>不继承：旧音频、ASR 结果、时间轴引用</span></div>
                  <div class="propagation-section-title propagation-section-title--old"><strong>修改前 · 旧段落历史</strong><span>历史结果保留但标记“已失效”</span></div>
                  <article class="audio-row audio-row--stale audio-row--new"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">18</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">苏婉</strong><span class="paragraph-id">段落 para_12_018</span></div><p class="row-script">“你终于来了。雨这样大，我还是赶过来了。”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">需要重新生成</span></div></div><div class="row-audio-status"><span class="audio-version">历史音频 v2 · 已失效</span><span class="status-pill status-pill--stale">↺ 已失效</span><span class="audio-version">ASR 已解绑</span></div></article>
                  <div class="split-operation">拆分段落　→　分配两个不同的新段落 ID</div>
                  <div class="propagation-section-title propagation-section-title--new"><strong>修改后 · 当前剧本</strong><span>两个新段落均需要重新生成</span></div>
                  <article class="audio-row audio-row--new"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">18</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">苏婉</strong><span class="paragraph-id">段落 para_12_018a</span></div><p class="row-script">“你终于来了。”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">需要重新生成 · 不继承旧音频、ASR 与时间轴</span></div></div><div class="row-audio-status"><span class="audio-version">音频 — · 新段落</span><span class="status-pill status-pill--warning">需要重新生成</span><span class="status-pill status-pill--wide status-pill--warning">○ ASR — 未生成</span></div></article>
                  <article class="audio-row audio-row--new"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">19</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">苏婉</strong><span class="paragraph-id">段落 para_12_018b</span></div><p class="row-script">“雨这样大，我还是赶过来了。”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">需要重新生成 · 不继承旧音频、ASR 与时间轴</span></div></div><div class="row-audio-status"><span class="audio-version">音频 — · 新段落</span><span class="status-pill status-pill--warning">需要重新生成</span><span class="status-pill status-pill--wide status-pill--warning">○ ASR — 未生成</span></div></article>
                  <div class="history-trace"><strong>历史信息 · 可追溯</strong><span>旧音频 v3 / ASR 96% / 时间轴 clip_088 → 已失效；不显示在两个新段落上。</span></div>
                </section>
                <div class="audio-inspector-divider" aria-hidden="true"></div>
                <aside class="audio-inspector" aria-label="失效影响，可独立滚动">
                  <header class="inspector-header"><div class="inspector-title-row"><h2>失效影响</h2></div><p>段落拆分 · 3 项下游结果</p></header>
                  <section class="inspector-card"><div class="impact-list"><div class="impact-item"><strong>旧音频 audio_para_12_018_v3</strong><span>↺ 已失效 · 历史保留</span></div><div class="impact-item"><strong>ASR review_asr_088</strong><span>↺ 已失效 · 不继承</span></div><div class="impact-item"><strong>时间轴 timeline_clip_088</strong><span>↺ 已失效 · 不继承</span></div></div></section>
                  <section class="inspector-card"><h3>当前结果策略</h3><p class="warning-text">para_12_018a · 需要重新生成</p><p class="warning-text">para_12_018b · 需要重新生成</p><p>旧结果仅在历史信息中可见</p></section>
                  <span class="static-button" aria-disabled="true">查看确认提示　⌘↵</span>
                  <div class="definition-note"><strong>状态语义</strong><span>“已失效”描述旧结果；“需要重新生成”描述当前新段落。</span></div>
                </aside>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
