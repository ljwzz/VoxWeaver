<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["settings-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="settings-workspace" aria-label="项目设置静态页面">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver / Project Workspace</p>
            <p class="window-context"><span class="viewport-1440">1440 × 900</span><span class="viewport-1280">1280 × 800</span></p>
          </header>

          <div class="settings-shell">
            <aside class="settings-rail" aria-label="功能分组">
              <div class="settings-rail-list">
                <span class="settings-activity static-control" tabindex="-1" aria-label="文本整理，仅展示">文</span>
                <span class="settings-activity static-control" tabindex="-1" aria-label="角色管理，仅展示">角</span>
                <span class="settings-activity static-control" tabindex="-1" aria-label="音频生成，仅展示">音</span>
                <span class="settings-activity static-control" tabindex="-1" aria-label="后期处理，仅展示">后</span>
              </div>
              <span class="settings-activity settings-activity--selected static-control" aria-current="page" aria-label="设置，当前选中">设</span>
            </aside>

            <aside class="settings-sidebar" aria-label="设置子功能">
              <div class="settings-sidebar-content">
                <div class="settings-sidebar-top">
                  <header class="settings-sidebar-header"><h1>设置</h1><p>项目与软件配置</p></header>
                  <span class="settings-nav-item static-control"><span class="settings-nav-state">•</span><span class="settings-nav-label">项目备份</span></span>
                  <span class="settings-nav-item settings-nav-item--selected static-control" aria-current="page"><span class="settings-nav-state">✓</span><span class="settings-nav-label">项目设置</span></span>
                  <span class="settings-nav-item static-control"><span class="settings-nav-state">•</span><span class="settings-nav-label">软件设置</span></span>
                </div>
                <div class="settings-sidebar-summary"><strong>Project VoxWeaver</strong><span>设置按作用范围分层</span></div>
              </div>
              <div class="settings-resize-handle" aria-label="侧栏宽度调整入口，仅展示"></div>
            </aside>

            <section class="settings-editor" aria-label="项目设置编辑区">
              <header class="settings-toolbar"><strong>项目设置</strong><span>·</span><span>仅作用于当前项目</span></header>
              <div class="settings-content">
                <section class="settings-card save-state-card" aria-label="项目设置状态">
                  <div class="save-state-copy"><strong>项目设置状态</strong><span>字段状态与恢复入口始终可见</span></div>
                  <div class="save-state-chips" aria-label="静态保存状态集合">
                    <span class="chip chip--warning-strong">未保存修改</span>
                    <span class="chip chip--warning">保存中</span>
                    <span class="chip chip--success">保存成功</span>
                    <span class="chip chip--error">字段错误</span>
                    <span class="chip chip--error">保存失败</span>
                  </div>
                  <span class="save-state-spacer"></span>
                  <span class="primary-action static-control">保存项目设置<span class="shortcut">⌘↵</span></span>
                </section>

                <section class="settings-card settings-panel" aria-labelledby="script-settings-heading">
                  <div class="settings-group">
                    <h2 id="script-settings-heading">剧本切分</h2>
                    <span class="group-scope">仅当前项目</span>
                    <p class="group-description">配置段落切分与生成前超限检查。</p>
                    <div class="group-strip" aria-hidden="true"></div>
                  </div>
                  <div class="paragraph-row">
                    <div class="field-label"><strong>段落最长字数</strong><span>用于剧本切分与生成前超限检查</span></div>
                    <div class="provider-inline"><strong>当前 TTS：示例 Provider · model-zh-v2</strong><span>能力探测示例上限：4000 字 · 非产品默认</span></div>
                    <div class="number-field-wrap">
                      <span class="number-field static-control" aria-label="段落最长字数 2400 字，仅展示"><span>2400</span><span class="unit">字</span></span>
                      <span class="number-field-hint">示例范围 100–4000 · 来自能力探测，待确认</span>
                    </div>
                  </div>
                  <p class="script-effect"><span class="info-mark">ⓘ</span><span>修改配置不会自动重切现有剧本，只会标出超限段落。</span></p>
                </section>

                <section class="settings-card settings-panel settings-panel--audio" aria-labelledby="audio-validation-heading">
                  <div class="settings-group">
                    <h2 id="audio-validation-heading">音频校验</h2>
                    <span class="group-scope">仅当前项目</span>
                    <p class="group-description">控制 ASR 相似度 Gate 与待复核判定。</p>
                    <div class="group-strip" aria-hidden="true"></div>
                  </div>
                  <div class="gate-notes">
                    <h3>启用 ASR 相似度 Gate</h3>
                    <p>低于阈值时进入待复核，不断言 TTS 发音错误。</p>
                    <p>修改阈值会重新判定已保存分数，不等同于重新运行 ASR。</p>
                    <span class="chip chip--selected">当前项目范围</span>
                  </div>
                  <div class="threshold-card" aria-label="ASR 相似度阈值，固定展示">
                    <div class="gate-row">
                      <span class="gate-switch static-control" aria-label="ASR 相似度 Gate 已启用，仅展示"><img src="./assets/gate-switch.svg" width="44" height="24" alt=""></span>
                      <strong>启用 ASR 相似度 Gate</strong><span class="gate-value">86%</span>
                    </div>
                    <span class="threshold-slider static-control" aria-label="ASR 相似度阈值 86%，仅展示">
                      <span class="threshold-track"></span><span class="threshold-active"></span><img class="threshold-thumb" src="./assets/slider-thumb.svg" width="16" height="16" alt="">
                    </span>
                    <span class="low-match static-control" aria-label="低匹配预览，仅展示"><strong>⚠</strong><span>转写结果不一致，待复核 · 示例 68%</span><span>查看低匹配预览</span></span>
                  </div>
                </section>

                <p class="scope-note"><span class="info-mark">ⓘ</span><span>校验范围、默认阈值、等于阈值时的判定与计分算法均待确认；切换页面前会处理未保存修改。</span></p>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
