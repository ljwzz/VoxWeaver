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
    <main class="overlay-canvas" aria-label="拆分段落并标记下游结果失效确认弹层">
          <section class="invalidation-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
            <div class="row-between" style="width: 512px"><h1 class="dialog-title" id="dialog-title">拆分段落并标记下游结果失效？</h1><span class="impact-badge impact-badge--invalidated"><span>×</span><span>已失效 3</span></span></div>
            <p class="body-copy" style="width: 512px; color: var(--vw-text-secondary)">para_01_018 将拆为两个新段落。旧段落已被音频与时间轴引用，确认后这些结果只会标记为“已失效”，不会被删除。</p>
            <div class="dialog-warning"><span class="strong" style="color: var(--vw-state-warning)">!</span><span>此操作不删除历史记录；后续重新生成后才会产生新的音频或时间轴结果。</span></div>
            <div class="dialog-impact-list">
              <div class="dialog-impact-row"><span class="dialog-impact-symbol">◉</span><div class="dialog-impact-copy"><strong class="body-copy">音频片段 · clip_para_01_018</strong><span class="caption">1 项将标记为已失效；新段落不继承原音频。</span></div></div>
              <div class="dialog-impact-row"><span class="dialog-impact-symbol">⌁</span><div class="dialog-impact-copy"><strong class="body-copy">时间轴区间 · timeline_para_01_018</strong><span class="caption">1 项将标记为已失效；新段落不继承原时间轴。</span></div></div>
            </div>
            <p class="dialog-new-ids">新段落：para_01_018a、para_01_018b · 继承说话人“林舟”与来源章节信息。</p>
            <div class="dialog-actions"><span class="text-button" aria-disabled="true">取消</span><span class="text-button text-button--primary" aria-disabled="true">确认拆分</span></div>
          </section>
        </main>
  </PageDocument>
</template>
