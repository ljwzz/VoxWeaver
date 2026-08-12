<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["audio-overlay-view"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="overlay-export-stage" aria-label="取消整章生成静态弹层">
          <section class="overlay-frame">
            <div class="cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-dialog-title">
              <h1 id="cancel-dialog-title">取消整章生成？</h1>
              <p>已完成的 17 条结果仍保留；排队和生成中的任务将停止。</p>
              <footer class="dialog-actions"><span class="static-button" aria-disabled="true">继续生成</span><span class="static-button static-button--primary" aria-disabled="true">确认取消</span></footer>
            </div>
          </section>
        </main>
  </PageDocument>
</template>
