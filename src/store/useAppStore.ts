import {create} from 'zustand'
import {api, createDefaultBuildOptions, selectProjectDirectory} from '../services/tauri-api'
import type {
  BuildArtifact,
  BuildEnvironment,
  BuildFinishedEvent,
  BuildHistoryRecord,
  BuildLogEvent,
  BuildOptions,
  BuildStatus,
  BuildTemplate,
  EnvironmentSettings,
  GitCommit,
  GitRepositoryStatus,
  MavenModule,
  MavenProject,
  PersistedBuildStatus,
} from '../types/domain'

interface AppState {
  project?: MavenProject
  environment?: BuildEnvironment
  selectedModule?: MavenModule
  selectedModules: MavenModule[]
  selectedModuleIds: string[]
  savedProjectPaths: string[]
  buildOptions: BuildOptions
  buildStatus: BuildStatus
  currentBuildId?: string
  startedAt?: number
  durationMs: number
  logs: BuildLogEvent[]
  artifacts: BuildArtifact[]
  history: BuildHistoryRecord[]
  templates: BuildTemplate[]
  gitStatus?: GitRepositoryStatus
  gitCommits: GitCommit[]
  gitChecking: boolean
  gitCommitsLoading: boolean
  gitPulling: boolean
  gitSwitching: boolean
  loading: boolean
  error?: string
  initialize: () => Promise<void>
  chooseProject: () => Promise<void>
  parseProjectPath: (rootPath: string) => Promise<void>
  removeSavedProject: (rootPath: string) => Promise<void>
  checkGitStatus: (rootPath?: string) => Promise<void>
  loadGitCommits: (rootPath?: string) => Promise<void>
  fetchGitUpdates: () => Promise<void>
  pullGitUpdates: () => Promise<void>
  switchGitBranch: (branchName: string) => Promise<void>
  setSelectedModule: (moduleId: string) => void
  setSelectedModules: (moduleIds: string[]) => void
  selectAllProject: () => void
  setBuildOption: <K extends keyof BuildOptions>(
    key: K,
    value: BuildOptions[K],
  ) => void
  setEditableCommand: (command: string) => void
  refreshCommandPreview: () => Promise<void>
  updateEnvironment: (settings: EnvironmentSettings) => Promise<void>
  startBuild: () => Promise<void>
  cancelBuild: () => Promise<void>
  appendBuildLog: (event: BuildLogEvent) => void
  clearBuildLogs: () => void
  finishBuild: (event: BuildFinishedEvent) => void
  loadHistoryAndTemplates: () => Promise<void>
  rerunHistory: (record: BuildHistoryRecord) => void
  rerunHistoryNow: (record: BuildHistoryRecord) => Promise<void>
  saveTemplate: (name: string) => Promise<void>
  updateTemplate: (template: BuildTemplate) => Promise<void>
  applyTemplate: (template: BuildTemplate) => void
  deleteTemplate: (templateId: string) => Promise<void>
}

const findModule = (
  modules: MavenModule[],
  moduleId: string,
): MavenModule | undefined => {
  for (const moduleItem of modules) {
    if (moduleItem.id === moduleId) {
      return moduleItem
    }
    const child = findModule(moduleItem.children ?? [], moduleId)
    if (child) {
      return child
    }
  }
  return undefined
}

const flattenModules = (modules: MavenModule[]): MavenModule[] =>
  modules.flatMap((moduleItem) => [
    moduleItem,
    ...flattenModules(moduleItem.children ?? []),
  ])

const moduleSelectionLabel = (modules: MavenModule[], modulePath: string) => {
  if (!modulePath) {
    return '全部项目'
  }
  if (modules.length === 1) {
    return modules[0].artifactId
  }
  return `${modules.length} 个模块`
}

const findModulesByPaths = (modules: MavenModule[], modulePath: string) => {
  const paths = modulePath
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
  const allModules = flattenModules(modules)
  return paths
    .map((path) => allModules.find((moduleItem) => moduleItem.relativePath === path))
    .filter((moduleItem): moduleItem is MavenModule => Boolean(moduleItem))
}

