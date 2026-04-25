import {create} from 'zustand'
import {api, createDefaultBuildOptions, selectProjectDirectory} from '../services/tauri-api'
import {diagnoseBuildFailure} from '../services/buildDiagnosisService'
import type {
    BuildArtifact,
    BuildDiagnosis,
    BuildEnvironment,
    BuildFinishedEvent,
    BuildHistoryRecord,
    BuildLogEvent,
    BuildOptions,
    BuildStatus,
    BuildTemplate,
    EnvironmentProfile,
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
  environmentSettings?: EnvironmentSettings
  selectedModule?: MavenModule
  selectedModules: MavenModule[]
  selectedModuleIds: string[]
  savedProjectPaths: string[]
  buildOptions: BuildOptions
  buildStatus: BuildStatus
  currentBuildId?: string
  buildCancelling: boolean
  startedAt?: number
  durationMs: number
  logs: BuildLogEvent[]
  diagnosis?: BuildDiagnosis
  artifacts: BuildArtifact[]
  history: BuildHistoryRecord[]
  templates: BuildTemplate[]
  gitStatus?: GitRepositoryStatus
  gitCommits: GitCommit[]
  gitChecking: boolean
  gitCommitsLoading: boolean
  gitPulling: boolean
  gitSwitching: boolean
  gitError?: string
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
  clearGitError: () => void
  setSelectedModule: (moduleId: string) => void
  setSelectedModules: (moduleIds: string[]) => void
  selectAllProject: () => void
  setBuildOption: <K extends keyof BuildOptions>(
    key: K,
    value: BuildOptions[K],
  ) => void
  setEditableCommand: (command: string) => void
  refreshCommandPreview: () => Promise<void>
  refreshEnvironment: () => Promise<void>
  updateEnvironment: (settings: EnvironmentSettings) => Promise<void>
  applyEnvironmentProfile: (profileId: string) => Promise<void>
  saveEnvironmentProfile: (name: string) => Promise<void>
  deleteEnvironmentProfile: (profileId: string) => Promise<void>
  startBuild: () => Promise<void>
  startPackageBuild: (moduleIds: string[]) => Promise<void>
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
  removeArtifact: (path: string) => Promise<void>
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

const appendSystemLog = (
  logs: BuildLogEvent[],
  buildId: string | undefined,
  line: string,
): BuildLogEvent[] => [
  ...logs.slice(-4999),
  {
    buildId: buildId ?? 'pending',
    stream: 'system',
    line,
  },
]

const createProfileFromEnvironment = (
  name: string,
  environment?: BuildEnvironment,
  existingId?: string,
): EnvironmentProfile => ({
  id: existingId ?? crypto.randomUUID(),
  name: name.trim(),
  javaHome: environment?.javaHome,
  mavenHome: environment?.mavenHome,
  settingsXmlPath: environment?.settingsXmlPath,
  localRepoPath: environment?.localRepoPath,
  useMavenWrapper: environment?.useMavenWrapper ?? false,
  updatedAt: new Date().toISOString(),
})

const emptyEnvironmentSettings = (): EnvironmentSettings => ({
  profiles: [],
})

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

const packageProducingGoals = new Set(['package', 'install', 'verify', 'deploy'])

const ensurePackageGoal = (goals: string[]) => {
  if (goals.some((goal) => packageProducingGoals.has(goal))) {
    return goals
  }

  const nextGoals = goals.length > 0 ? [...goals, 'package'] : ['clean', 'package']
  return Array.from(new Set(nextGoals))
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

const isSameBuildLogLine = (
  previous: BuildLogEvent | undefined,
  next: BuildLogEvent,
) =>
  Boolean(previous)
  && previous?.buildId === next.buildId
  && previous.stream === next.stream
  && previous.line === next.line

export const useAppStore = create<AppState>((set, get) => ({
  buildOptions: createDefaultBuildOptions(),
  buildStatus: 'IDLE',
  buildCancelling: false,
  durationMs: 0,
  logs: [],
  diagnosis: undefined,
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
  gitError: undefined,
  loading: false,

  initialize: async () => {
    await get().loadHistoryAndTemplates()
    try {
      const settings = await api.loadEnvironmentSettings()
      const savedProjectPaths = normalizeProjectPaths([
        ...(settings.projectPaths ?? []),
        ...(settings.lastProjectPath ? [settings.lastProjectPath] : []),
      ])
      set({ savedProjectPaths, environmentSettings: settings })
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
      project: undefined,
      selectedModule: undefined,
      selectedModules: [],
      selectedModuleIds: [],
      logs: [],
      diagnosis: undefined,
      artifacts: [],
      gitStatus: undefined,
      gitCommits: [],
      gitError: undefined,
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
        buildCancelling: false,
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

    set({ gitChecking: true, gitError: undefined })
    try {
      const gitStatus = await api.checkGitStatus(targetPath)
      set({ gitStatus, gitError: undefined })
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
        gitError: getErrorMessage(error),
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

    set({ gitChecking: true, gitError: undefined })
    try {
      const gitStatus = await api.fetchGitUpdates(targetPath)
      set({ gitStatus, gitError: undefined })
      await get().loadGitCommits(targetPath)
    } catch (error) {
      set({ gitError: getErrorMessage(error) })
    } finally {
      set({ gitChecking: false })
    }
  },

  pullGitUpdates: async () => {
    const targetPath = get().project?.rootPath
    if (!targetPath) {
      return
    }

    set({ gitPulling: true, gitError: undefined })
    try {
      const result = await api.pullGitUpdates(targetPath)
      set({ gitStatus: result.status, gitError: undefined })
      await get().loadGitCommits(targetPath)
      await get().parseProjectPath(targetPath)
    } catch (error) {
      const gitError = getErrorMessage(error)
      await get().checkGitStatus(targetPath)
      set({ gitError })
    } finally {
      set({ gitPulling: false })
    }
  },

  switchGitBranch: async (branchName: string) => {
    const targetPath = get().project?.rootPath
    if (!targetPath) {
      return
    }

    set({ gitSwitching: true, gitError: undefined })
    try {
      const result = await api.switchGitBranch(targetPath, branchName)
      set({ gitStatus: result.status, gitError: undefined })
      await get().loadGitCommits(targetPath)
      await get().parseProjectPath(targetPath)
    } catch (error) {
      const gitError = getErrorMessage(error)
      await get().checkGitStatus(targetPath)
      set({ gitError })
    } finally {
      set({ gitSwitching: false })
    }
  },

  clearGitError: () => {
    set({ gitError: undefined })
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
        profiles: settings.profiles ?? [],
        projectPaths: get().savedProjectPaths,
      })
      const environmentSettings = await api.loadEnvironmentSettings()
      const environment = await api.detectEnvironment(project?.rootPath ?? '')
      set({ environment, environmentSettings })
      if (project) {
        await get().refreshCommandPreview()
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  refreshEnvironment: async () => {
    const { project } = get()
    try {
      const environment = await api.detectEnvironment(project?.rootPath ?? '')
      const environmentSettings = await api.loadEnvironmentSettings()
      set({ environment, environmentSettings })
      if (project) {
        await get().refreshCommandPreview()
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  applyEnvironmentProfile: async (profileId: string) => {
    const { environmentSettings, project } = get()
    const profile = environmentSettings?.profiles.find((item) => item.id === profileId)
    if (!profile) {
      set({ error: '未找到环境方案。' })
      return
    }

    try {
      await api.saveEnvironmentSettings({
        ...(environmentSettings ?? emptyEnvironmentSettings()),
        activeProfileId: profile.id,
        profiles: environmentSettings?.profiles ?? [],
        projectPaths: get().savedProjectPaths,
      })
      const nextSettings = await api.loadEnvironmentSettings()
      const environment = await api.detectEnvironment(project?.rootPath ?? '')
      set({ environment, environmentSettings: nextSettings })
      if (project) {
        await get().refreshCommandPreview()
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  saveEnvironmentProfile: async (name: string) => {
    const trimmedName = name.trim()
    if (!trimmedName) {
      set({ error: '请输入环境方案名称。' })
      return
    }

    const { environmentSettings, project, environment } = get()
    const baseSettings = environmentSettings ?? emptyEnvironmentSettings()
    const existing = baseSettings.profiles.find((profile) => profile.name === trimmedName)
    const profile = createProfileFromEnvironment(trimmedName, environment, existing?.id)
    const profiles = [
      profile,
      ...baseSettings.profiles.filter((item) => item.id !== profile.id),
    ].slice(0, 12)

    try {
      await api.saveEnvironmentSettings({
        ...baseSettings,
        activeProfileId: profile.id,
        profiles,
        projectPaths: get().savedProjectPaths,
      })
      const nextSettings = await api.loadEnvironmentSettings()
      const environment = await api.detectEnvironment(project?.rootPath ?? '')
      set({ environment, environmentSettings: nextSettings })
      if (project) {
        await get().refreshCommandPreview()
      }
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  deleteEnvironmentProfile: async (profileId: string) => {
    const { environmentSettings, project } = get()
    const profiles = (environmentSettings?.profiles ?? []).filter(
      (profile) => profile.id !== profileId,
    )
    const activeProfileId = environmentSettings?.activeProfileId === profileId
      ? undefined
      : environmentSettings?.activeProfileId

    try {
      await api.saveEnvironmentSettings({
        ...(environmentSettings ?? emptyEnvironmentSettings()),
        activeProfileId,
        profiles,
        projectPaths: get().savedProjectPaths,
      })
      const nextSettings = await api.loadEnvironmentSettings()
      const environment = await api.detectEnvironment(project?.rootPath ?? '')
      set({ environment, environmentSettings: nextSettings })
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
      diagnosis: undefined,
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
      if (get().buildCancelling) {
        set((state) => ({
          logs: appendSystemLog(state.logs, currentBuildId, '构建进程已启动，继续发送停止请求。'),
        }))
        try {
          await api.cancelBuild(currentBuildId)
        } catch (cancelError) {
          const message = getErrorMessage(cancelError)
          set((state) => ({
            logs: appendSystemLog(state.logs, currentBuildId, `停止请求发送失败：${message}`),
          }))
          throw cancelError
        }
      }
    } catch (error) {
      const message = getErrorMessage(error)
      set((state) => ({
        buildStatus: 'FAILED',
        buildCancelling: false,
        error: message,
        logs: appendSystemLog(state.logs, get().currentBuildId, `构建启动或停止请求失败：${message}`),
      }))
    }
  },

  startPackageBuild: async (moduleIds) => {
    const { project, environment, buildOptions } = get()
    if (!project || !environment || !buildOptions.projectRoot) {
      set({ error: '请先选择项目并确认构建环境。' })
      return
    }

    const allModules = flattenModules(project.modules)
    const selectedModules = moduleIds.length > 0
      ? moduleIds
          .map((moduleId) => allModules.find((moduleItem) => moduleItem.id === moduleId))
          .filter((moduleItem): moduleItem is MavenModule => Boolean(moduleItem))
      : []

    if (moduleIds.length > 0 && selectedModules.length === 0) {
      set({ error: '部署配置绑定的模块不在当前项目中。' })
      return
    }

    const selectedModulePath = selectedModules
      .map((moduleItem) => moduleItem.relativePath)
      .join(',')
    const nextBuildOptions = {
      ...buildOptions,
      selectedModulePath,
      goals: ensurePackageGoal(buildOptions.goals),
    }

    try {
      const editableCommand = await api.buildCommandPreview({
        options: nextBuildOptions,
        environment,
      })
      set({
        selectedModule: selectedModules[0],
        selectedModules,
        selectedModuleIds: selectedModules.map((moduleItem) => moduleItem.id),
        buildOptions: {
          ...nextBuildOptions,
          editableCommand,
        },
      })
      await get().startBuild()
    } catch (error) {
      set({ error: getErrorMessage(error) })
    }
  },

  cancelBuild: async () => {
    const currentBuildId = get().currentBuildId
    set({ buildCancelling: true })
    if (!currentBuildId) {
      set((state) => ({
        logs: appendSystemLog(state.logs, undefined, '已请求停止，等待构建进程初始化完成。'),
      }))
      return
    }
    set((state) => ({
      logs: appendSystemLog(state.logs, currentBuildId, '已请求停止构建。'),
    }))
    try {
      set((state) => ({
        logs: appendSystemLog(state.logs, currentBuildId, `正在调用后端停止命令：cancel_build(${currentBuildId})`),
      }))
      await api.cancelBuild(currentBuildId)
      set((state) => ({
        logs: appendSystemLog(state.logs, currentBuildId, '后端停止命令已返回，等待构建进程退出。'),
      }))
    } catch (error) {
      const message = getErrorMessage(error)
      set((state) => ({
        buildCancelling: false,
        error: message,
        logs: appendSystemLog(state.logs, currentBuildId, `停止请求发送失败：${message}`),
      }))
    }
  },

  appendBuildLog: (event: BuildLogEvent) => {
    set((state) => ({
      logs: isSameBuildLogLine(state.logs.at(-1), event)
        ? state.logs
        : [...state.logs.slice(-4999), event],
    }))
  },

  clearBuildLogs: () => {
    set({ logs: [], diagnosis: undefined })
  },

  finishBuild: (event: BuildFinishedEvent) => {
    const { buildOptions, environment, selectedModules, currentBuildId, logs } = get()
    if (event.buildId !== currentBuildId) {
      return
    }
    const diagnosis = event.status === 'FAILED'
      ? diagnoseBuildFailure(event.buildId, logs, environment)
      : undefined
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
      buildCancelling: false,
      diagnosis,
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

  removeArtifact: async (path: string) => {
    await api.deleteBuildArtifact(path)
    set((state) => ({
      artifacts: state.artifacts.filter((artifact) => artifact.path !== path),
      history: state.history.map((record) => ({
        ...record,
        artifacts: record.artifacts?.filter((artifact) => artifact.path !== path),
      })),
    }))
  },
}))
