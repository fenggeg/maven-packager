import {
  Button,
  Descriptions,
  Empty,
  Input,
  Modal,
  Popconfirm,
  Progress,
  Space,
  Table,
  Tag,
  Tooltip,
  Typography
} from 'antd'
import {CopyOutlined, DeleteOutlined, FullscreenOutlined, PlayCircleOutlined} from '@ant-design/icons'
import type {ColumnsType} from 'antd/es/table'
import {useMemo, useRef, useState} from 'react'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {DeploymentStage, DeploymentTask} from '../../types/domain'

const {Text} = Typography

const statusColor: Record<DeploymentTask['status'], string> = {
  pending: 'default',
  uploading: 'processing',
  stopping: 'orange',
  starting: 'cyan',
  checking: 'blue',
  success: 'green',
  failed: 'red',
  cancelled: 'orange',
}

const statusLabel = (status: DeploymentTask['status']) => {
  switch (status) {
    case 'pending': return '等待中'
    case 'uploading': return '上传中'
    case 'stopping': return '停止中'
    case 'starting': return '执行中'
    case 'checking': return '检测中'
    case 'success': return '成功'
    case 'failed': return '失败'
    case 'cancelled': return '已取消'
    default: return status
  }
}

const stageStatusColor = (status: DeploymentStage['status']) => {
  switch (status) {
    case 'success': return 'green'
    case 'failed': return 'red'
    case 'timeout': return 'red'
    case 'cancelled': return 'orange'
    case 'skipped': return 'default'
    case 'running':
    case 'checking':
    case 'waiting':
      return 'processing'
    default:
      return 'default'
  }
}

