<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["overlay-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="dialog success-dialog" role="dialog" aria-modal="true" aria-labelledby="success-title">
          <header class="dialog-header"><span class="dialog-icon dialog-icon--success">✓</span><div class="dialog-titles"><h1 id="success-title">软件设置已保存</h1><p>保存状态：成功</p></div></header>
          <p class="success-message">软件级候选默认已保存；“范围待确认”项不会因此成为已确定功能。</p>
          <footer class="dialog-footer"><span class="primary-action static-control">完成</span></footer>
        </main>
  </PageDocument>
</template>
