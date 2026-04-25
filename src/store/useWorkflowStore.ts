import {create} from 'zustand'
import {api} from '../services/tauri-api'
import type {
    DeploymentLogEvent,
    DeploymentProfile,
    DeploymentStage,
    DeploymentTask,
    ModuleDependencyGraph,
    SaveServerProfilePayload,
    ServerProfile,
    TaskPipeline,
    TaskPipelineLogEvent,
    TaskPipelineRun,
    TaskPipelineStepEvent,
} from '../types/domain'
import {useAppStore} from './useAppStore'

interface WorkflowState {
  dependencyGraph?: ModuleDependencyGraph
  dependencyLoading: boolean
  taskPipelines: TaskPipeline[]
  taskPipelineRuns: TaskPipelineRun[]
  taskPipelineLogsByRunId: Record<string, string[]>
  currentTaskPipelineRun?: TaskPipelineRun
  serverProfiles: ServerProfile[]
  deploymentProfiles: DeploymentProfile[]
  deploymentTasks: DeploymentTask[]
  currentDeploymentTask?: DeploymentTask
  deploymentLogsByTaskId: Record<string, string[]>
  loading: boolean
  error?: string
  initialize: () => Promise<void>
  loadDependencyGraph: (rootPath: string) => Promise<void>
  clearDependencyGraph: () => void
  saveTaskPipeline: (pipeline: TaskPipeline) => Promise<void>
  deleteTaskPipeline: (pipelineId: string) => Promise<void>
  refreshTaskPipelines: () => Promise<void>
  startTaskPipeline: (pipeline: TaskPipeline) => Promise<void>
  appendTaskPipelineLog: (event: TaskPipelineLogEvent) => void
  updateTaskPipelineStep: (event: TaskPipelineStepEvent) => void
  finishTaskPipeline: (run: TaskPipelineRun) => void
  saveServerProfile: (payload: SaveServerProfilePayload) => Promise<void>
  deleteServerProfile: (serverId: string) => Promise<void>
  saveDeploymentProfile: (profile: DeploymentProfile) => Promise<void>
  deleteDeploymentProfile: (profileId: string) => Promise<void>
  refreshDeploymentData: () => Promise<void>
  startDeployment: (profileId: string, serverId: string, artifactPath: string, buildTaskId?: string) => Promise<void>
  cancelDeployment: (taskId: string) => Promise<void>
  appendDeploymentLog: (event: DeploymentLogEvent) => void
  updateDeploymentTask: (task: DeploymentTask) => void
  finishDeploymentTask: (task: DeploymentTask) => void
  deleteDeploymentTask: (taskId: string) => Promise<void>
  rerunDeployment: (task: DeploymentTask) => Promise<void>
  deleteTaskPipelineRun: (runId: string) => Promise<void>
  rerunTaskPipeline: (run: TaskPipelineRun) => Promise<void>
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const sortPipelines = (pipelines: TaskPipeline[]) =>
  [...pipelines].sort((left, right) =>
    (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
      || left.name.localeCompare(right.name, 'zh-CN'))

const sortRuns = (runs: TaskPipelineRun[]) =>
  [...runs].sort((left, right) => right.startedAt.localeCompare(left.startedAt))

const sortProfiles = <T extends {updatedAt?: string; name?: string}>(items: T[]) =>
  [...items].sort((left, right) =>
    (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
      || (left.name ?? '').localeCompare(right.name ?? '', 'zh-CN'))

const sortDeploymentTasks = (tasks: DeploymentTask[]) =>
  [...tasks].sort((left, right) => right.createdAt.localeCompare(left.createdAt))

const createPendingDeploymentStages = (): DeploymentStage[] => [
  {key: 'upload', label: '上传产物', status: 'pending'},
  {key: 'stop', label: '停止旧服务', status: 'pending'},
  {key: 'replace', label: '替换文件', status: 'pending'},
  {key: 'start', label: '启动服务', status: 'pending'},
  {key: 'health', label: '健康检查', status: 'pending'},
]

const isDeploymentTaskRunning = (task?: DeploymentTask) =>
  Boolean(task && !['success', 'failed', 'cancelled'].includes(task.status))

export const useWorkflowStore = create<WorkflowState>((set, get) => ({
  dependencyLoading: false,
  taskPipelines: [],
  taskPipelineRuns: [],
  taskPipelineLogsByRunId: {},
  serverProfiles: [],
  deploymentProfiles: [],
  deploymentTasks: [],
  deploymentLogsByTaskId: {},
  loading: false,

  initialize: async () => {
    set({loading: true, error: undefined})
    try {
      const [taskPipelines, taskPipelineRuns, serverProfiles, deploymentProfiles, deploymentTasks] = await Promise.all([
        api.listTaskPipelines(),
        api.listTaskPipelineRuns(),
        api.listServerProfiles(),
        api.listDeploymentProfiles(),
        api.listDeploymentTasks(),
      ])
      set({
        taskPipelines: sortPipelines(taskPipelines),
        taskPipelineRuns: sortRuns(taskPipelineRuns),
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

  saveTaskPipeline: async (pipeline) => {
    try {
      await api.saveTaskPipeline(pipeline)
      await get().refreshTaskPipelines()
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  deleteTaskPipeline: async (pipelineId) => {
    try {
      await api.deleteTaskPipeline(pipelineId)
      await get().refreshTaskPipelines()
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  refreshTaskPipelines: async () => {
    try {
      const [taskPipelines, taskPipelineRuns] = await Promise.all([
        api.listTaskPipelines(),
        api.listTaskPipelineRuns(),
      ])
      set({
        taskPipelines: sortPipelines(taskPipelines),
        taskPipelineRuns: sortRuns(taskPipelineRuns),
      })
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  startTaskPipeline: async (pipeline) => {
    const appState = useAppStore.getState()
    if (!appState.project || !appState.environment) {
      set({error: '请先选择项目并完成环境识别。'})
      return
    }
    try {
      const runId = await api.startTaskPipeline({
        pipeline,
        projectRoot: appState.project.rootPath,
        environment: appState.environment,
      })
      const pendingRun: TaskPipelineRun = {
        id: runId,
        pipelineId: pipeline.id,
        pipelineName: pipeline.name,
        projectRoot: appState.project.rootPath,
        moduleIds: pipeline.moduleIds,
        status: 'running',
        totalDurationMs: 0,
        startedAt: new Date().toISOString(),
        steps: pipeline.steps.map((step) => ({
          stepId: step.id,
          label: step.label,
          type: step.type,
          status: step.enabled ? 'pending' : 'skipped',
          output: [],
        })),
      }
      set((state) => ({
        currentTaskPipelineRun: pendingRun,
        taskPipelineRuns: sortRuns([pendingRun, ...state.taskPipelineRuns.filter((item) => item.id !== runId)]),
        taskPipelineLogsByRunId: {
          ...state.taskPipelineLogsByRunId,
          [runId]: [`${new Date().toLocaleTimeString()} 任务链已提交执行`],
        },
      }))
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  appendTaskPipelineLog: (event) => {
    set((state) => ({
      taskPipelineLogsByRunId: {
        ...state.taskPipelineLogsByRunId,
        [event.runId]: [...(state.taskPipelineLogsByRunId[event.runId] ?? []), event.line].slice(-400),
      },
    }))
  },

  updateTaskPipelineStep: (event) => {
    set((state) => {
      const updateRun = (run?: TaskPipelineRun) =>
        run && run.id === event.runId
          ? {
              ...run,
              steps: run.steps.map((step) =>
                step.stepId === event.step.stepId ? event.step : step),
            }
          : run

      return {
        currentTaskPipelineRun: updateRun(state.currentTaskPipelineRun),
        taskPipelineRuns: state.taskPipelineRuns.map((run) =>
          run.id === event.runId
            ? {
                ...run,
                steps: run.steps.map((step) =>
                  step.stepId === event.step.stepId ? event.step : step),
              }
            : run),
      }
    })
  },

  finishTaskPipeline: (run) => {
    set((state) => ({
      currentTaskPipelineRun: run,
      taskPipelineRuns: sortRuns([run, ...state.taskPipelineRuns.filter((item) => item.id !== run.id)]),
    }))
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
      const taskId = await api.startDeployment({
        deploymentProfileId: profileId,
        serverId,
        localArtifactPath: artifactPath,
        buildTaskId,
      })
      set((state) => ({
        currentDeploymentTask: {
          id: taskId,
          deploymentProfileId: profileId,
          serverId,
          moduleId: '',
          artifactPath,
          artifactName: artifactPath.split(/[\\/]/).at(-1) ?? artifactPath,
          status: 'pending',
          log: [],
          stages: createPendingDeploymentStages(),
          createdAt: new Date().toISOString(),
        },
        deploymentLogsByTaskId: {
          ...state.deploymentLogsByTaskId,
          [taskId]: [`${new Date().toLocaleTimeString()} 已提交部署任务`],
        },
      }))
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  cancelDeployment: async (taskId) => {
    try {
      await api.cancelDeployment(taskId)
      set((state) => ({
        deploymentLogsByTaskId: {
          ...state.deploymentLogsByTaskId,
          [taskId]: [
            ...(state.deploymentLogsByTaskId[taskId] ?? []),
            `${new Date().toLocaleTimeString()} 已请求停止部署`,
          ].slice(-500),
        },
      }))
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  appendDeploymentLog: (event) => {
    set((state) => ({
      deploymentLogsByTaskId: {
        ...state.deploymentLogsByTaskId,
        [event.taskId]: [...(state.deploymentLogsByTaskId[event.taskId] ?? []), event.line].slice(-500),
      },
    }))
  },

  updateDeploymentTask: (task) => {
    set((state) => ({
      currentDeploymentTask: state.currentDeploymentTask?.id === task.id ? task : state.currentDeploymentTask,
      deploymentTasks: sortDeploymentTasks([task, ...state.deploymentTasks.filter((item) => item.id !== task.id)]),
    }))
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

  deleteTaskPipelineRun: async (runId) => {
    try {
      await api.deleteTaskPipelineRun(runId)
      set((state) => ({
        taskPipelineRuns: state.taskPipelineRuns.filter((item) => item.id !== runId),
      }))
    } catch (error) {
      set({error: getErrorMessage(error)})
    }
  },

  rerunTaskPipeline: async (run) => {
    const pipeline = get().taskPipelines.find((p) => p.id === run.pipelineId)
    if (!pipeline) {
      set({error: '任务链模板已不存在，无法重跑。'})
      return
    }
    await get().startTaskPipeline(pipeline)
  },
}))
