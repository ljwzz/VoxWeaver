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
    <main class="overlay-export-stage" aria-label="拆分段落使旧结果失效确认静态弹层">
          <section class="overlay-frame">
            <div class="stale-dialog" role="dialog" aria-modal="true" aria-labelledby="stale-dialog-title">
              <h1 id="stale-dialog-title">拆分段落会使旧结果失效</h1>
              <p>原段落 para_12_018 将退出当前剧本版本；历史记录不会删除。</p>
              <section class="dialog-card"><strong>旧段落与下游结果</strong><span>音频 v3 · 高匹配 96%</span><span>ASR 回听结果 · 时间轴片段 00:41–00:49</span><span>确认后统一标记：已失效</span></section>
              <section class="dialog-card dialog-card--new"><strong>将创建两个新段落</strong><span>para_12_018a / para_12_018b</span><span>继承：说话人林黛玉、来源与基础批注</span><span>不继承：旧音频、ASR、时间轴</span></section>
              <footer class="dialog-actions"><span class="static-button" aria-disabled="true">取消</span><span class="static-button static-button--primary" aria-disabled="true">确认拆分并标记失效</span></footer>
            </div>
          </section>
        </main>
  </PageDocument>
</template>
