import {create} from 'zustand'
import {api} from '../services/tauri-api'
import {useAppStore} from './useAppStore'
import {useDeploymentLogStore} from './useDeploymentLogStore'
import type {
    DeploymentProfile,
    DeploymentStage,
    DeploymentTask,
    DeployStepType,
    ModuleDependencyGraph,
    ProbeStatusEvent,
    SaveServerProfilePayload,
    ServerProfile,
} from '../types/domain'

interface WorkflowState {
  dependencyGraph?: ModuleDependencyGraph
  dependencyLoading: boolean
  serverProfiles: ServerProfile[]
  deploymentProfiles: DeploymentProfile[]
  deploymentTasks: DeploymentTask[]
  currentDeploymentTask?: DeploymentTask
  loading: boolean
  error?: string
  initialize: () => Promise<void>
  loadDependencyGraph: (rootPath: string) => Promise<void>
  clearDependencyGraph: () => void
  saveServerProfile: (payload: SaveServerProfilePayload) => Promise<void>
  deleteServerProfile: (serverId: string) => Promise<void>
  testServerConnection: (serverId: string) => Promise<string>
  saveDeploymentProfile: (profile: DeploymentProfile) => Promise<void>
  deleteDeploymentProfile: (profileId: string) => Promise<void>
  refreshDeploymentData: () => Promise<void>
  startDeployment: (profileId: string, serverId: string, artifactPath: string, buildTaskId?: string) => Promise<void>
  cancelDeployment: (taskId: string) => Promise<void>
  updateDeploymentTask: (task: DeploymentTask) => void
  finishDeploymentTask: (task: DeploymentTask) => void
  deleteDeploymentTask: (taskId: string) => Promise<void>
  rerunDeployment: (task: DeploymentTask) => Promise<void>
  updateProbeStatuses: (event: ProbeStatusEvent) => void
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const sortProfiles = <T extends {updatedAt?: string; name?: string}>(items: T[]) =>
  [...items].sort((left, right) =>
    (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
      || (left.name ?? '').localeCompare(right.name ?? '', 'zh-CN'))

const sortDeploymentTasks = (tasks: DeploymentTask[]) =>
  [...tasks].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

const createPendingDeploymentStages = (profile?: DeploymentProfile): DeploymentStage[] => {
  const steps = profile?.deploymentSteps?.length
    ? [...profile.deploymentSteps].sort((left, right) => left.order - right.order)
    : []

  if (steps.length > 0) {
    return steps.map((step) => ({
      key: step.id,
      label: step.name,
      type: step.type as DeployStepType,
      status: step.enabled ? 'pending' : 'skipped',
      message: step.enabled ? undefined : '步骤已禁用，跳过。',
      retryCount: step.retryCount ?? 0,
      currentRetry: 0,
      logs: [],
    }))
  }

  return [
    {key: 'upload', label: '上传产物', type: 'upload_file', status: 'pending', logs: []},
    {key: 'replace', label: '替换文件', type: 'ssh_command', status: 'pending', logs: []},
    {key: 'start', label: '启动服务', type: 'ssh_command', status: 'pending', logs: []},
    {key: 'health', label: '健康检查', type: 'http_check', status: 'pending', logs: []},
  ]
}

const isDeploymentTaskRunning = (task?: DeploymentTask) =>
  Boolean(task && !['success', 'failed', 'timeout', 'cancelled'].includes(task.status))

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  dependencyLoading: false,
  serverProfiles: [],
  deploymentProfiles: [],
  deploymentTasks: [],
  loading: false,

  initialize: async () => {
    set({loading: true, error: undefined})
    try {
      const [serverProfiles, deploymentProfiles, deploymentTasks] = await Promise.all([
        api.listServerProfiles(),
        api.listDeploymentProfiles(),
        api.listDeploymentTasks(),
      ])
      set({
        serverProfiles: sortProfiles(serverProfiles),
        deploymentProfiles: sortProfiles(deploymentProfiles),
        deploymentTasks: sortDeploymentTasks(deploymentTasks),
      })
    } catch (error) {
      set({error: getErrorMessage(error)})
    } finally {
      set({loading: false})
    }
  },

  loadDependencyGraph: async (rootPath: string) => {
    if (!rootPath) {
      set({dependencyGraph: undefined})
      return
    }
    set({dependencyLoading: true})
    try {
      const dependencyGraph = await api.analyzeProjectDependencies(rootPath)
      set({dependencyGraph})
    } catch (error) {
      set({error: getErrorMessage(error), dependencyGraph: undefined})
    } finally {
      set({dependencyLoading: false})
    }
  },

  clearDependencyGraph: () => {
    set({dependencyGraph: undefined, dependencyLoading: false})
  },

  saveServerProfile: async (payload) => {
    try {
      await api.saveServerProfile(payload)
      await get().refreshDeploymentData()
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  deleteServerProfile: async (serverId) => {
    try {
      await api.deleteServerProfile(serverId)
      await get().refreshDeploymentData()
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  testServerConnection: async (serverId) => {
    try {
      return await api.testServerConnection(serverId)
    } catch (error) {
      throw new Error(getErrorMessage(error))
    }
  },

  saveDeploymentProfile: async (profile) => {
    try {
      await api.saveDeploymentProfile(profile)
      await get().refreshDeploymentData()
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  deleteDeploymentProfile: async (profileId) => {
    try {
      await api.deleteDeploymentProfile(profileId)
      await get().refreshDeploymentData()
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  refreshDeploymentData: async () => {
    try {
      const [serverProfiles, deploymentProfiles, deploymentTasks] = await Promise.all([
        api.listServerProfiles(),
        api.listDeploymentProfiles(),
        api.listDeploymentTasks(),
      ])
      set({
        serverProfiles: sortProfiles(serverProfiles),
        deploymentProfiles: sortProfiles(deploymentProfiles),
        deploymentTasks: sortDeploymentTasks(deploymentTasks),
      })
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  startDeployment: async (profileId, serverId, artifactPath, buildTaskId) => {
    if (isDeploymentTaskRunning(get().currentDeploymentTask)) {
      set({error: '当前已有部署任务在执行，请先停止或等待完成。'})
      return
    }

    try {
      const profile = get().deploymentProfiles.find((item) => item.id === profileId)
      const taskId = await api.startDeployment({
        deploymentProfileId: profileId,
        serverId,
        localArtifactPath: artifactPath,
        buildTaskId,
      })
      set(() => ({
        currentDeploymentTask: {
          id: taskId,
          deploymentProfileId: profileId,
          projectRoot: profile?.projectRoot ?? useAppStore.getState().project?.rootPath ?? '',
          serverId,
          moduleId: '',
          artifactPath,
          artifactName: artifactPath.split(/[\\/]/).at(-1) ?? artifactPath,
          status: 'pending',
          log: [],
          stages: createPendingDeploymentStages(profile),
          createdAt: new Date().toISOString(),
        },
      }))
      useDeploymentLogStore.getState().appendLog({
        taskId,
        line: `${new Date().toLocaleTimeString()} 已提交部署任务`,
      })
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  cancelDeployment: async (taskId) => {
    try {
      await api.cancelDeployment(taskId)
      useDeploymentLogStore.getState().appendLog({
        taskId,
        line: `${new Date().toLocaleTimeString()} 已请求停止部署`,
      })
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  updateDeploymentTask: (task) => {
    set((state) => {
      const isCurrent = state.currentDeploymentTask?.id === task.id
      if (!isCurrent) return {}
      return {currentDeploymentTask: task}
    })
  },

  finishDeploymentTask: (task) => {
    set((state) => ({
      currentDeploymentTask: task,
      deploymentTasks: sortDeploymentTasks([task, ...state.deploymentTasks.filter((item) => item.id !== task.id)]),
    }))
  },

  deleteDeploymentTask: async (taskId) => {
    try {
      await api.deleteDeploymentTask(taskId)
      set((state) => ({
        deploymentTasks: state.deploymentTasks.filter((item) => item.id !== taskId),
      }))
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  rerunDeployment: async (task) => {
    await get().startDeployment(
      task.deploymentProfileId,
      task.serverId,
      task.artifactPath,
      task.buildTaskId,
    )
  },

  updateProbeStatuses: (event) => {
    set((state) => {
      const task = state.currentDeploymentTask
      if (!task || task.id !== event.taskId) {
        return {}
      }
      const updatedStages = task.stages.map((stage) =>
        stage.key === event.stageKey
          ? {...stage, probeStatuses: event.probeStatuses}
          : stage,
      )
      return {
        currentDeploymentTask: {...task, stages: updatedStages},
      }
    })
  },
}))
