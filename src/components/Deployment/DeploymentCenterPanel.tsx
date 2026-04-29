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
  Progress,
  Select,
  Space,
  Steps,
  Table,
  Tabs,
  Tag,
  Tooltip,
  Typography,
} from 'antd'
import {
  ArrowDownOutlined,
  ArrowUpOutlined,
  CloudServerOutlined,
  DeleteOutlined,
  DeploymentUnitOutlined,
  EditOutlined,
  HistoryOutlined,
  InboxOutlined,
  PlayCircleOutlined,
  PlusOutlined,
  SaveOutlined,
  SearchOutlined,
  StopOutlined,
} from '@ant-design/icons'
import {memo, useEffect, useMemo, useState} from 'react'
import {DeploymentHistoryTable} from './DeploymentHistoryTable'
import {
  belongsToProject,
  findDeployableArtifacts,
  findProfileModule,
  flattenModules,
  normalizeProjectRoot,
  profileModuleLabel,
} from '../../services/deploymentTopologyService'
import {api, selectLocalFile} from '../../services/tauri-api'
import {useAppStore} from '../../store/useAppStore'
import {useNavigationStore} from '../../store/navigationStore'
import {useUploadProgressStore} from '../../store/useUploadProgressStore'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {
  BackupConfig,
  BuildArtifact,
  DeployFailureStrategy,
  DeploymentProfile,
  DeploymentStage,
  DeployStep,
  DeployStepType,
  LogNamingMode,
  ProbeStatus,
  SaveServerProfilePayload,
  ServerProfile,
  StartupProbeConfig,
} from '../../types/domain'

const {Text} = Typography

interface DeploymentTemplate {
  id: string
  name: string
  description: string
  steps: DeployStep[]
  builtin?: boolean
  updatedAt?: string
}

type FormMode = 'create' | 'edit'

const DEPLOYMENT_TEMPLATE_STORAGE_KEY = 'maven-packager.deploymentTemplates.v1'

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

const createDefaultStartupProbe = (): StartupProbeConfig => ({
  enabled: true,
  timeoutSeconds: 120,
  intervalSeconds: 3,
  processProbe: {enabled: true},
  portProbe: {enabled: true, host: '127.0.0.1', port: 8080, consecutiveSuccesses: 2},
  httpProbe: {enabled: false, method: 'GET', consecutiveSuccesses: 2},
  logProbe: {
    enabled: true,
    successPatterns: ['Started'],
    failurePatterns: [
      'APPLICATION FAILED TO START',
      'Application run failed',
      'Port already in use',
      'Web server failed to start',
      'Address already in use',
      'BindException',
      'OutOfMemoryError',
    ],
    warningPatterns: ['Exception', 'ERROR'],
    useRegex: false,
    onlyCurrentDeployLog: true,
  },
  successPolicy: 'health_first',
})

const createDefaultBackupConfig = (): BackupConfig => ({
  enabled: true,
  backupDir: '',
  retentionCount: 5,
  autoRollback: false,
  restartAfterRollback: false,
})

