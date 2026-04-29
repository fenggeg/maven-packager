import {
    CopyOutlined,
    DeleteOutlined,
    DownloadOutlined,
    FullscreenOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined
} from '@ant-design/icons'
import {Button, Card, Input, List, Modal, Radio, Select, Space, Tag, Tooltip, Typography} from 'antd'
import {useEffect, useMemo, useRef, useState} from 'react'
import {LogConsole} from '../common/LogConsole'
import {useAppStore} from '../../store/useAppStore'
import {useDeploymentLogStore} from '../../store/useDeploymentLogStore'
import {useNavigationStore} from '../../store/navigationStore'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {BuildDiagnosis, BuildLogEvent, BuildStatus} from '../../types/domain'

const { Text } = Typography

type LogSource = 'build' | 'deployment'
type LogFilter = 'all' | 'error' | 'warn' | 'success'
const EMPTY_DEPLOYMENT_LOGS: string[] = []

const statusText: Record<BuildStatus, string> = {
  IDLE: '未开始',
  RUNNING: '构建中',
  SUCCESS: '构建成功',
  FAILED: '构建失败',
  CANCELLED: '已停止',
}

const statusColor: Record<BuildStatus, string> = {
  IDLE: 'default',
  RUNNING: 'processing',
  SUCCESS: 'success',
  FAILED: 'error',
  CANCELLED: 'warning',
}

const diagnosisCategoryText: Record<BuildDiagnosis['category'], string> = {
  jdk_mismatch: 'JDK 版本不匹配',
  maven_missing: 'Maven 不存在',
  wrapper_issue: 'Wrapper 失效',
  settings_missing: 'settings.xml 缺失',
  dependency_download_failed: '依赖下载失败',
  repo_unreachable: '私服不可达',
  profile_invalid: 'profile 不存在',
  module_invalid: '模块路径错误',
  test_failed: '单元测试失败',
  unknown: '未知错误',
}

const classifyBuildLog = (event: BuildLogEvent) => {
  const line = event.line.toLowerCase()
  if (line.includes('build success')) {
    return 'success'
  }
  if (
    line.includes('[error]') ||
    line.includes('build failure') ||
    line.includes('could not resolve dependencies') ||
    line.includes('java_home is not defined correctly') ||
    line.includes('non-resolvable parent pom')
  ) {
    return 'error'
  }
  if (line.includes('[warning]')) {
    return 'warn'
  }
  return ''
}

const classifyLine = (line: string) => {
  const lower = line.toLowerCase()
  if (lower.includes('build success') || lower.includes('exit code 0') || lower.includes('部署完成')) {
    return 'success'
  }
  if (lower.includes('[error]') || lower.includes('build failure') || lower.includes('命令执行失败') || lower.includes('部署失败') || lower.includes('timeout') || lower.includes('failed')) {
    return 'error'
  }
  if (lower.includes('[warning]') || lower.includes('warn')) {
    return 'warn'
  }
  return ''
}

const deploymentStatusLabel = (status: string) => {
  switch (status) {
    case 'success': return '部署成功'
    case 'failed': return '部署失败'
    case 'cancelled': return '已停止'
    case 'pending': return '等待中'
    case 'uploading': return '上传中'
    case 'stopping': return '停止旧服务'
    case 'starting': return '启动中'
    case 'checking': return '检测中'
    default: return status
  }
}

