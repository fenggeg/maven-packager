import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { open } from '@tauri-apps/plugin-dialog'
import type {
  BuildCommandPayload,
  BuildEnvironment,
  BuildFinishedEvent,
  BuildHistoryRecord,
  BuildLogEvent,
  BuildOptions,
  BuildTemplate,
  EnvironmentSettings,
  MavenProject,
  StartBuildPayload,
} from '../types/domain'

type TauriWindow = Window & { __TAURI_INTERNALS__?: unknown }

const inTauri = () =>
  typeof window !== 'undefined' &&
  Boolean((window as TauriWindow).__TAURI_INTERNALS__)

const requireTauri = () => {
  if (!inTauri()) {
    throw new Error('请在 Tauri 桌面应用中使用本功能。')
  }
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

  detectEnvironment: (rootPath: string) =>
    invoke<BuildEnvironment>('detect_environment', { rootPath }),

  loadEnvironmentSettings: () =>
    invoke<EnvironmentSettings>('load_environment_settings'),

  saveEnvironmentSettings: (settings: EnvironmentSettings) =>
    invoke<void>('save_environment_settings', { settings }),

  saveLastProjectPath: (rootPath: string) =>
    invoke<void>('save_last_project_path', { rootPath }),

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

  openPathInExplorer: (path: string) =>
    invoke<void>('open_path_in_explorer', { path }),
}

export async function registerBuildEvents(
  onLog: (event: BuildLogEvent) => void,
  onFinished: (event: BuildFinishedEvent) => void,
) {
  if (!inTauri()) {
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
