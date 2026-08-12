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
    <main aria-label="VoxWeaver 后期处理时间轴对齐静态页面">
          <header class="post-titlebar">
            <img src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <strong>VoxWeaver · 示例小说</strong>
            <span>项目工作台</span>
          </header>
          <div class="post-shell">
            <aside class="post-activity" aria-label="功能分组展示状态">
              <div class="activity-stack">
                <span class="post-activity-item">文</span><span class="post-activity-item">角</span><span class="post-activity-item">音</span><span class="post-activity-item is-current">后</span>
              </div>
              <span class="post-activity-item">设</span>
            </aside>
            <aside class="post-sidebar" aria-label="后期处理导航展示状态">
              <div class="post-sidebar-main">
                <header class="post-sidebar-header">
                  <div class="post-sidebar-heading"><h1>后期处理</h1><span class="post-sidebar-actions static-control" aria-disabled="true"><span>＋</span><span>⋯</span></span></div>
                  <p>章节后期处理 · 导出</p>
                </header>
                <p class="post-nav-group">章节后期处理</p>
                <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">▾ 章节音频合并</span><span class="post-nav-count">2</span></div>
                <div class="post-nav-item is-child is-current"><span class="post-nav-mark">✓</span><span class="post-nav-label">时间轴对齐</span><span class="post-nav-count">3</span></div>
                <div class="post-nav-item is-child"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">响度一致性</span><span class="post-nav-count">4</span></div>
                <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">章节摘要生成</span><span class="post-nav-count">1</span></div>
                <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">章节封面生成</span><span class="post-nav-count">2</span></div>
                <div class="post-nav-divider"></div>
                <p class="post-nav-group">导出</p>
                <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">导出 tar 包</span><span class="post-nav-count">2</span></div>
                <div class="post-sidebar-spacer"></div>
                <div class="post-sidebar-summary"><span>第 12 章 · 38 个有效片段</span><span>2 缺失 · 1 已失效</span></div>
              </div>
              <div class="post-resize-handle static-control" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"></div>
            </aside>
            <section class="post-editor" aria-label="时间轴对齐编辑区">
              <header class="chapter-toolbar">
                <div class="chapter-context"><h2>第 12 章 · 雨夜来客</h2><p>章节音频合并 / 时间轴对齐</p></div>
                <div class="toolbar-spacer"></div>
                <span class="chip is-success">38 有效</span><span class="chip is-error">2 缺失 / 1 已失效</span><span class="display-button is-primary static-control" aria-disabled="true">生成章节音频</span>
              </header>
              <div class="post-content">
                <div class="post-content-inner timeline-content">
                  <section class="waveform-card" aria-label="章节波形固定展示">
                    <img class="waveform-play" src="./assets/play.svg" width="32" height="32" alt="" aria-hidden="true"><span class="waveform-pause">Ⅱ</span>
                    <span class="waveform-caption">第 12 章 · 有效音频 38</span><span class="waveform-time">00:42.680 / 08:36.200</span>
                    <img class="waveform-graphic" src="./assets/waveform.svg" alt="固定章节波形"><span class="waveform-line" aria-hidden="true"></span><span class="waveform-state">播放中</span>
                  </section>
                  <div class="timeline-controls"><span class="chip is-accent">磁吸：开启</span><span class="chip">精度：10 ms</span><span class="chip">缩放 100%  −  ＋</span><span class="caption">1280px：保持片段最小宽度 · 横向滚动 / 缩放</span></div>
                  <section class="timeline-viewport" aria-label="章节时间轴固定展示">
                    <div class="timeline-canvas">
                      <div class="timeline-ruler">
                        <i class="timeline-tick is-major" style="left:19px"></i><i class="timeline-tick" style="left:111px"></i><i class="timeline-tick" style="left:203px"></i><i class="timeline-tick" style="left:295px"></i><i class="timeline-tick" style="left:387px"></i><i class="timeline-tick is-major" style="left:479px"></i><i class="timeline-tick" style="left:571px"></i><i class="timeline-tick" style="left:663px"></i><i class="timeline-tick" style="left:755px"></i><i class="timeline-tick" style="left:847px"></i><i class="timeline-tick is-major" style="left:939px"></i>
                        <span class="timeline-ruler-label" style="left:19px">00:00</span><span class="timeline-ruler-label" style="left:249px">00:30</span><span class="timeline-ruler-label" style="left:479px">01:00</span><span class="timeline-ruler-label" style="left:709px">01:30</span><span class="timeline-ruler-label" style="left:899px">02:00</span>
                      </div>
                      <article class="timeline-clip is-success" style="left:20px"><div class="timeline-clip-header"><span>旁白</span><span class="state-success">✓ 有效</span></div><span class="timeline-clip-id">P-018</span><div class="timeline-clip-time"><span>00:00.000</span><span>→ 00:09.200</span></div></article>
                      <article class="timeline-clip is-error" style="left:194px"><div class="timeline-clip-header"><span>沈砚</span><span class="state-error">! 缺失</span></div><span class="timeline-clip-id">P-019</span><div class="timeline-clip-time"><span>00:09.600</span><span>→ --:--.---</span></div></article>
                      <article class="timeline-clip is-warning" style="left:368px"><div class="timeline-clip-header"><span>旁白</span><span class="state-warning">⧉ 重复</span></div><span class="timeline-clip-id">P-020</span><div class="timeline-clip-time"><span>00:15.400</span><span>→ 00:19.200</span></div></article>
                      <article class="timeline-clip is-warning" style="left:542px"><div class="timeline-clip-header"><span>苏婉</span><span class="state-warning">? 未审核</span></div><span class="timeline-clip-id">P-021</span><div class="timeline-clip-time"><span>00:19.800</span><span>→ 00:29.400</span></div></article>
                      <article class="timeline-clip is-stale" style="left:716px"><div class="timeline-clip-header"><span>旁白</span><span class="state-stale">ⓧ 已失效</span></div><span class="timeline-clip-id">P-022</span><div class="timeline-clip-time"><span>00:30.100</span><span>→ 00:39.800</span></div></article>
                      <article class="timeline-clip" style="left:890px"><div class="timeline-clip-header"><span>苏婉</span><span class="state-accent">▶ 当前</span></div><span class="timeline-clip-id">P-023</span><div class="timeline-clip-time"><span>00:40.200</span><span>→ 00:46.800</span></div></article>
                      <article class="timeline-clip is-success" style="left:1100px"><div class="timeline-clip-header"><span>旁白</span><span class="state-success">✓ 有效</span></div><span class="timeline-clip-id">P-024</span><div class="timeline-clip-time"><span>00:47.600</span><span>→ 00:56.100</span></div></article>
                      <div class="timeline-playhead"><span>00:42.680</span><img src="./assets/playhead-handle.svg" alt="" aria-hidden="true"></div>
                    </div>
                  </section>
                  <div class="timeline-scrollbar" aria-hidden="true"></div>
                  <section class="current-clip-panel" aria-label="当前片段固定信息">
                    <div class="current-script"><span class="label state-accent">▶ 当前指针 00:42.680 · P-023</span><strong class="body-strong">苏婉 · 段落 23</strong><blockquote>“多谢。” 门外的雨声暂歇，角色在片段末尾停顿。</blockquote><span class="caption">播放指针同时定位当前片段与剧本文本摘要</span></div>
                    <div class="exact-controls">
                      <div class="time-inputs"><div class="time-input"><span class="caption">开始时间</span><strong class="body-strong">00:40.200</strong></div><div class="time-input"><span class="caption">结束时间</span><strong class="body-strong">00:46.800</strong></div><div class="time-input"><span class="caption">前置停顿</span><strong class="body-strong">+ 0.400 s</strong></div><div class="time-input"><span class="caption">后置停顿</span><strong class="body-strong">+ 0.800 s</strong></div></div>
                      <div class="clip-actions static-control" aria-disabled="true"><span class="display-button">调整停顿</span><span class="display-button">替换片段</span><span class="chip">拖动后自动吸附</span></div>
                      <span class="caption">拖动片段边缘调整位置；按住 ⌥ 暂停吸附；时间输入支持 10 ms 精度。</span>
                    </div>
                  </section>
                </div>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
