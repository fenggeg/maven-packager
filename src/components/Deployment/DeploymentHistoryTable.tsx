import {Button, Descriptions, Empty, Input, Modal, Popconfirm, Space, Table, Tag, Tooltip} from 'antd'
import {CopyOutlined, DeleteOutlined, FullscreenOutlined, PlayCircleOutlined} from '@ant-design/icons'
import type {ColumnsType} from 'antd/es/table'
import {useMemo, useRef, useState} from 'react'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {DeploymentTask} from '../../types/domain'

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

const classifyLine = (line: string) => {
  const lower = line.toLowerCase()
  if (lower.includes('部署完成') || lower.includes('已替换') || lower.includes('健康检查通过')) {
    return 'success'
  }
  if (lower.includes('停止')) {
    return 'warning'
  }
  if (lower.includes('失败') || lower.includes('错误') || lower.includes('error')) {
    return 'error'
  }
  return ''
}

export function DeploymentHistoryTable() {
  const deploymentTasks = useWorkflowStore((state) => state.deploymentTasks)
  const deploymentLogsByTaskId = useWorkflowStore((state) => state.deploymentLogsByTaskId)
  const deleteDeploymentTask = useWorkflowStore((state) => state.deleteDeploymentTask)
  const rerunDeployment = useWorkflowStore((state) => state.rerunDeployment)
  const [openTask, setOpenTask] = useState<DeploymentTask>()
  const [logKeyword, setLogKeyword] = useState('')
  const [logExpanded, setLogExpanded] = useState(false)
  const logModalPanelRef = useRef<HTMLDivElement>(null)

  const columns: ColumnsType<DeploymentTask> = useMemo(() => [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: '部署配置',
      dataIndex: 'deploymentProfileName',
      width: 180,
      render: (value?: string) => value ?? '-',
    },
    {
      title: '服务器',
      dataIndex: 'serverName',
      width: 150,
      render: (value?: string) => value ?? '-',
    },
    {
      title: '产物',
      dataIndex: 'artifactName',
      width: 180,
      ellipsis: true,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 110,
      render: (value: DeploymentTask['status']) => <Tag color={statusColor[value]}>{value}</Tag>,
    },
    {
      title: '操作',
      width: 160,
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

  return (
    <>
      <Table
        rowKey="id"
        size="small"
        columns={columns}
        dataSource={deploymentTasks}
        locale={{emptyText: <Empty description="暂无部署记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}}
        pagination={{pageSize: 6}}
        scroll={{x: 820}}
      />
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
                <Tag color={statusColor[openTask.status]}>{openTask.status}</Tag>
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
                  title: '状态',
                  dataIndex: 'status',
                  width: 100,
                  render: (value: string) => <Tag>{value}</Tag>,
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
