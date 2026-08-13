<script setup lang="ts">
const props = defineProps<{
  label: string;
  subtitle: string;
  title: string;
}>();

const collapsed = defineModel<boolean>('collapsed', { default: false });
</script>

<template>
  <div class="audio-inspector-divider" aria-hidden="true"></div>
  <aside
    v-if="!collapsed"
    class="audio-inspector"
    :aria-label="props.label"
  >
    <header class="inspector-header">
      <div class="inspector-title-row">
        <h2>{{ props.title }}</h2>
        <ElTooltip content="收起右侧检查器" placement="left">
          <ElButton
            class="inspector-toggle"
            :aria-label="`折叠${props.title}`"
            link
            type="primary"
            @click="collapsed = true"
          >
            ‹ 折叠
          </ElButton>
        </ElTooltip>
      </div>
      <p>{{ props.subtitle }}</p>
    </header>
    <slot />
  </aside>

  <aside v-else class="audio-inspector-collapsed" :aria-label="`${props.title}已折叠`">
    <ElTooltip content="展开右侧检查器" placement="left">
      <ElButton
        class="inspector-expand"
        :aria-label="`展开${props.title}`"
        circle
        plain
        type="primary"
        @click="collapsed = false"
      >
        ›
      </ElButton>
    </ElTooltip>
    <span>{{ props.title }}</span>
  </aside>
</template>
