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
    <main class="dialog restore-dialog" role="dialog" aria-modal="true" aria-labelledby="restore-title">
          <header class="dialog-header"><span class="dialog-icon dialog-icon--warning">↺</span><div class="dialog-titles"><h1 id="restore-title">确认恢复项目备份</h1><p>恢复不会创建新的成品导出。</p></div></header>
          <section class="restore-details" aria-label="恢复目标详情">
            <div class="restore-data-row"><span>目标备份</span><span></span><strong>v0.9.12 · 2026-08-11 10:42</strong></div>
            <div class="restore-data-row"><span>当前项目</span><span></span><strong>存在未备份修改 · 3 项进行中任务</strong></div>
            <div class="restore-data-row"><span>项目位置</span><span></span><strong>/Projects/VoxWeaver/Demo（示例）</strong></div>
          </section>
          <section class="restore-risk"><strong>!</strong><p>覆盖风险：恢复将替换当前项目的版本、音频与审核状态；未备份修改可能丢失。</p></section>
          <p class="dialog-caption">请确认目标备份与当前项目状态后继续。</p>
          <footer class="dialog-footer"><span class="secondary-action static-control">取消</span><span class="primary-action static-control">确认恢复</span></footer>
        </main>
  </PageDocument>
</template>
