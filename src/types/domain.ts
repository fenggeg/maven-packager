export type BuildStatus = 'IDLE' | 'RUNNING' | 'SUCCESS' | 'FAILED' | 'CANCELLED'

export type PersistedBuildStatus = 'SUCCESS' | 'FAILED' | 'CANCELLED'

export interface MavenProject {
  rootPath: string
  rootPomPath: string
  groupId?: string
  artifactId: string
  version?: string
  packaging?: string
  modules: MavenModule[]
}

export interface MavenModule {
  id: string
  name?: string
  artifactId: string
  groupId?: string
  version?: string
  packaging?: string
  relativePath: string
  pomPath: string
  children?: MavenModule[]
  errorMessage?: string
}

export interface ModuleDependencyEdge {
  fromModuleId: string
  toModuleId: string
  type: 'compile' | 'test' | 'runtime' | 'provided' | 'parent' | 'aggregation' | string
}

export interface ModuleDependencySummary {
  moduleId: string
  packaging?: string
  dependencies: string[]
  dependents: string[]
  aggregationChildren: string[]
  aggregationParent?: string
  releaseCandidateModuleIds: string[]
  requiredBuildModuleIds: string[]
  suggestedValidationModuleIds: string[]
  relatedAggregationModuleIds: string[]
  recommendedModuleIds: string[]
  hasCycle: boolean
  cyclePaths: string[][]
}

export interface ModuleDependencyGraph {
  rootPath: string
  edges: ModuleDependencyEdge[]
  summaries: ModuleDependencySummary[]
  cycles: string[][]
}

export interface GitBranch {
  name: string
  isCurrent: boolean
}

export interface GitRepositoryStatus {
  isGitRepo: boolean
  branch?: string
  branches: GitBranch[]
  upstream?: string
  aheadCount: number
  behindCount: number
  hasRemoteUpdates: boolean
  hasLocalChanges: boolean
  message?: string
}

export interface GitCommit {
  hash: string
  shortHash: string
  author: string
  date: string
  subject: string
}

export interface GitPullResult {
  success: boolean
  output: string
  status: GitRepositoryStatus
}

export interface GitSwitchBranchResult {
  success: boolean
  output: string
  status: GitRepositoryStatus
}

export interface BuildEnvironment {
  javaHome?: string
  javaVersion?: string
  javaPath?: string
  javaSource: EnvironmentSource
  mavenHome?: string
  mavenVersion?: string
  mavenPath?: string
  mavenSource: EnvironmentSource
  settingsXmlPath?: string
  settingsXmlSource: EnvironmentSource
  localRepoPath?: string
  localRepoSource: EnvironmentSource
  hasMavenWrapper: boolean
  mavenWrapperPath?: string
  useMavenWrapper: boolean
  wrapperSource: EnvironmentSource
  gitPath?: string
  gitVersion?: string
  gitSource: EnvironmentSource
  status: EnvironmentStatus
  errors: string[]
}

export type EnvironmentStatus = 'ok' | 'warning' | 'error'

export type EnvironmentSource = 'auto' | 'manual' | 'wrapper' | 'missing'

export type BuildDiagnosisCategory =
  | 'jdk_mismatch'
  | 'maven_missing'
  | 'wrapper_issue'
  | 'settings_missing'
  | 'dependency_download_failed'
  | 'repo_unreachable'
  | 'profile_invalid'
  | 'module_invalid'
  | 'test_failed'
  | 'unknown'

export interface BuildDiagnosis {
  id: string
  taskId: string
  summary: string
  category: BuildDiagnosisCategory
  possibleCauses: string[]
  suggestedActions: string[]
  keywordLines: string[]
}

export interface BuildOptions {
  projectRoot: string
  selectedModulePath: string
  goals: string[]
  profiles: string[]
  properties: Record<string, string | boolean>
  alsoMake: boolean
  skipTests: boolean
  customArgs: string[]
  editableCommand: string
}

export interface BuildArtifact {
  path: string
  fileName: string
  extension: string
  sizeBytes: number
  modifiedAt?: string
  modulePath: string
}

export type DeploymentEnvironmentKind = 'test' | 'staging' | 'production' | 'custom'

export interface ServiceMapping {
  id: string
  moduleId: string
  serviceName: string
  artifactPattern: string
  deploymentProfileId?: string
  createdAt?: string
  updatedAt?: string
}

export interface DeploymentEnvironment {
  id: string
  name: string
  kind: DeploymentEnvironmentKind
  serverId: string
  status: 'unknown' | 'idle' | 'deploying' | 'healthy' | 'failed'
  updatedAt?: string
}

export interface DeploymentConfiguration {
  id: string
  serviceMappingId: string
  environmentId: string
  deploymentProfileId: string
  serverId: string
  remoteDeployPath: string
  artifactPattern: string
  healthCheckEnabled: boolean
  updatedAt?: string
}

export interface ModuleArtifactServiceLink {
  moduleId: string
  artifactPath?: string
  artifactName?: string
  serviceMappingId?: string
  environmentId?: string
  deploymentConfigurationId?: string
}

