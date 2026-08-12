<script setup lang="ts">
import PageDocument from '@/components/PageDocument.vue';
import pageStyles1 from '../workspace/styles.css?inline';
import pageStyles2 from './styles.css?inline';

const bodyClasses = ["qa-page"] as const;
const styleSheets = [pageStyles1, pageStyles2] as const;
</script>

<template>
  <PageDocument
    :body-classes="bodyClasses"
    :style-sheets="styleSheets"
  >
    <main class="qa-card" aria-label="设置模块 QA 状态">
          <span class="qa-status">✓ 通过</span>
          <div class="qa-details">
            <h1>1280×800 / 键盘焦点与横向溢出检查</h1>
            <p>焦点顺序：设置入口 → 子功能 → 工具栏/保存 → 段落最长字数 → Gate 开关 → 阈值 → 低匹配预览</p>
            <p>对话框：取消 → 放弃/返回 → 主操作；关闭后返回触发控件。</p>
            <p>宽度：52 + 220 + 1008 = 1280；表单内部 968 px，无横向溢出。快捷键步进与阈值精度待确认。</p>
          </div>
        </main>
  </PageDocument>
</template>
