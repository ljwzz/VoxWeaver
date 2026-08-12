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
    <main aria-label="VoxWeaver 后期处理章节摘要静态页面">
          <header class="post-titlebar"><img src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true"><strong>VoxWeaver · 示例小说</strong><span>项目工作台</span></header>
          <div class="post-shell">
            <aside class="post-activity" aria-label="功能分组展示状态"><div class="activity-stack"><span class="post-activity-item">文</span><span class="post-activity-item">角</span><span class="post-activity-item">音</span><span class="post-activity-item is-current">后</span></div><span class="post-activity-item">设</span></aside>
            <aside class="post-sidebar" aria-label="后期处理导航展示状态"><div class="post-sidebar-main">
              <header class="post-sidebar-header"><div class="post-sidebar-heading"><h1>后期处理</h1><span class="post-sidebar-actions static-control" aria-disabled="true"><span>＋</span><span>⋯</span></span></div><p>章节后期处理 · 导出</p></header>
              <p class="post-nav-group">章节后期处理</p>
              <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">▾ 章节音频合并</span><span class="post-nav-count">2</span></div>
              <div class="post-nav-item is-child"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">时间轴对齐</span><span class="post-nav-count">3</span></div>
              <div class="post-nav-item is-child"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">响度一致性</span><span class="post-nav-count">4</span></div>
              <div class="post-nav-item is-current"><span class="post-nav-mark">✓</span><span class="post-nav-label">章节摘要生成</span><span class="post-nav-count">1</span></div>
              <div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">章节封面生成</span><span class="post-nav-count">2</span></div>
              <div class="post-nav-divider"></div><p class="post-nav-group">导出</p><div class="post-nav-item"><span class="post-nav-mark is-empty">•</span><span class="post-nav-label">导出 tar 包</span><span class="post-nav-count">2</span></div>
              <div class="post-sidebar-spacer"></div><div class="post-sidebar-summary"><span>第 12 章 · 38 个有效片段</span><span>2 缺失 · 1 已失效</span></div>
            </div><div class="post-resize-handle static-control" aria-label="侧栏宽度调整入口，仅展示" aria-disabled="true"></div></aside>
            <section class="post-editor" aria-label="章节摘要编辑区">
              <header class="chapter-toolbar"><div class="chapter-context" style="width:410px"><h2>第 12 章 · 雨夜来客</h2><p>章节摘要生成 · 当前有效剧本 v18</p></div><div class="toolbar-spacer"></div><span class="chip is-warning">候选 v3 · 待确认</span><span class="chip is-stale">旧摘要 v2 · 已失效</span><span class="display-button is-primary static-control" aria-disabled="true">确认章节摘要</span></header>
              <div class="post-content"><div class="post-content-inner three-column">
                <section class="dense-column card" aria-label="有效剧本固定快照">
                  <h3 class="section-title">有效剧本与内容范围</h3><span class="chip is-success" style="align-self:flex-start">v18 · 当前有效</span>
                  <div class="info-stack"><div class="info-row"><span class="caption">章节范围</span><span class="caption">para_12_001 – 032</span></div><div class="info-row"><span class="caption">内容统计</span><span class="caption">32 段 · 3,842 字</span></div><div class="info-row"><span class="caption">更新时间</span><span class="caption">今天 10:42</span></div></div>
                  <div class="script-update"><strong class="label state-stale">ⓧ 剧本已更新</strong><span class="caption state-stale">摘要 v2 因输入变化已失效</span></div>
                  <div class="chapter-preview"><strong class="label">章节内容预览</strong><div class="paragraph-row"><span>001</span><span>雨线斜斜地敲在檐上……</span></div><div class="paragraph-row"><span>006</span><span>沈砚起身走向门边。</span></div><div class="paragraph-row"><span>012</span><span>陌生人收起油纸伞。</span></div><div class="paragraph-row is-current"><span>018</span><span>门外传来三声轻叩。</span></div><div class="paragraph-row"><span>023</span><span>“多谢。”</span></div><div class="paragraph-row"><span>032</span><span>灯火在雨幕里渐远。</span></div></div>
                </section>
                <section class="dense-column card" aria-label="摘要候选固定文本">
                  <div class="notice-stale"><strong class="body-strong">ⓧ</strong><div class="notice-stale-message"><strong class="body-strong">摘要 v2 已失效，需要重新确认</strong><span class="caption state-stale">输入从剧本 v17 更新为 v18 · 变更 8 处</span></div></div>
                  <div class="candidate-summary-header"><h3 class="section-title">摘要候选 v3</h3><span class="caption state-warning">✎ 可编辑 · 未保存</span></div>
                  <div class="summary-editor"><p>雨夜，沈砚独自在旧宅整理遗物，门外忽然传来三声轻叩。来客苏婉带着一封多年未曾寄出的信，也带回一段被刻意掩埋的往事。</p><p>两人在试探与沉默之间重新拼合线索：失踪的账册、被改写的证词，以及雨幕中反复出现的脚步声，都指向同一个未被审判的夜晚。</p><p>章节结尾，苏婉留下信件后离开。沈砚没有追出去，只听见脚步声在廊下停顿了一瞬。</p><div class="summary-editor-spacer"></div><div class="editor-stats"><span class="caption">286 / 360 字</span><span class="caption state-success">自动保存草稿</span></div></div>
                  <div class="change-summary"><span>相较摘要 v2：新增 2 个线索 · 改写结尾 · 删除过时人物关系</span><span>查看差异 ↗</span></div>
                </section>
                <aside class="dense-column card" aria-label="生成输入与版本固定信息">
                  <h3 class="section-title">生成输入与版本</h3><div class="input-card summary-input-card"><div class="info-row"><span class="caption">输入版本</span><span class="caption">剧本 v18</span></div><div class="info-row"><span class="caption">章节范围</span><span class="caption">001 – 032</span></div><div class="info-row"><span class="caption">生成时间</span><span class="caption">10:47</span></div><div class="info-row"><span class="caption">输入摘要</span><span class="caption">sha256 7b4e…a12c</span></div></div>
                  <span class="label">提示词</span><div class="prompt-card">保留核心冲突和悬念；按事件顺序概括；不添加剧本未出现的事实；结尾避免剧透下一章。</div>
                  <span class="display-button static-control" style="align-self:flex-start" aria-disabled="true">重新生成</span>
                  <div class="history-header"><strong class="label">历史版本</strong><span class="caption">3 个版本</span></div><div class="history-list"><div class="history-item is-warning"><span>v3</span><span>待确认 · 剧本 v18</span></div><div class="history-item is-stale"><span>v2</span><span>ⓧ 已失效 · 剧本 v17</span></div><div class="history-item is-success"><span>v1</span><span>✓ 已确认 · 剧本 v16</span></div></div><span class="caption">生成输入、提示词和确认状态随版本保存。</span>
                </aside>
              </div></div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
