<template>
  <main class="not-found-page">
    <ElResult icon="warning" title="页面不存在" sub-title="请从页面目录选择有效页面">
      <template #extra>
        <RouterLink class="page-catalog-link" to="/pages">
          返回页面目录
        </RouterLink>
      </template>
    </ElResult>
  </main>
</template>
