import {CopyOutlined, FullscreenOutlined, MenuFoldOutlined, MenuUnfoldOutlined} from '@ant-design/icons'
import {Button, Card, Empty, List, Modal, Space, Tabs, Tag, Typography} from 'antd'
import {useEffect, useMemo, useState} from 'react'
import {BuildLogPanel} from '../components/BuildLogPanel/BuildLogPanel'
import {useAppStore} from '../store/useAppStore'
import {type InspectorTab, useNavigationStore} from '../store/navigationStore'
import {useWorkflowStore} from '../store/useWorkflowStore'
import type {BuildDiagnosis} from '../types/domain'

const {Text} = Typography

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

const deploymentRunning = (status?: string) =>
  Boolean(status && !['success', 'failed', 'cancelled'].includes(status))

export function InspectorDrawer() {
  const inspectorOpen = useNavigationStore((state) => state.inspectorOpen)
  const inspectorTab = useNavigationStore((state) => state.inspectorTab)
  const inspectorLogSource = useNavigationStore((state) => state.inspectorLogSource)
  const setInspectorOpen = useNavigationStore((state) => state.setInspectorOpen)
  const setInspectorTab = useNavigationStore((state) => state.setInspectorTab)
  const setInspectorLogSource = useNavigationStore((state) => state.setInspectorLogSource)
  const buildStatus = useAppStore((state) => state.buildStatus)
  const diagnosis = useAppStore((state) => state.diagnosis)
  const logs = useAppStore((state) => state.logs)
  const artifacts = useAppStore((state) => state.artifacts)
  const selectedModules = useAppStore((state) => state.selectedModules)
  const currentDeploymentTask = useWorkflowStore((state) => state.currentDeploymentTask)
  const currentTaskPipelineRun = useWorkflowStore((state) => state.currentTaskPipelineRun)
  const serverProfiles = useWorkflowStore((state) => state.serverProfiles)
  const deploymentProfiles = useWorkflowStore((state) => state.deploymentProfiles)
  const [expanded, setExpanded] = useState(false)

  useEffect(() => {
    if (buildStatus === 'RUNNING') {
      setInspectorOpen(true)
      setInspectorTab('logs')
      setInspectorLogSource('build')
    }
    if (buildStatus === 'FAILED') {
      setInspectorOpen(true)
      setInspectorTab('diagnosis')
      setInspectorLogSource('build')
    }
    if (deploymentRunning(currentDeploymentTask?.status)) {
      setInspectorOpen(true)
      setInspectorTab('logs')
      setInspectorLogSource('deployment')
    }
    if (currentTaskPipelineRun?.status === 'running') {
      setInspectorOpen(true)
      setInspectorTab('logs')
      setInspectorLogSource('pipeline')
    }
  }, [buildStatus, currentDeploymentTask?.status, currentTaskPipelineRun?.status, setInspectorOpen, setInspectorTab, setInspectorLogSource])

  const diagnosisText = useMemo(() => {
    if (!diagnosis) {
      return ''
    }
    return [
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
      ...diagnosis.keywordLines.map((line) => `> ${line}`),
    ].join('\n')
  }, [diagnosis])

  // ---- Dynamic diagnosis content based on log source ----
  const diagnosisContent = useMemo(() => {
    if (inspectorLogSource === 'build') {
      return (
        <Card
          title="构建诊断"
          className="panel-card"
          size="small"
          extra={(
            <Button
              size="small"
              icon={<CopyOutlined />}
              disabled={!diagnosis}
              onClick={() => void navigator.clipboard?.writeText(diagnosisText)}
            >
              复制
            </Button>
          )}
        >
          {diagnosis ? (
            <Space direction="vertical" size={10} style={{width: '100%'}}>
              <Space size={8} wrap>
                <Tag color="error">{diagnosisCategoryText[diagnosis.category]}</Tag>
                <Text strong>{diagnosis.summary}</Text>
              </Space>
              <Text strong>建议动作</Text>
              <List
                size="small"
                dataSource={diagnosis.suggestedActions}
                renderItem={(item) => <List.Item>{item}</List.Item>}
              />
            </Space>
          ) : (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="构建失败后自动生成诊断" />
          )}
        </Card>
      )
    }

    if (inspectorLogSource === 'pipeline') {
      const run = currentTaskPipelineRun
      const failedStep = run?.steps.find((s) => s.status === 'failed')
      return (
        <Card title="任务链诊断" className="panel-card" size="small">
          {!run ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行中的任务链" />
          ) : (
            <Space direction="vertical" size={10} style={{width: '100%'}}>
              <Space size={8} wrap>
                <Tag color={run.status === 'running' ? 'processing' : run.status === 'success' ? 'success' : 'error'}>
                  {run.status === 'running' ? '执行中' : run.status === 'success' ? '已完成' : '已失败'}
                </Tag>
                <Text strong>{run.pipelineName}</Text>
              </Space>
              <Text type="secondary">
                步骤进度：{run.steps.filter((s) => s.status === 'success').length} / {run.steps.length}
              </Text>
              {failedStep && (
                <>
                  <Text strong type="danger">失败步骤：{failedStep.label}</Text>
                  {failedStep.output && failedStep.output.length > 0 && (
                    <div className="diagnosis-keyword-lines">
                      {failedStep.output.slice(-6).map((line, index) => (
                        <pre key={`${failedStep.stepId}-${index}`}>{line}</pre>
                      ))}
                    </div>
                  )}
                </>
              )}
            </Space>
          )}
        </Card>
      )
    }

    // deployment
    const task = currentDeploymentTask
    const currentStage = task?.stages.find((s) => s.status === 'running') ?? task?.stages.find((s) => s.status === 'failed')
    const server = serverProfiles.find((s) => s.id === task?.serverId)
    const profile = deploymentProfiles.find((p) => p.id === task?.deploymentProfileId)
    return (
      <Card title="部署诊断" className="panel-card" size="small">
        {!task ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无运行中的部署任务" />
        ) : (
          <Space direction="vertical" size={10} style={{width: '100%'}}>
            <Space size={8} wrap>
              <Tag color={task.status === 'success' ? 'success' : task.status === 'pending' ? 'processing' : task.status === 'cancelled' ? 'warning' : 'error'}>
                {task.status === 'success' ? '部署成功' : task.status === 'pending' ? '等待中' : task.status === 'cancelled' ? '已取消' : '部署失败'}
              </Tag>
              <Text strong>{task.artifactName}</Text>
            </Space>
            <Text type="secondary">目标服务器：{server?.name ?? task.serverId} ({server?.host ?? '-'})</Text>
            <Text type="secondary">部署配置：{profile?.name ?? task.deploymentProfileId}</Text>
            {currentStage && (
              <>
                <Text strong type={currentStage.status === 'failed' ? 'danger' : undefined}>
                  当前阶段：{currentStage.label} {currentStage.status === 'failed' ? '· 失败' : currentStage.status === 'running' ? '· 执行中' : ''}
                </Text>
                {task.log && task.log.length > 0 && (
                  <div className="diagnosis-keyword-lines">
                    {task.log.slice(-6).map((line, index) => (
                      <pre key={`${task.id}-${index}`}>{line}</pre>
                    ))}
                  </div>
                )}
              </>
            )}
          </Space>
        )}
      </Card>
    )
  }, [inspectorLogSource, diagnosis, diagnosisText, currentTaskPipelineRun, currentDeploymentTask, serverProfiles, deploymentProfiles])

  // ---- Dynamic details content based on log source ----
  const detailsContent = useMemo(() => {
    if (inspectorLogSource === 'build') {
      return (
        <Card title="构建上下文" className="panel-card" size="small">
          <Space direction="vertical" size={8} style={{width: '100%'}}>
            <Text type="secondary">构建状态：{buildStatus}</Text>
            <Text type="secondary">日志行数：{logs.length}</Text>
            <Text type="secondary">选中模块：{selectedModules.length || '全部项目'}</Text>
            <Text type="secondary">当前产物：{artifacts.length}</Text>
          </Space>
        </Card>
      )
    }

    if (inspectorLogSource === 'pipeline') {
      const run = currentTaskPipelineRun
      return (
        <Card title="任务链上下文" className="panel-card" size="small">
          {!run ? (
            <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无任务链运行记录" />
          ) : (
            <Space direction="vertical" size={8} style={{width: '100%'}}>
              <Text type="secondary">任务链：{run.pipelineName}</Text>
              <Text type="secondary">状态：{run.status}</Text>
              <Text type="secondary">总步骤：{run.steps.length}</Text>
              <Text type="secondary">成功步骤：{run.steps.filter((s) => s.status === 'success').length}</Text>
              <Text type="secondary">失败步骤：{run.steps.filter((s) => s.status === 'failed').length}</Text>
              <Text type="secondary">跳过步骤：{run.steps.filter((s) => s.status === 'skipped').length}</Text>
            </Space>
          )}
        </Card>
      )
    }

    // deployment
    const task = currentDeploymentTask
    const server = serverProfiles.find((s) => s.id === task?.serverId)
    const profile = deploymentProfiles.find((p) => p.id === task?.deploymentProfileId)
    return (
      <Card title="部署上下文" className="panel-card" size="small">
        {!task ? (
          <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="无部署任务记录" />
        ) : (
          <Space direction="vertical" size={8} style={{width: '100%'}}>
            <Text type="secondary">部署产物：{task.artifactName}</Text>
            <Text type="secondary">目标服务器：{server?.name ?? task.serverId} ({server?.host ?? '-'})</Text>
            <Text type="secondary">部署配置：{profile?.name ?? task.deploymentProfileId}</Text>
            <Text type="secondary">状态：{task.status}</Text>
            <Text type="secondary">阶段进度：</Text>
            <Space size={4} wrap>
              {task.stages.map((stage) => (
                <Tag
                  key={stage.key}
                  color={stage.status === 'success' ? 'success' : stage.status === 'failed' ? 'error' : stage.status === 'running' ? 'processing' : 'default'}
                >
                  {stage.label}
                </Tag>
              ))}
            </Space>
          </Space>
        )}
      </Card>
    )
  }, [inspectorLogSource, buildStatus, logs.length, selectedModules.length, artifacts.length, currentTaskPipelineRun, currentDeploymentTask, serverProfiles, deploymentProfiles])

  if (!inspectorOpen) {
    return (
      <aside className="inspector-collapsed">
        <Button
          type="text"
          icon={<MenuUnfoldOutlined />}
          aria-label="展开详情面板"
          onClick={() => setInspectorOpen(true)}
        />
      </aside>
    )
  }

  return (
    <aside className="inspector-drawer">
      <div className="inspector-header">
        <Text strong>Inspector</Text>
        <Space size={4}>
          <Button
            size="small"
            type="text"
            icon={<FullscreenOutlined />}
            aria-label="全屏查看"
            onClick={() => setExpanded(true)}
          />
          <Button
            size="small"
            type="text"
            icon={<MenuFoldOutlined />}
            aria-label="收起详情面板"
            onClick={() => setInspectorOpen(false)}
          />
        </Space>
      </div>
      <Tabs
        className="inspector-tabs"
        activeKey={inspectorTab}
        onChange={(key) => setInspectorTab(key as InspectorTab)}
        items={[
          {
            key: 'logs',
            label: '日志',
            children: <BuildLogPanel />,
          },
          {
            key: 'diagnosis',
            label: inspectorLogSource === 'build' ? '构建诊断' : inspectorLogSource === 'pipeline' ? '任务链诊断' : '部署诊断',
            children: diagnosisContent,
          },
          {
            key: 'details',
            label: inspectorLogSource === 'build' ? '构建详情' : inspectorLogSource === 'pipeline' ? '任务链详情' : '部署详情',
            children: detailsContent,
          },
        ]}
      />
      <Modal
        title="Inspector"
        open={expanded}
        footer={null}
        width="90vw"
        onCancel={() => setExpanded(false)}
      >
        <BuildLogPanel />
      </Modal>
    </aside>
  )
}
