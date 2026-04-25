import {
    Alert,
    Button,
    Card,
    Checkbox,
    Empty,
    Input,
    InputNumber,
    List,
    Modal,
    Popconfirm,
    Select,
    Space,
    Steps,
    Tabs,
    Tag,
    Typography,
} from 'antd'
import {
    ArrowDownOutlined,
    ArrowUpOutlined,
    CloudServerOutlined,
    DeleteOutlined,
    DeploymentUnitOutlined,
    HistoryOutlined,
    InboxOutlined,
    PlayCircleOutlined,
    PlusOutlined,
    SaveOutlined,
    StopOutlined,
} from '@ant-design/icons'
import {useEffect, useMemo, useState} from 'react'
import {DeploymentHistoryTable} from './DeploymentHistoryTable'
import {findDeployableArtifacts, flattenModules, moduleLabel,} from '../../services/deploymentTopologyService'
import {selectLocalFile} from '../../services/tauri-api'
import {useAppStore} from '../../store/useAppStore'
import {useNavigationStore} from '../../store/navigationStore'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {
    BuildArtifact,
    DeployFailureStrategy,
    DeploymentProfile,
    DeploymentStage,
    DeployStep,
    DeployStepType,
    SaveServerProfilePayload,
    ServerProfile,
} from '../../types/domain'

const {Text} = Typography

const createServerDraft = (): SaveServerProfilePayload => ({
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'private_key',
  password: '',
  privateKeyPath: '',
  group: '',
})

const createDeploymentDraft = (): DeploymentProfile => ({
  id: crypto.randomUUID(),
  name: '',
  moduleId: '',
  localArtifactPattern: '*.jar',
  remoteDeployPath: '',
  deploymentSteps: [],
  customCommands: [],
})

const stepTypeOptions: {label: string; value: DeployStepType}[] = [
  {label: 'SSH 命令', value: 'ssh_command'},
  {label: '等待', value: 'wait'},
  {label: '端口检测', value: 'port_check'},
  {label: 'HTTP 健康检查', value: 'http_check'},
  {label: '日志关键字检测', value: 'log_check'},
  {label: '文件上传', value: 'upload_file'},
]

const failureStrategyOptions: {label: string; value: DeployFailureStrategy}[] = [
  {label: '失败即停止', value: 'stop'},
  {label: '失败后继续', value: 'continue'},
  {label: '失败后回滚', value: 'rollback'},
]

const stepTypeLabel = (type?: string) =>
  stepTypeOptions.find((item) => item.value === type)?.label ?? type ?? '部署步骤'

const createDefaultStepConfig = (type: DeployStepType): DeployStep['config'] => {
  switch (type) {
    case 'wait':
      return {waitSeconds: 10}
    case 'port_check':
      return {host: '127.0.0.1', port: 8080, checkIntervalSeconds: 3}
    case 'http_check':
      return {
        url: 'http://127.0.0.1:8080/actuator/health',
        method: 'GET',
        expectedStatusCodes: [200],
        expectedBodyContains: 'UP',
        checkIntervalSeconds: 5,
      }
    case 'log_check':
      return {
        logPath: '${remoteDeployPath}/${artifactName}.log',
        successKeywords: ['Started'],
        failureKeywords: ['Exception', 'ERROR', 'Address already in use'],
        checkIntervalSeconds: 3,
      }
    case 'upload_file':
      return {
        localPath: '${artifactPath}',
        remotePath: '${remoteDeployPath}/.${artifactName}.uploading',
        overwrite: true,
      }
    case 'ssh_command':
    default:
      return {command: '', successExitCodes: [0]}
  }
}

const createDeployStep = (type: DeployStepType, order: number, name?: string): DeployStep => ({
  id: crypto.randomUUID(),
  enabled: true,
  name: name ?? stepTypeLabel(type),
  type,
  order,
  timeoutSeconds: type === 'wait' ? undefined : type === 'http_check' || type === 'log_check' ? 90 : 60,
  retryCount: type === 'http_check' || type === 'port_check' || type === 'log_check' ? 1 : 0,
  retryIntervalSeconds: 3,
  failureStrategy: 'stop',
  config: createDefaultStepConfig(type),
})

const stepConfigRecord = (step: DeployStep) => step.config as Record<string, unknown>

const toNumberList = (value: unknown, fallback: number[]) => {
  if (Array.isArray(value)) {
    const values = value.map((item) => Number(item)).filter((item) => Number.isFinite(item))
    return values.length > 0 ? values : fallback
  }
  if (typeof value === 'string') {
    const values = value.split(',').map((item) => Number(item.trim())).filter((item) => Number.isFinite(item))
    return values.length > 0 ? values : fallback
  }
  return fallback
}

const toStringList = (value: unknown, fallback: string[] = []) => {
  if (Array.isArray(value)) {
    return value.map(String).map((item) => item.trim()).filter(Boolean)
  }
  if (typeof value === 'string') {
    return value.split(',').map((item) => item.trim()).filter(Boolean)
  }
  return fallback
}

const stepSummary = (step: DeployStep) => {
  const config = stepConfigRecord(step)
  switch (step.type) {
    case 'ssh_command':
      return String(config.command ?? '').slice(0, 90) || '未配置命令'
    case 'wait':
      return `等待 ${Number(config.waitSeconds ?? 0)} 秒`
    case 'port_check':
      return `${String(config.host ?? '')}:${Number(config.port ?? 0)}，间隔 ${Number(config.checkIntervalSeconds ?? 0)} 秒`
    case 'http_check':
      return `${String(config.method ?? 'GET')} ${String(config.url ?? '')}，期望 ${toNumberList(config.expectedStatusCodes, [200]).join(',')}`
    case 'log_check':
      return `${String(config.logPath ?? '')}，成功关键字 ${toStringList(config.successKeywords).join(', ') || '-'}`
    case 'upload_file':
      return `${String(config.localPath ?? '')} → ${String(config.remotePath ?? '')}`
    default:
      return ''
  }
}

