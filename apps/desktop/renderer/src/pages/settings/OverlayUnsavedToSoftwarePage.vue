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
    <main class="dialog unsaved-dialog" role="dialog" aria-modal="true" aria-labelledby="unsaved-software-title">
          <header class="dialog-header"><span class="dialog-icon dialog-icon--warning">!</span><div class="dialog-titles"><h1 id="unsaved-software-title">有未保存的项目设置</h1><p>离开后前往：软件设置</p></div></header>
          <section class="unsaved-body"><strong>以下修改尚未保存：</strong><p>• 段落最长字数：2000 → 2400 字</p><p>• ASR 相似度阈值：86% → 72%</p></section>
          <p class="dialog-caption">保存前会先执行字段校验。</p>
          <footer class="dialog-footer"><span class="secondary-action static-control">取消</span><span class="danger-action static-control">放弃修改</span><span class="primary-action static-control">保存并离开</span></footer>
        </main>
  </PageDocument>
</template>
