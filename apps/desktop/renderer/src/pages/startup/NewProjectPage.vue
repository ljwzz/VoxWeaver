<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from './styles.css?inline';

const bodyClasses = ["startup-screen", "startup-screen--new-project"] as const;
const styleSheets = [pageStyles1] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="startup-stage">
          <section class="desktop-window" aria-label="VoxWeaver 新建项目窗口">
            <header class="window-titlebar">
              <img
                class="window-controls"
                src="./assets/window-controls-new-project.svg"
                width="52"
                height="12"
                alt=""
                aria-hidden="true"
              >
              <p class="window-title">新建项目</p>
              <span class="titlebar-balance" aria-hidden="true"></span>
            </header>

            <div class="new-project-body">
              <div class="new-project-content">
                <header class="new-project-header">
                  <div class="header-copy">
                    <h1>新建项目</h1>
                    <p>选择项目存放文件夹与源文件；两项均为必填</p>
                  </div>
                  <div class="step-status" aria-label="当前步骤：步骤 1 / 1，选择输入">
                    <img src="./assets/current-step.svg" width="8" height="8" alt="" aria-hidden="true">
                    <span>步骤 1 / 1 · 选择输入</span>
                  </div>
                </header>

                <section class="project-inputs" aria-label="项目输入展示状态">
                  <article class="input-card">
                    <span class="input-step input-step--current">1</span>
                    <div class="input-field">
                      <h2>项目存放文件夹</h2>
                      <p class="input-description">将在所选位置创建独立的 VoxWeaver 项目目录</p>
                      <div class="selector-row">
                        <div class="selector-placeholder">请选择项目存放文件夹</div>
                        <span class="secondary-button" aria-disabled="true">选择文件夹</span>
                      </div>
                    </div>
                  </article>

                  <article class="input-card">
                    <span class="input-step">2</span>
                    <div class="input-field">
                      <h2>源文件</h2>
                      <p class="input-description">创建时按原始字节复制；格式识别在进入项目后进行</p>
                      <div class="selector-row">
                        <div class="selector-placeholder">请选择源文件</div>
                        <span class="secondary-button" aria-disabled="true">选择文件</span>
                      </div>
                    </div>
                  </article>
                </section>

                <aside class="creation-boundary">
                  <span class="boundary-icon" aria-hidden="true">i</span>
                  <div>
                    <h2>创建项目时</h2>
                    <p>只复制并登记源文件，不在此步骤执行格式识别、文本提取、章节分析或 Provider 请求。全部创建步骤成功后进入项目；失败时保留仍有效的输入并允许重试。</p>
                  </div>
                </aside>
              </div>
            </div>

            <footer class="new-project-footer">
              <p>2 项必填 · 尚未选择</p>
              <div class="footer-actions" aria-label="新建项目操作展示状态">
                <span class="footer-button" aria-disabled="true">取消</span>
                <span class="footer-button footer-button--disabled" aria-disabled="true">下一步</span>
              </div>
            </footer>
          </section>
        </main>
  </PageDocument>
</template>