export interface BuildCommandPayload {
  options: BuildOptions
  environment: BuildEnvironment
}

export interface StartBuildPayload {
  projectRoot: string
  command: string
  modulePath: string
  moduleArtifactId?: string
  javaHome?: string
  mavenHome?: string
  useMavenWrapper: boolean
}

export interface BuildLogEvent {
  buildId: string
  stream: 'stdout' | 'stderr' | 'system'
  line: string
}

export interface BuildFinishedEvent {
  buildId: string
  status: PersistedBuildStatus
  durationMs: number
}

export interface BuildHistoryRecord {
  id: string
  createdAt: string
  projectRoot: string
  modulePath: string
  moduleArtifactId?: string
  command: string
  status: PersistedBuildStatus
  durationMs: number
  javaHome?: string
  mavenHome?: string
  useMavenWrapper: boolean
  buildOptions?: BuildOptions
  artifacts?: BuildArtifact[]
}

export interface BuildTemplate {
  id: string
  name: string
  projectRoot: string
  modulePath: string
  goals: string[]
  profiles: string[]
  properties: Record<string, string | boolean>
  alsoMake: boolean
  skipTests: boolean
  customArgs: string[]
  useMavenWrapper: boolean
  javaHome?: string
  mavenHome?: string
  createdAt?: string
  updatedAt?: string
  pinned?: boolean
}

export type TaskStepType = 'maven_goal' | 'shell_command' | 'open_directory' | 'notify'

export interface TaskStep {
  id: string
  type: TaskStepType
  label: string
  enabled: boolean
  payload: Record<string, unknown>
}

export interface TaskPipeline {
  id: string
  name: string
  moduleIds: string[]
  steps: TaskStep[]
  createdAt?: string
  updatedAt?: string
}

export type TaskStepRunStatus = 'pending' | 'running' | 'success' | 'failed' | 'skipped'

export interface TaskStepRun {
  stepId: string
  label: string
  type: TaskStepType | string
  status: TaskStepRunStatus
  startedAt?: string
  finishedAt?: string
  message?: string
  output: string[]
}

export interface TaskPipelineRun {
  id: string
  pipelineId: string
  pipelineName: string
  projectRoot: string
  moduleIds: string[]
  status: 'running' | 'success' | 'failed'
  totalDurationMs: number
  startedAt: string
  finishedAt?: string
  steps: TaskStepRun[]
}

export interface TaskPipelineLogEvent {
  runId: string
  stepId?: string
  level: 'info' | 'error' | string
  line: string
}

export interface TaskPipelineStepEvent {
  runId: string
  step: TaskStepRun
}

export interface StartTaskPipelinePayload {
  pipeline: TaskPipeline
  projectRoot: string
  environment: BuildEnvironment
}

export interface EnvironmentSettings {
  activeProfileId?: string
  profiles: EnvironmentProfile[]
  lastProjectPath?: string
  projectPaths?: string[]
}

export interface EnvironmentProfile {
  id: string
  name: string
  javaHome?: string
  mavenHome?: string
  settingsXmlPath?: string
  localRepoPath?: string
  useMavenWrapper: boolean
  updatedAt?: string
}

export interface ServerProfile {
  id: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'private_key'
  privateKeyPath?: string
  group?: string
  passwordConfigured: boolean
  createdAt?: string
  updatedAt?: string
}

export interface SaveServerProfilePayload {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authType: 'password' | 'private_key'
  password?: string
  privateKeyPath?: string
  group?: string
}

export type DeploymentCustomCommandStage =
  | 'before_stop'
  | 'stop'
  | 'after_stop'
  | 'replace'
  | 'after_replace'
  | 'start'
  | 'after_start'
  | 'health_check'
  | 'after_health'

export interface DeploymentCustomCommand {
  id: string
  name: string
  command: string
  enabled: boolean
  stage: DeploymentCustomCommandStage
}

export interface DeploymentProfile {
  id: string
  name: string
  moduleId: string
  localArtifactPattern: string
  remoteDeployPath: string
  customCommands: DeploymentCustomCommand[]
  createdAt?: string
  updatedAt?: string
}

export interface DeploymentStage {
  key: string
  label: string
  status: 'pending' | 'running' | 'success' | 'failed' | 'skipped' | 'cancelled'
  startedAt?: string
  finishedAt?: string
  message?: string
}

export interface DeploymentTask {
  id: string
  buildTaskId?: string
  deploymentProfileId: string
  deploymentProfileName?: string
  serverId: string
  serverName?: string
  moduleId: string
  artifactPath: string
  artifactName: string
  status: 'pending' | 'uploading' | 'stopping' | 'starting' | 'checking' | 'success' | 'failed' | 'cancelled'
  log: string[]
  stages: DeploymentStage[]
  createdAt: string
  finishedAt?: string
}

export interface StartDeploymentPayload {
  deploymentProfileId: string
  serverId: string
  localArtifactPath: string
  buildTaskId?: string
}

export interface DeploymentLogEvent {
  taskId: string
  stageKey?: string
  line: string
}
