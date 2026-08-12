<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["text-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="workspace" aria-label="VoxWeaver 角色提取静态页面">
          <header class="window-titlebar"><img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt=""><p class="window-title">VoxWeaver · 示例小说</p><p class="window-context">项目工作台</p></header>
          <div class="workspace-body">
            <aside class="activity-rail"><div class="activity-list"><div class="activity-item activity-item--selected"><span class="activity-glyph">文</span><span class="selection-bar"></span></div><div class="activity-item activity-item--review"><span class="activity-glyph">角</span><span class="activity-marker">!</span></div><div class="activity-item activity-item--processing"><span class="activity-glyph">音</span><span class="activity-marker">◔</span></div><div class="activity-item activity-item--stale"><span class="activity-glyph">后</span><span class="activity-marker">↻</span></div></div><div class="activity-item"><span class="activity-glyph">设</span></div></aside>
            <aside class="context-sidebar"><div class="sidebar-content"><div class="sidebar-top">
              <header class="sidebar-header"><div class="sidebar-heading-row"><h1>文本整理</h1><span class="sidebar-actions"><span>＋</span><span>⋯</span></span></div><p class="sidebar-subtitle">5 个子功能 · 12 项待复核</p></header>
              <div class="sidebar-item sidebar-item--default"><span class="sidebar-state"></span><span class="sidebar-label">文本提取</span><span class="sidebar-count">1</span></div>
              <div class="sidebar-item sidebar-item--processing"><span class="sidebar-state">◔</span><span class="sidebar-label">章节切割</span><span class="sidebar-count">36</span></div>
              <div class="sidebar-item sidebar-item--review"><span class="sidebar-state">!</span><span class="sidebar-label">错别字与标点</span><span class="sidebar-count">12</span></div>
              <div class="sidebar-item sidebar-item--selected"><span class="sidebar-state">✓</span><span class="sidebar-label">角色提取</span><span class="sidebar-count">2</span></div>
              <div class="sidebar-item sidebar-item--stale"><span class="sidebar-state">↻</span><span class="sidebar-label">剧本管理</span><span class="sidebar-count">3</span></div>
            </div><section class="sidebar-summary"><h2>示例小说</h2><p>36 章 · 总进度 62%</p></section></div><div class="resize-handle" aria-disabled="true"><span></span></div></aside>
            <section class="editor"><header class="editor-toolbar"><div class="toolbar-context"><strong>角色提取</strong><span>·</span><span>18 个候选 · 4 项待确认 · 1 项冲突</span></div><div class="toolbar-actions"><span class="icon-button">⋯</span><span class="toolbar-button toolbar-button--secondary">批量确认</span><span class="toolbar-button toolbar-button--primary">确认并加入角色档案</span></div></header>
              <div class="text-editor-content text-editor-content--compact character-content">
                <div class="page-heading"><div class="page-heading-copy"><h2>角色提取</h2><p>候选来自章节原文证据；确认后才写入角色档案。</p></div><span class="status-badge status-badge--review">! 待复核</span></div>
                <div class="filter-row">
                  <div class="static-filter" style="width: 450px"><div class="static-filter-copy"><span class="static-filter-label">搜索</span><span class="static-filter-value">姓名 / 称谓 / 别名</span></div><span class="caption">⌄</span></div>
                  <div class="static-filter" style="width: 270px"><div class="static-filter-copy"><span class="static-filter-label">状态</span><span class="static-filter-value">全部候选</span></div><span class="caption">⌄</span></div>
                  <div class="static-filter" style="width: 368px"><div class="static-filter-copy"><span class="static-filter-label">来源章节</span><span class="static-filter-value">第 1–8 章</span></div><span class="caption">⌄</span></div>
                </div>
                <div class="definition-warning"><span class="strong">!</span><span>“化身名称”和“模仿关系”的业务定义待确认；当前仅展示字段与选择控件，不补充含义。</span></div>
                <section class="surface-card character-table">
                  <div class="character-table-head"><span>角色 / 状态</span><span>称谓 · 别名 · 化身</span><span>来源与证据</span><span>动态属性</span><span>模仿目标角色</span></div>
                  <div class="character-row"><div class="character-identity"><span>林舟</span><span class="status-badge status-badge--processing">◔ 处理中</span></div><div class="character-cell">林队、舟哥<br>化身：夜航者</div><div class="character-cell">第 3、5 章<br>“林舟抬起受伤的左臂，示意众人停下。”</div><div class="character-cell">成年 · 紧张<br>左臂受伤 · 克制</div><div class="target-selector"><span>未选择目标角色</span><span class="caption">⌄</span></div></div>
                  <div class="character-row character-row--success"><div class="character-identity"><span>沈砚</span><span class="status-badge status-badge--success">✓ 已完成</span></div><div class="character-cell">沈医生<br>化身：—</div><div class="character-cell">第 3、8 章<br>“沈砚合上药箱，语气仍然平静。”</div><div class="character-cell">成年 · 平静<br>无伤病 · 专注</div><div class="target-selector"><span>未选择目标角色</span><span class="caption">⌄</span></div></div>
                  <div class="character-row character-row--error"><div class="character-identity"><span>阿满 / 满叔</span><span class="status-badge status-badge--error">× 失败</span></div><div class="character-cell">称谓指向冲突<br>化身：守门人</div><div class="character-cell">第 5、8 章<br>是否为同一角色，原文证据不足。</div><div class="character-cell">年龄未知 · 警觉<br>伤病未知 · 防备</div><div class="target-selector"><span>未选择目标角色</span><span class="caption">⌄</span></div></div>
                  <div class="character-row character-row--review"><div class="character-identity"><span>苏禾</span><span class="status-badge status-badge--review">! 待复核</span></div><div class="character-cell">小禾<br>化身：白鸢</div><div class="character-cell">第 8 章<br>“白鸢借用沈砚的声线重复了警告。”</div><div class="character-cell">成年 · 紧张<br>无伤病 · 犹疑</div><div class="target-selector"><span>沈砚</span><span class="caption">⌄</span></div></div>
                </section>
                <div class="selected-character-actions"><p class="body-copy" style="color: var(--vw-text-secondary)">已选择：苏禾 · 待确认 · 模仿目标“沈砚”</p><div class="card-actions" style="width: auto"><span class="text-button">查看全部证据</span><span class="text-button text-button--primary">确认并加入角色档案</span></div></div>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