const createSpringBootJarSteps = (): DeployStep[] => {
  const steps: DeployStep[] = [
    createDeployStep('upload_file', 10, '上传 jar 包'),
    createDeployStep('ssh_command', 20, '备份旧 jar'),
    createDeployStep('ssh_command', 30, '停止旧服务'),
    createDeployStep('wait', 40, '等待端口释放'),
    createDeployStep('ssh_command', 50, '替换 jar 文件'),
    createDeployStep('ssh_command', 60, '启动新服务'),
    createDeployStep('wait', 70, '等待服务初始化'),
    createDeployStep('port_check', 80, '检查服务端口'),
    createDeployStep('http_check', 90, 'HTTP 健康检查'),
    createDeployStep('log_check', 100, '检查启动日志'),
  ]

  steps[1].config = {command: 'if [ -f "${remoteDeployPath}/${artifactName}" ]; then cp -f "${remoteDeployPath}/${artifactName}" "${remoteDeployPath}/${artifactName}.bak"; fi', successExitCodes: [0]}
  steps[2].config = {command: 'pkill -f "${artifactName}" || true', successExitCodes: [0]}
  steps[3].config = {waitSeconds: 3}
  steps[4].config = {command: 'mv -f "${remoteDeployPath}/.${artifactName}.uploading" "${remoteDeployPath}/${artifactName}"', successExitCodes: [0]}
  steps[5].config = {command: 'nohup java -jar "${remoteDeployPath}/${artifactName}" > "${remoteDeployPath}/${artifactName}.log" 2>&1 &', successExitCodes: [0]}
  steps[6].config = {waitSeconds: 10}
  steps[7].config = {host: '127.0.0.1', port: 8080, checkIntervalSeconds: 3}
  steps[8].config = {
    url: 'http://127.0.0.1:8080/actuator/health',
    method: 'GET',
    expectedStatusCodes: [200],
    expectedBodyContains: 'UP',
    checkIntervalSeconds: 5,
  }
  steps[9].config = {
    logPath: '${remoteDeployPath}/${artifactName}.log',
    successKeywords: ['Started'],
    failureKeywords: ['Exception', 'ERROR', 'Address already in use'],
    checkIntervalSeconds: 3,
  }
  return steps
}

const deploymentStageStatus = (status: DeploymentStage['status']) => {
  switch (status) {
    case 'success': return 'finish'
    case 'failed': return 'error'
    case 'cancelled': return 'error'
    case 'timeout': return 'error'
    case 'running': return 'process'
    case 'checking': return 'process'
    case 'waiting': return 'process'
    default: return 'wait'
  }
}

const deploymentTaskFinished = (status?: string) =>
  Boolean(status && ['success', 'failed', 'cancelled'].includes(status))

const deploymentTaskLabel = (status: string) => {
  switch (status) {
    case 'success': return '部署完成'
    case 'failed': return '部署失败'
    case 'cancelled': return '已停止'
    default: return '部署中'
  }
}

const deploymentTaskColor = (status: string) => {
  switch (status) {
    case 'success': return 'green'
    case 'failed': return 'red'
    case 'cancelled': return 'orange'
    default: return 'processing'
  }
}

const defaultDeploymentStages: DeploymentStage[] = [
  {key: 'upload', label: '上传产物', type: 'upload_file', status: 'pending', logs: []},
  {key: 'start', label: '启动服务', type: 'ssh_command', status: 'pending', logs: []},
  {key: 'health', label: '健康检查', type: 'http_check', status: 'pending', logs: []},
]

const deploymentProgressCurrent = (stages: DeploymentStage[]) => {
  const activeIndex = stages.findIndex((stage) => ['running', 'checking', 'waiting'].includes(stage.status))
  if (activeIndex >= 0) {
    return activeIndex
  }
  const pendingIndex = stages.findIndex((stage) => stage.status === 'pending')
  if (pendingIndex >= 0) {
    return pendingIndex
  }
  return Math.max(stages.length - 1, 0)
}

const formatDuration = (durationMs?: number) => {
  if (!durationMs) {
    return ''
  }
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
}

const deploymentStageDescription = (stage: DeploymentStage) => {
  const parts = [
    stepTypeLabel(stage.type),
    stage.message,
    stage.durationMs ? `耗时 ${formatDuration(stage.durationMs)}` : '',
    stage.retryCount ? `重试 ${stage.currentRetry ?? 0}/${stage.retryCount}` : '',
  ].filter(Boolean)
  return parts.join(' · ')
}

