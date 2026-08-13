<script setup lang="ts">
import type { DemoModuleKey } from '@/demo/navigation';

import { computed } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import {
  getDemoModule,
  getDemoPageRouteName,
  resolveDemoModuleBySlug,
} from '@/demo/navigation';

const props = defineProps<{
  moduleKey: DemoModuleKey;
}>();

const route = useRoute();
const router = useRouter();
const targetModule = computed(() => getDemoModule(props.moduleKey));
const isCurrentModule = computed(() => (
  resolveDemoModuleBySlug(route.meta.pageSlug)?.key === props.moduleKey
));

function navigateToModule(): void {
  void router.push({
    name: getDemoPageRouteName(targetModule.value.landingSlug),
  });
}
</script>

<template>
  <button
    class="demo-module-button"
    type="button"
    :aria-current="isCurrentModule ? 'true' : undefined"
    :aria-label="targetModule.name"
    :title="targetModule.name"
    @click="navigateToModule"
  >
    <slot>{{ targetModule.activityLabel }}</slot>
  </button>
</template>
