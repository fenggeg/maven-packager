import {invoke} from '@tauri-apps/api/core'
import {listen} from '@tauri-apps/api/event'
import {BundleType, getBundleType, getVersion} from '@tauri-apps/api/app'
import {open} from '@tauri-apps/plugin-dialog'
import {relaunch} from '@tauri-apps/plugin-process'
import {check, type DownloadEvent, type Update} from '@tauri-apps/plugin-updater'
import type {
    BuildArtifact,
    BuildCommandPayload,
    BuildEnvironment,
    BuildFinishedEvent,
    BuildHistoryRecord,
    BuildLogEvent,
    BuildOptions,
    BuildTemplate,
    DeploymentLogEvent,
    DeploymentProfile,
    DeploymentTask,
    EnvironmentSettings,
    GitCommit,
    GitPullResult,
    GitRepositoryStatus,
    GitSwitchBranchResult,
    MavenProject,
    ModuleDependencyGraph,
    SaveServerProfilePayload,
    ServerProfile,
    StartBuildPayload,
    StartDeploymentPayload,
} from '../types/domain'

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown }

export type AppUpdateDownloadEvent = DownloadEvent

export const isTauriRuntime = () =>
  typeof window !== 'undefined' &&
  Boolean((window as TauriWindow).__TAURI_INTERNALS__)

const requireTauri = () => {
  if (!isTauriRuntime()) {
    throw new Error('请在 Tauri 桌面应用中使用本功能。')
  }
}

const getWindowsUpdaterTarget = async () => {
  try {
    const bundleType = await getBundleType()

    if (bundleType === BundleType.Nsis) {
      return 'windows-x86_64-nsis'
    }

    if (bundleType === BundleType.Msi) {
      return 'windows-x86_64-msi'
    }
  } catch {
    return undefined
  }

  return undefined
}

export async function checkForAppUpdate(): Promise<Update | null> {
  requireTauri()
  const target = await getWindowsUpdaterTarget()

  return check({
    timeout: 30000,
    ...(target ? { target } : {}),
  })
}

export async function getCurrentAppVersion(): Promise<string> {
  requireTauri()
  return getVersion()
}

export async function installAppUpdate(
  update: Update,
  onEvent: (event: DownloadEvent) => void,
  onDownloaded?: () => void,
): Promise<void> {
  requireTauri()
  await update.download(onEvent, { timeout: 300000 })
  onDownloaded?.()
  await update.install()
  await relaunch()
}

export async function selectProjectDirectory(): Promise<string | null> {
  requireTauri()
  const selected = await open({
    directory: true,
    multiple: false,
    title: '选择 Maven 多模块项目根目录',
  })

  return typeof selected === 'string' ? selected : null
}

export async function selectLocalDirectory(title: string): Promise<string | null> {
  requireTauri()
  const selected = await open({
    directory: true,
    multiple: false,
    title,
  })

  return typeof selected === 'string' ? selected : null
}

export async function selectLocalFile(title: string): Promise<string | null> {
  requireTauri()
  const selected = await open({
    directory: false,
    multiple: false,
    title,
  })

  return typeof selected === 'string' ? selected : null
}

