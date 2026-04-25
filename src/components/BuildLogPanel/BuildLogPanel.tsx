import {
    CopyOutlined,
    DeleteOutlined,
    FullscreenOutlined,
    PauseCircleOutlined,
    PlayCircleOutlined
} from '@ant-design/icons'
import {Button, Card, Input, List, Modal, Radio, Space, Tag, Tooltip, Typography} from 'antd'
import {useEffect, useRef, useState} from 'react'
import {useAppStore} from '../../store/useAppStore'
import {useNavigationStore} from '../../store/navigationStore'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {BuildDiagnosis, BuildLogEvent, BuildStatus} from '../../types/domain'

const { Text } = Typography

type LogSource = 'build' | 'pipeline' | 'deployment'

const statusText: Record<BuildStatus, string> = {
  IDLE: '未开始',
  RUNNING: 'BUILDING',
  SUCCESS: 'BUILD SUCCESS',
  FAILED: 'BUILD FAILED',
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
  if (lower.includes('build success') || lower.includes('任务链执行完成') || lower.includes('步骤完成') || lower.includes('exit code 0') || lower.includes('部署完成')) {
    return 'success'
  }
  if (lower.includes('[error]') || lower.includes('build failure') || lower.includes('任务链') && lower.includes('失败') || lower.includes('命令执行失败') || lower.includes('部署失败')) {
    return 'error'
  }
  if (lower.includes('[warning]') || lower.includes('warn')) {
    return 'warn'
  }
  return ''
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

  // Pipeline logs
  const currentTaskPipelineRun = useWorkflowStore((state) => state.currentTaskPipelineRun)
  const taskPipelineLogsByRunId = useWorkflowStore((state) => state.taskPipelineLogsByRunId)

  // Deployment logs
  const currentDeploymentTask = useWorkflowStore((state) => state.currentDeploymentTask)
  const deploymentLogsByTaskId = useWorkflowStore((state) => state.deploymentLogsByTaskId)

  const panelRef = useRef<HTMLDivElement>(null)
  const modalPanelRef = useRef<HTMLDivElement>(null)
  const [expanded, setExpanded] = useState(false)
  const [keyword, setKeyword] = useState('')
  const [autoScroll, setAutoScroll] = useState(true)
  const activeSource = useNavigationStore((state) => state.inspectorLogSource)
  const setActiveSource = useNavigationStore((state) => state.setInspectorLogSource)

  const isDeploymentRunning = currentDeploymentTask != null && !['success', 'failed', 'cancelled'].includes(currentDeploymentTask.status)

  // Alias for local readability
  const setActiveSourceLocal = (source: LogSource) => setActiveSource(source)

  // Get current log lines based on active source
  const pipelineRunId = currentTaskPipelineRun?.id
  const pipelineLogs = taskPipelineLogsByRunId[pipelineRunId ?? ''] ?? []
  const deploymentTaskId = currentDeploymentTask?.id
  const deploymentLogs = deploymentLogsByTaskId[deploymentTaskId ?? ''] ?? []

  const lastLaunchRef = useRef<{
    buildStartedAt?: number
    pipelineRunId?: string
    deploymentTaskId?: string
  }>({})

  useEffect(() => {
    const previous = lastLaunchRef.current
    let nextSource: LogSource | undefined

    if (buildStartedAt && buildStatus === 'RUNNING' && buildStartedAt !== previous.buildStartedAt) {
      nextSource = 'build'
    }
    if (pipelineRunId && currentTaskPipelineRun?.status === 'running' && pipelineRunId !== previous.pipelineRunId) {
      nextSource = 'pipeline'
    }
    if (deploymentTaskId && isDeploymentRunning && deploymentTaskId !== previous.deploymentTaskId) {
      nextSource = 'deployment'
    }

    lastLaunchRef.current = {
      buildStartedAt,
      pipelineRunId,
      deploymentTaskId,
    }

    if (nextSource) {
      setActiveSource(nextSource)
    }
  }, [
    buildStartedAt,
    buildStatus,
    currentTaskPipelineRun?.status,
    deploymentTaskId,
    isDeploymentRunning,
    pipelineRunId,
    setActiveSource,
  ])

  const currentLogCount = activeSource === 'build' ? logs.length : activeSource === 'pipeline' ? pipelineLogs.length : deploymentLogs.length

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
  const visibleBuildLogs = keyword.trim()
    ? logs.filter((event) => event.line.toLowerCase().includes(keyword.trim().toLowerCase()))
    : logs

  const visiblePipelineLogs = keyword.trim()
    ? pipelineLogs.filter((line) => line.toLowerCase().includes(keyword.trim().toLowerCase()))
    : pipelineLogs

  const visibleDeploymentLogs = keyword.trim()
    ? deploymentLogs.filter((line) => line.toLowerCase().includes(keyword.trim().toLowerCase()))
    : deploymentLogs

  const renderContent = () => {
    if (activeSource === 'build') {
      return visibleBuildLogs.length === 0 ? (
        <div className="log-empty">
          <Text>准备开始构建</Text>
          <Text type="secondary">请选择模块并点击"开始打包"。</Text>
        </div>
      ) : (
        visibleBuildLogs.map((event, index) => (
          <pre className={`log-line ${classifyBuildLog(event)}`} key={`${event.buildId}-${index}`}>
            {event.line}
          </pre>
        ))
      )
    }

    if (activeSource === 'pipeline') {
      return visiblePipelineLogs.length === 0 ? (
        <div className="log-empty">
          <Text>暂无任务链日志</Text>
          <Text type="secondary">执行任务链后日志将在此实时展示。</Text>
        </div>
      ) : (
        visiblePipelineLogs.map((line, index) => (
          <pre className={`log-line ${classifyLine(line)}`} key={`pl-${index}`}>
            {line}
          </pre>
        ))
      )
    }

    // deployment
    return visibleDeploymentLogs.length === 0 ? (
      <div className="log-empty">
        <Text>暂无部署日志</Text>
        <Text type="secondary">执行部署后日志将在此实时展示。</Text>
      </div>
    ) : (
      visibleDeploymentLogs.map((line, index) => (
        <pre className={`log-line ${classifyLine(line)}`} key={`dl-${index}`}>
          {line}
        </pre>
      ))
    )
  }

  const copyLogs = () => {
    let text = ''
    if (activeSource === 'build') {
      text = logs.map((event) => event.line).join('\n')
    } else if (activeSource === 'pipeline') {
      text = pipelineLogs.join('\n')
    } else {
      text = deploymentLogs.join('\n')
    }
    void navigator.clipboard?.writeText(text)
  }

  const clearLogs = () => {
    if (activeSource === 'build') {
      clearBuildLogs()
    }
    // Pipeline and deployment logs are managed by their respective flows
  }

  // Build status tag for header
  const renderStatusTag = () => {
    if (activeSource === 'build') {
      return <Tag color={statusColor[buildStatus]}>{statusText[buildStatus]}</Tag>
    }
    if (activeSource === 'pipeline' && currentTaskPipelineRun) {
      const isRunning = currentTaskPipelineRun.status === 'running'
      const color = isRunning ? 'processing' : currentTaskPipelineRun.status === 'success' ? 'success' : 'error'
      const label = isRunning ? '执行中' : currentTaskPipelineRun.status === 'success' ? '已完成' : '已失败'
      return (
        <Tag color={color}>
          {currentTaskPipelineRun.pipelineName}
          {isRunning ? ` · ${currentTaskPipelineRun.steps.filter((s) => s.status === 'success').length}/${currentTaskPipelineRun.steps.length}` : ''}
          {' '}{label}
        </Tag>
      )
    }
    if (activeSource === 'deployment' && currentDeploymentTask) {
      const isRunning = !['success', 'failed', 'cancelled'].includes(currentDeploymentTask.status)
      const color = currentDeploymentTask.status === 'success' ? 'success' : currentDeploymentTask.status === 'cancelled' ? 'warning' : isRunning ? 'processing' : 'error'
      return <Tag color={color}>{currentDeploymentTask.artifactName} · {currentDeploymentTask.status}</Tag>
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
        className="panel-card"
        size="small"
        extra={
          <Space wrap size={4}>
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
            <Tooltip title="复制日志">
              <Button
                size="small"
                type="text"
                disabled={currentLogCount === 0}
                icon={<CopyOutlined />}
                onClick={copyLogs}
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
          <Radio.Button value="pipeline">任务链</Radio.Button>
          <Radio.Button value="deployment">部署</Radio.Button>
        </Radio.Group>
        <Input
          allowClear
          size="small"
          className="log-search"
          placeholder="搜索日志关键词"
          value={keyword}
          onChange={(event) => setKeyword(event.target.value)}
        />
        <div className="log-panel" ref={panelRef}>
          {renderContent()}
        </div>
        <Modal
          title={`日志输出 · ${activeSource === 'build' ? '构建' : activeSource === 'pipeline' ? '任务链' : '部署'}`}
          open={expanded}
          footer={null}
          width="88vw"
          onCancel={() => setExpanded(false)}
        >
          <div className="log-panel log-panel-large" ref={modalPanelRef}>
            {renderContent()}
          </div>
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
