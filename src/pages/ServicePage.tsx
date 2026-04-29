import {
  CloudServerOutlined,
  CopyOutlined,
  DatabaseOutlined,
  FileTextOutlined,
  FullscreenOutlined,
  RocketOutlined,
  SearchOutlined
} from '@ant-design/icons'
import {Button, Card, Descriptions, Empty, Input, Modal, Space, Table, Tag, Tooltip, Typography} from 'antd'
import {useMemo, useState} from 'react'
import {LogConsole} from '../components/common/LogConsole'
import {belongsToProject, flattenModules, profileModuleLabel} from '../services/deploymentTopologyService'
import {useAppStore} from '../store/useAppStore'
import {useDeploymentLogStore} from '../store/useDeploymentLogStore'
import {useNavigationStore} from '../store/navigationStore'
import {useWorkflowStore} from '../store/useWorkflowStore'
import type {DeploymentTask} from '../types/domain'

const {Title, Text} = Typography

const statusColor: Record<DeploymentTask['status'], string> = {
  pending: 'default',
  uploading: 'processing',
  stopping: 'orange',
  starting: 'cyan',
  checking: 'blue',
  waiting: 'processing',
  success: 'green',
  failed: 'red',
  timeout: 'red',
  cancelled: 'orange',
}

const statusLabel = (status: DeploymentTask['status']) => {
  switch (status) {
    case 'pending': return '等待中'
    case 'uploading': return '上传中'
    case 'stopping': return '停止中'
    case 'starting': return '启动中'
    case 'checking': return '检查中'
    case 'waiting': return '等待中'
    case 'success': return '成功'
    case 'failed': return '失败'
    case 'timeout': return '已超时'
    case 'cancelled': return '已取消'
    default: return status
  }
}

const stepTypeLabel = (type?: string) => {
  switch (type) {
    case 'ssh_command': return 'SSH 命令'
    case 'wait': return '等待'
    case 'port_check': return '端口检测'
    case 'http_check': return 'HTTP 健康检查'
    case 'log_check': return '日志关键字检测'
    case 'upload_file': return '文件上传'
    case 'startup_probe': return '启动探针'
    default: return type ?? '-'
  }
}

const stageStatusLabel = (status: string) => {
  switch (status) {
    case 'pending': return '等待中'
    case 'waiting': return '等待中'
    case 'running': return '执行中'
    case 'checking': return '检测中'
    case 'success': return '成功'
    case 'failed': return '失败'
    case 'skipped': return '已跳过'
    case 'timeout': return '已超时'
    case 'cancelled': return '已取消'
    default: return status
  }
}

const formatDuration = (durationMs?: number) => {
  if (!durationMs) {
    return '-'
  }
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
}

const classifyLine = (line: string) => {
  const lower = line.toLowerCase()
  if (lower.includes('部署完成') || lower.includes('已替换') || lower.includes('健康检查通过')) {
    return 'success'
  }
  if (lower.includes('停止')) {
    return 'warn'
  }
  if (lower.includes('失败') || lower.includes('错误') || lower.includes('error')) {
    return 'error'
  }
  return ''
}

