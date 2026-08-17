import type {
  StageStateDto,
  TaskSummaryDto,
  WorkspaceBootstrapDto,
  WorkspacePageKey,
} from '@voxweaver/contracts';

import { isWorkspacePageKey } from '@voxweaver/contracts';
import { getFirstWorkspacePageForStage } from '@/workspace/navigation';

function isActiveOrRecoverableTask(task: TaskSummaryDto): boolean {
  return task.status === 'pending'
    || task.status === 'running'
    || task.recoveryStatus !== 'none';
}

function pageForTask(task: TaskSummaryDto): WorkspacePageKey {
  return task.status === 'succeeded' ? 'chapter-splitting' : 'text-extraction';
}

function pageForPendingStage(stage: StageStateDto): WorkspacePageKey | undefined {
  if (stage.stageId === '01') {
    if (stage.status === 'review-required' || stage.status === 'stale')
      return 'chapter-splitting';
    return 'text-extraction';
  }

  return getFirstWorkspacePageForStage(stage.stageId)?.key;
}

export function resolveWorkspaceEntry(bootstrap: WorkspaceBootstrapDto): WorkspacePageKey {
  if (isWorkspacePageKey(bootstrap.lastPage))
    return bootstrap.lastPage;

  if (bootstrap.currentTask && isActiveOrRecoverableTask(bootstrap.currentTask))
    return pageForTask(bootstrap.currentTask);

  const recoverableTask = bootstrap.recoverableTasks.find(isActiveOrRecoverableTask);
  if (recoverableTask)
    return pageForTask(recoverableTask);

  for (const stage of bootstrap.stages) {
    if (stage.status === 'completed')
      continue;

    const pageKey = pageForPendingStage(stage);
    if (pageKey)
      return pageKey;
  }

  if (isWorkspacePageKey(bootstrap.recommendedPage))
    return bootstrap.recommendedPage;

  return 'text-extraction';
}
