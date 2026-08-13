import ElementPlus from 'element-plus';
import { createApp } from 'vue';
import App from '@/App.vue';

import { router } from '@/router';
import 'element-plus/dist/index.css';
import '@/styles/index.css';

async function bootstrapRenderer(): Promise<void> {
  if (import.meta.env.DEV) {
    const [{ installPreviewRoutes }] = await Promise.all([
      import('@/preview/routes'),
      import('@/styles/demo-preview.css'),
    ]);
    installPreviewRoutes(router);
  }

  createApp(App)
    .use(router)
    .use(ElementPlus)
    .mount('#app');
}

void bootstrapRenderer();