export function BuildLogPanel() {
  // Build logs
  const logs = useAppStore((state) => state.logs)
  const diagnosis = useAppStore((state) => state.diagnosis)
  const buildStatus = useAppStore((state) => state.buildStatus)
  const buildCancelling = useAppStore((state) => state.buildCancelling)
  const buildStartedAt = useAppStore((state) => state.startedAt)
  const cancelBuild = useAppStore((state) => state.cancelBuild)
  const clearBuildLogs = useAppStore((state) => state.clearBuildLogs)

  // Deployment logs
  const currentDeploymentTask = useWorkflowStore((state) => state.currentDeploymentTask)
  const deploymentTaskId = currentDeploymentTask?.id
  const deploymentLogs = useDeploymentLogStore(
    (state) => state.logsByTaskId[deploymentTaskId ?? ''] ?? EMPTY_DEPLOYMENT_LOGS,
  )
  const clearDeploymentLogs = useDeploymentLogStore((state) => state.clearLogs)

  const panelRef = useRef<HTMLDivElement>(null)
  const modalPanelRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [logFilter, setLogFilter] = useState<LogFilter>('all')
  const [autoScroll, setAutoScroll] = useState(true)
  const activeSource = useNavigationStore((state) => state.inspectorLogSource)
  const setActiveSource = useNavigationStore((state) => state.setInspectorLogSource)

  const isDeploymentRunning = currentDeploymentTask != null && !['success', 'failed', 'cancelled'].includes(currentDeploymentTask.status)

  // Alias for local readability
  const setActiveSourceLocal = (source: LogSource) => setActiveSource(source)

  const lastLaunchRef = useRef<{
    buildStartedAt?: number
    deploymentTaskId?: string
  }>({})

  useEffect(() => {
    const previous = lastLaunchRef.current
    let nextSource: LogSource | undefined

    if (buildStartedAt && buildStatus === 'RUNNING' && buildStartedAt !== previous.buildStartedAt) {
      nextSource = 'build'
    }
    if (deploymentTaskId && isDeploymentRunning && deploymentTaskId !== previous.deploymentTaskId) {
      nextSource = 'deployment'
    }

    lastLaunchRef.current = {
      buildStartedAt,
      deploymentTaskId,
    }

    if (nextSource) {
      setActiveSource(nextSource)
    }
  }, [
    buildStartedAt,
    buildStatus,
    deploymentTaskId,
    isDeploymentRunning,
    setActiveSource,
  ])

  const currentLogCount = activeSource === 'build' ? logs.length : deploymentLogs.length

  // Auto-scroll
  useEffect(() => {
    if (autoScroll && panelRef.current) {
      panelRef.current.scrollTop = panelRef.current.scrollHeight
    }
    if (autoScroll && modalPanelRef.current) {
      modalPanelRef.current.scrollTop = modalPanelRef.current.scrollHeight
    }
  }, [autoScroll, currentLogCount])

  // Filter by keyword
  const keywordValue = keyword.trim().toLowerCase()
  const visibleBuildLogs = useMemo(() => logs.filter((event) => {
    if (logFilter !== 'all' && classifyBuildLog(event) !== logFilter) return false
    if (keywordValue && !event.line.toLowerCase().includes(keywordValue)) return false
    return true
  }), [keywordValue, logFilter, logs])

  const visibleDeploymentLogs = useMemo(() => deploymentLogs.filter((line) => {
    if (logFilter !== 'all' && classifyLine(line) !== logFilter) return false
    if (keywordValue && !line.toLowerCase().includes(keywordValue)) return false
    return true
  }), [deploymentLogs, keywordValue, logFilter])

  const visibleBuildLogLines = useMemo(
    () => visibleBuildLogs.map((event) => event.line),
    [visibleBuildLogs],
  )

  const copyLogs = () => {
    let text = ''
    if (activeSource === 'build') {
      text = logs.map((event) => event.line).join('\n')
    } else {
      text = deploymentLogs.join('\n')
    }
    void navigator.clipboard?.writeText(text)
  }

  const downloadLogs = () => {
    const text = activeSource === 'build'
      ? logs.map((event) => event.line).join('\n')
      : deploymentLogs.join('\n')
    if (!text) return
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = activeSource === 'build' ? 'build-log.txt' : 'deployment-log.txt'
    a.click()
    URL.revokeObjectURL(url)
  }

  const clearLogs = () => {
    if (activeSource === 'build') {
      clearBuildLogs()
    } else if (deploymentTaskId) {
      clearDeploymentLogs(deploymentTaskId)
    }
  }

  // Build status tag for header
  const renderStatusTag = () => {
    if (activeSource === 'build') {
      return <Tag color={statusColor[buildStatus]}>{statusText[buildStatus]}</Tag>
    }
    if (activeSource === 'deployment' && currentDeploymentTask) {
      const isRunning = !['success', 'failed', 'cancelled'].includes(currentDeploymentTask.status)
      const color = currentDeploymentTask.status === 'success' ? 'success' : currentDeploymentTask.status === 'cancelled' ? 'warning' : isRunning ? 'processing' : 'error'
      const label = `${currentDeploymentTask.artifactName} · ${deploymentStatusLabel(currentDeploymentTask.status)}`
      return (
        <Tooltip title={label}>
          <Tag color={color} className="log-status-tag">
            <span>{label}</span>
          </Tag>
        </Tooltip>
      )
    }
    return null
  }

  const copyDiagnosis = () => {
    if (!diagnosis) {
      return
    }
    const content = [
      `错误类型：${diagnosisCategoryText[diagnosis.category]}`,
      `摘要：${diagnosis.summary}`,
      '',
      '可能原因：',
      ...diagnosis.possibleCauses.map((item) => `- ${item}`),
      '',
      '建议动作：',
      ...diagnosis.suggestedActions.map((item) => `- ${item}`),
      '',
      '关键日志：',
      ...diagnosis.keywordLines.map((item) => `> ${item}`),
    ].join('\n')
    void navigator.clipboard?.writeText(content)
  }

  return (
    <Space direction="vertical" size={12} style={{ width: '100%' }}>
      <Card
        title="日志输出"
        className="panel-card log-panel-card"
        size="small"
        extra={
          <Space wrap size={4} className="log-card-extra">
            {renderStatusTag()}
            {activeSource === 'build' && (
              <Tooltip title="停止构建">
                <Button
                  size="small"
                  danger
                  type="text"
                  disabled={buildStatus !== 'RUNNING' || buildCancelling}
                  icon={<PauseCircleOutlined />}
                  onClick={() => void cancelBuild()}
                />
              </Tooltip>
            )}
            {activeSource === 'build' && (
              <Tooltip title="清空日志">
                <Button size="small" type="text" icon={<DeleteOutlined />} onClick={clearLogs} />
              </Tooltip>
            )}
            {activeSource === 'deployment' && (
              <Tooltip title="清空当前部署日志">
                <Button size="small" type="text" icon={<DeleteOutlined />} disabled={!deploymentTaskId} onClick={clearLogs} />
              </Tooltip>
            )}
            <Tooltip title="复制日志">
              <Button
                size="small"
                type="text"
                disabled={currentLogCount === 0}
                icon={<CopyOutlined />}
                onClick={copyLogs}
              />
            </Tooltip>
            <Tooltip title="下载日志">
              <Button
                size="small"
                type="text"
                disabled={currentLogCount === 0}
                icon={<DownloadOutlined />}
                onClick={downloadLogs}
              />
            </Tooltip>
            <Tooltip title={autoScroll ? '关闭自动滚动' : '开启自动滚动'}>
              <Button
                size="small"
                type={autoScroll ? 'primary' : 'text'}
                icon={<PlayCircleOutlined />}
                onClick={() => setAutoScroll((value) => !value)}
              />
            </Tooltip>
            <Tooltip title="放大查看">
              <Button
                aria-label="放大查看日志"
                icon={<FullscreenOutlined />}
                size="small"
                type="text"
                onClick={() => setExpanded(true)}
              />
            </Tooltip>
          </Space>
        }
      >
        <Radio.Group
          value={activeSource}
          onChange={(event) => setActiveSourceLocal(event.target.value)}
          size="small"
          style={{ marginBottom: 8 }}
        >
          <Radio.Button value="build">构建</Radio.Button>
          <Radio.Button value="deployment">部署</Radio.Button>
        </Radio.Group>
        <Space size={4}>
          <Select
            size="small"
            value={logFilter}
            onChange={setLogFilter}
            style={{ width: 100 }}
            options={[
              { value: 'all', label: '全部' },
              { value: 'error', label: '错误' },
              { value: 'warn', label: '告警' },
              { value: 'success', label: '成功' },
            ]}
          />
          <Input
            allowClear
            size="small"
            className="log-search"
            placeholder="搜索日志关键词"
            value={keyword}
            onChange={(event) => setKeyword(event.target.value)}
          />
        </Space>
        {activeSource === 'build' ? (
          <LogConsole
            ref={panelRef}
            lines={visibleBuildLogLines}
            classifyLine={classifyLine}
            emptyTitle="准备开始构建"
            emptyDescription="请选择模块并点击开始打包。"
            keyPrefix="build-log"
          />
        ) : (
          <LogConsole
            ref={panelRef}
            lines={visibleDeploymentLogs}
            classifyLine={classifyLine}
            emptyTitle="暂无部署日志"
            emptyDescription="执行部署后日志将在此实时展示。"
            keyPrefix="deployment-log"
          />
        )}
        <Modal
          title={`日志输出 · ${activeSource === 'build' ? '构建' : '部署'}`}
          open={expanded}
          footer={null}
          width="88vw"
          onCancel={() => setExpanded(false)}
        >
          {activeSource === 'build' ? (
            <LogConsole
              ref={modalPanelRef}
              className="log-panel log-panel-large"
              lines={visibleBuildLogLines}
              classifyLine={classifyLine}
              emptyTitle="准备开始构建"
              emptyDescription="请选择模块并点击开始打包。"
              keyPrefix="build-log-modal"
            />
          ) : (
            <LogConsole
              ref={modalPanelRef}
              className="log-panel log-panel-large"
              lines={visibleDeploymentLogs}
              classifyLine={classifyLine}
              emptyTitle="暂无部署日志"
              emptyDescription="执行部署后日志将在此实时展示。"
              keyPrefix="deployment-log-modal"
            />
          )}
        </Modal>
      </Card>

      {activeSource === 'build' && diagnosis && (
        <Card
          title="诊断面板"
          className="panel-card diagnosis-card"
          size="small"
          extra={
            <Tooltip title="复制诊断结果">
              <Button
                size="small"
                type="text"
                icon={<CopyOutlined />}
                onClick={copyDiagnosis}
              />
            </Tooltip>
          }
        >
          <Space direction="vertical" size={10} style={{ width: '100%' }}>
            <Space size={8} wrap>
              <Tag color="error">{diagnosisCategoryText[diagnosis.category]}</Tag>
              <Text strong>{diagnosis.summary}</Text>
            </Space>
            <div className="diagnosis-grid">
              <div>
                <Text strong>可能原因</Text>
                <List
                  size="small"
                  dataSource={diagnosis.possibleCauses}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </div>
              <div>
                <Text strong>建议动作</Text>
                <List
                  size="small"
                  dataSource={diagnosis.suggestedActions}
                  renderItem={(item) => <List.Item>{item}</List.Item>}
                />
              </div>
            </div>
            <div>
              <Text strong>高价值关键字行</Text>
              <div className="diagnosis-keyword-lines">
                {diagnosis.keywordLines.slice(0, 6).map((line, index) => (
                  <pre key={`${diagnosis.id}-${index}`}>{line}</pre>
                ))}
              </div>
            </div>
          </Space>
        </Card>
      )}
    </Space>
  )
}
