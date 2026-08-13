<script setup lang="ts">
import { useRouter } from 'vue-router';
import PageDocument from '@/components/PageDocument.vue';
import { getDemoPageRouteName } from '@/demo/navigation';
import { showDemoFeedback } from '@/demo/useDemoFeedback';
import workspaceStyles from '../workspace/styles.css?inline';
import audioStyles from './styles.css?inline';

const router = useRouter();
const bodyClasses = ['audio-overlay-view'] as const;
const styleSheets = [workspaceStyles, audioStyles] as const;

function continueGeneration(): void {
  void router.push({ name: getDemoPageRouteName('audio-chapter-generation') });
}

function confirmCancellation(): void {
  showDemoFeedback('已停止排队与生成中视觉状态；17 条完成结果保留', 'warning');
  void router.push({
    name: getDemoPageRouteName('audio-chapter-generation'),
    query: { preview: 'cancelled' },
  });
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="overlay-export-stage" aria-label="取消整章生成弹层">
      <section class="overlay-frame">
        <div class="cancel-dialog" role="dialog" aria-modal="true" aria-labelledby="cancel-dialog-title">
          <h1 id="cancel-dialog-title">取消整章生成？</h1>
          <p>已完成的 17 条结果仍保留；排队和生成中的视觉状态将停止。</p>
          <footer class="dialog-actions">
            <ElButton @click="continueGeneration">继续生成</ElButton>
            <ElButton type="primary" @click="confirmCancellation">确认取消</ElButton>
          </footer>
        </div>
      </section>
    </main>
  </PageDocument>
</template>
