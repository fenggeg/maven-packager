import type {DeploymentStage} from '../types/domain'

export interface PipelineSummary {
  done: number
  total: number
  percent: number
  activeIndex: number
  failedStage?: DeploymentStage
}

const ACTIVE_STATUSES = new Set<DeploymentStage['status']>(['running', 'checking', 'waiting'])
const DONE_STATUSES = new Set<DeploymentStage['status']>(['success', 'skipped'])
const FAILED_STATUSES = new Set<DeploymentStage['status']>(['failed', 'timeout', 'cancelled'])

export function summarizeDeploymentPipeline(stages: readonly DeploymentStage[]): PipelineSummary {
  const total = stages.length
  if (total === 0) {
    return {done: 0, total: 0, percent: 0, activeIndex: 0}
  }

  const done = stages.filter((stage) => DONE_STATUSES.has(stage.status)).length
  const runningIndex = stages.findIndex((stage) => ACTIVE_STATUSES.has(stage.status))
  const pendingIndex = stages.findIndex((stage) => stage.status === 'pending')
  const failedStage = stages.find((stage) => FAILED_STATUSES.has(stage.status))
  const activeIndex = runningIndex >= 0
    ? runningIndex
    : failedStage
      ? stages.indexOf(failedStage)
      : pendingIndex >= 0
        ? pendingIndex
        : Math.max(total - 1, 0)

  return {
    done,
    total,
    percent: Math.round((done / total) * 100),
    activeIndex,
    failedStage,
  }
}

export interface UploadProgressSample {
  percent: number
  elapsedMs: number
}

export interface UploadProgressPolicy {
  minPercentDelta: number
  maxIntervalMs: number
  milestones: readonly number[]
}

export const DEFAULT_UPLOAD_PROGRESS_POLICY: UploadProgressPolicy = {
  minPercentDelta: 2,
  maxIntervalMs: 500,
  milestones: [25, 50, 75, 100],
}

export function shouldFlushUploadProgress(
  previous: UploadProgressSample | undefined,
  next: UploadProgressSample,
  policy: UploadProgressPolicy = DEFAULT_UPLOAD_PROGRESS_POLICY,
): boolean {
  if (!previous) {
    return true
  }
  if (next.percent >= 100) {
    return true
  }
  if (next.percent - previous.percent >= policy.minPercentDelta) {
    return true
  }
  if (next.elapsedMs - previous.elapsedMs >= policy.maxIntervalMs) {
    return true
  }
  return policy.milestones.some((milestone) =>
    previous.percent < milestone && next.percent >= milestone,
  )
}
