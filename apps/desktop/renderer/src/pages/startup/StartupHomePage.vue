<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from './styles.css?inline';

const bodyClasses = ["startup-screen", "startup-screen--home"] as const;
const styleSheets = [pageStyles1] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="startup-stage">
          <section class="desktop-window" aria-label="VoxWeaver 项目启动窗口">
            <header class="window-titlebar">
              <img
                class="window-controls"
                src="./assets/window-controls.svg"
                width="52"
                height="12"
                alt=""
                aria-hidden="true"
              >
              <p class="window-title">VoxWeaver</p>
              <span class="titlebar-balance" aria-hidden="true"></span>
            </header>

            <div class="launch-body">
              <div class="launch-content">
                <section class="launch-hero" aria-labelledby="product-name">
                  <div class="product-logo" aria-hidden="true">
                    <img src="./assets/logo-waveform.svg" width="32" height="32" alt="">
                  </div>
                  <h1 id="product-name">VoxWeaver</h1>
                  <p>把长篇小说整理为可编辑、可审核的多角色有声内容</p>
                </section>

                <section class="launch-actions" aria-label="项目启动入口">
                  <article class="action-card action-card--selected" aria-label="新建项目，展示状态：已选中">
                    <img class="action-icon action-icon--folder" src="./assets/folder-plus.svg" width="48" height="38" alt="">
                    <h2>新建项目</h2>
                    <p>选择项目位置与源文件</p>
                    <span class="action-hint action-hint--accent">开始创建&nbsp; →</span>
                  </article>

                  <article class="action-card" aria-label="打开已有项目，展示状态：默认">
                    <img class="action-icon action-icon--folder" src="./assets/open-project.svg" width="48" height="37" alt="">
                    <h2>打开已有项目</h2>
                    <p>从本地工作区继续</p>
                    <span class="action-hint">选择目录</span>
                  </article>

                  <article class="action-card" aria-label="软件设置，展示状态：默认">
                    <img class="action-icon" src="./assets/settings.svg" width="48" height="48" alt="">
                    <h2>软件设置</h2>
                    <p>服务连接与软件偏好</p>
                    <span class="action-hint">启动前配置</span>
                  </article>
                </section>

                <aside class="launch-note">
                  <span class="info-icon" aria-hidden="true">i</span>
                  <p>所有项目与源文件处理均在本地完成；项目数据保存在你选择的目录</p>
                </aside>
              </div>
            </div>
          </section>
        </main>
  </PageDocument>
</template>
