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
    <main class="dialog validation-dialog" role="alertdialog" aria-modal="true" aria-labelledby="validation-title">
          <header class="dialog-header"><span class="dialog-icon dialog-icon--error">!</span><div class="dialog-titles"><h1 id="validation-title">字段校验失败</h1><p>修改仍保留，请修正后再次保存。</p></div></header>
          <section class="field-error"><strong>段落最长字数</strong><div class="invalid-value">5200 字</div><p>超出当前能力探测示例上限 4000 字；该上限不是产品默认。</p></section>
          <p class="dialog-caption">返回字段后保留焦点与未保存状态。</p>
          <footer class="dialog-footer"><span class="secondary-action static-control">取消</span><span class="primary-action static-control">返回修改</span></footer>
        </main>
  </PageDocument>
</template>
