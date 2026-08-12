<script setup lang="ts">
import { onBeforeUnmount } from 'vue';
import { mountPageDocument } from '@/pageDocumentState';

interface Props {
  bodyClasses: readonly string[];
  styleSheets: readonly string[];
}

const props = defineProps<Props>();
const unmountPageDocument = mountPageDocument(props.bodyClasses, props.styleSheets);

onBeforeUnmount(unmountPageDocument);
</script>

<template>
  <slot />
</template>
