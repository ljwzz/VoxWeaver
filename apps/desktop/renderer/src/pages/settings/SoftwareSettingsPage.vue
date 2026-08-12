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
    <main class="settings-workspace" aria-label="软件设置静态页面">
          <header class="window-titlebar">
            <img class="window-controls" src="./assets/window-controls.svg" width="42" height="10" alt="" aria-hidden="true">
            <p class="window-title">VoxWeaver / Project Workspace</p>
            <p class="window-context"><span class="viewport-1440">1440 × 900</span><span class="viewport-1280">1280 × 800</span></p>
          </header>

          <div class="settings-shell">
            <aside class="settings-rail" aria-label="功能分组">
              <div class="settings-rail-list">
                <span class="settings-activity static-control" tabindex="-1">文</span>
                <span class="settings-activity static-control" tabindex="-1">角</span>
                <span class="settings-activity static-control" tabindex="-1">音</span>
                <span class="settings-activity static-control" tabindex="-1">后</span>
              </div>
              <span class="settings-activity settings-activity--selected static-control" aria-current="page">设</span>
            </aside>

            <aside class="settings-sidebar" aria-label="设置子功能">
              <div class="settings-sidebar-content">
                <div class="settings-sidebar-top">
                  <header class="settings-sidebar-header"><h1>设置</h1><p>项目与软件配置</p></header>
                  <span class="settings-nav-item static-control"><span class="settings-nav-state">•</span><span class="settings-nav-label">项目备份</span></span>
                  <span class="settings-nav-item static-control"><span class="settings-nav-state">•</span><span class="settings-nav-label">项目设置</span></span>
                  <span class="settings-nav-item settings-nav-item--selected static-control" aria-current="page"><span class="settings-nav-state">✓</span><span class="settings-nav-label">软件设置</span></span>
                </div>
                <div class="settings-sidebar-summary"><strong>Project VoxWeaver</strong><span>设置按作用范围分层</span></div>
              </div>
              <div class="settings-resize-handle" aria-label="侧栏宽度调整入口，仅展示"></div>
            </aside>

            <section class="settings-editor" aria-label="软件设置编辑区">
              <header class="settings-toolbar"><strong>软件设置</strong><span>·</span><span>软件级默认值与连接</span></header>
              <div class="settings-content">
                <section class="settings-card software-save-card" aria-label="软件设置作用范围与保存状态">
                  <div class="software-scope-copy"><strong>软件级默认值与项目级配置是不同作用范围</strong><span>软件级默认值影响应用级候选默认；当前项目配置只作用于当前项目。覆盖解析顺序待确认。</span></div><span class="software-save-spacer" aria-hidden="true"></span>
                  <span class="primary-action static-control">保存软件设置<span class="shortcut">⌘↵</span></span>
                </section>

                <section class="settings-card candidate-group" aria-labelledby="appearance-heading">
                  <header class="candidate-header"><div class="candidate-title"><h2 id="appearance-heading">外观</h2><p>候选分组，仅保留作用范围与字段说明。</p></div><span class="candidate-header-spacer" aria-hidden="true"></span><span class="chip chip--warning-strong">范围待确认</span></header>
                  <div class="candidate-form-row">
                    <div class="candidate-field-info"><strong>外观候选项</strong><span>具体候选项尚未定义；不将主题等能力视为已确认功能。</span></div>
                    <div class="candidate-value-wrap"><div class="candidate-readonly"><span>尚未定义</span><span>范围待确认</span></div></div>
                  </div>
                </section>

                <section class="settings-card candidate-group" aria-labelledby="storage-heading">
                  <header class="candidate-header"><div class="candidate-title"><h2 id="storage-heading">存储与缓存</h2><p>缓存类型、容量、清理范围与删除后果尚未确认。</p></div><span class="candidate-header-spacer" aria-hidden="true"></span><span class="chip chip--warning-strong">范围待确认</span></header>
                  <div class="candidate-form-row">
                    <div class="candidate-field-info"><strong>存储与缓存候选项</strong><span>只表达候选范围，不提供会改变数据的已确认控件。</span></div>
                    <div class="candidate-value-wrap"><div class="candidate-readonly"><span>尚未定义</span><span>范围待确认</span></div></div>
                  </div>
                </section>

                <section class="settings-card candidate-group candidate-group--connections" aria-labelledby="connections-heading">
                  <header class="candidate-header"><div class="candidate-title"><h2 id="connections-heading">服务连接</h2><p>仅展示连接摘要与测试/编辑入口；本页不显示真实密钥。</p></div><span class="candidate-header-spacer" aria-hidden="true"></span><span class="chip chip--warning-strong">范围待确认</span></header>
                  <article class="connection-row">
                    <div class="connection-identity"><strong>语音合成服务</strong><span>凭据由安全存储引用 · 本页不显示密钥</span></div>
                    <div class="connection-type"><span>类型</span><span>TTS Provider</span></div>
                    <span class="connection-status connection-status--connected"><img src="./assets/status-dot-connected.svg" width="7" height="7" alt="">已连接</span>
                    <span></span><div class="connection-actions"><span>测试连接</span><span>编辑</span></div>
                  </article>
                  <article class="connection-row">
                    <div class="connection-identity"><strong>语音识别服务</strong><span>最近测试失败 · 可查看错误详情，不显示密钥</span></div>
                    <div class="connection-type"><span>类型</span><span>ASR Provider</span></div>
                    <span class="connection-status connection-status--failed"><img src="./assets/status-dot-failed.svg" width="7" height="7" alt="">连接失败</span>
                    <span></span><div class="connection-actions"><span>重新测试</span><span>编辑</span></div>
                  </article>
                </section>

                <section class="settings-card candidate-group candidate-group--provider" aria-labelledby="provider-heading">
                  <header class="candidate-header"><div class="candidate-title"><h2 id="provider-heading">默认 Provider</h2><p>默认作用对象、能力探测与项目覆盖规则仍需确认。</p></div><span class="candidate-header-spacer" aria-hidden="true"></span><span class="chip chip--warning-strong">范围待确认</span></header>
                  <div class="provider-candidate">
                    <div class="capability-card"><span class="capability-icon">◔</span><div class="capability-copy"><strong>TTS 能力上下文</strong><span>候选默认 Provider · 作用对象待确认</span><span>能力上限由探测提供 · 不写死为产品默认</span></div><span class="chip chip--warning-strong">探测中</span></div>
                    <div class="provider-scope-note"><strong>作用范围</strong><p>软件级候选默认不等同于当前项目设置；解析顺序与降级规则待确认。</p><span class="chip chip--warning-strong">范围待确认</span></div>
                  </div>
                </section>
              </div>
            </section>
          </div>
        </main>
  </PageDocument>
</template>