export const api = {
  parseMavenProject: (rootPath: string) =>
    invoke<MavenProject>('parse_maven_project', { rootPath }),

  analyzeProjectDependencies: (rootPath: string) =>
    invoke<ModuleDependencyGraph>('analyze_project_dependencies', { rootPath }),

  detectEnvironment: (rootPath: string) =>
    invoke<BuildEnvironment>('detect_environment', { rootPath }),

  loadEnvironmentSettings: () =>
    invoke<EnvironmentSettings>('load_environment_settings'),

  saveEnvironmentSettings: (settings: EnvironmentSettings) =>
    invoke<void>('save_environment_settings', { settings }),

  saveLastProjectPath: (rootPath: string) =>
    invoke<void>('save_last_project_path', { rootPath }),

  removeSavedProjectPath: (rootPath: string) =>
    invoke<EnvironmentSettings>('remove_saved_project_path', { rootPath }),

  buildCommandPreview: (payload: BuildCommandPayload) =>
    invoke<string>('build_command_preview', { payload }),

  startBuild: (payload: StartBuildPayload) =>
    invoke<string>('start_build', { payload }),

  cancelBuild: (buildId: string) => invoke<void>('cancel_build', { buildId }),

  listBuildHistory: () => invoke<BuildHistoryRecord[]>('list_build_history'),

  saveBuildHistory: (record: BuildHistoryRecord) =>
    invoke<void>('save_build_history', { record }),

  listTemplates: () => invoke<BuildTemplate[]>('list_templates'),

  saveTemplate: (template: BuildTemplate) =>
    invoke<void>('save_template', { template }),

  deleteTemplate: (templateId: string) =>
    invoke<void>('delete_template', { templateId }),

  listServerProfiles: () => invoke<ServerProfile[]>('list_server_profiles'),

  saveServerProfile: (payload: SaveServerProfilePayload) =>
    invoke<ServerProfile>('save_server_profile', { payload }),

  deleteServerProfile: (serverId: string) =>
    invoke<void>('delete_server_profile', { serverId }),

  listDeploymentProfiles: () =>
    invoke<DeploymentProfile[]>('list_deployment_profiles'),

  saveDeploymentProfile: (profile: DeploymentProfile) =>
    invoke<DeploymentProfile>('save_deployment_profile', { profile }),

  deleteDeploymentProfile: (profileId: string) =>
    invoke<void>('delete_deployment_profile', { profileId }),

  listDeploymentTasks: () =>
    invoke<DeploymentTask[]>('list_deployment_tasks'),

  startDeployment: (payload: StartDeploymentPayload) =>
    invoke<string>('start_deployment', { payload }),

  cancelDeployment: (taskId: string) =>
    invoke<void>('cancel_deployment', { taskId }),

  deleteDeploymentTask: (taskId: string) =>
    invoke<void>('delete_deployment_task', { taskId }),

  openPathInExplorer: (path: string) =>
    invoke<void>('open_path_in_explorer', { path }),

  scanBuildArtifacts: (projectRoot: string, modulePath: string) =>
    invoke<BuildArtifact[]>('scan_build_artifacts', { projectRoot, modulePath }),

  deleteBuildArtifact: (path: string) =>
    invoke<void>('delete_build_artifact', { path }),

  checkGitStatus: (rootPath: string) =>
    invoke<GitRepositoryStatus>('check_git_status', { rootPath }),

  listGitCommits: (rootPath: string, limit = 30) =>
    invoke<GitCommit[]>('list_git_commits', { rootPath, limit }),

  fetchGitUpdates: (rootPath: string) =>
    invoke<GitRepositoryStatus>('fetch_git_updates', { rootPath }),

  pullGitUpdates: (rootPath: string) =>
    invoke<GitPullResult>('pull_git_updates', { rootPath }),

  switchGitBranch: (rootPath: string, branchName: string) =>
    invoke<GitSwitchBranchResult>('switch_git_branch', { rootPath, branchName }),
}

export async function registerBuildEvents(
  onLog: (event: BuildLogEvent) => void,
  onFinished: (event: BuildFinishedEvent) => void,
) {
  if (!isTauriRuntime()) {
    return () => undefined
  }

  const unlistenLog = await listen<BuildLogEvent>('build-log', (event) => {
    onLog(event.payload)
  })
  const unlistenFinished = await listen<BuildFinishedEvent>(
    'build-finished',
    (event) => {
      onFinished(event.payload)
    },
  )

  return () => {
    unlistenLog()
    unlistenFinished()
  }
}

export async function registerDeploymentEvents(
  onLog: (event: DeploymentLogEvent) => void,
  onUpdated: (event: DeploymentTask) => void,
  onFinished: (event: DeploymentTask) => void,
) {
  if (!isTauriRuntime()) {
    return () => undefined
  }

  const unlistenLog = await listen<DeploymentLogEvent>('deployment-log', (event) => {
    onLog(event.payload)
  })
  const unlistenUpdated = await listen<DeploymentTask>('deployment-updated', (event) => {
    onUpdated(event.payload)
  })
  const unlistenFinished = await listen<DeploymentTask>('deployment-finished', (event) => {
    onFinished(event.payload)
  })

  return () => {
    unlistenLog()
    unlistenUpdated()
    unlistenFinished()
  }
}

export function createDefaultBuildOptions(
  projectRoot = '',
  selectedModulePath = '',
): BuildOptions {
  return {
    projectRoot,
    selectedModulePath,
    goals: ['clean', 'package'],
    profiles: [],
    properties: {},
    alsoMake: true,
    skipTests: true,
    customArgs: [],
    editableCommand: '',
  }
}