const collectArtifacts = (currentArtifacts: BuildArtifact[], historyArtifacts: BuildArtifact[]) => {
  const all = [...currentArtifacts, ...historyArtifacts]
  const seen = new Set<string>()
  return all.filter((artifact) => {
    if (seen.has(artifact.path)) {
      return false
    }
    seen.add(artifact.path)
    return true
  })
}

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export function DeploymentCenterPanel() {
  const project = useAppStore((state) => state.project)
  const artifacts = useAppStore((state) => state.artifacts)
  const history = useAppStore((state) => state.history)
  const buildOptions = useAppStore((state) => state.buildOptions)
  const buildStatus = useAppStore((state) => state.buildStatus)
  const startPackageBuild = useAppStore((state) => state.startPackageBuild)
  const error = useWorkflowStore((state) => state.error)
  const serverProfiles = useWorkflowStore((state) => state.serverProfiles)
  const deploymentProfiles = useWorkflowStore((state) => state.deploymentProfiles)
  const deploymentTasks = useWorkflowStore((state) => state.deploymentTasks)
  const currentDeploymentTask = useWorkflowStore((state) => state.currentDeploymentTask)
  const saveServerProfile = useWorkflowStore((state) => state.saveServerProfile)
  const deleteServerProfile = useWorkflowStore((state) => state.deleteServerProfile)
  const saveDeploymentProfile = useWorkflowStore((state) => state.saveDeploymentProfile)
  const deleteDeploymentProfile = useWorkflowStore((state) => state.deleteDeploymentProfile)
  const startDeployment = useWorkflowStore((state) => state.startDeployment)
  const cancelDeployment = useWorkflowStore((state) => state.cancelDeployment)
  const [serverDraft, setServerDraft] = useState<SaveServerProfilePayload>(createServerDraft())
  const [deploymentDraft, setDeploymentDraft] = useState<DeploymentProfile>(createDeploymentDraft())
  const [selectedDeploymentProfileId, setSelectedDeploymentProfileId] = useState<string>()
  const [selectedServerId, setSelectedServerId] = useState<string>()
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string>()
  const [pipelineEditorOpen, setPipelineEditorOpen] = useState(false)
  const [selectedStepId, setSelectedStepId] = useState<string>()
  const deploymentPreselectProfileId = useNavigationStore((state) => state.deploymentPreselectProfileId)
  const clearDeploymentPreselect = useNavigationStore((state) => state.clearDeploymentPreselect)

  useEffect(() => {
    if (deploymentPreselectProfileId) {
      const id = deploymentPreselectProfileId
      requestAnimationFrame(() => {
        setSelectedDeploymentProfileId(id)
        clearDeploymentPreselect()
      })
    }
  }, [deploymentPreselectProfileId, clearDeploymentPreselect])

  const projectRoot = project?.rootPath ?? ''
  const modules = useMemo(() => flattenModules(project?.modules ?? []), [project?.modules])
  const moduleById = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [modules],
  )
  const artifactPool = useMemo(
    () => {
      const currentProjectRoot = projectRoot ? normalizePath(projectRoot) : ''
      const historyArtifacts = currentProjectRoot
        ? history
            .filter((item) => normalizePath(item.projectRoot) === currentProjectRoot)
            .flatMap((item) => item.artifacts ?? [])
        : []

      return collectArtifacts(artifacts, historyArtifacts)
    },
    [artifacts, history, projectRoot],
  )
  const selectedProfile = deploymentProfiles.find((item) => item.id === selectedDeploymentProfileId)
  const selectedProfileModule = selectedProfile?.moduleId ? moduleById.get(selectedProfile.moduleId) : undefined
  const selectedProfileModuleMissing = Boolean(selectedProfile?.moduleId && !selectedProfileModule)
  const selectedServer = serverProfiles.find((item) => item.id === selectedServerId)
  const deploymentStages = currentDeploymentTask?.stages.length ? currentDeploymentTask.stages : defaultDeploymentStages
  const deploymentRunning = Boolean(currentDeploymentTask && !deploymentTaskFinished(currentDeploymentTask.status))
  const buildRunning = buildStatus === 'RUNNING'
  const packageBuildGoals = buildOptions.goals.some((goal) => ['package', 'install', 'verify', 'deploy'].includes(goal))
    ? buildOptions.goals
    : Array.from(new Set([...(buildOptions.goals.length > 0 ? buildOptions.goals : ['clean']), 'package']))
  const artifactOptions = useMemo(() => {
    if (!selectedProfile || (selectedProfile.moduleId && !selectedProfileModule)) {
      return []
    }

    return findDeployableArtifacts(artifactPool, selectedProfile, modules)
      .map((artifact) => ({
        label: `${artifact.fileName}${artifact.modulePath ? ` · ${artifact.modulePath}` : ''}`,
        value: artifact.path,
      }))
  }, [artifactPool, modules, selectedProfile, selectedProfileModule])
  const showPackageArtifactHint = Boolean(selectedProfile && !selectedProfileModuleMissing && artifactOptions.length === 0)
  const packageTargetLabel = selectedProfileModule?.artifactId ?? '当前项目'
  const buildOptionSummary = [
    packageBuildGoals.join(' '),
    buildOptions.alsoMake ? '同时构建依赖' : '仅目标模块',
    buildOptions.skipTests ? '跳过测试' : '执行测试',
  ].join('；')
  const recentArtifacts = artifactPool.slice(0, 5)
  const recentDeployments = deploymentTasks.slice(0, 5)
  const deploymentSuccessCount = deploymentTasks.filter((task) => task.status === 'success').length
  const runningDeploymentCount = deploymentTasks.filter((task) => !deploymentTaskFinished(task.status)).length
  const topologyRows = deploymentProfiles.slice(0, 6)
  const deploymentSteps = useMemo(
    () => [...(deploymentDraft.deploymentSteps ?? [])].sort((left, right) => left.order - right.order),
    [deploymentDraft.deploymentSteps],
  )
  const selectedPipelineStep = deploymentSteps.find((step) => step.id === selectedStepId) ?? deploymentSteps[0]
  const enabledStepCount = (deploymentDraft.deploymentSteps ?? []).filter((step) => step.enabled).length
  const serverStatus = (serverId: string) => {
    const latestTask = deploymentTasks.find((task) => task.serverId === serverId)
    if (!latestTask) {
      return {label: '空闲', color: 'default'}
    }
    if (latestTask.status === 'success') {
      return {label: '最近成功', color: 'green'}
    }
    if (latestTask.status === 'failed') {
      return {label: '最近失败', color: 'red'}
    }
    if (latestTask.status === 'cancelled') {
      return {label: '已停止', color: 'orange'}
    }
    return {label: '部署中', color: 'processing'}
  }

  const updateDeploymentSteps = (steps: DeployStep[], nextSelectedStepId?: string) => {
    const normalized = steps
      .map((step, index) => ({...step, order: (index + 1) * 10}))
    setDeploymentDraft((state) => ({...state, deploymentSteps: normalized}))
    if (nextSelectedStepId !== undefined) {
      setSelectedStepId(nextSelectedStepId)
    } else if (selectedStepId && !normalized.some((step) => step.id === selectedStepId)) {
      setSelectedStepId(normalized[0]?.id)
    }
  }

  const addDeploymentStep = (type: DeployStepType = 'ssh_command') => {
    const nextStep = createDeployStep(type, (deploymentSteps.length + 1) * 10)
    updateDeploymentSteps([...deploymentSteps, nextStep], nextStep.id)
  }

  const patchDeploymentStep = (stepId: string, patch: Partial<DeployStep>) => {
    updateDeploymentSteps(
      deploymentSteps.map((step) => step.id === stepId ? {...step, ...patch} : step),
      stepId,
    )
  }

  const patchDeploymentStepConfig = (stepId: string, patch: Record<string, unknown>) => {
    updateDeploymentSteps(
      deploymentSteps.map((step) =>
        step.id === stepId
          ? {...step, config: {...stepConfigRecord(step), ...patch} as DeployStep['config']}
          : step),
      stepId,
    )
  }

  const removeDeploymentStep = (stepId: string) => {
    updateDeploymentSteps(deploymentSteps.filter((step) => step.id !== stepId))
  }

  const moveDeploymentStep = (stepId: string, direction: -1 | 1) => {
    const index = deploymentSteps.findIndex((step) => step.id === stepId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= deploymentSteps.length) {
      return
    }
    const next = [...deploymentSteps]
    const [removed] = next.splice(index, 1)
    next.splice(targetIndex, 0, removed)
    updateDeploymentSteps(next, stepId)
  }

  const applySpringBootTemplate = () => {
    const steps = createSpringBootJarSteps()
    updateDeploymentSteps(steps, steps[0]?.id)
    setPipelineEditorOpen(true)
  }

  const openServer = (profile: ServerProfile) => {
    setServerDraft({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authType: profile.authType,
      password: '',
      privateKeyPath: profile.privateKeyPath,
      group: profile.group,
    })
  }

  const openDeployment = (profile: DeploymentProfile) => {
    setDeploymentDraft({
      ...profile,
      deploymentSteps: profile.deploymentSteps ?? [],
      customCommands: profile.customCommands ?? [],
    })
    setSelectedStepId(profile.deploymentSteps?.[0]?.id)
  }

  const packageDeploymentArtifact = async () => {
    if (!selectedProfile || selectedProfileModuleMissing) {
      return
    }

    await startPackageBuild(selectedProfile.moduleId ? [selectedProfile.moduleId] : [])
  }

  const renderStepConfigFields = (step: DeployStep) => {
    const config = stepConfigRecord(step)
    const updateConfig = (patch: Record<string, unknown>) => patchDeploymentStepConfig(step.id, patch)

    switch (step.type) {
      case 'ssh_command':
        return (
          <>
            <div className="step-field step-field-full">
              <Text type="secondary">命令内容</Text>
              <Input.TextArea
                className="command-textarea"
                rows={4}
                value={String(config.command ?? '')}
                onChange={(event) => updateConfig({command: event.target.value})}
              />
            </div>
            <div className="step-field">
              <Text type="secondary">成功退出码</Text>
              <Input
                value={toNumberList(config.successExitCodes, [0]).join(',')}
                onChange={(event) => updateConfig({successExitCodes: toNumberList(event.target.value, [0])})}
              />
            </div>
          </>
        )
      case 'wait':
        return (
          <div className="step-field">
            <Text type="secondary">等待秒数</Text>
            <InputNumber
              min={1}
              value={Number(config.waitSeconds ?? 10)}
              onChange={(value) => updateConfig({waitSeconds: Number(value) || 1})}
            />
          </div>
        )
      case 'port_check':
        return (
          <>
            <div className="step-field">
              <Text type="secondary">主机</Text>
              <Input value={String(config.host ?? '')} onChange={(event) => updateConfig({host: event.target.value})} />
            </div>
            <div className="step-field">
              <Text type="secondary">端口</Text>
              <InputNumber min={1} max={65535} value={Number(config.port ?? 8080)} onChange={(value) => updateConfig({port: Number(value) || 8080})} />
            </div>
            <div className="step-field">
              <Text type="secondary">检测间隔（秒）</Text>
              <InputNumber min={1} value={Number(config.checkIntervalSeconds ?? 3)} onChange={(value) => updateConfig({checkIntervalSeconds: Number(value) || 1})} />
            </div>
          </>
        )
      case 'http_check':
        return (
          <>
            <div className="step-field step-field-full">
              <Text type="secondary">请求地址</Text>
              <Input value={String(config.url ?? '')} onChange={(event) => updateConfig({url: event.target.value})} />
            </div>
            <div className="step-field">
              <Text type="secondary">请求方法</Text>
              <Select
                value={String(config.method ?? 'GET')}
                options={[{label: 'GET', value: 'GET'}, {label: 'POST', value: 'POST'}]}
                onChange={(value) => updateConfig({method: value})}
              />
            </div>
            <div className="step-field">
              <Text type="secondary">期望状态码</Text>
              <Input
                value={toNumberList(config.expectedStatusCodes, [200]).join(',')}
                onChange={(event) => updateConfig({expectedStatusCodes: toNumberList(event.target.value, [200])})}
              />
            </div>
            <div className="step-field">
              <Text type="secondary">响应包含</Text>
              <Input value={String(config.expectedBodyContains ?? '')} onChange={(event) => updateConfig({expectedBodyContains: event.target.value})} />
            </div>
            <div className="step-field">
              <Text type="secondary">检测间隔（秒）</Text>
              <InputNumber min={1} value={Number(config.checkIntervalSeconds ?? 5)} onChange={(value) => updateConfig({checkIntervalSeconds: Number(value) || 1})} />
            </div>
            <div className="step-field step-field-full">
              <Text type="secondary">请求头（JSON）</Text>
              <Input.TextArea
                rows={2}
                value={JSON.stringify(config.headers ?? {}, null, 2)}
                onChange={(event) => {
                  try {
                    updateConfig({headers: JSON.parse(event.target.value || '{}')})
                  } catch {
                    updateConfig({headers: config.headers ?? {}})
                  }
                }}
              />
            </div>
            <div className="step-field step-field-full">
              <Text type="secondary">请求体</Text>
              <Input.TextArea rows={2} value={String(config.body ?? '')} onChange={(event) => updateConfig({body: event.target.value})} />
            </div>
          </>
        )
      case 'log_check':
        return (
          <>
            <div className="step-field step-field-full">
              <Text type="secondary">日志路径</Text>
              <Input value={String(config.logPath ?? '')} onChange={(event) => updateConfig({logPath: event.target.value})} />
            </div>
            <div className="step-field">
              <Text type="secondary">成功关键字</Text>
              <Input value={toStringList(config.successKeywords).join(',')} onChange={(event) => updateConfig({successKeywords: toStringList(event.target.value)})} />
            </div>
            <div className="step-field">
              <Text type="secondary">失败关键字</Text>
              <Input value={toStringList(config.failureKeywords).join(',')} onChange={(event) => updateConfig({failureKeywords: toStringList(event.target.value)})} />
            </div>
            <div className="step-field">
              <Text type="secondary">检测间隔（秒）</Text>
              <InputNumber min={1} value={Number(config.checkIntervalSeconds ?? 3)} onChange={(value) => updateConfig({checkIntervalSeconds: Number(value) || 1})} />
            </div>
          </>
        )
      case 'upload_file':
        return (
          <>
            <div className="step-field step-field-full">
              <Text type="secondary">本地文件路径</Text>
              <Input value={String(config.localPath ?? '')} onChange={(event) => updateConfig({localPath: event.target.value})} />
            </div>
            <div className="step-field step-field-full">
              <Text type="secondary">远程目标路径</Text>
              <Input value={String(config.remotePath ?? '')} onChange={(event) => updateConfig({remotePath: event.target.value})} />
            </div>
            <div className="step-field step-field-full">
              <Checkbox checked={Boolean(config.overwrite)} onChange={(event) => updateConfig({overwrite: event.target.checked})}>
                允许覆盖远程文件
              </Checkbox>
            </div>
          </>
        )
      default:
        return null
    }
  }

  return (
    <Card title="部署中心" className="panel-card" size="small">
      <Space direction="vertical" size={16} style={{width: '100%'}}>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Tabs
          items={[
            {
              key: 'overview',
              label: '首页',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <div className="deployment-summary-grid">
                    <div className="deployment-summary-tile">
                      <InboxOutlined className="deployment-summary-icon" />
                      <div>
                        <Text type="secondary">最近产物</Text>
                        <div className="deployment-summary-number">{recentArtifacts.length}</div>
                      </div>
                    </div>
                    <div className="deployment-summary-tile">
                      <HistoryOutlined className="deployment-summary-icon" />
                      <div>
                        <Text type="secondary">最近部署</Text>
                        <div className="deployment-summary-number">{deploymentTasks.length}</div>
                        <Text type="secondary">{deploymentSuccessCount} 次成功</Text>
                      </div>
                    </div>
                    <div className="deployment-summary-tile">
                      <CloudServerOutlined className="deployment-summary-icon" />
                      <div>
                        <Text type="secondary">环境状态</Text>
                        <div className="deployment-summary-number">{serverProfiles.length}</div>
                        <Text type="secondary">{runningDeploymentCount > 0 ? `${runningDeploymentCount} 个部署中` : '无运行中部署'}</Text>
                      </div>
                    </div>
                  </div>

                  <div className="deployment-overview-grid">
                    <div className="deployment-overview-block">
                      <Space size={8} className="deployment-overview-heading">
                        <InboxOutlined />
                        <Text strong>最近产物</Text>
                      </Space>
                      {recentArtifacts.length === 0 ? (
                        <Empty description="暂无构建产物" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        <List
                          size="small"
                          dataSource={recentArtifacts}
                          renderItem={(artifact) => (
                            <List.Item>
                              <Space direction="vertical" size={0} className="artifact-item">
                                <Text strong ellipsis title={artifact.fileName}>{artifact.fileName}</Text>
                                <Text type="secondary" className="artifact-meta">
                                  {artifact.modulePath || '根项目'} · {(artifact.sizeBytes / 1024 / 1024).toFixed(2)} MB
                                </Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </div>

                    <div className="deployment-overview-block">
                      <Space size={8} className="deployment-overview-heading">
                        <HistoryOutlined />
                        <Text strong>最近部署</Text>
                      </Space>
                      {recentDeployments.length === 0 ? (
                        <Empty description="暂无部署记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        <List
                          size="small"
                          dataSource={recentDeployments}
                          renderItem={(task) => (
                            <List.Item>
                              <Space direction="vertical" size={0} className="artifact-item">
                                <Space size={8} wrap>
                                  <Tag color={deploymentTaskColor(task.status)}>{deploymentTaskLabel(task.status)}</Tag>
                                  <Text strong>{task.deploymentProfileName ?? task.deploymentProfileId}</Text>
                                </Space>
                                <Text type="secondary" className="artifact-meta">
                                  {task.serverName ?? task.serverId} · {task.artifactName}
                                </Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </div>
                  </div>

                  <div className="deployment-overview-block">
                    <Space size={8} className="deployment-overview-heading">
                      <CloudServerOutlined />
                      <Text strong>环境状态</Text>
                    </Space>
                    {serverProfiles.length === 0 ? (
                      <Empty description="暂无环境服务器" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <List
                        size="small"
                        dataSource={serverProfiles}
                        renderItem={(server) => {
                          const status = serverStatus(server.id)
                          return (
                            <List.Item>
                              <Space size={8} wrap>
                                <Tag color={status.color}>{status.label}</Tag>
                                <Text strong>{server.name}</Text>
                                <Text type="secondary">
                                  {server.group || '默认环境'} · {server.username}@{server.host}:{server.port}
                                </Text>
                              </Space>
                            </List.Item>
                          )
                        }}
                      />
                    )}
                  </div>

                  <div className="deployment-overview-block">
                    <Space size={8} className="deployment-overview-heading">
                      <DeploymentUnitOutlined />
                      <Text strong>模块 → 产物 → 服务 → 环境 → 部署配置</Text>
                    </Space>
                    {topologyRows.length === 0 ? (
                      <Alert
                        type="info"
                        showIcon
                        message="尚未建立服务映射"
                        description="在“服务映射”中绑定模块、产物规则和部署配置后，构建成功即可进入部署。"
                      />
                    ) : (
                      <List
                        size="small"
                        dataSource={topologyRows}
                        renderItem={(profile) => (
                          <List.Item>
                            <Space direction="vertical" size={2} className="artifact-item">
                              <Space size={8} wrap>
                                <Tag>{moduleLabel(modules, profile.moduleId)}</Tag>
                                <Text strong>{profile.name}</Text>
                              </Space>
                              <Text type="secondary" className="artifact-meta">
                                {profile.localArtifactPattern} → {profile.name} → {profile.deploymentSteps?.length ?? 0} 个流程步骤 → {profile.remoteDeployPath || '未配置远端目录'}
                              </Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    )}
                  </div>
                </Space>
              ),
            },
            {
              key: 'server',
              label: '环境资源',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <Space wrap>
                    <Input
                      placeholder="名称"
                      value={serverDraft.name}
                      onChange={(event) => setServerDraft((state) => ({...state, name: event.target.value}))}
                    />
                    <Input
                      placeholder="Host"
                      value={serverDraft.host}
                      onChange={(event) => setServerDraft((state) => ({...state, host: event.target.value}))}
                    />
                    <Input
                      placeholder="端口"
                      style={{width: 100}}
                      value={String(serverDraft.port)}
                      onChange={(event) => setServerDraft((state) => ({...state, port: Number(event.target.value) || 22}))}
                    />
                    <Input
                      placeholder="用户名"
                      value={serverDraft.username}
                      onChange={(event) => setServerDraft((state) => ({...state, username: event.target.value}))}
                    />
                  </Space>
                  <Space wrap>
                    <Select
                      value={serverDraft.authType}
                      style={{width: 160}}
                      options={[
                        {label: '私钥认证', value: 'private_key'},
                        {label: '密码认证', value: 'password'},
                      ]}
                      onChange={(value) => setServerDraft((state) => ({...state, authType: value}))}
                    />
                    {serverDraft.authType === 'private_key' ? (
                      <Input
                        placeholder="私钥路径"
                        style={{minWidth: 280}}
                        value={serverDraft.privateKeyPath}
                        onChange={(event) => setServerDraft((state) => ({...state, privateKeyPath: event.target.value}))}
                      />
                    ) : (
                      <Input.Password
                        placeholder="密码（留空则保留原密码）"
                        style={{minWidth: 260}}
                        value={serverDraft.password}
                        onChange={(event) => setServerDraft((state) => ({...state, password: event.target.value}))}
                      />
                    )}
                    <Input
                      placeholder="分组"
                      value={serverDraft.group}
                      onChange={(event) => setServerDraft((state) => ({...state, group: event.target.value}))}
                    />
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      onClick={() => void saveServerProfile(serverDraft)}
                    >
                      保存服务器
                    </Button>
                    <Button onClick={() => setServerDraft(createServerDraft())}>重置</Button>
                  </Space>
                  {serverProfiles.length === 0 ? (
                    <Empty description="暂无服务器配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      bordered
                      dataSource={serverProfiles}
                      renderItem={(profile) => (
                        <List.Item
                          actions={[
                            <Button key="edit" size="small" onClick={() => openServer(profile)}>
                              编辑
                            </Button>,
                            <Popconfirm
                              key="delete"
                              title="删除服务器配置？"
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => void deleteServerProfile(profile.id)}
                            >
                              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                            </Popconfirm>,
                          ]}
                        >
                          <Space direction="vertical" size={2}>
                            <Text strong>{profile.name}</Text>
                            <Text type="secondary">
                              {profile.username}@{profile.host}:{profile.port}
                            </Text>
                            <Space size={8} wrap>
                              <Tag>{profile.authType}</Tag>
                              {profile.passwordConfigured ? <Tag color="gold">已保存密码</Tag> : null}
                              {profile.group ? <Tag>{profile.group}</Tag> : null}
                            </Space>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}
                </Space>
              ),
            },
            {
              key: 'profile',
              label: '服务映射',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <Input
                    addonBefore="服务名称"
                    value={deploymentDraft.name}
                    onChange={(event) => setDeploymentDraft((state) => ({...state, name: event.target.value}))}
                  />
                  <Space wrap>
                    <Select
                      placeholder="绑定模块（用于筛选产物）"
                      style={{minWidth: 260}}
                      value={deploymentDraft.moduleId || undefined}
                      options={modules.map((item) => ({
                        label: `${item.artifactId}${item.relativePath ? ` · ${item.relativePath}` : ''}`,
                        value: item.id,
                      }))}
                      onChange={(value) => setDeploymentDraft((state) => ({...state, moduleId: value}))}
                    />
                    <Input
                      placeholder="产物匹配规则，如 *.jar"
                      style={{minWidth: 220}}
                      value={deploymentDraft.localArtifactPattern}
                      onChange={(event) => setDeploymentDraft((state) => ({...state, localArtifactPattern: event.target.value}))}
                    />
                  </Space>
                  <Input
                    addonBefore="远端目录"
                    value={deploymentDraft.remoteDeployPath}
                    onChange={(event) => setDeploymentDraft((state) => ({...state, remoteDeployPath: event.target.value}))}
                  />
                  <Card
                    title="部署流程"
                    size="small"
                    className="panel-card"
                    extra={(
                      <Space wrap>
                        <Button size="small" onClick={applySpringBootTemplate}>
                          Spring Boot Jar 模板
                        </Button>
                        <Button size="small" type="primary" onClick={() => setPipelineEditorOpen(true)}>
                          配置流程
                        </Button>
                      </Space>
                    )}
                  >
                    <Space direction="vertical" size={8} style={{width: '100%'}}>
                      <Text type="secondary">
                        {enabledStepCount > 0
                          ? `已配置 ${deploymentSteps.length} 个步骤，${enabledStepCount} 个启用。`
                          : deploymentDraft.customCommands.length > 0
                            ? `旧版命令 ${deploymentDraft.customCommands.filter((item) => item.enabled).length} 条启用，保存新流程后将升级为流水线。`
                            : '尚未配置部署流程。'}
                      </Text>
                      {deploymentSteps.length > 0 ? (
                        <List
                          size="small"
                          dataSource={deploymentSteps.slice(0, 5)}
                          renderItem={(step, index) => (
                            <List.Item>
                              <Space size={8} wrap className="artifact-item">
                                <Tag>{index + 1}</Tag>
                                <Tag color={step.enabled ? 'blue' : 'default'}>{stepTypeLabel(step.type)}</Tag>
                                <Text strong>{step.name}</Text>
                                <Text type="secondary" ellipsis className="artifact-meta">{stepSummary(step)}</Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      ) : null}
                    </Space>
                  </Card>

                  <Space wrap>
                    <Button type="primary" icon={<SaveOutlined />} onClick={() => void saveDeploymentProfile(deploymentDraft)}>
                      保存服务映射
                    </Button>
                    <Button onClick={() => setDeploymentDraft(createDeploymentDraft())}>
                      新建映射
                    </Button>
                  </Space>
                  {deploymentProfiles.length === 0 ? (
                    <Empty description="暂无服务映射" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      bordered
                      dataSource={deploymentProfiles}
                      renderItem={(profile) => (
                        <List.Item
                          actions={[
                            <Button key="edit" size="small" onClick={() => openDeployment(profile)}>
                              编辑
                            </Button>,
                            <Popconfirm
                              key="delete"
                              title="删除服务映射？"
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => void deleteDeploymentProfile(profile.id)}
                            >
                              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                            </Popconfirm>,
                          ]}
                        >
                            <Space direction="vertical" size={2}>
                            <Text strong>{profile.name}</Text>
                            <Text type="secondary">
                              模块：{profile.moduleId ? (moduleById.get(profile.moduleId)?.artifactId ?? '当前项目不存在该模块') : '未绑定'}
                            </Text>
                            <Text type="secondary">{profile.remoteDeployPath}</Text>
                            <Text type="secondary">匹配：{profile.localArtifactPattern}</Text>
                            <Text type="secondary">
                              部署流程：{profile.deploymentSteps?.length
                                ? `${profile.deploymentSteps.filter((step) => step.enabled).length}/${profile.deploymentSteps.length} 个步骤启用`
                                : `${profile.customCommands.filter((c) => c.enabled).length} 条旧版命令启用`}
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}
                </Space>
              ),
            },
            {
              key: 'run',
              label: '部署执行',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <Select
                    placeholder="选择服务映射"
                    style={{minWidth: 260}}
                    value={selectedDeploymentProfileId}
                    options={deploymentProfiles.map((item) => ({label: item.name, value: item.id}))}
                    onChange={(value) => {
                      setSelectedDeploymentProfileId(value)
                      setSelectedArtifactPath(undefined)
                    }}
                  />
                  <Select
                    placeholder="选择目标服务器"
                    style={{minWidth: 260}}
                    value={selectedServerId}
                    options={serverProfiles.map((item) => ({
                      label: `${item.name}（${item.username}@${item.host}:${item.port}）`,
                      value: item.id,
                    }))}
                    onChange={setSelectedServerId}
                    notFoundContent="请先在环境资源中添加服务器"
                  />
                  <Select
                    placeholder="选择构建产物（来自配置绑定模块）"
                    style={{minWidth: 260}}
                    value={selectedArtifactPath}
                    options={artifactOptions}
                    onChange={setSelectedArtifactPath}
                    notFoundContent={
                      selectedProfile
                        ? selectedProfileModuleMissing
                          ? '服务映射绑定的模块不在当前项目中'
                          : '当前项目没有匹配该模块和规则的本地产物'
                        : '先选择服务映射'
                    }
                  />
                  {showPackageArtifactHint ? (
                    <Alert
                      type={buildRunning ? 'info' : 'warning'}
                      showIcon
                      message={buildRunning ? '正在打包产物' : '当前没有可部署产物'}
                      description={(
                        <Space direction="vertical" size={4}>
                          <Text type="secondary">
                            目标：{packageTargetLabel}；匹配规则：{selectedProfile?.localArtifactPattern || '*.jar'}
                          </Text>
                          <Text type="secondary">打包选项：{buildOptionSummary}</Text>
                        </Space>
                      )}
                      action={(
                        <Button
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          loading={buildRunning}
                          disabled={buildRunning || !projectRoot}
                          onClick={() => void packageDeploymentArtifact()}
                        >
                          打包产物
                        </Button>
                      )}
                    />
                  ) : null}
                  <Space wrap>
                    <Button
                      onClick={() => {
                        void selectLocalFile('选择要部署的本地产物').then((path) => {
                          if (path) {
                            setSelectedArtifactPath(path)
                          }
                        })
                      }}
                    >
                      手动选择产物
                    </Button>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      disabled={!selectedDeploymentProfileId || !selectedServerId || !selectedArtifactPath || selectedProfileModuleMissing || deploymentRunning}
                      onClick={() => {
                        Modal.confirm({
                          title: '确认执行部署？',
                          content: `将部署到 ${selectedServer?.name ?? '目标服务器'}（${selectedServer?.host ?? ''}），请确认配置无误。`,
                          okText: '确认部署',
                          cancelText: '取消',
                          onOk: () => startDeployment(selectedDeploymentProfileId!, selectedServerId!, selectedArtifactPath!),
                        })
                      }}
                    >
                      开始部署
                    </Button>
                    <Button
                      danger
                      icon={<StopOutlined />}
                      disabled={!deploymentRunning || !currentDeploymentTask}
                      onClick={() => {
                        if (currentDeploymentTask) {
                          void cancelDeployment(currentDeploymentTask.id)
                        }
                      }}
                    >
                      停止部署
                    </Button>
                  </Space>
                  {selectedProfile ? (
                    <Alert
                      type={selectedProfileModuleMissing ? 'warning' : 'info'}
                      showIcon
                      message={`服务映射：${selectedProfile.name}`}
                      description={`模块：${selectedProfileModule?.artifactId ?? (selectedProfile.moduleId ? '当前项目不存在该模块' : '未绑定')}；目标目录：${selectedProfile.remoteDeployPath}；匹配规则：${selectedProfile.localArtifactPattern}；部署流程：${selectedProfile.deploymentSteps?.filter((step) => step.enabled).length ?? 0} 个启用步骤${selectedServer ? `；服务器：${selectedServer.name}` : ''}`}
                    />
                  ) : null}
                  {currentDeploymentTask ? (
                    <div className="pipeline-run-bar">
                      <Space size={8} wrap className="pipeline-run-heading">
                          <Tag color={deploymentTaskColor(currentDeploymentTask.status)}>
                            {deploymentTaskLabel(currentDeploymentTask.status)}
                          </Tag>
                          <Text>{currentDeploymentTask.deploymentProfileName ?? currentDeploymentTask.deploymentProfileId}</Text>
                      </Space>
                      <Text type="secondary" className="path-text">{currentDeploymentTask.artifactPath}</Text>
                      <Steps
                        direction="vertical"
                        size="small"
                        current={deploymentProgressCurrent(deploymentStages)}
                        status={['failed', 'cancelled'].includes(currentDeploymentTask.status) ? 'error' : currentDeploymentTask.status === 'success' ? 'finish' : 'process'}
                        items={deploymentStages.map((stage) => ({
                          title: stage.label,
                          status: deploymentStageStatus(stage.status),
                          description: deploymentStageDescription(stage),
                        }))}
                      />
                    </div>
                  ) : null}
                </Space>
              ),
            },
            {
              key: 'history',
              label: '部署记录',
              children: (
                <Space direction="vertical" size={12} style={{width: '100%'}}>
                  <Alert
                    type="info"
                    showIcon
                    message="生产部署记录"
                    description="这里聚合每次部署的流水线步骤、耗时、失败原因和日志，适合上线后复盘、失败排查和重跑。"
                  />
                  <DeploymentHistoryTable />
                </Space>
              ),
            },
          ]}
        />
        <Modal
          title="部署流程配置"
          open={pipelineEditorOpen}
          width={1040}
          okText="完成"
          cancelText="关闭"
          onOk={() => setPipelineEditorOpen(false)}
          onCancel={() => setPipelineEditorOpen(false)}
        >
          <div className="deployment-pipeline-editor">
            <div className="deployment-step-list">
              <Space wrap style={{marginBottom: 10}}>
                <Button icon={<PlusOutlined />} onClick={() => addDeploymentStep('ssh_command')}>
                  添加步骤
                </Button>
                <Select
                  placeholder="按类型添加"
                  style={{width: 180}}
                  options={stepTypeOptions}
                  onChange={(value) => addDeploymentStep(value)}
                />
                <Button onClick={applySpringBootTemplate}>生成 Spring Boot 模板</Button>
              </Space>
              {deploymentSteps.length === 0 ? (
                <Empty description="暂无部署步骤" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  size="small"
                  dataSource={deploymentSteps}
                  renderItem={(step, index) => (
                    <List.Item
                      className={step.id === selectedPipelineStep?.id ? 'deployment-step-item active' : 'deployment-step-item'}
                      onClick={() => setSelectedStepId(step.id)}
                      actions={[
                        <Button key="up" size="small" type="text" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={(event) => { event.stopPropagation(); moveDeploymentStep(step.id, -1) }} />,
                        <Button key="down" size="small" type="text" icon={<ArrowDownOutlined />} disabled={index === deploymentSteps.length - 1} onClick={(event) => { event.stopPropagation(); moveDeploymentStep(step.id, 1) }} />,
                        <Popconfirm
                          key="delete"
                          title="删除该部署步骤？"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={(event) => {
                            event?.stopPropagation()
                            removeDeploymentStep(step.id)
                          }}
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} onClick={(event) => event.stopPropagation()} />
                        </Popconfirm>,
                      ]}
                    >
                      <Space direction="vertical" size={2} className="artifact-item">
                        <Space size={8} wrap>
                          <Tag>{index + 1}</Tag>
                          <Tag color={step.enabled ? 'blue' : 'default'}>{stepTypeLabel(step.type)}</Tag>
                          <Text strong ellipsis>{step.name}</Text>
                        </Space>
                        <Text type="secondary" className="artifact-meta" ellipsis title={stepSummary(step)}>
                          {stepSummary(step)}
                        </Text>
                      </Space>
                    </List.Item>
                  )}
                />
              )}
            </div>

            <div className="deployment-step-detail">
              {selectedPipelineStep ? (
                <Space direction="vertical" size={14} style={{width: '100%'}}>
                  <Space wrap>
                    <Checkbox
                      checked={selectedPipelineStep.enabled}
                      onChange={(event) => patchDeploymentStep(selectedPipelineStep.id, {enabled: event.target.checked})}
                    >
                      启用
                    </Checkbox>
                    <Select
                      style={{width: 180}}
                      value={selectedPipelineStep.type}
                      options={stepTypeOptions}
                      onChange={(value: DeployStepType) =>
                        patchDeploymentStep(selectedPipelineStep.id, {
                          type: value,
                          name: selectedPipelineStep.name || stepTypeLabel(value),
                          config: createDefaultStepConfig(value),
                        })}
                    />
                  </Space>
                  <div className="step-card-body">
                    <div className="step-field step-field-full">
                      <Text type="secondary">步骤名称</Text>
                      <Input
                        value={selectedPipelineStep.name}
                        onChange={(event) => patchDeploymentStep(selectedPipelineStep.id, {name: event.target.value})}
                      />
                    </div>
                    <div className="step-field">
                      <Text type="secondary">超时时间（秒）</Text>
                      <InputNumber
                        min={1}
                        value={selectedPipelineStep.timeoutSeconds}
                        onChange={(value) => patchDeploymentStep(selectedPipelineStep.id, {timeoutSeconds: Number(value) || undefined})}
                      />
                    </div>
                    <div className="step-field">
                      <Text type="secondary">重试次数</Text>
                      <InputNumber
                        min={0}
                        value={selectedPipelineStep.retryCount ?? 0}
                        onChange={(value) => patchDeploymentStep(selectedPipelineStep.id, {retryCount: Number(value) || 0})}
                      />
                    </div>
                    <div className="step-field">
                      <Text type="secondary">重试间隔（秒）</Text>
                      <InputNumber
                        min={1}
                        value={selectedPipelineStep.retryIntervalSeconds ?? 3}
                        onChange={(value) => patchDeploymentStep(selectedPipelineStep.id, {retryIntervalSeconds: Number(value) || 1})}
                      />
                    </div>
                    <div className="step-field">
                      <Text type="secondary">失败策略</Text>
                      <Select
                        value={selectedPipelineStep.failureStrategy ?? 'stop'}
                        options={failureStrategyOptions}
                        onChange={(value) => patchDeploymentStep(selectedPipelineStep.id, {failureStrategy: value})}
                      />
                    </div>
                    {renderStepConfigFields(selectedPipelineStep)}
                  </div>
                </Space>
              ) : (
                <Empty description="选择左侧步骤进行配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              )}
            </div>
          </div>
        </Modal>
      </Space>
    </Card>
  )
}