const createDeploymentDraft = (): DeploymentProfile => ({
  id: crypto.randomUUID(),
  name: '',
  projectRoot: '',
  moduleId: '',
  modulePath: '',
  moduleArtifactId: '',
  localArtifactPattern: '*.jar',
  remoteArtifactName: '',
  remoteDeployPath: '',
  serviceDescription: '',
  serviceAlias: '',
  javaBinPath: '',
  jvmOptions: '',
  springProfile: '',
  extraArgs: '',
  workingDir: '',
  logPath: '',
  logNamingMode: 'date',
  logName: '',
  logEncoding: 'UTF-8',
  enableDeployLog: true,
  backupConfig: createDefaultBackupConfig(),
  deploymentSteps: [],
  customCommands: [],
  startupProbe: createDefaultStartupProbe(),
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
        logPath: '${logFile}',
        successKeywords: ['Started'],
        failureKeywords: [
          'APPLICATION FAILED TO START',
          'Application run failed',
          'Port already in use',
          'Web server failed to start',
          'Address already in use',
          'BindException',
          'OutOfMemoryError',
        ],
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

const stopPortOwnerFragment =
  'if [ -n "${portProbePort}" ]; then echo "端口 Java 进程清理：${portProbePort}"; find_port_pids() { if command -v lsof >/dev/null 2>&1; then lsof -nP -t -iTCP:${portProbePort} -sTCP:LISTEN 2>/dev/null; elif command -v ss >/dev/null 2>&1; then ss -ltnp 2>/dev/null | awk \'$4 ~ /:${portProbePort}$/ {print}\' | grep -o "pid=[0-9]*" | cut -d= -f2; elif command -v fuser >/dev/null 2>&1; then fuser -n tcp ${portProbePort} 2>/dev/null; else PORT_HEX=$(printf "%04X" ${portProbePort}); INODES=$(awk -v p=":$PORT_HEX" \'$4=="0A" && toupper($2) ~ p"$" {gsub(/\\r/,"",$10); print $10}\' /proc/net/tcp /proc/net/tcp6 2>/dev/null | sort -u); for inode in $INODES; do for fd in /proc/[0-9]*/fd/*; do link=$(readlink "$fd" 2>/dev/null || true); if [ "$link" = "socket:[$inode]" ]; then pid=${fd#/proc/}; echo "${pid%%/*}"; fi; done; done; fi; }; java_port_pids() { for pid in $(find_port_pids | tr " " "\\n" | sed "/^$/d" | sort -u); do CMD=$(tr "\\0" " " < "/proc/$pid/cmdline" 2>/dev/null || ps -p "$pid" -o args= 2>/dev/null || true); COMM=$(cat "/proc/$pid/comm" 2>/dev/null || true); if echo "$COMM $CMD" | grep -qi "java"; then echo "$pid"; else echo "端口 ${portProbePort} 被非 Java 进程 PID $pid 占用，跳过查杀" >&2; fi; done; }; JAVA_PIDS=$(java_port_pids | tr " " "\\n" | sed "/^$/d" | sort -u | tr "\\n" " "); if [ -n "$JAVA_PIDS" ]; then echo "端口 ${portProbePort} 被 Java PID $JAVA_PIDS 占用，直接查杀"; kill $JAVA_PIDS 2>/dev/null || true; sleep 2; fi; JAVA_PIDS=$(java_port_pids | tr " " "\\n" | sed "/^$/d" | sort -u | tr "\\n" " "); if [ -n "$JAVA_PIDS" ]; then echo "端口 ${portProbePort} Java PID $JAVA_PIDS 仍存活，强制查杀"; kill -9 $JAVA_PIDS 2>/dev/null || true; sleep 1; fi; REMAINING=$(find_port_pids | tr " " "\\n" | sed "/^$/d" | sort -u | tr "\\n" " "); if [ -n "$REMAINING" ]; then echo "端口 ${portProbePort} 仍被 PID $REMAINING 占用，无法启动新服务"; exit 1; fi; else echo "未配置端口清理，跳过端口占用处理"; fi'

const springBootStopCommand =
  `PID_FILE="\${pidFile}"; if [ -f "$PID_FILE" ]; then PID=$(cat "$PID_FILE"); if [ -n "$PID" ]; then echo "====== 停止服务进程 PID=$PID"; kill -9 "$PID" 2>/dev/null || true; fi; rm -f "$PID_FILE"; fi; pkill -9 -f "\${remoteDeployPath}/\${remoteArtifactName}" 2>/dev/null || true; ${stopPortOwnerFragment}`

const springBootStartCommand =
  'mkdir -p "${logDir}" && cd "${serviceDir}" || exit 1; nohup "${javaBin}" ${jvmOptions} -jar "${remoteDeployPath}/${remoteArtifactName}" ${springProfile} ${extraArgs} > "${logFile}" 2>&1 & PID=$!; echo "$PID" > "${pidFile}"; echo "${logFile}" > "${logPathFile}"; sleep 1; if ! ps -p "$PID" > /dev/null 2>&1; then echo "服务进程启动后立即退出"; tail -n 80 "${logFile}" 2>/dev/null || true; exit 1; fi; echo "PID=$PID; LOG_FILE=${logFile}"'

const createSpringBootJarSteps = (): DeployStep[] => {
  const steps: DeployStep[] = [
    createDeployStep('upload_file', 10, '上传 jar 包'),
    createDeployStep('ssh_command', 20, '备份旧 jar'),
    createDeployStep('ssh_command', 30, '停止旧服务'),
    createDeployStep('wait', 40, '等待端口释放'),
    createDeployStep('ssh_command', 50, '替换 jar 文件'),
    createDeployStep('ssh_command', 60, '启动新服务'),
  ]

  steps[1].config = {command: 'if [ -f "${remoteDeployPath}/${remoteArtifactName}" ]; then cp -f "${remoteDeployPath}/${remoteArtifactName}" "${remoteDeployPath}/${remoteArtifactName}.${timestamp}"; fi', successExitCodes: [0]}
  steps[2].config = {command: springBootStopCommand, successExitCodes: [0]}
  steps[3].config = {waitSeconds: 3}
  steps[4].config = {command: 'mv -f "${remoteDeployPath}/.${artifactName}.uploading" "${remoteDeployPath}/${remoteArtifactName}"', successExitCodes: [0]}
  steps[5].config = {command: springBootStartCommand, successExitCodes: [0]}
  return steps
}

const createTomcatWarSteps = (): DeployStep[] => {
  const steps: DeployStep[] = [
    createDeployStep('upload_file', 10, '上传 war 包'),
    createDeployStep('ssh_command', 20, '停止 Tomcat'),
    createDeployStep('ssh_command', 30, '备份旧包'),
    createDeployStep('ssh_command', 40, '替换 war 包'),
    createDeployStep('ssh_command', 50, '启动 Tomcat'),
    createDeployStep('http_check', 60, 'HTTP 验证'),
  ]
  steps[0].config = {localPath: '${artifactPath}', remotePath: '${remoteDeployPath}/.${artifactName}.uploading', overwrite: true}
  steps[1].config = {command: `if [ ! -x "\${remoteDeployPath}/bin/shutdown.sh" ]; then echo "缺少 Tomcat shutdown.sh 或没有执行权限"; exit 1; fi; "\${remoteDeployPath}/bin/shutdown.sh" || true; sleep 5; ${stopPortOwnerFragment}`, successExitCodes: [0]}
  steps[2].config = {command: 'if [ -f "${remoteDeployPath}/webapps/${remoteArtifactName}" ]; then cp -f "${remoteDeployPath}/webapps/${remoteArtifactName}" "${remoteDeployPath}/webapps/${remoteArtifactName}.${timestamp}"; fi', successExitCodes: [0]}
  steps[3].config = {command: 'mkdir -p "${remoteDeployPath}/webapps" && mv -f "${remoteDeployPath}/.${artifactName}.uploading" "${remoteDeployPath}/webapps/${remoteArtifactName}"', successExitCodes: [0]}
  steps[4].config = {command: 'if [ ! -x "${remoteDeployPath}/bin/startup.sh" ]; then echo "缺少 Tomcat startup.sh 或没有执行权限"; exit 1; fi; "${remoteDeployPath}/bin/startup.sh"', successExitCodes: [0]}
  steps[5].config = {url: 'http://127.0.0.1:8080/', method: 'GET', expectedStatusCodes: [200, 302], expectedBodyContains: '', checkIntervalSeconds: 5}
  return steps
}

const createStaticFileSteps = (): DeployStep[] => {
  const steps: DeployStep[] = [
    createDeployStep('upload_file', 10, '上传静态包'),
    createDeployStep('ssh_command', 20, '备份当前目录'),
    createDeployStep('ssh_command', 30, '解压并替换'),
    createDeployStep('http_check', 40, '站点验证'),
  ]
  steps[0].config = {localPath: '${artifactPath}', remotePath: '${remoteDeployPath}/.${artifactName}.uploading', overwrite: true}
  steps[1].config = {command: 'if [ -d "${remoteDeployPath}/current" ]; then cp -a "${remoteDeployPath}/current" "${remoteDeployPath}/backup-${timestamp}"; fi', successExitCodes: [0]}
  steps[2].config = {command: 'test -n "${remoteDeployPath}" && test "${remoteDeployPath}" != "/" && rm -rf "${remoteDeployPath}/next" && mkdir -p "${remoteDeployPath}/next" && unzip -oq "${remoteDeployPath}/.${artifactName}.uploading" -d "${remoteDeployPath}/next" && rm -rf "${remoteDeployPath}/current" && mv "${remoteDeployPath}/next" "${remoteDeployPath}/current"', successExitCodes: [0]}
  steps[3].config = {url: 'http://127.0.0.1/', method: 'GET', expectedStatusCodes: [200], expectedBodyContains: '', checkIntervalSeconds: 5}
  return steps
}

const cloneDeploySteps = (steps: DeployStep[]) =>
  steps.map((step, index) => ({
    ...step,
    id: crypto.randomUUID(),
    order: (index + 1) * 10,
    config: JSON.parse(JSON.stringify(step.config)) as DeployStep['config'],
  }))

const builtinDeploymentTemplates = (): DeploymentTemplate[] => [
  {
    id: 'builtin-spring-boot-jar',
    name: 'Spring Boot Jar 滚动替换',
    description: '上传、备份、停止旧进程、替换 Jar、nohup 启动并写入 PID/日志指针。',
    steps: createSpringBootJarSteps(),
    builtin: true,
  },
  {
    id: 'builtin-tomcat-war',
    name: 'Tomcat War 替换',
    description: '适用于独立 Tomcat：停服、备份 webapps、替换 War、启动后 HTTP 验证。',
    steps: createTomcatWarSteps(),
    builtin: true,
  },
  {
    id: 'builtin-static-files',
    name: '静态站点压缩包发布',
    description: '上传 zip、备份 current、解压替换并验证站点首页。',
    steps: createStaticFileSteps(),
    builtin: true,
  },
]

const loadDeploymentTemplates = (): DeploymentTemplate[] => {
  if (typeof window === 'undefined') {
    return builtinDeploymentTemplates()
  }
  try {
    const saved = JSON.parse(window.localStorage.getItem(DEPLOYMENT_TEMPLATE_STORAGE_KEY) ?? '[]') as DeploymentTemplate[]
    return [...builtinDeploymentTemplates(), ...saved.filter((item) => !item.builtin)]
  } catch {
    return builtinDeploymentTemplates()
  }
}

const saveCustomDeploymentTemplates = (templates: DeploymentTemplate[]) => {
  window.localStorage.setItem(
    DEPLOYMENT_TEMPLATE_STORAGE_KEY,
    JSON.stringify(templates.filter((item) => !item.builtin)),
  )
}

const createTemplateDraft = (): DeploymentTemplate => ({
  id: crypto.randomUUID(),
  name: '',
  description: '',
  steps: createSpringBootJarSteps(),
  updatedAt: new Date().toISOString(),
})

const probeStatusMeta = (status: string) => {
  switch (status) {
    case 'success': return {label: '通过', color: 'green'}
    case 'alive': return {label: '存活', color: 'green'}
    case 'open': return {label: '已监听', color: 'green'}
    case 'failed': return {label: '失败', color: 'red'}
    case 'dead': return {label: '已退出', color: 'red'}
    case 'closed': return {label: '未监听', color: 'red'}
    case 'warning': return {label: '告警', color: 'gold'}
    case 'checking': return {label: '检测中', color: 'processing'}
    case 'unknown': return {label: '未知', color: 'default'}
    default: return {label: status, color: 'default'}
  }
}

const probeTypeLabel = (type: string) => {
  switch (type) {
    case 'process': return '进程探针'
    case 'port': return '端口探针'
    case 'http': return 'HTTP 探针'
    case 'log': return '日志探针'
    case 'timeout': return '超时'
    default: return type
  }
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
  Boolean(status && ['success', 'failed', 'timeout', 'cancelled'].includes(status))

const deploymentTaskLabel = (status: string) => {
  switch (status) {
    case 'success': return '部署完成'
    case 'failed': return '部署失败'
    case 'timeout': return '部署超时'
    case 'cancelled': return '已停止'
    case 'waiting': return '等待中'
    default: return '部署中'
  }
}

const deploymentTaskColor = (status: string) => {
  switch (status) {
    case 'success': return 'green'
    case 'failed': return 'red'
    case 'timeout': return 'red'
    case 'cancelled': return 'orange'
    case 'waiting': return 'processing'
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

const formatUploadBytes = (bytes: number) => {
  if (bytes >= 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024 * 1024)).toFixed(1)} GB`
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`
  return `${bytes} B`
}

const UploadStepDescription = memo(function UploadStepDescription({
  taskId,
  stage,
}: {
  taskId: string
  stage: DeploymentStage
}) {
  const progress = useUploadProgressStore((state) => state.progressByTaskId[taskId])
  const isUploading = stage.type === 'upload_file' && (stage.status === 'running' || stage.status === 'pending')
  if (isUploading && progress && progress.percent < 100) {
    const speedText = progress.speedBytesPerSecond
      ? `，${formatUploadBytes(progress.speedBytesPerSecond)}/s`
      : ''
    return (
      <Space direction="vertical" size={2} style={{width: '100%'}}>
        <Progress percent={Math.floor(progress.percent)} size="small" />
        <Text type="secondary">
          {Math.floor(progress.percent)}% · {formatUploadBytes(progress.uploadedBytes)} / {formatUploadBytes(progress.totalBytes)}{speedText}
        </Text>
      </Space>
    )
  }
  return <span>{deploymentStageDescription(stage)}</span>
})

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
  const deleteServerProfile = useWorkflowStore((state) => state.deleteServerProfile)
  const testServerConnection = useWorkflowStore((state) => state.testServerConnection)
  const saveDeploymentProfile = useWorkflowStore((state) => state.saveDeploymentProfile)
  const deleteDeploymentProfile = useWorkflowStore((state) => state.deleteDeploymentProfile)
  const refreshDeploymentData = useWorkflowStore((state) => state.refreshDeploymentData)
  const startDeployment = useWorkflowStore((state) => state.startDeployment)
  const cancelDeployment = useWorkflowStore((state) => state.cancelDeployment)
  const [serverDraft, setServerDraft] = useState<SaveServerProfilePayload>(createServerDraft())
  const [serverFormMode, setServerFormMode] = useState<FormMode>('create')
  const [serverEditorOpen, setServerEditorOpen] = useState(false)
  const [deploymentDraft, setDeploymentDraft] = useState<DeploymentProfile>(createDeploymentDraft())
  const [deploymentFormMode, setDeploymentFormMode] = useState<FormMode>('create')
  const [deploymentEditorOpen, setDeploymentEditorOpen] = useState(false)
  const [selectedDeploymentProfileId, setSelectedDeploymentProfileId] = useState<string>()
  const [selectedServerId, setSelectedServerId] = useState<string>()
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string>()
  const [pendingDeployAfterBuild, setPendingDeployAfterBuild] = useState<{profileId: string; serverId: string}>()
  const [serverPickerOpen, setServerPickerOpen] = useState(false)
  const [serverPickerKeyword, setServerPickerKeyword] = useState('')
  const [pipelineEditorOpen, setPipelineEditorOpen] = useState(false)
  const [pipelineEditorTarget, setPipelineEditorTarget] = useState<'deployment' | 'template'>('deployment')
  const [selectedStepId, setSelectedStepId] = useState<string>()
  const [testingServerId, setTestingServerId] = useState<string>()
  const [testResult, setTestResult] = useState<{serverId: string; success: boolean; message: string}>()
  const [deploymentTemplates, setDeploymentTemplates] = useState<DeploymentTemplate[]>(loadDeploymentTemplates)
  const [templateDraft, setTemplateDraft] = useState<DeploymentTemplate>(createTemplateDraft())
  const [templateFormMode, setTemplateFormMode] = useState<FormMode>('create')
  const [templateEditorOpen, setTemplateEditorOpen] = useState(false)
  const [selectedTemplateStepId, setSelectedTemplateStepId] = useState<string>()
  const [activeDeploymentTab, setActiveDeploymentTab] = useState('overview')
  const [serverListKeyword, setServerListKeyword] = useState('')
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
  const currentProjectDeploymentProfiles = useMemo(
    () => deploymentProfiles.filter((profile) => belongsToProject(profile, projectRoot)),
    [deploymentProfiles, projectRoot],
  )
  const currentProjectDeploymentTasks = useMemo(
    () => deploymentTasks.filter((task) => normalizeProjectRoot(task.projectRoot) === normalizeProjectRoot(projectRoot)),
    [deploymentTasks, projectRoot],
  )
  const visibleDeploymentTask = currentDeploymentTask
    && normalizeProjectRoot(currentDeploymentTask.projectRoot) === normalizeProjectRoot(projectRoot)
    ? currentDeploymentTask
    : undefined
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
  const selectedProfile = currentProjectDeploymentProfiles.find((item) => item.id === selectedDeploymentProfileId)
  const selectedProfileModule = selectedProfile ? findProfileModule(modules, selectedProfile) : undefined
  const selectedProfileModuleMissing = Boolean((selectedProfile?.moduleId || selectedProfile?.modulePath) && !selectedProfileModule)
  const selectedServer = serverProfiles.find((item) => item.id === selectedServerId)
  const deploymentStages = visibleDeploymentTask?.stages.length ? visibleDeploymentTask.stages : defaultDeploymentStages
  const deploymentRunning = Boolean(visibleDeploymentTask && !deploymentTaskFinished(visibleDeploymentTask.status))
  const buildRunning = buildStatus === 'RUNNING'
  const packageBuildGoals = buildOptions.goals.some((goal) => ['package', 'install', 'verify', 'deploy'].includes(goal))
    ? buildOptions.goals
    : Array.from(new Set([...(buildOptions.goals.length > 0 ? buildOptions.goals : ['clean']), 'package']))
  const artifactOptions = useMemo(() => {
    if (!selectedProfile || selectedProfileModuleMissing) {
      return []
    }

    return findDeployableArtifacts(artifactPool, selectedProfile, modules)
      .map((artifact) => ({
        label: `${artifact.fileName}${artifact.modulePath ? ` · ${artifact.modulePath}` : ''}`,
        value: artifact.path,
      }))
  }, [artifactPool, modules, selectedProfile, selectedProfileModuleMissing])
  const filteredServerProfiles = useMemo(() => {
    const keyword = serverPickerKeyword.trim().toLowerCase()
    if (!keyword) {
      return serverProfiles
    }
    return serverProfiles.filter((server) =>
      [
        server.name,
        server.group,
        server.host,
        server.username,
        String(server.port),
      ].filter(Boolean).some((value) => String(value).toLowerCase().includes(keyword)))
  }, [serverPickerKeyword, serverProfiles])

  useEffect(() => {
    if (!pendingDeployAfterBuild || buildStatus !== 'SUCCESS' || buildRunning || deploymentRunning) {
      return
    }
    const profile = currentProjectDeploymentProfiles.find((item) => item.id === pendingDeployAfterBuild.profileId)
    if (!profile) {
      return
    }
    const artifactPath = findDeployableArtifacts(artifactPool, profile, modules)[0]?.path
    if (!artifactPath) {
      return
    }
    queueMicrotask(() => {
      setSelectedDeploymentProfileId(pendingDeployAfterBuild.profileId)
      setSelectedArtifactPath(artifactPath)
      setPendingDeployAfterBuild(undefined)
      void startDeployment(pendingDeployAfterBuild.profileId, pendingDeployAfterBuild.serverId, artifactPath)
    })
  }, [
    artifactPool,
    buildRunning,
    buildStatus,
    deploymentRunning,
    currentProjectDeploymentProfiles,
    modules,
    pendingDeployAfterBuild,
    startDeployment,
  ])
  const showPackageArtifactHint = Boolean(selectedProfile && !selectedProfileModuleMissing && artifactOptions.length === 0)
  const packageTargetLabel = selectedProfileModule?.artifactId ?? '当前项目'
  const buildOptionSummary = [
    packageBuildGoals.join(' '),
    buildOptions.alsoMake ? '同时构建依赖' : '仅目标模块',
    buildOptions.skipTests ? '跳过测试' : '执行测试',
  ].join('；')
  const recentArtifacts = artifactPool.slice(0, 5)
  const recentDeployments = currentProjectDeploymentTasks.slice(0, 5)
  const deploymentSuccessCount = currentProjectDeploymentTasks.filter((task) => task.status === 'success').length
  const runningDeploymentCount = currentProjectDeploymentTasks.filter((task) => !deploymentTaskFinished(task.status)).length
  const topologyRows = currentProjectDeploymentProfiles.slice(0, 6)
  const deploymentSteps = useMemo(
    () => [...(deploymentDraft.deploymentSteps ?? [])].sort((left, right) => left.order - right.order),
    [deploymentDraft.deploymentSteps],
  )
  const selectedPipelineStep = deploymentSteps.find((step) => step.id === selectedStepId) ?? deploymentSteps[0]
  const templateSteps = useMemo(
    () => [...(templateDraft.steps ?? [])].sort((left, right) => left.order - right.order),
    [templateDraft.steps],
  )
  const selectedTemplateStep = templateSteps.find((step) => step.id === selectedTemplateStepId) ?? templateSteps[0]
  const enabledStepCount = (deploymentDraft.deploymentSteps ?? []).filter((step) => step.enabled).length
  const serverStatus = (serverId: string) => {
    const latestTask = currentProjectDeploymentTasks.find((task) => task.serverId === serverId)
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

  const moduleSnapshot = (moduleId?: string) => {
    const module = moduleId ? moduleById.get(moduleId) : undefined
    return {
      moduleId: module?.id ?? '',
      modulePath: module?.relativePath ?? '',
      moduleArtifactId: module?.artifactId ?? '',
    }
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

  const updateTemplateSteps = (steps: DeployStep[], nextSelectedStepId?: string) => {
    const normalized = steps.map((step, index) => ({...step, order: (index + 1) * 10}))
    setTemplateDraft((state) => ({...state, steps: normalized, updatedAt: new Date().toISOString()}))
    if (nextSelectedStepId !== undefined) {
      setSelectedTemplateStepId(nextSelectedStepId)
    } else if (selectedTemplateStepId && !normalized.some((step) => step.id === selectedTemplateStepId)) {
      setSelectedTemplateStepId(normalized[0]?.id)
    }
  }

  const addDeploymentStep = (type: DeployStepType = 'ssh_command') => {
    const nextStep = createDeployStep(type, (deploymentSteps.length + 1) * 10)
    updateDeploymentSteps([...deploymentSteps, nextStep], nextStep.id)
  }

  const addTemplateStep = (type: DeployStepType = 'ssh_command') => {
    const nextStep = createDeployStep(type, (templateSteps.length + 1) * 10)
    updateTemplateSteps([...templateSteps, nextStep], nextStep.id)
  }

  const patchDeploymentStep = (stepId: string, patch: Partial<DeployStep>) => {
    updateDeploymentSteps(
      deploymentSteps.map((step) => step.id === stepId ? {...step, ...patch} : step),
      stepId,
    )
  }

  const patchTemplateStep = (stepId: string, patch: Partial<DeployStep>) => {
    updateTemplateSteps(
      templateSteps.map((step) => step.id === stepId ? {...step, ...patch} : step),
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

  const patchTemplateStepConfig = (stepId: string, patch: Record<string, unknown>) => {
    updateTemplateSteps(
      templateSteps.map((step) =>
        step.id === stepId
          ? {...step, config: {...stepConfigRecord(step), ...patch} as DeployStep['config']}
          : step),
      stepId,
    )
  }

  const removeDeploymentStep = (stepId: string) => {
    updateDeploymentSteps(deploymentSteps.filter((step) => step.id !== stepId))
  }

  const removeTemplateStep = (stepId: string) => {
    updateTemplateSteps(templateSteps.filter((step) => step.id !== stepId))
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

  const moveTemplateStep = (stepId: string, direction: -1 | 1) => {
    const index = templateSteps.findIndex((step) => step.id === stepId)
    const targetIndex = index + direction
    if (index < 0 || targetIndex < 0 || targetIndex >= templateSteps.length) {
      return
    }
    const next = [...templateSteps]
    const [removed] = next.splice(index, 1)
    next.splice(targetIndex, 0, removed)
    updateTemplateSteps(next, stepId)
  }

  const applyDeploymentTemplate = (template: DeploymentTemplate) => {
    const steps = cloneDeploySteps(template.steps)
    updateDeploymentSteps(steps, steps[0]?.id)
    setPipelineEditorOpen(true)
    setPipelineEditorTarget('deployment')
  }

  const saveDeploymentTemplate = () => {
    const nextTemplate: DeploymentTemplate = {
      ...templateDraft,
      name: templateDraft.name.trim() || '未命名部署模板',
      description: templateDraft.description.trim(),
      builtin: false,
      steps: cloneDeploySteps(templateDraft.steps),
      updatedAt: new Date().toISOString(),
    }
    const nextTemplates = [
      ...deploymentTemplates.filter((item) => item.id !== nextTemplate.id),
      nextTemplate,
    ]
    setDeploymentTemplates(nextTemplates)
    saveCustomDeploymentTemplates(nextTemplates)
    setTemplateDraft(createTemplateDraft())
    setTemplateFormMode('create')
    setSelectedTemplateStepId(undefined)
    setTemplateEditorOpen(false)
  }

  const editDeploymentTemplate = (template: DeploymentTemplate) => {
    setTemplateDraft({...template, steps: cloneDeploySteps(template.steps), builtin: false})
    setTemplateFormMode(template.builtin ? 'create' : 'edit')
    setSelectedTemplateStepId(template.steps[0]?.id)
    setTemplateEditorOpen(true)
  }

  const deleteDeploymentTemplate = (templateId: string) => {
    const nextTemplates = deploymentTemplates.filter((item) => item.id !== templateId)
    setDeploymentTemplates(nextTemplates)
    saveCustomDeploymentTemplates(nextTemplates)
  }

  const openServer = (profile: ServerProfile) => {
    setServerFormMode('edit')
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
    setServerEditorOpen(true)
  }

  const newServer = () => {
    setServerFormMode('create')
    setServerDraft(createServerDraft())
    setTestResult(undefined)
    setServerEditorOpen(true)
  }

  const openDeployment = (profile: DeploymentProfile) => {
    setDeploymentFormMode('edit')
    setDeploymentDraft({
      ...profile,
      projectRoot: profile.projectRoot,
      modulePath: profile.modulePath,
      moduleArtifactId: profile.moduleArtifactId,
      remoteArtifactName: profile.remoteArtifactName ?? '',
      serviceDescription: profile.serviceDescription ?? '',
      serviceAlias: profile.serviceAlias ?? '',
      javaBinPath: profile.javaBinPath ?? '',
      jvmOptions: profile.jvmOptions ?? '',
      springProfile: profile.springProfile ?? '',
      extraArgs: profile.extraArgs ?? '',
      workingDir: profile.workingDir ?? '',
      logPath: profile.logPath ?? '',
      logNamingMode: profile.logNamingMode ?? 'date',
      logName: profile.logName ?? '',
      logEncoding: profile.logEncoding ?? 'UTF-8',
      enableDeployLog: profile.enableDeployLog ?? true,
      backupConfig: profile.backupConfig ?? createDefaultBackupConfig(),
      deploymentSteps: profile.deploymentSteps ?? [],
      customCommands: profile.customCommands ?? [],
      startupProbe: profile.startupProbe ?? createDefaultStartupProbe(),
    })
    setSelectedStepId(profile.deploymentSteps?.[0]?.id)
    setActiveDeploymentTab('profile')
    setDeploymentEditorOpen(true)
  }

  const newDeployment = () => {
    setDeploymentFormMode('create')
    setDeploymentDraft({...createDeploymentDraft(), projectRoot})
    setSelectedStepId(undefined)
    setDeploymentEditorOpen(true)
  }

  const saveServerDraft = async (closeEditor = true) => {
    if (serverFormMode === 'create') {
      const created = await api.saveServerProfile({...serverDraft, id: undefined})
      await refreshDeploymentData()
      setServerFormMode('edit')
      setServerDraft({...serverDraft, id: created.id, password: ''})
      if (closeEditor) {
        setServerEditorOpen(false)
      }
      return created
    }
    const saved = await api.saveServerProfile(serverDraft)
    await refreshDeploymentData()
    setServerDraft({...serverDraft, id: saved.id, password: ''})
    if (closeEditor) {
      setServerEditorOpen(false)
    }
    return saved
  }

  const testServerDraft = async () => {
    setTestingServerId('draft')
    setTestResult(undefined)
    try {
      const saved = await saveServerDraft(false)
      const msg = await testServerConnection(saved.id)
      setTestResult({serverId: 'draft', success: true, message: msg})
    } catch (err) {
      setTestResult({serverId: 'draft', success: false, message: err instanceof Error ? err.message : String(err)})
    } finally {
      setTestingServerId(undefined)
    }
  }

  const saveDeploymentDraft = async () => {
    const profile = {
      ...(deploymentFormMode === 'create'
        ? {...deploymentDraft, id: crypto.randomUUID()}
        : deploymentDraft),
      projectRoot,
      ...moduleSnapshot(deploymentDraft.moduleId),
    }
    await saveDeploymentProfile(profile)
    setDeploymentFormMode('edit')
    setDeploymentDraft(profile)
    setDeploymentEditorOpen(false)
  }

  const packageDeploymentArtifact = async () => {
    if (!selectedProfile || selectedProfileModuleMissing) {
      return
    }

    await startPackageBuild(selectedProfile.moduleId ? [selectedProfile.moduleId] : [])
  }

  const renderStepConfigFields = (step: DeployStep, target: 'deployment' | 'template' = 'deployment') => {
    const config = stepConfigRecord(step)
    const updateConfig = (patch: Record<string, unknown>) =>
      target === 'template'
        ? patchTemplateStepConfig(step.id, patch)
        : patchDeploymentStepConfig(step.id, patch)

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

  const activePipelineSteps = pipelineEditorTarget === 'template' ? templateSteps : deploymentSteps
  const activePipelineStep = pipelineEditorTarget === 'template' ? selectedTemplateStep : selectedPipelineStep
  const activeAddStep = pipelineEditorTarget === 'template' ? addTemplateStep : addDeploymentStep
  const activePatchStep = pipelineEditorTarget === 'template' ? patchTemplateStep : patchDeploymentStep
  const activeRemoveStep = pipelineEditorTarget === 'template' ? removeTemplateStep : removeDeploymentStep
  const activeMoveStep = pipelineEditorTarget === 'template' ? moveTemplateStep : moveDeploymentStep
  const setActiveStepId = pipelineEditorTarget === 'template' ? setSelectedTemplateStepId : setSelectedStepId

  return (
    <Card title="部署中心" className="panel-card" size="small">
      <Space direction="vertical" size={16} style={{width: '100%'}}>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Tabs
          activeKey={activeDeploymentTab}
          onChange={setActiveDeploymentTab}
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
                        <div className="deployment-summary-number">{currentProjectDeploymentTasks.length}</div>
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
                      <Table
                        size="small"
                        rowKey="id"
                        dataSource={serverProfiles}
                        pagination={{pageSize: 5, size: 'small', showSizeChanger: false}}
                        columns={[
                          {
                            title: '状态',
                            width: 100,
                            render: (_, server) => {
                              const status = serverStatus(server.id)
                              return <Tag color={status.color}>{status.label}</Tag>
                            },
                          },
                          {
                            title: '名称',
                            dataIndex: 'name',
                            width: 140,
                          },
                          {
                            title: '分组',
                            width: 120,
                            render: (_, server) => server.group || '默认环境',
                          },
                          {
                            title: '地址',
                            width: 220,
                            ellipsis: true,
                            render: (_, server) => `${server.username}@${server.host}:${server.port}`,
                          },
                        ]}
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
                                  <Tag>{profileModuleLabel(modules, profile)}</Tag>
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
                  <div className="table-toolbar">
                    <Button type="primary" icon={<PlusOutlined />} onClick={newServer}>
                      新增服务器
                    </Button>
                  </div>
                  <Modal
                    title={serverFormMode === 'edit' ? `编辑服务器：${serverDraft.name || serverDraft.host || '未命名'}` : '新增服务器'}
                    open={serverEditorOpen}
                    width={760}
                    footer={null}
                    onCancel={() => setServerEditorOpen(false)}
                    destroyOnHidden
                  >
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
                      onClick={() => void saveServerDraft()}
                    >
                      {serverFormMode === 'edit' ? '保存修改' : '保存新增'}
                    </Button>
                    <Button
                      icon={<CloudServerOutlined />}
                      loading={testingServerId === 'draft'}
                      onClick={() => void testServerDraft()}
                    >
                      测试连接
                    </Button>
                    <Button onClick={() => setServerEditorOpen(false)}>取消编辑</Button>
                    {testResult?.serverId === 'draft' && (
                      <Alert
                        type={testResult.success ? 'success' : 'error'}
                        message={testResult.message}
                        showIcon
                        closable
                        onClose={() => setTestResult(undefined)}
                        style={{maxWidth: 400}}
                      />
                    )}
                  </Space>
                    </Space>
                  </Modal>
                  {serverProfiles.length === 0 ? (
                    <Empty description="暂无服务器配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <>
                      <Input
                        allowClear
                        size="small"
                        placeholder="搜索服务器名称、地址、分组"
                        prefix={<SearchOutlined />}
                        style={{width: 280, marginBottom: 8}}
                        value={serverListKeyword}
                        onChange={(event) => setServerListKeyword(event.target.value)}
                      />
                      <Table
                        size="small"
                        rowKey="id"
                        dataSource={serverProfiles.filter((profile) => {
                          const keyword = serverListKeyword.trim().toLowerCase()
                          if (!keyword) return true
                          return [profile.name, profile.group, profile.host, profile.username, String(profile.port)]
                            .filter(Boolean)
                            .some((value) => String(value).toLowerCase().includes(keyword))
                        })}
                        pagination={{pageSize: 10, size: 'small', showSizeChanger: false, showTotal: (total) => `共 ${total} 台`}}
                        columns={[
                          {
                            title: '名称',
                            dataIndex: 'name',
                            width: 140,
                          },
                          {
                            title: '地址',
                            width: 220,
                            ellipsis: true,
                            render: (_, profile) => `${profile.username}@${profile.host}:${profile.port}`,
                          },
                          {
                            title: '认证',
                            dataIndex: 'authType',
                            width: 100,
                            render: (value: string) => <Tag>{value}</Tag>,
                          },
                          {
                            title: '标签',
                            width: 200,
                            render: (_, profile) => (
                              <Space size={4} wrap>
                                {profile.passwordConfigured ? <Tag color="gold">已保存密码</Tag> : null}
                                {profile.group ? <Tag>{profile.group}</Tag> : null}
                                {testResult?.serverId === profile.id && (
                                  <Tag color={testResult.success ? 'green' : 'red'}>
                                    {testResult.success ? '连接成功' : '连接失败'}
                                  </Tag>
                                )}
                              </Space>
                            ),
                          },
                          {
                            title: '操作',
                            width: 200,
                            render: (_, profile) => (
                              <Space size={4}>
                                <Button size="small" icon={<CloudServerOutlined />} loading={testingServerId === profile.id} onClick={() => {
                                  setTestingServerId(profile.id)
                                  setTestResult(undefined)
                                  void testServerConnection(profile.id)
                                    .then((msg) => setTestResult({serverId: profile.id, success: true, message: msg}))
                                    .catch((err) => setTestResult({serverId: profile.id, success: false, message: err instanceof Error ? err.message : String(err)}))
                                    .finally(() => setTestingServerId(undefined))
                                }}>
                                  测试
                                </Button>
                                <Button size="small" onClick={() => openServer(profile)}>
                                  编辑
                                </Button>
                                <Popconfirm
                                  title="删除服务器配置？"
                                  okText="删除"
                                  cancelText="取消"
                                  onConfirm={() => void deleteServerProfile(profile.id)}
                                >
                                  <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                                </Popconfirm>
                              </Space>
                            ),
                          },
                        ]}
                      />
                    </>
                  )}
                </Space>
              ),
            },
            {
              key: 'profile',
              label: '服务映射',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <div className="table-toolbar">
                    <Button type="primary" icon={<PlusOutlined />} onClick={newDeployment}>
                      新增映射
                    </Button>
                  </div>
                  <Modal
                    title={deploymentFormMode === 'edit' ? `编辑服务映射：${deploymentDraft.name || '未命名'}` : '新增服务映射'}
                    open={deploymentEditorOpen}
                    width="min(980px, calc(100vw - 64px))"
                    footer={null}
                    onCancel={() => setDeploymentEditorOpen(false)}
                    destroyOnHidden
                  >
                    <div className="deployment-form-modal">
                      <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <Input
                    addonBefore="服务名称"
                    value={deploymentDraft.name}
                    onChange={(event) => setDeploymentDraft((state) => ({...state, name: event.target.value}))}
                  />
                  <Space wrap>
                    <Input
                      addonBefore="服务简称"
                      placeholder="如 r、g、a"
                      style={{width: 180}}
                      value={deploymentDraft.serviceAlias ?? ''}
                      onChange={(event) => setDeploymentDraft((state) => ({...state, serviceAlias: event.target.value || undefined}))}
                    />
                    <Input
                      addonBefore="服务描述"
                      placeholder="服务用途说明"
                      style={{minWidth: 300}}
                      value={deploymentDraft.serviceDescription ?? ''}
                      onChange={(event) => setDeploymentDraft((state) => ({...state, serviceDescription: event.target.value || undefined}))}
                    />
                  </Space>
                  <Space wrap>
                    <Select
                      placeholder="绑定模块（用于筛选产物）"
                      style={{minWidth: 260}}
                      value={deploymentDraft.moduleId || undefined}
                      options={modules.map((item) => ({
                        label: `${item.artifactId}${item.relativePath ? ` · ${item.relativePath}` : ''}`,
                        value: item.id,
                      }))}
                      onChange={(value) => setDeploymentDraft((state) => ({...state, ...moduleSnapshot(value)}))}
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
                  <Input
                    addonBefore="远端 jar 名称"
                    placeholder="留空则使用原始产物名称"
                    value={deploymentDraft.remoteArtifactName ?? ''}
                    onChange={(event) => setDeploymentDraft((state) => ({...state, remoteArtifactName: event.target.value || undefined}))}
                  />
                  <Card title="Java 运行配置" size="small" className="panel-card">
                    <Space direction="vertical" size={8} style={{width: '100%'}}>
                      <Input
                        addonBefore="Java 路径"
                        placeholder="如 /home/data/java/jdk1.8.0_144/jre/bin/java，留空使用 java"
                        value={deploymentDraft.javaBinPath ?? ''}
                        onChange={(event) => setDeploymentDraft((state) => ({...state, javaBinPath: event.target.value || undefined}))}
                      />
                      <Input
                        addonBefore="JVM 参数"
                        placeholder="如 -Xms1024m -Xmx1024m"
                        value={deploymentDraft.jvmOptions ?? ''}
                        onChange={(event) => setDeploymentDraft((state) => ({...state, jvmOptions: event.target.value || undefined}))}
                      />
                      <Space wrap>
                        <Input
                          addonBefore="Spring Profile"
                          placeholder="如 dev、prod"
                          style={{minWidth: 200}}
                          value={deploymentDraft.springProfile ?? ''}
                          onChange={(event) => setDeploymentDraft((state) => ({...state, springProfile: event.target.value || undefined}))}
                        />
                        <Input
                          addonBefore="附加参数"
                          placeholder="额外启动参数"
                          style={{minWidth: 260}}
                          value={deploymentDraft.extraArgs ?? ''}
                          onChange={(event) => setDeploymentDraft((state) => ({...state, extraArgs: event.target.value || undefined}))}
                        />
                      </Space>
                      <Input
                        addonBefore="工作目录"
                        placeholder="留空使用远端目录"
                        value={deploymentDraft.workingDir ?? ''}
                        onChange={(event) => setDeploymentDraft((state) => ({...state, workingDir: event.target.value || undefined}))}
                      />
                    </Space>
                  </Card>
                  <Card title="备份与回滚" size="small" className="panel-card">
                    <Space direction="vertical" size={8} style={{width: '100%'}}>
                      <Space wrap>
                        <Checkbox
                          checked={deploymentDraft.backupConfig?.enabled ?? true}
                          onChange={(event) => setDeploymentDraft((state) => ({
                            ...state,
                            backupConfig: {...(state.backupConfig ?? createDefaultBackupConfig()), enabled: event.target.checked},
                          }))}
                        >
                          启用备份
                        </Checkbox>
                        <Checkbox
                          checked={deploymentDraft.backupConfig?.autoRollback ?? false}
                          onChange={(event) => setDeploymentDraft((state) => ({
                            ...state,
                            backupConfig: {...(state.backupConfig ?? createDefaultBackupConfig()), autoRollback: event.target.checked},
                          }))}
                        >
                          探针失败自动回滚
                        </Checkbox>
                        <Checkbox
                          checked={deploymentDraft.backupConfig?.restartAfterRollback ?? false}
                          onChange={(event) => setDeploymentDraft((state) => ({
                            ...state,
                            backupConfig: {...(state.backupConfig ?? createDefaultBackupConfig()), restartAfterRollback: event.target.checked},
                          }))}
                        >
                          回滚后重启旧版本
                        </Checkbox>
                      </Space>
                      <Space wrap>
                        <Input
                          addonBefore="备份目录"
                          placeholder="留空使用远端目录"
                          style={{minWidth: 300}}
                          value={deploymentDraft.backupConfig?.backupDir ?? ''}
                          onChange={(event) => setDeploymentDraft((state) => ({
                            ...state,
                            backupConfig: {...(state.backupConfig ?? createDefaultBackupConfig()), backupDir: event.target.value || undefined},
                          }))}
                        />
                        <InputNumber
                          addonBefore="保留数量"
                          min={1}
                          max={50}
                          value={deploymentDraft.backupConfig?.retentionCount ?? 5}
                          onChange={(value) => setDeploymentDraft((state) => ({
                            ...state,
                            backupConfig: {...(state.backupConfig ?? createDefaultBackupConfig()), retentionCount: value ?? 5},
                          }))}
                        />
                      </Space>
                    </Space>
                  </Card>
                  <Space wrap>
                    <Input
                      addonBefore="日志目录/文件"
                      placeholder="填目录则自动生成日志名；填 .log 则作为完整文件"
                      style={{minWidth: 360}}
                      value={deploymentDraft.logPath ?? ''}
                      onChange={(event) => setDeploymentDraft((state) => ({...state, logPath: event.target.value || undefined}))}
                    />
                    <Select
                      value={deploymentDraft.logNamingMode ?? 'date'}
                      style={{width: 140}}
                      options={[
                        {label: '日期格式', value: 'date'},
                        {label: '固定名称', value: 'fixed'},
                      ]}
                      onChange={(value: LogNamingMode) => setDeploymentDraft((state) => ({...state, logNamingMode: value}))}
                    />
                    {deploymentDraft.logNamingMode === 'fixed' && (
                      <Input
                        addonBefore="日志名称"
                        placeholder="固定日志文件名（不含路径和扩展名）"
                        style={{minWidth: 280}}
                        value={deploymentDraft.logName ?? ''}
                        onChange={(event) => setDeploymentDraft((state) => ({...state, logName: event.target.value || undefined}))}
                      />
                    )}
                    <Select
                      value={deploymentDraft.logEncoding ?? 'UTF-8'}
                      style={{width: 120}}
                      options={[
                        {label: 'UTF-8', value: 'UTF-8'},
                        {label: 'GBK', value: 'GBK'},
                      ]}
                      onChange={(value) => setDeploymentDraft((state) => ({...state, logEncoding: value}))}
                    />
                    <Checkbox
                      checked={deploymentDraft.enableDeployLog ?? true}
                      onChange={(event) => setDeploymentDraft((state) => ({...state, enableDeployLog: event.target.checked}))}
                    >
                      输出部署日志
                    </Checkbox>
                  </Space>
                  <Card
                    title="部署流程"
                    size="small"
                    className="panel-card"
                    extra={(
                      <Space wrap>
                        <Select
                          size="small"
                          placeholder="应用模板"
                          style={{width: 220}}
                          options={deploymentTemplates.map((template) => ({
                            label: template.builtin ? `${template.name}（内置）` : template.name,
                            value: template.id,
                          }))}
                          onChange={(templateId) => {
                            const template = deploymentTemplates.find((item) => item.id === templateId)
                            if (template) {
                              applyDeploymentTemplate(template)
                            }
                          }}
                        />
                        <Button size="small" type="primary" onClick={() => { setPipelineEditorTarget('deployment'); setPipelineEditorOpen(true) }}>
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

                  <Card
                    title="启动探针"
                    size="small"
                    className="panel-card"
                    extra={(
                      <Checkbox
                        checked={deploymentDraft.startupProbe?.enabled ?? true}
                        onChange={(event) => setDeploymentDraft((state) => ({
                          ...state,
                          startupProbe: {...(state.startupProbe ?? createDefaultStartupProbe()), enabled: event.target.checked},
                        }))}
                      >
                        启用
                      </Checkbox>
                    )}
                  >
                    {deploymentDraft.startupProbe?.enabled !== false ? (
                      <Space direction="vertical" size={8} style={{width: '100%'}}>
                        <Space wrap>
                          <div className="step-field">
                            <Text type="secondary">超时（秒）</Text>
                            <InputNumber
                              min={10}
                              max={600}
                              value={deploymentDraft.startupProbe?.timeoutSeconds ?? 120}
                              onChange={(value) => setDeploymentDraft((state) => ({
                                ...state,
                                startupProbe: {...(state.startupProbe ?? createDefaultStartupProbe()), timeoutSeconds: Number(value) || 120},
                              }))}
                            />
                          </div>
                          <div className="step-field">
                            <Text type="secondary">检测间隔（秒）</Text>
                            <InputNumber
                              min={1}
                              max={30}
                              value={deploymentDraft.startupProbe?.intervalSeconds ?? 3}
                              onChange={(value) => setDeploymentDraft((state) => ({
                                ...state,
                                startupProbe: {...(state.startupProbe ?? createDefaultStartupProbe()), intervalSeconds: Number(value) || 3},
                              }))}
                            />
                          </div>
                        </Space>
                        <Text type="secondary" style={{fontSize: 12}}>
                          启动命令负责"把服务拉起来"，启动探针负责"证明服务真的起来了"。部署结果由探针综合判定。
                        </Text>
                        <Card type="inner" size="small" title="进程探针" extra={
                          <Checkbox
                            checked={deploymentDraft.startupProbe?.processProbe?.enabled ?? true}
                            onChange={(event) => setDeploymentDraft((state) => ({
                              ...state,
                              startupProbe: {
                                ...(state.startupProbe ?? createDefaultStartupProbe()),
                                processProbe: {...(state.startupProbe?.processProbe ?? {enabled: true}), enabled: event.target.checked},
                              },
                            }))}
                          >启用</Checkbox>
                        }>
                          {deploymentDraft.startupProbe?.processProbe?.enabled !== false ? (
                            <div className="step-field">
                              <Text type="secondary">PID 文件路径（留空使用默认）</Text>
                              <Input
                                placeholder="${remoteDeployPath}/<远端包名去扩展名>.pid"
                                value={deploymentDraft.startupProbe?.processProbe?.pidFile ?? ''}
                                onChange={(event) => setDeploymentDraft((state) => ({
                                  ...state,
                                  startupProbe: {
                                    ...(state.startupProbe ?? createDefaultStartupProbe()),
                                    processProbe: {...(state.startupProbe?.processProbe ?? {enabled: true}), pidFile: event.target.value || undefined},
                                  },
                                }))}
                              />
                            </div>
                          ) : <Text type="secondary">未启用</Text>}
                        </Card>
                        <Card type="inner" size="small" title="端口探针" extra={
                          <Checkbox
                            checked={deploymentDraft.startupProbe?.portProbe?.enabled ?? true}
                            onChange={(event) => setDeploymentDraft((state) => ({
                              ...state,
                              startupProbe: {
                                ...(state.startupProbe ?? createDefaultStartupProbe()),
                                portProbe: {...(state.startupProbe?.portProbe ?? {enabled: true, host: '127.0.0.1', port: 8080, consecutiveSuccesses: 2}), enabled: event.target.checked},
                              },
                            }))}
                          >启用</Checkbox>
                        }>
                          {deploymentDraft.startupProbe?.portProbe?.enabled !== false ? (
                            <Space wrap>
                              <div className="step-field">
                                <Text type="secondary">主机</Text>
                                <Input
                                  value={deploymentDraft.startupProbe?.portProbe?.host ?? '127.0.0.1'}
                                  onChange={(event) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      portProbe: {...(state.startupProbe?.portProbe ?? {enabled: true, host: '127.0.0.1', port: 8080, consecutiveSuccesses: 2}), host: event.target.value},
                                    },
                                  }))}
                                />
                              </div>
                              <div className="step-field">
                                <Text type="secondary">端口</Text>
                                <InputNumber
                                  min={1}
                                  max={65535}
                                  value={deploymentDraft.startupProbe?.portProbe?.port ?? 8080}
                                  onChange={(value) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      portProbe: {...(state.startupProbe?.portProbe ?? {enabled: true, host: '127.0.0.1', port: 8080, consecutiveSuccesses: 2}), port: Number(value) || 8080},
                                    },
                                  }))}
                                />
                              </div>
                              <div className="step-field">
                                <Text type="secondary">连续成功次数</Text>
                                <InputNumber
                                  min={1}
                                  max={10}
                                  value={deploymentDraft.startupProbe?.portProbe?.consecutiveSuccesses ?? 2}
                                  onChange={(value) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      portProbe: {...(state.startupProbe?.portProbe ?? {enabled: true, host: '127.0.0.1', port: 8080, consecutiveSuccesses: 2}), consecutiveSuccesses: Number(value) || 2},
                                    },
                                  }))}
                                />
                              </div>
                            </Space>
                          ) : <Text type="secondary">未启用</Text>}
                        </Card>
                        <Card type="inner" size="small" title="HTTP 探针" extra={
                          <Checkbox
                            checked={deploymentDraft.startupProbe?.httpProbe?.enabled ?? false}
                            onChange={(event) => setDeploymentDraft((state) => ({
                              ...state,
                              startupProbe: {
                                ...(state.startupProbe ?? createDefaultStartupProbe()),
                                httpProbe: {...(state.startupProbe?.httpProbe ?? {enabled: false, method: 'GET', consecutiveSuccesses: 2}), enabled: event.target.checked},
                              },
                            }))}
                          >启用</Checkbox>
                        }>
                          {deploymentDraft.startupProbe?.httpProbe?.enabled ? (
                            <Space direction="vertical" size={8} style={{width: '100%'}}>
                              <div className="step-field step-field-full">
                                <Text type="secondary">请求地址</Text>
                                <Input
                                  placeholder="http://127.0.0.1:8080/actuator/health"
                                  value={deploymentDraft.startupProbe?.httpProbe?.url ?? ''}
                                  onChange={(event) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      httpProbe: {...(state.startupProbe?.httpProbe ?? {enabled: true, method: 'GET', consecutiveSuccesses: 2}), url: event.target.value || undefined},
                                    },
                                  }))}
                                />
                              </div>
                              <Space wrap>
                                <div className="step-field">
                                  <Text type="secondary">请求方法</Text>
                                  <Select
                                    value={deploymentDraft.startupProbe?.httpProbe?.method ?? 'GET'}
                                    options={[{label: 'GET', value: 'GET'}, {label: 'POST', value: 'POST'}]}
                                    onChange={(value) => setDeploymentDraft((state) => ({
                                      ...state,
                                      startupProbe: {
                                        ...(state.startupProbe ?? createDefaultStartupProbe()),
                                        httpProbe: {...(state.startupProbe?.httpProbe ?? {enabled: true, method: 'GET', consecutiveSuccesses: 2}), method: value},
                                      },
                                    }))}
                                  />
                                </div>
                                <div className="step-field">
                                  <Text type="secondary">期望状态码</Text>
                                  <Input
                                    value={(deploymentDraft.startupProbe?.httpProbe?.expectedStatusCodes ?? [200]).join(',')}
                                    onChange={(event) => setDeploymentDraft((state) => ({
                                      ...state,
                                      startupProbe: {
                                        ...(state.startupProbe ?? createDefaultStartupProbe()),
                                        httpProbe: {...(state.startupProbe?.httpProbe ?? {enabled: true, method: 'GET', consecutiveSuccesses: 2}), expectedStatusCodes: toNumberList(event.target.value, [200])},
                                      },
                                    }))}
                                  />
                                </div>
                                <div className="step-field">
                                  <Text type="secondary">连续成功次数</Text>
                                  <InputNumber
                                    min={1}
                                    max={10}
                                    value={deploymentDraft.startupProbe?.httpProbe?.consecutiveSuccesses ?? 2}
                                    onChange={(value) => setDeploymentDraft((state) => ({
                                      ...state,
                                      startupProbe: {
                                        ...(state.startupProbe ?? createDefaultStartupProbe()),
                                        httpProbe: {...(state.startupProbe?.httpProbe ?? {enabled: true, method: 'GET', consecutiveSuccesses: 2}), consecutiveSuccesses: Number(value) || 2},
                                      },
                                    }))}
                                  />
                                </div>
                              </Space>
                            </Space>
                          ) : <Text type="secondary">未启用</Text>}
                        </Card>
                        <Card type="inner" size="small" title="日志探针" extra={
                          <Checkbox
                            checked={deploymentDraft.startupProbe?.logProbe?.enabled ?? true}
                            onChange={(event) => setDeploymentDraft((state) => ({
                              ...state,
                              startupProbe: {
                                ...(state.startupProbe ?? createDefaultStartupProbe()),
                                logProbe: {...(state.startupProbe?.logProbe ?? createDefaultStartupProbe().logProbe!), enabled: event.target.checked},
                              },
                            }))}
                          >启用</Checkbox>
                        }>
                          {deploymentDraft.startupProbe?.logProbe?.enabled !== false ? (
                            <Space direction="vertical" size={8} style={{width: '100%'}}>
                              <div className="step-field step-field-full">
                                <Text type="secondary">日志路径（留空使用本次部署独立日志）</Text>
                                <Input
                                  placeholder="${remoteDeployPath}/logs/<远端包名去扩展名>-YYYYMMDDHHMMSS.log"
                                  value={deploymentDraft.startupProbe?.logProbe?.logPath ?? ''}
                                  onChange={(event) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      logProbe: {...(state.startupProbe?.logProbe ?? createDefaultStartupProbe().logProbe!), logPath: event.target.value || undefined},
                                    },
                                  }))}
                                />
                              </div>
                              <div className="step-field step-field-full">
                                <Text type="secondary">成功关键字（逗号分隔）</Text>
                                <Input
                                  value={(deploymentDraft.startupProbe?.logProbe?.successPatterns ?? ['Started']).join(',')}
                                  onChange={(event) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      logProbe: {...(state.startupProbe?.logProbe ?? createDefaultStartupProbe().logProbe!), successPatterns: toStringList(event.target.value, ['Started'])},
                                    },
                                  }))}
                                />
                              </div>
                              <div className="step-field step-field-full">
                                <Text type="secondary">强失败关键字（匹配即判失败，逗号分隔）</Text>
                                <Input
                                  value={(deploymentDraft.startupProbe?.logProbe?.failurePatterns ?? []).join(',')}
                                  onChange={(event) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      logProbe: {...(state.startupProbe?.logProbe ?? createDefaultStartupProbe().logProbe!), failurePatterns: toStringList(event.target.value)},
                                    },
                                  }))}
                                />
                              </div>
                              <div className="step-field step-field-full">
                                <Text type="secondary">告警关键字（只标黄展示，逗号分隔）</Text>
                                <Input
                                  value={(deploymentDraft.startupProbe?.logProbe?.warningPatterns ?? []).join(',')}
                                  onChange={(event) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      logProbe: {...(state.startupProbe?.logProbe ?? createDefaultStartupProbe().logProbe!), warningPatterns: toStringList(event.target.value)},
                                    },
                                  }))}
                                />
                              </div>
                              <Space wrap>
                                <Checkbox
                                  checked={deploymentDraft.startupProbe?.logProbe?.useRegex ?? false}
                                  onChange={(event) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      logProbe: {...(state.startupProbe?.logProbe ?? createDefaultStartupProbe().logProbe!), useRegex: event.target.checked},
                                    },
                                  }))}
                                >
                                  使用正则表达式
                                </Checkbox>
                                <Checkbox
                                  checked={deploymentDraft.startupProbe?.logProbe?.onlyCurrentDeployLog ?? true}
                                  onChange={(event) => setDeploymentDraft((state) => ({
                                    ...state,
                                    startupProbe: {
                                      ...(state.startupProbe ?? createDefaultStartupProbe()),
                                      logProbe: {...(state.startupProbe?.logProbe ?? createDefaultStartupProbe().logProbe!), onlyCurrentDeployLog: event.target.checked},
                                    },
                                  }))}
                                >
                                  仅检测本次部署日志
                                </Checkbox>
                              </Space>
                            </Space>
                          ) : <Text type="secondary">未启用</Text>}
                        </Card>
                      </Space>
                    ) : (
                      <Text type="secondary">启动探针未启用，部署结果将由启动命令退出码决定。</Text>
                    )}
                  </Card>

                  <Space wrap>
                    <Button type="primary" icon={<SaveOutlined />} onClick={() => void saveDeploymentDraft()}>
                      {deploymentFormMode === 'edit' ? '保存映射修改' : '保存新增映射'}
                    </Button>
                    <Button onClick={() => setDeploymentEditorOpen(false)}>取消编辑</Button>
                  </Space>
                      </Space>
                    </div>
                  </Modal>
                  {currentProjectDeploymentProfiles.length === 0 ? (
                    <Empty description="暂无服务映射" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <Table
                      rowKey="id"
                      size="small"
                      className="service-dictionary-table"
                      dataSource={currentProjectDeploymentProfiles}
                      pagination={false}
                      columns={[
                        {
                          title: '服务',
                          width: 220,
                          render: (_: unknown, record: DeploymentProfile) => (
                            <Space direction="vertical" size={2} className="service-dictionary-cell">
                              <Space size={6} wrap>
                                {record.serviceAlias ? <Tag color="blue">{record.serviceAlias}</Tag> : null}
                                <Text strong>{record.name || '未命名服务'}</Text>
                              </Space>
                              {record.serviceDescription ? (
                                <Text type="secondary">{record.serviceDescription}</Text>
                              ) : (
                                <Text type="secondary">未填写服务描述</Text>
                              )}
                            </Space>
                          ),
                        },
                        {
                          title: '模块',
                          dataIndex: 'moduleId',
                          width: 160,
                          render: (value: string, record: DeploymentProfile) => {
                            const mod = findProfileModule(modules, record)
                            return mod ? (
                              <Space direction="vertical" size={2} className="service-dictionary-cell">
                                <Text>{mod.artifactId}</Text>
                                {mod.relativePath ? <Text type="secondary">{mod.relativePath}</Text> : null}
                              </Space>
                            ) : <Text type="secondary">{record.moduleArtifactId || value || '未绑定'}</Text>
                          },
                        },
                        {
                          title: '产物与路径',
                          width: 300,
                          render: (_: unknown, record: DeploymentProfile) => {
                            const artifactName = record.remoteArtifactName || record.localArtifactPattern
                            const baseName = artifactName.replace(/\.[^.]+$/, '')
                            return (
                              <Space direction="vertical" size={2} className="service-dictionary-cell">
                                <Text code>{artifactName}</Text>
                                <Text type="secondary">{record.remoteDeployPath || '未配置远端目录'}</Text>
                                <Text type="secondary">日志：{record.logPath || '自动'}</Text>
                                <Text type="secondary">PID：{baseName}.pid</Text>
                              </Space>
                            )
                          },
                        },
                        {
                          title: '探针',
                          width: 180,
                          render: (_: unknown, record: DeploymentProfile) => {
                            const port = record.startupProbe?.portProbe?.enabled ? record.startupProbe.portProbe.port : undefined
                            const url = record.startupProbe?.httpProbe?.enabled ? record.startupProbe.httpProbe.url : undefined
                            return (
                              <Space direction="vertical" size={4} className="service-dictionary-cell">
                                <Space size={6} wrap>
                                  {record.startupProbe?.processProbe?.enabled ? <Tag>进程</Tag> : null}
                                  {port ? <Tag>{port}</Tag> : null}
                                  {record.startupProbe?.logProbe?.enabled ? <Tag>日志</Tag> : null}
                                </Space>
                                {url ? <Text code>{url}</Text> : <Text type="secondary">未配置 HTTP 健康检查</Text>}
                              </Space>
                            )
                          },
                        },
                        {
                          title: '操作',
                          width: 160,
                          render: (_: unknown, record: DeploymentProfile) => (
                            <Space size={4}>
                              <Tooltip title="编辑此映射">
                                <Button
                                  size="small"
                                  icon={<EditOutlined />}
                                  onClick={() => openDeployment(record)}
                                >
                                  编辑
                                </Button>
                              </Tooltip>
                              <Popconfirm
                                title="删除服务映射？"
                                okText="删除"
                                cancelText="取消"
                                onConfirm={() => void deleteDeploymentProfile(record.id)}
                              >
                                <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                              </Popconfirm>
                            </Space>
                          ),
                        },
                      ]}
                    />
                  )}
                </Space>
              ),
            },
            {
              key: 'templates',
              label: '部署模板',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <div className="table-toolbar">
                    <Button
                      type="primary"
                      icon={<PlusOutlined />}
                      onClick={() => {
                        setTemplateDraft(createTemplateDraft())
                        setTemplateFormMode('create')
                        setSelectedTemplateStepId(undefined)
                        setTemplateEditorOpen(true)
                      }}
                    >
                      新增模板
                    </Button>
                  </div>
                  <Modal
                    title={templateFormMode === 'edit' ? `编辑模板：${templateDraft.name || '未命名'}` : '新增部署模板'}
                    open={templateEditorOpen}
                    width="min(880px, calc(100vw - 64px))"
                    footer={null}
                    onCancel={() => setTemplateEditorOpen(false)}
                    destroyOnHidden
                  >
                    <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <Input
                    addonBefore="模板名称"
                    value={templateDraft.name}
                    onChange={(event) => setTemplateDraft((state) => ({...state, name: event.target.value}))}
                  />
                  <Input.TextArea
                    rows={2}
                    placeholder="模板说明"
                    value={templateDraft.description}
                    onChange={(event) => setTemplateDraft((state) => ({...state, description: event.target.value}))}
                  />
                  <Card
                    title="模板流程"
                    size="small"
                    className="panel-card"
                    extra={(
                      <Space wrap>
                        <Button size="small" onClick={() => { setPipelineEditorTarget('template'); setPipelineEditorOpen(true) }}>
                          编辑模板流程
                        </Button>
                        <Button type="primary" size="small" icon={<SaveOutlined />} onClick={saveDeploymentTemplate}>
                          {templateFormMode === 'edit' ? '保存模板修改' : '保存新增模板'}
                        </Button>
                      </Space>
                    )}
                  >
                    {templateSteps.length === 0 ? (
                      <Empty description="暂无模板步骤" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <List
                        size="small"
                        dataSource={templateSteps.slice(0, 6)}
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
                    )}
                  </Card>
                    </Space>
                  </Modal>
                  <List
                    bordered
                    dataSource={deploymentTemplates}
                    renderItem={(template) => (
                      <List.Item
                        actions={[
                          <Button key="apply" size="small" type="primary" onClick={() => applyDeploymentTemplate(template)}>
                            应用到当前映射
                          </Button>,
                          <Button key="edit" size="small" onClick={() => editDeploymentTemplate(template)}>
                            {template.builtin ? '基于此模板新建' : '编辑模板'}
                          </Button>,
                          template.builtin ? null : (
                            <Popconfirm
                              key="delete"
                              title="删除部署模板？"
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => deleteDeploymentTemplate(template.id)}
                            >
                              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                            </Popconfirm>
                          ),
                        ].filter(Boolean)}
                      >
                        <Space direction="vertical" size={2}>
                          <Space size={8} wrap>
                            <Text strong>{template.name}</Text>
                            {template.builtin ? <Tag>内置</Tag> : <Tag color="blue">自定义</Tag>}
                          </Space>
                          <Text type="secondary">{template.description || '无说明'}</Text>
                          <Text type="secondary">流程步骤：{template.steps.length}</Text>
                        </Space>
                      </List.Item>
                    )}
                  />
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
                    options={currentProjectDeploymentProfiles.map((item) => ({label: item.name, value: item.id}))}
                    onChange={(value) => {
                      setSelectedDeploymentProfileId(value)
                      setSelectedArtifactPath(undefined)
                    }}
                  />
                  <div className="deployment-server-select">
                    <Button onClick={() => setServerPickerOpen(true)}>
                      {selectedServer
                        ? `${selectedServer.name}（${selectedServer.username}@${selectedServer.host}:${selectedServer.port}）`
                        : '选择目标服务器'}
                    </Button>
                    {selectedServer ? (
                      <Text type="secondary">{selectedServer.group || '默认环境'} · 当前仅支持单服务器部署</Text>
                    ) : (
                      <Text type="secondary">从服务器列表中选择一个目标环境</Text>
                    )}
                  </div>
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
                        let repackageBeforeDeploy = false
                        Modal.confirm({
                          title: '确认执行部署？',
                          content: (
                            <Space direction="vertical" size={8}>
                              <Text>
                                将部署到 {selectedServer?.name ?? '目标服务器'}（{selectedServer?.host ?? ''}），请确认配置无误。
                              </Text>
                              <Checkbox
                                disabled={buildRunning || !projectRoot}
                                onChange={(event) => {
                                  repackageBeforeDeploy = event.target.checked
                                }}
                              >
                                重新打包后使用最新产物部署
                              </Checkbox>
                            </Space>
                          ),
                          okText: '确认部署',
                          cancelText: '取消',
                          onOk: () => {
                            if (repackageBeforeDeploy) {
                              setPendingDeployAfterBuild({profileId: selectedDeploymentProfileId!, serverId: selectedServerId!})
                              void packageDeploymentArtifact()
                              return
                            }
                            startDeployment(selectedDeploymentProfileId!, selectedServerId!, selectedArtifactPath!)
                          },
                        })
                      }}
                    >
                      开始部署
                    </Button>
                    <Button
                      danger
                      icon={<StopOutlined />}
                      disabled={!deploymentRunning || !visibleDeploymentTask}
                      onClick={() => {
                        if (visibleDeploymentTask) {
                          void cancelDeployment(visibleDeploymentTask.id)
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
                      description={`模块：${selectedProfileModule?.artifactId ?? (selectedProfile.moduleId || selectedProfile.modulePath ? '当前项目不存在该模块' : '未绑定')}；目标目录：${selectedProfile.remoteDeployPath}；匹配规则：${selectedProfile.localArtifactPattern}；部署流程：${selectedProfile.deploymentSteps?.filter((step) => step.enabled).length ?? 0} 个启用步骤${selectedServer ? `；服务器：${selectedServer.name}` : ''}`}
                    />
                  ) : null}
                  {visibleDeploymentTask ? (
                    <div className="pipeline-run-bar">
                      <Space size={8} wrap className="pipeline-run-heading">
                          <Tag color={deploymentTaskColor(visibleDeploymentTask.status)}>
                            {deploymentTaskLabel(visibleDeploymentTask.status)}
                          </Tag>
                          <Text className="pipeline-run-title" title={visibleDeploymentTask.deploymentProfileName ?? visibleDeploymentTask.deploymentProfileId}>
                            {visibleDeploymentTask.deploymentProfileName ?? visibleDeploymentTask.deploymentProfileId}
                          </Text>
                      </Space>
                      <Text type="secondary" className="path-text">{visibleDeploymentTask.artifactPath}</Text>
                      {visibleDeploymentTask.log.length > 0 ? (
                        <div className="deployment-connection-log">
                          <Text type="secondary">{visibleDeploymentTask.log[visibleDeploymentTask.log.length - 1]}</Text>
                        </div>
                      ) : null}
                      <Steps
                        direction="vertical"
                        size="small"
                        current={deploymentProgressCurrent(deploymentStages)}
                        status={['failed', 'cancelled'].includes(visibleDeploymentTask.status) ? 'error' : visibleDeploymentTask.status === 'success' ? 'finish' : 'process'}
                        items={deploymentStages.map((stage) => ({
                          title: stage.label,
                          status: deploymentStageStatus(stage.status),
                          description: (
                            <Space direction="vertical" size={2}>
                              <UploadStepDescription taskId={visibleDeploymentTask.id} stage={stage} />
                              {stage.probeStatuses && stage.probeStatuses.length > 0 ? (
                                <div className="probe-status-list">
                                  {stage.probeStatuses.map((ps: ProbeStatus, idx: number) => {
                                    const meta = probeStatusMeta(ps.status)
                                    return (
                                      <div key={idx} className="probe-status-row">
                                        <Tag color={meta.color}>{meta.label}</Tag>
                                        <Text className="probe-status-text">
                                          {probeTypeLabel(ps.probeType)}：{ps.message ?? ps.status}
                                          {ps.checkCount ? `（已检测 ${ps.checkCount} 次）` : ''}
                                        </Text>
                                      </div>
                                    )
                                  })}
                                </div>
                              ) : null}
                            </Space>
                          ),
                        }))}
                      />
                      {visibleDeploymentTask.probeResult ? (
                        <Alert
                          type={visibleDeploymentTask.status === 'success' ? 'success' : 'error'}
                          showIcon
                          message={visibleDeploymentTask.status === 'success' ? '启动探针检测通过' : '启动探针检测失败'}
                          description={visibleDeploymentTask.probeResult}
                          style={{marginTop: 8}}
                        />
                      ) : null}
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
          title="选择目标服务器"
          open={serverPickerOpen}
          width={760}
          footer={null}
          onCancel={() => setServerPickerOpen(false)}
        >
          <Space direction="vertical" size={12} style={{width: '100%'}}>
            <Input
              allowClear
              placeholder="搜索服务器名称、分组、主机、用户名或端口"
              value={serverPickerKeyword}
              onChange={(event) => setServerPickerKeyword(event.target.value)}
            />
            <List
              bordered
              className="deployment-server-list"
              dataSource={filteredServerProfiles}
              locale={{emptyText: '没有匹配的服务器'}}
              renderItem={(server) => (
                <List.Item
                  className={server.id === selectedServerId ? 'deployment-server-item active' : 'deployment-server-item'}
                  actions={[
                    <Button
                      key="select"
                      type={server.id === selectedServerId ? 'primary' : 'default'}
                      size="small"
                      onClick={() => {
                        setSelectedServerId(server.id)
                        setServerPickerOpen(false)
                      }}
                    >
                      {server.id === selectedServerId ? '已选择' : '选择'}
                    </Button>,
                  ]}
                >
                  <Space direction="vertical" size={2} className="artifact-item">
                    <Space size={8} wrap>
                      <Text strong>{server.name}</Text>
                      <Tag>{server.group || '默认环境'}</Tag>
                      <Tag>{server.authType === 'password' ? '密码' : '私钥'}</Tag>
                    </Space>
                    <Text type="secondary">
                      {server.username}@{server.host}:{server.port}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </Space>
        </Modal>
        <Modal
          title={pipelineEditorTarget === 'template' ? '模板流程配置' : '部署流程配置'}
          open={pipelineEditorOpen}
          width="min(1040px, calc(100vw - 64px))"
          okText="完成"
          cancelText="关闭"
          onOk={() => setPipelineEditorOpen(false)}
          onCancel={() => setPipelineEditorOpen(false)}
        >
          <div className="deployment-pipeline-editor">
            <div className="deployment-step-list">
              <Space wrap style={{marginBottom: 10}}>
                <Button icon={<PlusOutlined />} onClick={() => activeAddStep('ssh_command')}>
                  添加步骤
                </Button>
                <Select
                  placeholder="按类型添加"
                  style={{width: 180}}
                  options={stepTypeOptions}
                  onChange={(value) => activeAddStep(value)}
                />
              </Space>
              {activePipelineSteps.length === 0 ? (
                <Empty description="暂无部署步骤" image={Empty.PRESENTED_IMAGE_SIMPLE} />
              ) : (
                <List
                  size="small"
                  dataSource={activePipelineSteps}
                  renderItem={(step, index) => (
                    <List.Item
                      className={step.id === activePipelineStep?.id ? 'deployment-step-item active' : 'deployment-step-item'}
                      onClick={() => setActiveStepId(step.id)}
                      actions={[
                        <Button key="up" size="small" type="text" icon={<ArrowUpOutlined />} disabled={index === 0} onClick={(event) => { event.stopPropagation(); activeMoveStep(step.id, -1) }} />,
                        <Button key="down" size="small" type="text" icon={<ArrowDownOutlined />} disabled={index === activePipelineSteps.length - 1} onClick={(event) => { event.stopPropagation(); activeMoveStep(step.id, 1) }} />,
                        <Popconfirm
                          key="delete"
                          title="删除该部署步骤？"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={(event) => {
                            event?.stopPropagation()
                            activeRemoveStep(step.id)
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
              {activePipelineStep ? (
                <Space direction="vertical" size={14} style={{width: '100%'}}>
                  <Space wrap>
                    <Checkbox
                      checked={activePipelineStep.enabled}
                      onChange={(event) => activePatchStep(activePipelineStep.id, {enabled: event.target.checked})}
                    >
                      启用
                    </Checkbox>
                    <Select
                      style={{width: 180}}
                      value={activePipelineStep.type}
                      options={stepTypeOptions}
                      onChange={(value: DeployStepType) =>
                        activePatchStep(activePipelineStep.id, {
                          type: value,
                          name: activePipelineStep.name || stepTypeLabel(value),
                          config: createDefaultStepConfig(value),
                        })}
                    />
                  </Space>
                  <div className="step-card-body">
                    <div className="step-field step-field-full">
                      <Text type="secondary">步骤名称</Text>
                      <Input
                        value={activePipelineStep.name}
                        onChange={(event) => activePatchStep(activePipelineStep.id, {name: event.target.value})}
                      />
                    </div>
                    <div className="step-field">
                      <Text type="secondary">超时时间（秒）</Text>
                      <InputNumber
                        min={1}
                        value={activePipelineStep.timeoutSeconds}
                        onChange={(value) => activePatchStep(activePipelineStep.id, {timeoutSeconds: Number(value) || undefined})}
                      />
                    </div>
                    <div className="step-field">
                      <Text type="secondary">重试次数</Text>
                      <InputNumber
                        min={0}
                        value={activePipelineStep.retryCount ?? 0}
                        onChange={(value) => activePatchStep(activePipelineStep.id, {retryCount: Number(value) || 0})}
                      />
                    </div>
                    <div className="step-field">
                      <Text type="secondary">重试间隔（秒）</Text>
                      <InputNumber
                        min={1}
                        value={activePipelineStep.retryIntervalSeconds ?? 3}
                        onChange={(value) => activePatchStep(activePipelineStep.id, {retryIntervalSeconds: Number(value) || 1})}
                      />
                    </div>
                    <div className="step-field">
                      <Text type="secondary">失败策略</Text>
                      <Select
                        value={activePipelineStep.failureStrategy ?? 'stop'}
                        options={failureStrategyOptions}
                        onChange={(value) => activePatchStep(activePipelineStep.id, {failureStrategy: value})}
                      />
                    </div>
                    {renderStepConfigFields(activePipelineStep, pipelineEditorTarget)}
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