const toHistoryStatus = (status: PersistedBuildStatus): BuildStatus => status

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const sortTemplates = (templates: BuildTemplate[]) =>
  [...templates].sort((left, right) => {
    if (Boolean(left.pinned) !== Boolean(right.pinned)) {
      return left.pinned ? -1 : 1
    }
    return (right.updatedAt ?? '').localeCompare(left.updatedAt ?? '')
      || left.name.localeCompare(right.name, 'zh-CN')
  })

const notifyBuildFinished = (status: PersistedBuildStatus, durationMs: number, artifactCount: number) => {
  const success = status === 'SUCCESS'
  const title = success ? 'Maven 打包完成' : status === 'CANCELLED' ? 'Maven 打包已停止' : 'Maven 打包失败'
  const seconds = Math.max(1, Math.round(durationMs / 1000))
  const body = success
    ? `耗时 ${seconds}s，发现 ${artifactCount} 个产物。`
    : `耗时 ${seconds}s，请查看构建日志。`

  try {
    if ('Notification' in window) {
      if (Notification.permission === 'granted') {
        new Notification(title, { body })
      } else if (Notification.permission === 'default') {
        void Notification.requestPermission().then((permission) => {
          if (permission === 'granted') {
            new Notification(title, { body })
          }
        })
      }
    }
  } catch {
    // 桌面通知不可用时继续播放提示音。
  }

  try {
    const AudioContextClass = window.AudioContext
      ?? (window as typeof window & { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
    if (!AudioContextClass) {
      return
    }
    const context = new AudioContextClass()
    const oscillator = context.createOscillator()
    const gain = context.createGain()
    oscillator.type = success ? 'sine' : 'triangle'
    oscillator.frequency.value = success ? 880 : 220
    gain.gain.setValueAtTime(0.0001, context.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.08, context.currentTime + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, context.currentTime + 0.22)
    oscillator.connect(gain)
    gain.connect(context.destination)
    oscillator.start()
    oscillator.stop(context.currentTime + 0.24)
    oscillator.onended = () => void context.close()
  } catch {
    // 用户系统禁止音频时忽略。
  }
}

const normalizeProjectPaths = (paths: string[]) =>
  paths.reduce<string[]>((result, path) => {
    const trimmed = path.trim()
    if (!trimmed || result.some((item) => item.toLowerCase() === trimmed.toLowerCase())) {
      return result
    }
    return [...result, trimmed]
  }, [])

const upsertProjectPath = (paths: string[], rootPath: string) => {
  const trimmed = rootPath.trim()
  if (!trimmed) {
    return paths
  }
  return [
    trimmed,
    ...paths.filter((path) => path.toLowerCase() !== trimmed.toLowerCase()),
  ].slice(0, 20)
}

export const useAppStore = create<AppState>((set, get) => ({
  buildOptions: createDefaultBuildOptions(),
  buildStatus: 'IDLE',
  durationMs: 0,
  logs: [],
  artifacts: [],
  history: [],
  templates: [],
  selectedModules: [],
  selectedModuleIds: [],
  savedProjectPaths: [],
  gitChecking: false,
  gitCommits: [],
  gitCommitsLoading: false,
  gitPulling: false,
  gitSwitching: false,
  loading: false,

  initialize: async () => {
    await get().loadHistoryAndTemplates()
    try {
      const settings = await api.loadEnvironmentSettings()
      const savedProjectPaths = normalizeProjectPaths([
        ...(settings.projectPaths ?? []),
        ...(settings.lastProjectPath ? [settings.lastProjectPath] : []),
      ])
      set({ savedProjectPaths })
      if (settings.lastProjectPath) {
        await get().parseProjectPath(settings.lastProjectPath)
      } else {
        const environment = await api.detectEnvironment('')
        set({ environment })
      }
    } catch {
      // 浏览器预览或首次启动时没有本地设置，保持空工作台即可。
    }
  },

  chooseProject: async () => {
    try {
      const rootPath = await selectProjectDirectory()
      if (rootPath) {
        await get().parseProjectPath(rootPath)
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  parseProjectPath: async (rootPath: string) => {
    set({
      loading: true,
      error: undefined,
      logs: [],
      artifacts: [],
      gitStatus: undefined,
      gitCommits: [],
    })
    try {
      const [project, environment] = await Promise.all([
        api.parseMavenProject(rootPath),
        api.detectEnvironment(rootPath),
      ])
      const buildOptions = createDefaultBuildOptions(project.rootPath, '')
      set({
        project,
        environment,
        selectedModule: undefined,
        selectedModules: [],
        selectedModuleIds: [],
        buildOptions,
        buildStatus: 'IDLE',
        currentBuildId: undefined,
        durationMs: 0,
      })
      await api.saveLastProjectPath(project.rootPath)
      set((state) => ({
        savedProjectPaths: upsertProjectPath(state.savedProjectPaths, project.rootPath),
      }))
      await get().refreshCommandPreview()
      void get().checkGitStatus(project.rootPath)
    } catch (error) {
      set({ error: getErrorMessage(error) })
    } finally {
      set({ loading: false })
    }
  },

  removeSavedProject: async (rootPath: string) => {
    try {
      const settings = await api.removeSavedProjectPath(rootPath)
      set({
        savedProjectPaths: normalizeProjectPaths(settings.projectPaths ?? []),
      })
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  checkGitStatus: async (rootPath?: string) => {
    const targetPath = rootPath ?? get().project?.rootPath
    if (!targetPath) {
      return
    }

    set({ gitChecking: true })
    try {
      const gitStatus = await api.checkGitStatus(targetPath)
      set({ gitStatus })
      void get().loadGitCommits(targetPath)
    } catch (error) {
      set({
        gitStatus: {
          isGitRepo: true,
          branches: [],
          aheadCount: 0,
          behindCount: 0,
          hasRemoteUpdates: false,
          hasLocalChanges: false,
          message: getErrorMessage(error),
        },
        gitCommits: [],
      })
    } finally {
      set({ gitChecking: false })
    }
  },

  loadGitCommits: async (rootPath?: string) => {
    const targetPath = rootPath ?? get().project?.rootPath
    if (!targetPath) {
      set({ gitCommits: [] })
      return
    }

    set({ gitCommitsLoading: true })
    try {
      const gitCommits = await api.listGitCommits(targetPath, 30)
      set({ gitCommits })
    } catch {
      set({ gitCommits: [] })
    } finally {
      set({ gitCommitsLoading: false })
    }
  },

  fetchGitUpdates: async () => {
    const targetPath = get().project?.rootPath
    if (!targetPath) {
      return
    }

    set({ gitChecking: true, error: undefined })
    try {
      const gitStatus = await api.fetchGitUpdates(targetPath)
      set({ gitStatus })
      await get().loadGitCommits(targetPath)
    } catch (error) {
      set({ error: getErrorMessage(error) })
    } finally {
      set({ gitChecking: false })
    }
  },

  pullGitUpdates: async () => {
    const targetPath = get().project?.rootPath
    if (!targetPath) {
      return
    }

    set({ gitPulling: true, error: undefined })
    try {
      const result = await api.pullGitUpdates(targetPath)
      set({ gitStatus: result.status })
      await get().loadGitCommits(targetPath)
      await get().parseProjectPath(targetPath)
    } catch (error) {
      set({ error: getErrorMessage(error) })
      await get().checkGitStatus(targetPath)
    } finally {
      set({ gitPulling: false })
    }
  },

  switchGitBranch: async (branchName: string) => {
    const targetPath = get().project?.rootPath
    if (!targetPath) {
      return
    }

    set({ gitSwitching: true, error: undefined })
    try {
      const result = await api.switchGitBranch(targetPath, branchName)
      set({ gitStatus: result.status })
      await get().loadGitCommits(targetPath)
      await get().parseProjectPath(targetPath)
    } catch (error) {
      set({ error: getErrorMessage(error) })
      await get().checkGitStatus(targetPath)
    } finally {
      set({ gitSwitching: false })
    }
  },

  setSelectedModule: (moduleId: string) => {
    const project = get().project
    const selectedModule = project ? findModule(project.modules, moduleId) : undefined
    if (!selectedModule) {
      return
    }
    set((state) => ({
      selectedModule,
      selectedModules: [selectedModule],
      selectedModuleIds: [selectedModule.id],
      buildOptions: {
        ...state.buildOptions,
        selectedModulePath: selectedModule.relativePath,
      },
    }))
    void get().refreshCommandPreview()
  },

  setSelectedModules: (moduleIds: string[]) => {
    const project = get().project
    if (!project) {
      return
    }
    const allModules = flattenModules(project.modules)
    const selectedModules = moduleIds
      .map((moduleId) => allModules.find((moduleItem) => moduleItem.id === moduleId))
      .filter((moduleItem): moduleItem is MavenModule => Boolean(moduleItem))
    const selectedModulePath = selectedModules
      .map((moduleItem) => moduleItem.relativePath)
      .join(',')

    set((state) => ({
      selectedModule: selectedModules[0],
      selectedModules,
      selectedModuleIds: selectedModules.map((moduleItem) => moduleItem.id),
      buildOptions: {
        ...state.buildOptions,
        selectedModulePath,
      },
    }))
    void get().refreshCommandPreview()
  },

  selectAllProject: () => {
    set((state) => ({
      selectedModule: undefined,
      selectedModules: [],
      selectedModuleIds: [],
      buildOptions: {
        ...state.buildOptions,
        selectedModulePath: '',
      },
    }))
    void get().refreshCommandPreview()
  },

  setBuildOption: (key, value) => {
    set((state) => ({
      buildOptions: {
        ...state.buildOptions,
        [key]: value,
      },
    }))
    void get().refreshCommandPreview()
  },

  setEditableCommand: (command: string) => {
    set((state) => ({
      buildOptions: {
        ...state.buildOptions,
        editableCommand: command,
      },
    }))
  },

  refreshCommandPreview: async () => {
    const { buildOptions, environment } = get()
    if (!environment || !buildOptions.projectRoot) {
      return
    }

    try {
      const editableCommand = await api.buildCommandPreview({
        options: buildOptions,
        environment,
      })
      set((state) => ({
        buildOptions: {
          ...state.buildOptions,
          editableCommand,
        },
      }))
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  updateEnvironment: async (settings: EnvironmentSettings) => {
    const { project } = get()
    try {
      await api.saveEnvironmentSettings({
        ...settings,
        projectPaths: get().savedProjectPaths,
      })
      const environment = await api.detectEnvironment(project?.rootPath ?? '')
      set({ environment })
      if (project) {
        await get().refreshCommandPreview()
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  startBuild: async () => {
    const { buildOptions, environment, selectedModules } = get()
    if (!environment || !buildOptions.projectRoot || !buildOptions.editableCommand.trim()) {
      set({ error: '请先选择项目并确认构建命令。' })
      return
    }

    set({
      buildStatus: 'RUNNING',
      logs: [],
      artifacts: [],
      startedAt: Date.now(),
      durationMs: 0,
      error: undefined,
    })

    try {
      const currentBuildId = await api.startBuild({
        projectRoot: buildOptions.projectRoot,
        command: buildOptions.editableCommand,
        modulePath: buildOptions.selectedModulePath,
        moduleArtifactId: moduleSelectionLabel(selectedModules, buildOptions.selectedModulePath),
        javaHome: environment.javaHome,
        mavenHome: environment.mavenHome,
        useMavenWrapper: environment.useMavenWrapper,
      })
      set({ currentBuildId })
    } catch (error) {
      set({ buildStatus: 'FAILED', error: getErrorMessage(error) })
    }
  },

  cancelBuild: async () => {
    const currentBuildId = get().currentBuildId
    if (!currentBuildId) {
      return
    }
    try {
      await api.cancelBuild(currentBuildId)
      set({ buildStatus: 'CANCELLED' })
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  appendBuildLog: (event: BuildLogEvent) => {
    set((state) => ({
      logs: [...state.logs.slice(-4999), event],
    }))
  },

  clearBuildLogs: () => {
    set({ logs: [] })
  },

  finishBuild: (event: BuildFinishedEvent) => {
    const { buildOptions, environment, selectedModules, currentBuildId } = get()
    if (event.buildId !== currentBuildId) {
      return
    }
    const record: BuildHistoryRecord = {
      id: event.buildId,
      createdAt: new Date().toISOString(),
      projectRoot: buildOptions.projectRoot,
      modulePath: buildOptions.selectedModulePath,
      moduleArtifactId: moduleSelectionLabel(selectedModules, buildOptions.selectedModulePath),
      command: buildOptions.editableCommand,
      status: event.status,
      durationMs: event.durationMs,
      javaHome: environment?.javaHome,
      mavenHome: environment?.mavenHome,
      useMavenWrapper: environment?.useMavenWrapper ?? false,
      buildOptions: { ...buildOptions },
      artifacts: [],
    }
    void (async () => {
      const artifacts = event.status === 'SUCCESS'
        ? await api.scanBuildArtifacts(record.projectRoot, record.modulePath).catch(() => [])
        : []
      const recordWithArtifacts = { ...record, artifacts }
      set({ artifacts })
      notifyBuildFinished(event.status, event.durationMs, artifacts.length)
      await api.saveBuildHistory(recordWithArtifacts)
      await get().loadHistoryAndTemplates()
    })()
    set({
      buildStatus: toHistoryStatus(event.status),
      durationMs: event.durationMs,
      currentBuildId: undefined,
    })
  },

  loadHistoryAndTemplates: async () => {
    try {
      const [history, templates] = await Promise.all([
        api.listBuildHistory(),
        api.listTemplates(),
      ])
      set({ history, templates: sortTemplates(templates) })
    } catch {
      set({ history: [], templates: [] })
    }
  },

  rerunHistory: (record: BuildHistoryRecord) => {
    const project = get().project
    const selectedModules = project
      ? findModulesByPaths(project.modules, record.modulePath)
      : []
    const buildOptions = record.buildOptions
      ? { ...record.buildOptions, editableCommand: record.command }
      : {
          ...createDefaultBuildOptions(record.projectRoot, record.modulePath),
          editableCommand: record.command,
        }
    set({
      selectedModule: selectedModules[0],
      selectedModules,
      selectedModuleIds: selectedModules.map((moduleItem) => moduleItem.id),
      buildOptions,
      buildStatus: 'IDLE',
      durationMs: record.durationMs,
      artifacts: record.artifacts ?? [],
    })
  },

  rerunHistoryNow: async (record: BuildHistoryRecord) => {
    if (get().project?.rootPath !== record.projectRoot) {
      await get().parseProjectPath(record.projectRoot)
    }
    get().rerunHistory(record)
    await get().startBuild()
  },

  saveTemplate: async (name: string) => {
    const { buildOptions, environment } = get()
    if (!buildOptions.projectRoot) {
      set({ error: '请先选择项目。' })
      return
    }
    const template: BuildTemplate = {
      id: crypto.randomUUID(),
      name,
      projectRoot: buildOptions.projectRoot,
      modulePath: buildOptions.selectedModulePath,
      goals: buildOptions.goals,
      profiles: buildOptions.profiles,
      properties: buildOptions.properties,
      alsoMake: buildOptions.alsoMake,
      skipTests: buildOptions.skipTests,
      customArgs: buildOptions.customArgs,
      useMavenWrapper: environment?.useMavenWrapper ?? false,
      javaHome: environment?.javaHome,
      mavenHome: environment?.mavenHome,
      pinned: false,
    }
    await api.saveTemplate(template)
    await get().loadHistoryAndTemplates()
  },

  updateTemplate: async (template: BuildTemplate) => {
    await api.saveTemplate(template)
    await get().loadHistoryAndTemplates()
  },

  applyTemplate: (template: BuildTemplate) => {
    const project = get().project
    const selectedModules = project
      ? findModulesByPaths(project.modules, template.modulePath)
      : []
    set((state) => ({
      selectedModule: selectedModules[0],
      selectedModules,
      selectedModuleIds: selectedModules.map((moduleItem) => moduleItem.id),
      buildOptions: {
        ...state.buildOptions,
        projectRoot: template.projectRoot,
        selectedModulePath: template.modulePath,
        goals: template.goals,
        profiles: template.profiles,
        properties: template.properties,
        alsoMake: template.alsoMake,
        skipTests: template.skipTests,
        customArgs: template.customArgs,
      },
      artifacts: [],
    }))
    void get().refreshCommandPreview()
  },

  deleteTemplate: async (templateId: string) => {
    await api.deleteTemplate(templateId)
    await get().loadHistoryAndTemplates()
  },
}))
