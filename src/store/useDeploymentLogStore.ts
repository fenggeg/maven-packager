import {create} from 'zustand'
import type {DeploymentLogEvent} from '../types/domain'
import {appendBoundedItems} from '../utils/boundedBuffer'

const MAX_LOG_LINES = 3000
const FLUSH_INTERVAL_MS = 300
const pendingLogBuffer: Record<string, string[]> = {}

interface DeploymentLogState {
  logsByTaskId: Record<string, string[]>
  flushTimerId: ReturnType<typeof setInterval> | null
  appendLog: (event: DeploymentLogEvent) => void
  flushLogs: () => void
  clearLogs: (taskId: string) => void
  startFlushTimer: () => void
  stopFlushTimer: () => void
}

export const useDeploymentLogStore = create<DeploymentLogState>((set, get) => ({
  logsByTaskId: {},
  flushTimerId: null,

  appendLog: (event) => {
    pendingLogBuffer[event.taskId] = [...(pendingLogBuffer[event.taskId] ?? []), event.line]
  },

  flushLogs: () => {
    const taskIds = Object.keys(pendingLogBuffer)
    if (taskIds.length === 0) return

    set((state) => {
      const nextLogs = {...state.logsByTaskId}
      for (const taskId of taskIds) {
        const buffered = pendingLogBuffer[taskId]
        if (!buffered || buffered.length === 0) continue
        const existing = nextLogs[taskId] ?? []
        nextLogs[taskId] = appendBoundedItems(existing, buffered, MAX_LOG_LINES)
        delete pendingLogBuffer[taskId]
      }
      return {
        logsByTaskId: nextLogs,
      }
    })
  },

  clearLogs: (taskId) => {
    set((state) => {
      const nextLogs = {...state.logsByTaskId}
      delete nextLogs[taskId]
      delete pendingLogBuffer[taskId]
      return {logsByTaskId: nextLogs}
    })
  },

  startFlushTimer: () => {
    const {flushTimerId} = get()
    if (flushTimerId) return
    const id = setInterval(() => {
      get().flushLogs()
    }, FLUSH_INTERVAL_MS)
    set({flushTimerId: id})
  },

  stopFlushTimer: () => {
    const {flushTimerId} = get()
    if (flushTimerId) {
      clearInterval(flushTimerId)
      get().flushLogs()
      set({flushTimerId: null})
    }
  },
}))
