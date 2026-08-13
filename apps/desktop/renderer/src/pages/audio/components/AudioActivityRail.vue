<script setup lang="ts">
import type { DemoModuleKey } from '@/demo/navigation';

import DemoModuleButton from '@/components/demo/DemoModuleButton.vue';

interface ActivityItem {
  key: DemoModuleKey;
  glyph: string;
}

const primaryItems: readonly ActivityItem[] = [
  { key: 'text', glyph: '文' },
  { key: 'role', glyph: '角' },
  { key: 'audio', glyph: '音' },
  { key: 'post', glyph: '后' },
];
</script>

<template>
  <aside class="activity-rail" aria-label="项目功能模块">
    <div class="activity-list">
      <DemoModuleButton
        v-for="item in primaryItems"
        :key="item.key"
        class="activity-item"
        :class="`activity-item--${item.key}`"
        :data-module-key="item.key"
        :module-key="item.key"
      >
        <span class="activity-glyph">{{ item.glyph }}</span>
        <span class="selection-bar" aria-hidden="true"></span>
      </DemoModuleButton>
    </div>

    <DemoModuleButton
      class="activity-item activity-item--settings"
      data-module-key="settings"
      module-key="settings"
    >
      <span class="activity-glyph">设</span>
      <span class="selection-bar" aria-hidden="true"></span>
    </DemoModuleButton>
  </aside>
</template>
