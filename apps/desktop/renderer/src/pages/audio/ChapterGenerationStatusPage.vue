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
    <main class="workspace audio-workspace" aria-label="整章生成中与部分失败静态页面">
          <header class="window-titlebar"><img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true"><p class="window-title">VoxWeaver · 示例小说</p><p class="window-context">项目工作台</p></header>
          <div class="workspace-body">
            <aside class="activity-rail" aria-label="功能分组静态状态"><div class="activity-list"><div class="activity-item"><span class="activity-glyph">文</span></div><div class="activity-item"><span class="activity-glyph">角</span></div><div class="activity-item activity-item--selected"><span class="activity-glyph">音</span><span class="selection-bar" aria-hidden="true"></span></div><div class="activity-item"><span class="activity-glyph">后</span></div></div><div class="activity-item"><span class="activity-glyph">设</span></div></aside>
            <aside class="context-sidebar" aria-label="章节侧栏"><div class="sidebar-content"><div class="audio-sidebar-stack"><header class="audio-sidebar-title"><h1>音频生成</h1><span>筛选与排序</span></header><div class="chapter-search"><strong>⌕</strong><span>搜索章节名或编号</span></div><div class="chapter-filters"><span class="chapter-filter">状态：全部⌄</span><span class="chapter-filter">范围：本卷⌄</span></div><div class="chapter-list-heading"><h2>章节列表</h2><span>5 章 · 5 种状态</span></div><div class="chapter-list"><article class="chapter-card"><div class="chapter-info"><strong>第 10 章</strong><span>旧园重逢</span></div><span class="chapter-status">○ 未生成</span></article><article class="chapter-card chapter-card--review"><div class="chapter-info"><strong>第 11 章</strong><span>风声渐起</span></div><span class="chapter-status">! 待复核</span></article><article class="chapter-card chapter-card--generating chapter-card--selected"><div class="chapter-info"><strong>第 12 章</strong><span>雨夜来客</span></div><span class="chapter-status">↻ 生成中</span></article><article class="chapter-card chapter-card--complete"><div class="chapter-info"><strong>第 13 章</strong><span>灯下问答</span></div><span class="chapter-status">✓ 已完成</span></article><article class="chapter-card chapter-card--stale"><div class="chapter-info"><strong>第 14 章</strong><span>门外余音</span></div><span class="chapter-status">↺ 已失效</span></article></div></div><div class="chapter-summary">○ 未生成 1 · ↻ 生成中 1 · ! 待复核 1<br>✓ 已完成 1 · ↺ 已失效 1</div></div><div class="resize-handle" aria-hidden="true"><span></span></div></aside>

            <section class="audio-editor" aria-label="整章生成任务与检查器">
              <header class="chapter-toolbar"><div class="chapter-context"><strong>第 12 章</strong><span>雨夜来客</span></div><div class="toolbar-summary"><div class="toolbar-progress"><strong>总进度 19/32 · 成功 17 · 失败 2</strong><span class="mini-progress"><span></span></span></div><span class="static-button" aria-disabled="true">取消</span></div></header>
              <div class="audio-editor-body">
                <section class="audio-script-pane" aria-label="任务剧本，可独立滚动">
                  <header class="script-header"><h1>整章生成任务</h1><p>总体进度 19 / 32 · 成功 17 · 失败 2</p></header>
                  <div class="script-hint">成功结果保持完成；失败行独立重试，不回退其他段落。</div>
                  <article class="audio-row"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">18</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">旁白</strong><span class="paragraph-id">段落 para_12_018</span></div><p class="row-script">雨线斜斜地敲在檐上，门外忽然传来三声轻叩。</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">排队</span></div></div><div class="row-audio-status"><span class="audio-version">音频 —</span><span class="status-pill" style="border-color:var(--vw-border-strong);background:#fff;color:var(--vw-text-secondary)">○ 排队</span><span class="status-pill status-pill--wide status-pill--warning">… 待校验</span></div></article>
                  <article class="audio-row audio-row--generating"><div class="row-gutter"><span class="play-control"></span><span class="row-number">19</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">沈砚</strong><span class="paragraph-id">段落 para_12_019</span></div><p class="row-script">“谁？”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">生成中</span></div></div><div class="row-audio-status"><span class="audio-version">音频生成中</span><span class="status-pill status-pill--warning">生成中</span><span class="status-pill status-pill--wide status-pill--warning">… 待校验</span></div></article>
                  <article class="audio-row audio-row--pending"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">20</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">旁白</strong><span class="paragraph-id">段落 para_12_020</span></div><p class="row-script">门外的人没有回答，只将油纸伞往廊下一收。</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">已生成待校验</span></div></div><div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill status-pill--warning">… 已生成待校验</span><span class="status-pill status-pill--wide status-pill--warning">… 待校验</span></div></article>
                  <article class="audio-row audio-row--success"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">21</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">苏婉</strong><span class="paragraph-id">段落 para_12_021</span></div><p class="row-script">“是我。夜深了，仍要来叨扰。”</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">高匹配</span></div></div><div class="row-audio-status"><span class="audio-version">音频 v3</span><span class="status-pill">✓ 高匹配</span><span class="status-pill status-pill--wide">✓ 高匹配 · 96%</span></div></article>
                  <article class="audio-row audio-row--generation-failed"><div class="row-gutter"><span class="play-control">▶</span><span class="row-number">22</span><span>⋮ 拖选</span></div><div class="row-content"><div class="row-meta"><strong class="row-speaker">旁白</strong><span class="paragraph-id">段落 para_12_022</span></div><p class="row-script">沈砚沉默片刻，侧身让开门。</p><div class="annotations"><span class="annotation">◇ 情绪：紧张</span><span class="annotation annotation--reading">↗ 朗读：压低音量</span><span class="row-state-text">生成失败 · 可单行重试</span></div></div><div class="row-audio-status"><span class="audio-version">音频 —</span><span class="status-pill status-pill--error">× 生成失败</span><span class="static-button static-button--compact" aria-disabled="true">重试本行</span></div></article>
                </section>
                <div class="audio-inspector-divider" aria-hidden="true"></div>
                <aside class="audio-inspector" aria-label="任务摘要，可独立滚动">
                  <section class="task-context-panel">
                    <header class="inspector-header"><div class="inspector-title-row"><h2>任务摘要</h2><span>‹ 折叠</span></div><p>整章生成中 · 剧本保持可见</p></header>
                    <section class="task-card"><div class="task-summary"><strong>部分失败</strong><span>19 / 32</span></div><div class="task-progress-track"><span></span></div><p class="task-result">成功 17 · 失败 2 · 剩余 13</p><p class="task-detail">成功行保持当前状态，仅失败行进入重试。</p><span class="static-button static-button--compact" aria-disabled="true">重试失败项</span></section>
                    <section class="inspector-card inspector-card--error"><h3>失败原因</h3><p>第 07 行：Provider 超时</p><p>第 18 行：文本超过限制</p><p>成功行保持当前状态，不回退</p></section>
                    <section class="inspector-card task-next"><h3>后续处理</h3><p>仅失败行进入重试队列</p><p>取消时已完成结果仍保留</p></section>
                    <span class="static-button static-button--compact" aria-disabled="true">重试失败项</span>
                  </section>
                  <section class="task-card"><div class="task-summary"><strong>部分失败</strong><span>19 / 32</span></div><div class="task-progress-track"><span></span></div><p class="task-result">成功 17 · 失败 2 · 剩余 13</p><p class="task-detail">成功行保持当前状态，仅失败行进入重试。</p><span class="static-button static-button--compact" aria-disabled="true">重试失败项</span></section>
                  <section class="inspector-card inspector-card--warning cancel-confirm-note"><h3>取消前需要确认</h3><p>已完成 17 条结果仍保留；仅停止排队与生成中项目。</p></section>
                </aside>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
