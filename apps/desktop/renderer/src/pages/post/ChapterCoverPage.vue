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
    <main aria-label="VoxWeaver 后期处理章节封面静态页面">
          <header class="post-titlebar"><img src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true"><strong>VoxWeaver · 示例小说</strong><span>项目工作台</span></header>
          <div class="post-shell">
            <aside class="post-activity" aria-label="功能分组展示状态"><div class="activity-stack"><span class="post-activity-item">文</span><span class="post-activity-item">角</span><span class="post-activity-item">音</span><span class="post-activity-item is-current">后</span></div><span class="post-activity-item">设</span></aside>
            <aside class="post-sidebar" aria-label="后期处理导航展示状态"><div class="post-sidebar-main">
              <header class="post-sidebar-header"><div class="post-sidebar-heading"><h1>后期处理</h1><span class="post-sidebar-actions static-control" aria-disabled="true"><span>＋</span><span>⋯</span></span></div><p>章节后期处理 · 导出</p></header><p class="post-nav-group">章节后期处理</p>
              <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">▾ 章节音频合并</span><span class="post-nav-count">2</span></div><div class="post-nav-item is-child"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">时间轴对齐</span><span class="post-nav-count">3</span></div><div class="post-nav-item is-child"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">响度一致性</span><span class="post-nav-count">4</span></div><div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">章节摘要生成</span><span class="post-nav-count">1</span></div><div class="post-nav-item is-current"><span class="post-nav-mark">✓</span><span class="post-nav-label">章节封面生成</span><span class="post-nav-count">2</span></div>
              <div class="post-nav-divider"></div><p class="post-nav-group">导出</p><div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">导出 tar 包</span><span class="post-nav-count">2</span></div><div class="post-sidebar-spacer"></div><div class="post-sidebar-summary"><span>第 12 章 · 38 个有效片段</span><span>2 缺失 · 1 已失效</span></div>
            </div><div class="post-resize-handle static-control" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"></div></aside>
            <section class="post-editor" aria-label="章节封面编辑区">
              <header class="chapter-toolbar"><div class="chapter-context" style="width:410px"><h2>第 12 章 · 雨夜来客</h2><p>章节封面生成 · 当前摘要 v3</p></div><div class="toolbar-spacer"></div><span class="chip is-success">摘要 v3 · 当前有效</span><span class="chip is-warning">封面状态：待确认</span><span class="chip is-accent">生成中 62%</span></header>
              <div class="post-content"><div class="post-content-inner cover-layout">
                <section class="cover-candidates card" aria-label="章节封面固定候选">
                  <header class="cover-header"><h3 class="section-title">封面候选</h3><span class="caption">4 个等宽候选 · 非瀑布流</span></header>
                  <div class="cover-grid"><article class="cover-candidate"><div class="panel-header"><strong>候选 01</strong><span class="state-stale">● 已生成</span></div><img src="./assets/cover-preview.svg" alt="候选 01 抽象预览"><span>灯影与雨幕</span><span class="caption">摘要 v3 · 提示词 v2</span></article><article class="cover-candidate is-current"><div class="panel-header"><strong>候选 02</strong><span class="state-success">✓ 已选择</span></div><img src="./assets/cover-preview.svg" alt="候选 02 抽象预览"><span>门外的来客</span><span class="caption">摘要 v3 · 提示词 v2</span></article><article class="cover-candidate is-stale"><div class="panel-header"><strong>候选 03</strong><span>ⓧ 已失效</span></div><img src="./assets/cover-preview.svg" alt="候选 03 抽象预览"><span>旧信与回声</span><span>摘要 v2 · 已失效</span></article><article class="cover-candidate is-error"><div class="panel-header"><strong>候选 04</strong><span>× 生成失败</span></div><img src="./assets/cover-preview.svg" alt="候选 04 抽象预览"><span>生成失败</span><span>重试任务 #248</span></article></div>
                  <div class="selected-cover" aria-label="已选择候选 02 抽象占位封面"><div class="cover-sky"></div><img class="cover-light" src="./assets/cover-abstract-light.svg" alt="抽象光源"><div class="cover-building"></div><div class="cover-doorway"></div><i class="rain-line" style="top:20.58px;left:15px;height:36px"></i><i class="rain-line" style="top:54.58px;left:57px;height:48px"></i><i class="rain-line" style="top:88.58px;left:99px;height:60px"></i><i class="rain-line" style="top:122.58px;left:141px;height:36px"></i><i class="rain-line" style="top:20.58px;left:183px;height:48px"></i><i class="rain-line" style="top:54.58px;left:225px;height:60px"></i><i class="rain-line" style="top:88.58px;left:267px;height:36px"></i><i class="rain-line" style="top:122.58px;left:309px;height:48px"></i><i class="rain-line" style="top:20.58px;left:351px;height:60px"></i><i class="rain-line" style="top:54.58px;left:393px;height:36px"></i><i class="rain-line" style="top:88.58px;left:435px;height:48px"></i><i class="rain-line" style="top:122.58px;left:477px;height:60px"></i><i class="rain-line" style="top:20.58px;left:519px;height:36px"></i><i class="rain-line" style="top:54.58px;left:561px;height:48px"></i><i class="rain-line" style="top:88.58px;left:603px;height:60px"></i><i class="rain-line" style="top:122.58px;left:645px;height:36px"></i><i class="rain-line" style="top:20.58px;left:687px;height:48px"></i><i class="rain-line" style="top:54.58px;left:729px;height:60px"></i><span class="cover-placeholder-badge">抽象占位图 · 不引用具体艺术家风格</span></div>
                  <div class="cover-footer"><span>✓ 已选择候选 02 · 尚未确认</span><span class="state-warning">待复核</span></div>
                </section>
                <aside class="cover-inspector card" aria-label="封面检查器固定信息"><h3 class="section-title">封面检查器</h3><span class="chip is-accent" style="align-self:flex-start">候选 02 · 已选择</span><div class="input-card format-card"><div class="info-row"><span class="caption">画幅</span><span class="caption">16:9 · 占位</span></div><div class="info-row"><span class="caption">尺寸</span><span class="caption">1920 × 1080 · 占位</span></div><div class="info-row"><span class="caption">规格状态</span><span class="caption state-warning">待确认</span></div><span class="caption state-warning">具体画幅、尺寸和输出格式尚未固化。</span></div><span class="label">风格提示词</span><div class="style-prompt">中性叙事封面；雨夜、旧宅门廊与一封未寄出的信；低饱和、清晰主体、避免文字；不引用具体艺术家或品牌视觉。</div><div class="input-card generation-card"><div class="info-row"><span class="caption">摘要版本</span><span class="caption">summary v3</span></div><div class="info-row"><span class="caption">提示词版本</span><span class="caption">prompt v2</span></div><div class="info-row"><span class="caption">生成任务</span><span class="caption">cover #248</span></div><div class="info-row"><span class="caption">输入摘要</span><span class="caption">sha256 91e0…d214</span></div></div><div class="progress-card"><strong class="label state-accent">候选 04 重新生成中</strong><div class="progress-track"></div><span class="caption">62% · 保存生成输入与版本信息</span></div><div class="inspector-actions static-control" aria-disabled="true"><span class="display-button">重新生成</span><span class="display-button is-primary">选择并确认</span></div><span class="caption">未加入社交分享；成品导出由“导出 tar”处理。</span></aside>
              </div></div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
