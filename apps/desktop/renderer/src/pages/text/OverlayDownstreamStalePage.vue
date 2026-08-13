<script setup lang="ts">
import { useRouter } from 'vue-router';
import PageDocument from '@/components/PageDocument.vue';
import { getDemoPageRouteName } from '@/demo/navigation';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ['overlay-page'] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
const router = useRouter();

function returnToScriptManagement(): void {
  void router.push({ name: getDemoPageRouteName('script-management') });
}

function confirmDemoSplit(): void {
  showDemoFeedback('已确认拆分演示；未生成 ID，未修改音频或时间轴', 'success');
  returnToScriptManagement();
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="overlay-canvas" aria-label="拆分段落并标记下游结果失效确认弹层">
      <section class="invalidation-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title">
        <div class="row-between" style="width: 512px"><h1 id="dialog-title" class="dialog-title">拆分段落并标记下游结果失效？</h1><span class="impact-badge impact-badge--invalidated"><span>×</span><span>已失效 3</span></span></div>
        <p class="body-copy" style="width: 512px; color: var(--vw-text-secondary)">para_01_018 将拆为两个预览段落。旧段落已被音频与时间轴引用，本演示不会写入任何失效状态。</p>
        <div class="dialog-warning"><span class="strong" style="color: var(--vw-state-warning)">!</span><span>确认只显示演示反馈并返回；不生成 ID，不修改音频或时间轴。</span></div>
        <div class="dialog-impact-list">
          <div class="dialog-impact-row"><span class="dialog-impact-symbol">◉</span><div class="dialog-impact-copy"><strong class="body-copy">音频片段 · clip_para_01_018</strong><span class="caption">仅展示 1 项潜在影响；不会改变记录。</span></div></div>
          <div class="dialog-impact-row"><span class="dialog-impact-symbol">⌁</span><div class="dialog-impact-copy"><strong class="body-copy">时间轴区间 · timeline_para_01_018</strong><span class="caption">仅展示 1 项潜在影响；不会改变记录。</span></div></div>
        </div>
        <p class="dialog-new-ids">预览段落：A、B · 不生成稳定 ID。</p>
        <div class="dialog-actions">
          <ElButton class="text-button" data-testid="cancel-downstream-stale" @click="returnToScriptManagement">取消</ElButton>
          <ElButton class="text-button text-button--primary" data-testid="confirm-downstream-stale" @click="confirmDemoSplit">确认拆分</ElButton>
        </div>
      </section>
    </main>
  </PageDocument>
</template>
