<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();

function returnToStartup(): void {
  void router.replace('/startup');
}
</script>

<template>
  <main class="production-not-found-page">
    <ElResult
      icon="warning"
      title="页面不存在"
      sub-title="当前地址不是有效的 VoxWeaver 正式页面。"
    >
      <template #extra>
        <ElButton type="primary" @click="returnToStartup">
          返回启动页
        </ElButton>
      </template>
    </ElResult>
  </main>
</template>

<style scoped>
.production-not-found-page {
  display: grid;
  width: 100%;
  height: 100%;
  place-items: center;
  background: #fbfcfa;
}
</style>
