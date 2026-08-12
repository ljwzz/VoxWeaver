<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["post-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main aria-label="VoxWeaver 后期处理响度一致性静态页面">
          <header class="post-titlebar"><img src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true"><strong>VoxWeaver · 示例小说</strong><span>项目工作台</span></header>
          <div class="post-shell">
            <aside class="post-activity" aria-label="功能分组展示状态"><div class="activity-stack"><span class="post-activity-item">文</span><span class="post-activity-item">角</span><span class="post-activity-item">音</span><span class="post-activity-item is-current">后</span></div><span class="post-activity-item">设</span></aside>
            <aside class="post-sidebar" aria-label="后期处理导航展示状态"><div class="post-sidebar-main">
              <header class="post-sidebar-header"><div class="post-sidebar-heading"><h1>后期处理</h1><span class="post-sidebar-actions static-control" aria-disabled="true"><span>＋</span><span>⋯</span></span></div><p>章节后期处理 · 导出</p></header>
              <p class="post-nav-group">章节后期处理</p>
              <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">▾ 章节音频合并</span><span class="post-nav-count">2</span></div>
              <div class="post-nav-item is-child"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">时间轴对齐</span><span class="post-nav-count">3</span></div>
              <div class="post-nav-item is-child is-current"><span class="post-nav-mark">✓</span><span class="post-nav-label">响度一致性</span><span class="post-nav-count">4</span></div>
              <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">章节摘要生成</span><span class="post-nav-count">1</span></div>
              <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">章节封面生成</span><span class="post-nav-count">2</span></div>
              <div class="post-nav-divider"></div><p class="post-nav-group">导出</p><div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">导出 tar 包</span><span class="post-nav-count">2</span></div>
              <div class="post-sidebar-spacer"></div><div class="post-sidebar-summary"><span>第 12 章 · 38 个有效片段</span><span>2 缺失 · 1 已失效</span></div>
            </div><div class="post-resize-handle static-control" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"></div></aside>
            <section class="post-editor" aria-label="响度一致性编辑区">
              <header class="chapter-toolbar"><div class="chapter-context" style="width:390px"><h2>第 12 章 · 雨夜来客</h2><p>章节音频合并 / 响度一致性</p></div><div class="toolbar-spacer"></div><span class="chip is-accent">4 个候选待确认</span><span class="chip is-warning">待音频规格确认</span><span class="display-button static-control" aria-disabled="true">撤销候选</span><span class="display-button is-primary static-control" aria-disabled="true">应用到本章</span></header>
              <div class="post-content"><div class="post-content-inner loudness-layout">
                <section class="spec-gate"><strong class="body-strong">!</strong><p class="body-text">响度目标、真峰值与输出标准均为布局占位；待音频规格确认后才能固化。</p><span class="caption">当前章节：38 个有效片段</span></section>
                <div class="loudness-labels"><span>片段</span><span>当前值</span><span>建议值*</span><span>峰值 / 风险</span><span>处理状态</span><span>试听</span></div>
                <section class="candidate-panel" aria-label="自动响度候选固定数据">
                  <header class="candidate-header"><strong class="section-title" style="font-size:14px">⚙ 自动候选</strong><span class="caption">3 项 · 尚未应用</span></header>
                  <div class="loudness-row"><strong>P-018 · 旁白</strong><span class="caption">当前 -17.8</span><strong class="state-accent">建议 -16.0*</strong><span class="state-warning">峰值 -1.0 · 待确认</span><strong class="state-accent" style="font-size:10.34px;line-height:13.792px">⚙ 自动候选</strong><strong style="font-size:10.34px;line-height:13.792px">A/B 试听</strong></div>
                  <div class="loudness-row is-warning"><strong>P-021 · 苏婉</strong><span class="caption">当前 -13.2</span><strong class="state-accent">建议 -16.0*</strong><span class="state-warning">峰值 -0.2 · 风险</span><strong class="state-warning" style="font-size:10.34px;line-height:13.792px">! 峰值风险</strong><strong style="font-size:10.34px;line-height:13.792px">A/B 试听</strong></div>
                  <div class="loudness-row is-error"><strong>P-027 · 旁白</strong><span class="caption">当前 --</span><strong class="state-accent">建议 --</strong><span class="state-error">峰值 -- · 失败</span><strong class="state-error" style="font-size:10.34px;line-height:13.792px">× 处理失败</strong><strong style="font-size:10.34px;line-height:13.792px">A/B 试听</strong></div>
                </section>
                <section class="manual-panel" aria-label="人工确认固定数据"><header class="manual-header"><strong class="section-title" style="font-size:14px">人工确认</strong><span class="caption state-success">1 项已确认 · 与自动候选视觉分离</span></header><div class="loudness-row"><strong>P-023 · 苏婉</strong><span class="caption">当前 -16.8</span><strong class="state-accent">确认 -16.0*</strong><span class="state-success">峰值 -1.2 · 安全</span><strong class="state-success" style="font-size:10.34px;line-height:13.792px">✓ 人工确认</strong><strong style="font-size:10.34px;line-height:13.792px">前 / 后试听</strong></div></section>
                <section class="preview-grid" aria-label="响度试听固定展示">
                  <article class="preview-card"><strong class="section-title" style="font-size:14px">处理前试听</strong><span class="body-strong">当前 -17.8 · 峰值 -0.4</span><p class="preview-glyph" aria-hidden="true">▶  ━━━━━━━●━━━━━━━━  00:08.640</p><span class="caption">原片段 · 不改写源文件</span></article>
                  <article class="preview-card is-accent"><strong class="section-title state-accent" style="font-size:14px">候选后试听</strong><span class="body-strong state-warning">建议 -16.0* · 峰值风险待确认</span><p class="preview-glyph" aria-hidden="true">▶  ━━━━━━━━━●━━━━━━  00:08.640</p><span class="caption">仅预览候选 · 点击“应用到本章”后写入处理结果</span></article>
                  <article class="preview-card is-warning"><strong class="section-title state-warning" style="font-size:14px">当前选择</strong><span class="body-strong">P-021 · 峰值风险</span><strong class="state-warning">待复核</strong><span class="caption">撤销候选入口位于顶部</span></article>
                </section>
              </div></div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