export function ServicePage() {
  const project = useAppStore((state) => state.project)
  const modules = flattenModules(project?.modules ?? [])
  const deploymentProfiles = useWorkflowStore((state) => state.deploymentProfiles)
  const serverProfiles = useWorkflowStore((state) => state.serverProfiles)
  const deploymentTasks = useWorkflowStore((state) => state.deploymentTasks)
  const navigateToDeployment = useNavigationStore((state) => state.navigateToDeployment)
  const currentProjectDeploymentProfiles = useMemo(
    () => deploymentProfiles.filter((profile) => belongsToProject(profile, project?.rootPath)),
    [deploymentProfiles, project?.rootPath],
  )

  const [openTask, setOpenTask] = useState<DeploymentTask>()
  const [logKeyword, setLogKeyword] = useState('')
  const [logExpanded, setLogExpanded] = useState(false)
  const [serverKeyword, setServerKeyword] = useState('')
  const openTaskBufferedLogs = useDeploymentLogStore(
    (state) => openTask ? state.logsByTaskId[openTask.id] : undefined,
  )

  const latestTaskMap = useMemo(() => {
    const map = new Map<string, DeploymentTask>()
    for (const task of deploymentTasks) {
      const key = `${task.deploymentProfileId}:${task.serverId}`
      const existing = map.get(key)
      if (!existing || task.createdAt > existing.createdAt) {
        map.set(key, task)
      }
    }
    return map
  }, [deploymentTasks])

  const getLatestTask = (profileId: string, serverId: string) =>
    latestTaskMap.get(`${profileId}:${serverId}`)

  const runningCount = deploymentTasks.filter(
    (t) => !['success', 'failed', 'cancelled'].includes(t.status)
  ).length

  const successCount = deploymentTasks.filter((t) => t.status === 'success').length
  const failedCount = deploymentTasks.filter((t) => t.status === 'failed').length

  const openTaskLogs = useMemo(
    () => openTask ? (openTaskBufferedLogs ?? openTask.log ?? []) : [],
    [openTask, openTaskBufferedLogs],
  )
  const logKeywordValue = logKeyword.trim().toLowerCase()
  const filteredLogs = useMemo(
    () => logKeywordValue
      ? openTaskLogs.filter((line) => line.toLowerCase().includes(logKeywordValue))
      : openTaskLogs,
    [logKeywordValue, openTaskLogs],
  )

  return (
    <main className="workspace-page">
      <div className="workspace-heading">
        <div>
          <Title level={3}>服务部署总览</Title>
          <Text type="secondary">一览所有服务在各服务器上的部署状态，快速查看日志或进入部署中心。</Text>
        </div>
      </div>

      <Space size={12} wrap style={{marginBottom: 16}}>
        <Tag icon={<DatabaseOutlined />} color="blue">服务 {currentProjectDeploymentProfiles.length}</Tag>
        <Tag icon={<CloudServerOutlined />} color="purple">服务器 {serverProfiles.length}</Tag>
        <Tag color="processing">运行中 {runningCount}</Tag>
        <Tag color="green">成功 {successCount}</Tag>
        <Tag color="red">失败 {failedCount}</Tag>
      </Space>

      {currentProjectDeploymentProfiles.length === 0 ? (
        <Empty description="暂无服务配置，请先在部署中心添加服务映射" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <Space direction="vertical" size={16} style={{width: '100%'}}>
          {currentProjectDeploymentProfiles.map((profile) => {
            const moduleName = profileModuleLabel(modules, profile)
            return (
              <Card
                key={profile.id}
                title={(
                  <Space size={8}>
                    <span>{profile.name}</span>
                    <Tag>{moduleName}</Tag>
                  </Space>
                )}
                className="panel-card"
                size="small"
                extra={
                  <Tooltip title="去部署">
                    <Button
                      size="small"
                      icon={<RocketOutlined />}
                      onClick={() => navigateToDeployment(profile.id)}
                    />
                  </Tooltip>
                }
              >
                <Space direction="vertical" size={12} style={{width: '100%'}}>
                  <Descriptions size="small" column={3}>
                    <Descriptions.Item label="产物匹配">{profile.localArtifactPattern}</Descriptions.Item>
                    <Descriptions.Item label="远程目录">{profile.remoteDeployPath}</Descriptions.Item>
                    <Descriptions.Item label="部署流程">
                      {profile.deploymentSteps?.length
                        ? `${profile.deploymentSteps.filter((step) => step.enabled).length}/${profile.deploymentSteps.length} 个步骤启用`
                        : `${profile.customCommands.filter((c) => c.enabled).length} 条旧版命令启用`}
                    </Descriptions.Item>
                  </Descriptions>
                  {serverProfiles.length === 0 ? (
                    <Text type="secondary">暂无服务器配置</Text>
                  ) : (
                    <>
                      <Input
                        allowClear
                        size="small"
                        placeholder="搜索服务器名称、地址"
                        prefix={<SearchOutlined />}
                        style={{width: 260, marginBottom: 8}}
                        value={serverKeyword}
                        onChange={(event) => setServerKeyword(event.target.value)}
                      />
                      <Table
                        rowKey="serverId"
                        size="small"
                        pagination={{pageSize: 5, size: 'small', showSizeChanger: false}}
                        dataSource={serverProfiles
                          .filter((server) => {
                            const keyword = serverKeyword.trim().toLowerCase()
                            if (!keyword) return true
                            return [server.name, server.host, server.username, String(server.port)]
                              .filter(Boolean)
                              .some((value) => String(value).toLowerCase().includes(keyword))
                          })
                          .map((server) => {
                            const task = getLatestTask(profile.id, server.id)
                            return {
                              serverId: server.id,
                              serverName: server.name,
                              serverHost: `${server.username}@${server.host}:${server.port}`,
                              task,
                            }
                          })}
                        columns={[
                          {
                            title: '服务器',
                            dataIndex: 'serverName',
                            width: 140,
                          },
                          {
                            title: '地址',
                            dataIndex: 'serverHost',
                            width: 200,
                            ellipsis: true,
                          },
                          {
                            title: '状态',
                            width: 110,
                            render: (_, record) => {
                              const task = record.task
                              if (!task) {
                                return <Tag>未部署</Tag>
                              }
                              return <Tag color={statusColor[task.status]}>{statusLabel(task.status)}</Tag>
                            },
                          },
                          {
                            title: '最近部署',
                            width: 170,
                            render: (_, record) => {
                              const task = record.task
                              if (!task) {
                                return <Text type="secondary">-</Text>
                              }
                              return new Date(task.createdAt).toLocaleString()
                            },
                          },
                          {
                            title: '产物',
                            width: 160,
                            ellipsis: true,
                            render: (_, record) => record.task?.artifactName ?? '-',
                          },
                          {
                            title: '操作',
                            width: 100,
                            render: (_, record) => (
                              <Tooltip title="查看日志">
                                <Button
                                  size="small"
                                  icon={<FileTextOutlined />}
                                  disabled={!record.task}
                                  onClick={() => {
                                    if (record.task) {
                                      setOpenTask(record.task)
                                      setLogKeyword('')
                                    }
                                  }}
                                />
                              </Tooltip>
                            ),
                          },
                        ]}
                        scroll={{x: 780}}
                      />
                    </>
                  )}
                </Space>
              </Card>
            )
          })}
        </Space>
      )}

      <Modal
        title={openTask ? `部署日志 · ${openTask.deploymentProfileName ?? openTask.deploymentProfileId}` : '部署日志'}
        open={Boolean(openTask)}
        footer={null}
        width={900}
        onCancel={() => setOpenTask(undefined)}
      >
        {openTask ? (
          <Space direction="vertical" size={16} style={{width: '100%'}}>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="状态">
                <Tag color={statusColor[openTask.status]}>{statusLabel(openTask.status)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="服务器">
                {openTask.serverName ?? openTask.serverId}
              </Descriptions.Item>
              <Descriptions.Item label="产物" span={2}>
                {openTask.artifactName}
              </Descriptions.Item>
            </Descriptions>
            <Table
              style={{marginTop: 8}}
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={openTask.stages}
              columns={[
                {title: '阶段', dataIndex: 'label', width: 140},
                {
                  title: '类型',
                  dataIndex: 'type',
                  width: 120,
                  render: (value: string) => stepTypeLabel(value),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 100,
                  render: (value: string) => <Tag>{stageStatusLabel(value)}</Tag>,
                },
                {
                  title: '耗时',
                  dataIndex: 'durationMs',
                  width: 90,
                  render: (value: number | undefined) => formatDuration(value),
                },
                {
                  title: '结果',
                  render: (_, stage) => stage.message ?? '-',
                },
              ]}
            />
            <Space wrap style={{marginTop: 8, marginBottom: 8}}>
              <Input
                allowClear
                size="small"
                placeholder="搜索日志"
                style={{width: 200}}
                value={logKeyword}
                onChange={(event) => setLogKeyword(event.target.value)}
              />
              <Tooltip title="复制日志">
                <Button
                  size="small"
                  icon={<CopyOutlined />}
                  disabled={openTaskLogs.length === 0}
                  onClick={() => void navigator.clipboard?.writeText(openTaskLogs.join('\n'))}
                />
              </Tooltip>
              <Tooltip title="放大查看">
                <Button size="small" icon={<FullscreenOutlined />} onClick={() => setLogExpanded(true)} />
              </Tooltip>
            </Space>
            <LogConsole
              className="workflow-log-panel"
              lines={filteredLogs}
              classifyLine={classifyLine}
              emptyTitle="暂无部署日志"
              keyPrefix="service-deployment-log"
            />
            <Modal
              title={`部署日志 · ${openTask.deploymentProfileName ?? openTask.id}`}
              open={logExpanded}
              footer={null}
              width="85vw"
              onCancel={() => setLogExpanded(false)}
            >
              <LogConsole
                className="log-panel log-panel-large"
                lines={filteredLogs}
                classifyLine={classifyLine}
                emptyTitle="暂无部署日志"
                keyPrefix="service-deployment-log-modal"
              />
            </Modal>
          </Space>
        ) : null}
      </Modal>
    </main>
  )
}
