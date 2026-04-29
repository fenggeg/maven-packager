import {create} from 'zustand'
import {shouldFlushUploadProgress, type UploadProgressSample} from '../services/deploymentRuntime'

const lastProgressSamples: Record<string, UploadProgressSample> = {}

export interface UploadProgress {
  taskId: string
  stageKey: string
  percent: number
  uploadedBytes: number
  totalBytes: number
  speedBytesPerSecond?: number
  message: string
}

interface UploadProgressState {
  progressByTaskId: Record<string, UploadProgress>
  updateProgress: (taskId: string, progress: UploadProgress) => void
  clearProgress: (taskId: string) => void
}

export const useUploadProgressStore = create<UploadProgressState>((set) => ({
  progressByTaskId: {},

  updateProgress: (taskId, progress) => {
    const nextSample = {percent: progress.percent, elapsedMs: performance.now()}
    if (!shouldFlushUploadProgress(lastProgressSamples[taskId], nextSample)) {
      return
    }
    lastProgressSamples[taskId] = nextSample
    set((state) => ({
      progressByTaskId: {
        ...state.progressByTaskId,
        [taskId]: progress,
      },
    }))
  },

  clearProgress: (taskId) => {
    delete lastProgressSamples[taskId]
    set((state) => {
      const next = {...state.progressByTaskId}
      delete next[taskId]
      return {progressByTaskId: next}
    })
  },
}))
