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

function returnToSource(): void {
  void router.push({ name: getDemoPageRouteName('audio-stale-propagation') });
}

function confirmPreview(): void {
  showDemoFeedback('已确认失效传播预览；未创建段落或任务', 'success');
  returnToSource();
}
</script>

<template>
  <PageDocument :body-classes="bodyClasses" :style-sheets="styleSheets">
    <main class="overlay-export-stage" aria-label="拆分段落使旧结果失效确认弹层">
      <section class="overlay-frame">
        <div class="stale-dialog" role="dialog" aria-modal="true" aria-labelledby="stale-dialog-title">
          <h1 id="stale-dialog-title">拆分段落会使旧结果失效</h1>
          <p>原段落 para_12_018 将退出当前剧本版本；历史记录不会删除。</p>
          <section class="dialog-card">
            <strong>旧段落与下游结果</strong>
            <span>音频 v3 · 高匹配 96%</span>
            <span>ASR 回听结果 · 时间轴片段 00:41–00:49</span>
            <span>确认后统一标记：已失效</span>
          </section>
          <section class="dialog-card dialog-card--new">
            <strong>两个新段落的预览状态</strong>
            <span>para_12_018a / para_12_018b</span>
            <span>继承：说话人苏婉、来源与基础批注</span>
            <span>当前状态保持：需要重新生成</span>
          </section>
          <ElAlert
            :closable="false"
            title="确认仅返回来源页；不删除历史结果，不创建真实新段落或任务。"
            type="warning"
          />
          <footer class="dialog-actions">
            <ElButton @click="returnToSource">取消</ElButton>
            <ElButton type="primary" @click="confirmPreview">确认并返回</ElButton>
          </footer>
        </div>
      </section>
    </main>
  </PageDocument>
</template>
