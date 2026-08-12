<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["text-page","script-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 剧本管理静态页面">
          <header class="window-titlebar"><img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt=""><p class="window-title">VoxWeaver · 示例小说</p><p class="window-context">项目工作台</p></header>
          <div class="workspace-body">
            <aside class="activity-rail"><div class="activity-list"><div class="activity-item activity-item--selected"><span class="activity-glyph">文</span><span class="selection-bar"></span></div><div class="activity-item activity-item--review"><span class="activity-glyph">角</span><span class="activity-marker">!</span></div><div class="activity-item activity-item--processing"><span class="activity-glyph">音</span><span class="activity-marker">◔</span></div><div class="activity-item activity-item--stale"><span class="activity-glyph">后</span><span class="activity-marker">↻</span></div></div><div class="activity-item"><span class="activity-glyph">设</span></div></aside>
            <aside class="context-sidebar"><div class="sidebar-content"><div class="sidebar-top">
              <header class="sidebar-header"><div class="sidebar-heading-row"><h1>文本整理</h1><span class="sidebar-actions"><span>＋</span><span>⋯</span></span></div><p class="sidebar-subtitle">5 个子功能 · 12 项待复核</p></header>
              <div class="sidebar-item sidebar-item--default"><span class="sidebar-state"></span><span class="sidebar-label">文本提取</span><span class="sidebar-count">1</span></div>
              <div class="sidebar-item sidebar-item--processing"><span class="sidebar-state">◔</span><span class="sidebar-label">章节切割</span><span class="sidebar-count">36</span></div>
              <div class="sidebar-item sidebar-item--review"><span class="sidebar-state">!</span><span class="sidebar-label">错别字与标点</span><span class="sidebar-count">12</span></div>
              <div class="sidebar-item sidebar-item--failed"><span class="sidebar-state">×</span><span class="sidebar-label">角色提取</span><span class="sidebar-count">2</span></div>
              <div class="sidebar-item sidebar-item--selected"><span class="sidebar-state">✓</span><span class="sidebar-label">剧本管理</span><span class="sidebar-count">3</span></div>
            </div><section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section></div><div class="resize-handle" aria-disabled="true"><span></span></div></aside>
            <section class="editor">
              <header class="editor-toolbar"><div class="toolbar-context"><strong>剧本管理</strong><span>·</span><span>第 03 章 · 门后的影子 · 剧本 v7 · 最长 200 字</span></div><div class="toolbar-actions"><span class="icon-button">⋯</span><span class="toolbar-button toolbar-button--secondary">版本历史</span><span class="toolbar-button toolbar-button--primary">保存剧本版本</span></div></header>
              <div class="text-editor-content script-content">
                <div class="page-heading script-heading"><div class="page-heading-copy"><h2>剧本管理</h2><p>第 03 章 · 门后的影子 · 当前版本 v7 · 段落最长 200 字</p></div><span class="status-badge status-badge--review"><span>!</span><span>待复核</span></span></div>
                <div class="script-tool-row"><span class="text-button"><span>拆分段落</span></span><span class="text-button"><span>合并上段</span></span><span class="text-button"><span>上移</span></span><span class="text-button"><span>下移</span></span><span class="text-button"><span>编辑文本</span></span><span class="hint">选择已被下游引用的段落后，拆分将打开失效确认。</span></div>

                <article class="script-row">
                  <div class="script-meta"><div class="script-meta-left"><span class="caption">第 017 行</span><strong>说话人：林舟</strong><span style="color: var(--vw-text-secondary)">表达：低声</span><span style="color: var(--vw-accent-primary)">默认</span></div><span class="script-id">para_01_017</span></div>
                  <p class="script-copy">雨声贴着窗沿落下。林舟停顿片刻，压低声音说：我们必须在天亮前离开这里。</p>
                  <div class="script-annotations"><span class="annotation"><span>人</span><span>说话人：林砚</span></span><span class="annotation"><span>◇</span><span>情绪：紧张</span></span><span class="annotation annotation--reading"><span>↗</span><span>朗读：压低音量</span></span></div>
                  <div class="script-status"><span class="script-status-copy">来源：第 3 章 · 18–24 行</span><div class="script-flags"><span class="impact-badge impact-badge--neutral"><span>○</span><span>未引用</span></span><span class="length-counter"><span class="caption">正常</span><span>56 / 200</span></span><span class="status-badge status-badge--neutral"><span>•</span><span>默认</span></span></div></div>
                </article>

                <article class="script-row script-row--error">
                  <div class="script-meta"><div class="script-meta-left"><span class="caption">第 021 行</span><strong>说话人：林舟</strong><span style="color: var(--vw-text-secondary)">表达：低声</span><span style="color: var(--vw-state-error)">超长阻塞</span></div><span class="script-id">para_01_021</span></div>
                  <p class="script-copy">林舟把散落在桌面的记录一页页重新排好，又将昨夜发生的事情从头复述了一遍。他刻意放慢速度，希望每个人都能听清，但这段文字已经超过当前段落最长字数配置，需要拆分后才能继续生成音频。</p>
                  <div class="script-annotations"><span class="annotation"><span>人</span><span>说话人：林砚</span></span><span class="annotation"><span>◇</span><span>情绪：紧张</span></span><span class="annotation annotation--reading"><span>↗</span><span>朗读：压低音量</span></span></div>
                  <div class="script-status"><span class="script-status-copy script-status-copy--error">阻塞：超过最长字数 26 字。请拆分段落或调整配置。</span><div class="script-flags"><span class="impact-badge impact-badge--neutral"><span>○</span><span>未引用</span></span><span class="length-counter length-counter--error"><span>阻塞</span><span>226 / 200</span></span><span class="status-badge status-badge--error"><span>×</span><span>失败</span></span></div></div>
                </article>

                <section class="split-result">
                  <div class="row-between"><strong>拆分结果示例</strong><span class="status-badge status-badge--success"><span>✓</span><span>已完成</span></span></div>
                  <article class="split-result-row">
                    <div class="script-meta"><div class="script-meta-left"><span class="caption">第 018 行</span><strong>说话人：林舟</strong><span class="caption">来源：第 3 章 · 原 18–24 行</span></div><span class="script-id">para_01_018a</span></div>
                    <p class="script-copy">门轴发出一声轻响。林舟停在原地，雨水从衣角滴落。</p>
                    <div class="script-annotations"><span class="annotation"><span>人</span><span>说话人：林砚</span></span><span class="annotation"><span>◇</span><span>情绪：紧张</span></span><span class="annotation annotation--reading"><span>↗</span><span>朗读：压低音量</span></span><span class="impact-badge impact-badge--neutral"><span>○</span><span>未引用</span></span><span class="length-counter"><span class="caption">正常</span><span>24 / 200</span></span><span class="caption" style="color: #2e7d55">不继承原音频 / 原时间轴</span></div>
                  </article>
                  <article class="split-result-row">
                    <div class="script-meta"><div class="script-meta-left"><span class="caption">第 019 行</span><strong>说话人：林舟</strong><span class="caption">来源：第 3 章 · 原 18–24 行</span></div><span class="script-id">para_01_018b</span></div>
                    <p class="script-copy">“别回头。”沈砚在身后说。林舟却已经看见门后的影子。</p>
                    <div class="script-annotations"><span class="annotation"><span>人</span><span>说话人：林砚</span></span><span class="annotation"><span>◇</span><span>情绪：紧张</span></span><span class="annotation annotation--reading"><span>↗</span><span>朗读：压低音量</span></span><span class="impact-badge impact-badge--neutral"><span>○</span><span>未引用</span></span><span class="length-counter"><span class="caption">正常</span><span>26 / 200</span></span><span class="caption" style="color: #2e7d55">不继承原音频 / 原时间轴</span></div>
                  </article>
                  <p class="caption">两个新段落获得不同 ID；继承仍适用的说话人与来源信息，不显示原音频和原时间轴。</p>
                </section>

                <section class="history-stale"><div><strong>历史段落 para_01_018</strong><p class="caption" style="color: var(--vw-state-stale)">原音频 clip_para_01_018 与原时间轴 timeline_para_01_018 保留在历史信息中，并标记为“已失效”。</p></div><div class="script-flags"><span class="impact-badge impact-badge--invalidated"><span>×</span><span>已失效 3</span></span><span class="status-badge status-badge--stale"><span>↻</span><span>已失效</span></span></div></section>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
