import { ElMessage } from 'element-plus';

export type DemoFeedbackType = 'error' | 'info' | 'success' | 'warning';

export function showDemoFeedback(message: string, type: DemoFeedbackType = 'info'): void {
  const detail = message.trim() || '操作已触发';

  ElMessage({
    duration: 1_800,
    grouping: true,
    message: `演示状态：${detail}（仅作预览，不会持久化）`,
    type,
  });
}
