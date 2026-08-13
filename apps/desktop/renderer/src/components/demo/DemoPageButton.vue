<script setup lang="ts">
import type { DemoSidebarPageSlug } from '@/demo/navigation';

import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { getDemoPageRouteName } from '@/demo/navigation';

const props = defineProps<{
  pageSlug: DemoSidebarPageSlug;
}>();

const route = useRoute();
const router = useRouter();
const isCurrentPage = computed(() => route.meta.pageSlug === props.pageSlug);

function navigateToPage(): void {
  void router.push({
    name: getDemoPageRouteName(props.pageSlug),
  });
}
</script>

<template>
  <button
    class="demo-page-button"
    type="button"
    :aria-current="isCurrentPage ? 'page' : undefined"
    @click="navigateToPage"
  >
    <slot>{{ pageSlug }}</slot>
  </button>
</template>