const stageStatusLabel = (status: DeploymentStage['status']) => {
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

const stepTypeLabel = (type?: string) => {
  switch (type) {
    case 'ssh_command': return 'SSH 命令'
    case 'wait': return '等待'
    case 'port_check': return '端口检测'
    case 'http_check': return 'HTTP 健康检查'
    case 'log_check': return '日志关键字检测'
    case 'upload_file': return '文件上传'
    default: return type ?? '-'
  }
}

const formatDuration = (durationMs?: number) => {
  if (!durationMs) {
    return '-'
  }
  return durationMs >= 1000 ? `${(durationMs / 1000).toFixed(1)}s` : `${durationMs}ms`
}

const stageProgress = (stages: DeploymentStage[]) => {
  const total = stages.length
  if (total === 0) {
    return {done: 0, total: 0, percent: 0}
  }
  const done = stages.filter((stage) => ['success', 'skipped'].includes(stage.status)).length
  return {done, total, percent: Math.round((done / total) * 100)}
}

const getFailureReason = (task: DeploymentTask) =>
  task.stages.find((stage) => ['failed', 'timeout', 'cancelled'].includes(stage.status))?.message
  ?? task.log.find((line) => /失败|错误|error|timeout|超时/i.test(line))
  ?? '-'

const classifyLine = (line: string) => {
  const lower = line.toLowerCase()
  if (lower.includes('部署完成') || lower.includes('已替换') || lower.includes('健康检查通过') || lower.includes('检测通过')) {
    return 'success'
  }
  if (lower.includes('停止')) {
    return 'warning'
  }
  if (lower.includes('失败') || lower.includes('错误') || lower.includes('error') || lower.includes('超时') || lower.includes('timeout')) {
    return 'error'
  }
  return ''
}

export function DeploymentHistoryTable() {
  const deploymentTasks = useWorkflowStore((state) => state.deploymentTasks)
  const deploymentLogsByTaskId = useWorkflowStore((state) => state.deploymentLogsByTaskId)
  const deleteDeploymentTask = useWorkflowStore((state) => state.deleteDeploymentTask)
  const rerunDeployment = useWorkflowStore((state) => state.rerunDeployment)
  const [expanded, setExpanded] = useState(false)
  const [openTask, setOpenTask] = useState<DeploymentTask>()
  const [logKeyword, setLogKeyword] = useState('')
  const [logExpanded, setLogExpanded] = useState(false)
  const logModalPanelRef = useRef<HTMLDivElement>(null)

  const columns: ColumnsType<DeploymentTask> = useMemo(() => [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 150,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: '部署对象',
      render: (_, record) => (
        <Space direction="vertical" size={0} className="artifact-item">
          <Text strong ellipsis title={record.deploymentProfileName ?? record.deploymentProfileId}>
            {record.deploymentProfileName ?? record.deploymentProfileId}
          </Text>
          <Text type="secondary" className="artifact-meta" ellipsis title={record.artifactName}>
            {record.serverName ?? record.serverId} · {record.artifactName}
          </Text>
          {record.status === 'failed' || record.status === 'cancelled' ? (
            <Text type="danger" className="artifact-meta" ellipsis title={getFailureReason(record)}>
              {getFailureReason(record)}
            </Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 96,
      render: (value: DeploymentTask['status']) => <Tag color={statusColor[value]}>{statusLabel(value)}</Tag>,
    },
    {
      title: '流程进度',
      width: 138,
      render: (_, record) => {
        const progress = stageProgress(record.stages)
        return (
          <Space direction="vertical" size={2} style={{width: '100%'}}>
            <Progress percent={progress.percent} size="small" showInfo={false} />
            <Text type="secondary">{progress.done}/{progress.total} 个步骤完成</Text>
          </Space>
        )
      },
    },
    {
      title: '操作',
      width: 128,
      render: (_, record) => (
        <Space wrap>
          <Tooltip title="重跑部署">
            <Button
              size="small"
              type="primary"
              icon={<PlayCircleOutlined />}
              onClick={() => void rerunDeployment(record)}
            />
          </Tooltip>
          <Tooltip title="详情">
            <Button
              size="small"
              icon={<FullscreenOutlined />}
              onClick={() => { setOpenTask(record); setLogKeyword('') }}
            />
          </Tooltip>
          <Popconfirm
            title="删除部署记录？"
            description="确定要删除这条部署记录吗？"
            okText="删除"
            okType="danger"
            cancelText="取消"
            onConfirm={() => void deleteDeploymentTask(record.id)}
          >
            <Tooltip title="删除">
              <Button size="small" danger type="text" icon={<DeleteOutlined />} />
            </Tooltip>
          </Popconfirm>
        </Space>
      ),
    },
  ], [])

  const openTaskLogs = openTask ? (deploymentLogsByTaskId[openTask.id] ?? openTask.log ?? []) : []
  const filteredLogs = logKeyword.trim()
    ? openTaskLogs.filter((line) => line.toLowerCase().includes(logKeyword.trim().toLowerCase()))
    : openTaskLogs

  const renderLogContent = () =>
    filteredLogs.length === 0 ? (
      '暂无部署日志'
    ) : (
      filteredLogs.map((line, index) => (
        <pre className={`log-line ${classifyLine(line)}`} key={`dlog-${index}`}>
          {line}
        </pre>
      ))
    )

  const table = (large = false) => (
    <Table
      rowKey="id"
      size={large ? 'middle' : 'small'}
      columns={columns}
      dataSource={deploymentTasks}
      locale={{emptyText: <Empty description="暂无部署记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}}
      pagination={{pageSize: large ? 12 : 6}}
    />
  )

  return (
    <>
      <div className="table-toolbar">
        <Tooltip title="放大查看">
          <Button
            aria-label="放大查看部署记录"
            icon={<FullscreenOutlined />}
            size="small"
            onClick={() => setExpanded(true)}
          />
        </Tooltip>
      </div>
      {table()}
      <Modal
        title="部署记录"
        open={expanded}
        footer={null}
        width="88vw"
        onCancel={() => setExpanded(false)}
      >
        {table(true)}
      </Modal>
      <Modal
        title={openTask ? `部署详情 · ${openTask.deploymentProfileName ?? openTask.id}` : '部署详情'}
        open={Boolean(openTask)}
        footer={null}
        width={900}
        onCancel={() => setOpenTask(undefined)}
      >
        {openTask ? (
          <>
            <Descriptions size="small" bordered column={2}>
              <Descriptions.Item label="状态">
                <Tag color={statusColor[openTask.status]}>{statusLabel(openTask.status)}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="服务器">
                {openTask.serverName ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="部署配置">
                {openTask.deploymentProfileName ?? '-'}
              </Descriptions.Item>
              <Descriptions.Item label="模块">
                {openTask.moduleId}
              </Descriptions.Item>
              <Descriptions.Item label="产物" span={2}>
                {openTask.artifactPath}
              </Descriptions.Item>
              <Descriptions.Item label="失败原因" span={2}>
                {['failed', 'cancelled'].includes(openTask.status) ? getFailureReason(openTask) : '-'}
              </Descriptions.Item>
            </Descriptions>
            <Table
              style={{marginTop: 16}}
              rowKey="key"
              size="small"
              pagination={false}
              dataSource={openTask.stages}
              columns={[
                {title: '阶段', dataIndex: 'label', width: 140},
                {
                  title: '类型',
                  dataIndex: 'type',
                  width: 130,
                  render: (value: string) => stepTypeLabel(value),
                },
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 100,
                  render: (value: DeploymentStage['status']) => (
                    <Tag color={stageStatusColor(value)}>{stageStatusLabel(value)}</Tag>
                  ),
                },
                {
                  title: '耗时',
                  dataIndex: 'durationMs',
                  width: 90,
                  render: (value: number | undefined) => formatDuration(value),
                },
                {
                  title: '重试',
                  width: 90,
                  render: (_, stage) => stage.retryCount ? `${stage.currentRetry ?? 0}/${stage.retryCount}` : '-',
                },
                {
                  title: '结果',
                  render: (_, stage) => stage.message ?? '-',
                },
              ]}
            />
            <Space wrap style={{marginTop: 16, marginBottom: 8}}>
              <Input
                allowClear
                size="small"
                placeholder="搜索日志"
                style={{width: 200}}
                value={logKeyword}
                onChange={(event) => setLogKeyword(event.target.value)}
              />
              <Button
                size="small"
                disabled={openTaskLogs.length === 0}
                icon={<CopyOutlined />}
                onClick={() => void navigator.clipboard?.writeText(openTaskLogs.join('\n'))}
              >
                复制日志
              </Button>
              <Button
                size="small"
                icon={<FullscreenOutlined />}
                onClick={() => setLogExpanded(true)}
              >
                放大查看
              </Button>
            </Space>
            <div className="workflow-log-panel">
              {renderLogContent()}
            </div>
            <Modal
              title={`部署日志 · ${openTask.deploymentProfileName ?? openTask.id}`}
              open={logExpanded}
              footer={null}
              width="85vw"
              onCancel={() => setLogExpanded(false)}
            >
              <div className="log-panel log-panel-large" ref={logModalPanelRef}>
                {renderLogContent()}
              </div>
            </Modal>
          </>
        ) : null}
      </Modal>
    </>
  )
}
