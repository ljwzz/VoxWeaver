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
    <main class="workspace audio-workspace" aria-label="音频生成选区特殊要求静态页面">
          <header class="window-titlebar"><img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true"><p class="window-title">VoxWeaver · 示例小说</p><p class="window-context">项目工作台</p></header>
          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组静态状态"><div class="activity-list"><div class="activity-item"><span class="activity-glyph">文</span></div><div class="activity-item"><span class="activity-glyph">角</span></div><div class="activity-item activity-item--selected"><span class="activity-glyph">音</span><span class="selection-bar" aria-hidden="true"></span></div><div class="activity-item"><span class="activity-glyph">后</span></div></div><div class="activity-item"><span class="activity-glyph">设</span></div></aside>
            <aside class="context-sidebar" aria-label="章节侧栏"><div class="sidebar-content"><div class="audio-sidebar-stack"><header class="audio-sidebar-title"><h1>音频生成</h1><span>筛选与排序</span></header><div class="chapter-search"><strong>⌕</strong><span>搜索章节名或编号</span></div><div class="chapter-filters"><span class="chapter-filter">状态：全部⌄</span><span class="chapter-filter">范围：本卷⌄</span></div><div class="chapter-list-heading"><h2>章节列表</h2><span>5 章 · 5 种状态</span></div><div class="chapter-list"><article class="chapter-card"><div class="chapter-info"><strong>第 10 章</strong><span>旧园重逢</span></div><span class="chapter-status">○ 未生成</span></article><article class="chapter-card chapter-card--generating"><div class="chapter-info"><strong>第 11 章</strong><span>风声渐起</span></div><span class="chapter-status">↻ 生成中</span></article><article class="chapter-card chapter-card--review chapter-card--selected"><div class="chapter-info"><strong>第 12 章</strong><span>雨夜来客</span></div><span class="chapter-status">! 待复核</span></article><article class="chapter-card chapter-card--complete"><div class="chapter-info"><strong>第 13 章</strong><span>灯下问答</span></div><span class="chapter-status">✓ 已完成</span></article><article class="chapter-card chapter-card--stale"><div class="chapter-info"><strong>第 14 章</strong><span>门外余音</span></div><span class="chapter-status">↺ 已失效</span></article></div></div><div class="chapter-summary">○ 未生成 1 · ↻ 生成中 1 · ! 待复核 1<br>✓ 已完成 1 · ↺ 已失效 1</div></div><div class="resize-handle" aria-hidden="true"><span></span></div></aside>

            <section class="audio-editor" aria-label="选区剧本与检查器">
              <header class="chapter-toolbar"><div class="chapter-context"><strong>第 12 章</strong><span>雨夜来客</span></div><div class="toolbar-summary"><span class="toolbar-summary-text">高匹配度 28 / 32 条音频</span><span class="static-button static-button--primary" aria-disabled="true">生成本章音频</span></div></header>
              <div class="audio-editor-body">
                <section class="audio-script-pane" aria-label="选区剧本，可独立滚动">
                  <header class="script-header"><h1>剧本 · 选区模式</h1><p>完整句子 1 处 · 跨行边界示例 1 处</p></header>
                  <div class="script-hint">选区高亮不覆盖正文；拖过行尾时以双端边界提示跨行范围。</div>
                  <article class="audio-row"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">17</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">旁白</strong><span class="paragraph-id">段落 para_12_017</span></div><p class="row-script">门轴轻响，沈砚抬眼望向廊下。</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">当前行</span></div></div><div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div></article>
                  <article class="audio-row audio-row--selection"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">18</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">苏婉</strong><span class="paragraph-id">段落 para_12_018</span></div><p class="row-script">“你终于来了。”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">完整句子已选中</span></div></div><div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div></article>
                  <div class="selection-strip"><strong>完整句子 <span style="float:right">← 已选中</span></strong><span>「你终于来了。」</span></div>
                  <article class="audio-row"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">19</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">沈砚</strong><span class="paragraph-id">段落 para_12_019</span></div><p class="row-script">“雨这样大，你不该一个人来。”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">当前行</span></div></div><div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div></article>
                  <div class="selection-strip selection-strip--cross-line"><strong>跨行边界 <span style="float:right">↕ 边界反馈</span></strong><span>第 18 行末 → 第 19 行首 · 范围待确认</span></div>
                  <article class="audio-row"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">20</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">旁白</strong><span class="paragraph-id">段落 para_12_020</span></div><p class="row-script">她把伞靠在墙边，衣袖仍在往下滴水。</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">当前行</span></div></div><div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div></article>
                </section>
                <div class="audio-inspector-divider" aria-hidden="true"></div>
                <aside class="audio-inspector" aria-label="选区设置，可独立滚动">
                  <header class="inspector-header"><div class="inspector-title-row"><h2>选区设置</h2><span>‹ 折叠</span></div><p>完整句子 · 第 18 行</p></header>
                  <section class="inspector-card"><h3>当前选区</h3><p>所属段落：para_12_018</p><p>说话人：林黛玉</p><p>选中文本：“你终于来了。”</p></section>
                  <div class="selection-player"><span>▶</span><span>试听 00:08</span></div>
                  <section class="inspector-card"><h3>当前音频</h3><p>版本：v3 · 高匹配</p><p>生成时间：本次设计示例</p></section>
                  <section class="inspector-card"><h3>特殊要求提示词</h3><p>压低音量，句尾略停顿；保持克制。</p></section>
                  <span class="static-button static-button--primary static-button--compact" aria-disabled="true">重新生成</span>
                  <section class="inspector-card inspector-card--warning"><h3>范围说明</h3><p>特殊要求锁定到选区；本次重新生成范围待确认。</p></section>
                  <p class="inspector-link">取消选择 · 恢复章节参数</p>
                  <footer class="inspector-footer"><span class="static-button" aria-disabled="true">取消选择　⌘↵</span><span>Esc 返回章节参数</span></footer>
                </aside>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
