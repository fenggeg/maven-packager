import {Button, Descriptions, Empty, Input, Modal, Popconfirm, Space, Table, Tag, Tooltip, Typography} from 'antd'
import {CopyOutlined, DeleteOutlined, FullscreenOutlined, PlayCircleOutlined} from '@ant-design/icons'
import type {ColumnsType} from 'antd/es/table'
import {useMemo, useRef, useState} from 'react'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {TaskPipelineRun} from '../../types/domain'

const {Text} = Typography

const statusColor: Record<TaskPipelineRun['status'], string> = {
  running: 'processing',
  success: 'green',
  failed: 'red',
}

const classifyLine = (line: string) => {
  const lower = line.toLowerCase()
  if (lower.includes('任务链执行完成') || lower.includes('步骤完成')) {
    return 'success'
  }
  if (lower.includes('失败') || lower.includes('[error]')) {
    return 'error'
  }
  return ''
}

export function TaskPipelineHistoryTable() {
  const taskPipelineRuns = useWorkflowStore((state) => state.taskPipelineRuns)
  const taskPipelineLogsByRunId = useWorkflowStore((state) => state.taskPipelineLogsByRunId)
  const taskPipelines = useWorkflowStore((state) => state.taskPipelines)
  const deleteTaskPipelineRun = useWorkflowStore((state) => state.deleteTaskPipelineRun)
  const rerunTaskPipeline = useWorkflowStore((state) => state.rerunTaskPipeline)
  const [openRun, setOpenRun] = useState<TaskPipelineRun>()
  const [logKeyword, setLogKeyword] = useState('')
  const [logExpanded, setLogExpanded] = useState(false)
  const logPanelRef = useRef<HTMLDivElement>(null)
  const logModalPanelRef = useRef<HTMLDivElement>(null)

  const columns: ColumnsType<TaskPipelineRun> = useMemo(() => [
    {
      title: '时间',
      dataIndex: 'startedAt',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: '任务链',
      dataIndex: 'pipelineName',
      width: 180,
    },
    {
      title: '状态',
      dataIndex: 'status',
      width: 100,
      render: (value: TaskPipelineRun['status']) => <Tag color={statusColor[value]}>{value}</Tag>,
    },
    {
      title: '耗时',
      dataIndex: 'totalDurationMs',
      width: 100,
      render: (value: number) => `${Math.max(1, Math.round(value / 1000))}s`,
    },
    {
      title: '步骤',
      width: 260,
      render: (_, record) => {
        const successCount = record.steps.filter((step) => step.status === 'success').length
        const failedStep = record.steps.find((step) => step.status === 'failed')
        return (
          <Text type={failedStep ? 'danger' : 'secondary'}>
            {successCount}/{record.steps.length} 完成
            {failedStep ? ` · 失败于 ${failedStep.label}` : ''}
          </Text>
        )
      },
    },
    {
      title: '操作',
      width: 160,
      render: (_, record) => {
        const pipelineExists = taskPipelines.some((p) => p.id === record.pipelineId)
        return (
          <Space wrap>
            <Tooltip title={pipelineExists ? '重跑任务链' : '任务链模板已不存在'}>
              <Button
                size="small"
                type="primary"
                icon={<PlayCircleOutlined />}
                disabled={!pipelineExists}
                onClick={() => void rerunTaskPipeline(record)}
              />
            </Tooltip>
            <Tooltip title="详情">
              <Button
                size="small"
                icon={<FullscreenOutlined />}
                onClick={() => { setOpenRun(record); setLogKeyword('') }}
              />
            </Tooltip>
            <Popconfirm
              title="删除执行记录？"
              description="确定要删除这条任务执行记录吗？"
              okText="删除"
              okType="danger"
              cancelText="取消"
              onConfirm={() => void deleteTaskPipelineRun(record.id)}
            >
              <Tooltip title="删除">
                <Button size="small" danger type="text" icon={<DeleteOutlined />} />
              </Tooltip>
            </Popconfirm>
          </Space>
        )
      },
    },
  ], [])

  const openRunLogs = openRun ? (taskPipelineLogsByRunId[openRun.id] ?? openRun.steps.flatMap((s) => s.output)) : []
  const filteredLogs = logKeyword.trim()
    ? openRunLogs.filter((line) => line.toLowerCase().includes(logKeyword.trim().toLowerCase()))
    : openRunLogs

  const renderLogContent = () =>
    filteredLogs.length === 0 ? (
      <Text type="secondary">暂无执行日志</Text>
    ) : (
      filteredLogs.map((line, index) => (
        <pre className={`log-line ${classifyLine(line)}`} key={`hlog-${index}`}>
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
        dataSource={taskPipelineRuns}
        locale={{emptyText: <Empty description="暂无任务执行记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />}}
        pagination={{pageSize: 6}}
        scroll={{x: 760}}
      />
      <Modal
        title={openRun ? `任务链执行详情 · ${openRun.pipelineName}` : '任务链执行详情'}
        open={Boolean(openRun)}
        footer={null}
        width={900}
        onCancel={() => setOpenRun(undefined)}
      >
        {openRun ? (
          <Space direction="vertical" size={16} style={{width: '100%'}}>
            <Descriptions size="small" column={2} bordered>
              <Descriptions.Item label="状态">
                <Tag color={statusColor[openRun.status]}>{openRun.status}</Tag>
              </Descriptions.Item>
              <Descriptions.Item label="耗时">
                {Math.max(1, Math.round(openRun.totalDurationMs / 1000))}s
              </Descriptions.Item>
              <Descriptions.Item label="开始时间">
                {new Date(openRun.startedAt).toLocaleString()}
              </Descriptions.Item>
              <Descriptions.Item label="模块范围">
                {openRun.moduleIds.length > 0 ? openRun.moduleIds.join(', ') : '全部项目'}
              </Descriptions.Item>
            </Descriptions>
            <Table
              rowKey="stepId"
              size="small"
              pagination={false}
              dataSource={openRun.steps}
              columns={[
                {title: '步骤', dataIndex: 'label', width: 160},
                {title: '类型', dataIndex: 'type', width: 120},
                {
                  title: '状态',
                  dataIndex: 'status',
                  width: 100,
                  render: (value: string) => <Tag color={stepStatusColor(value)}>{value}</Tag>,
                },
                {
                  title: '结果',
                  render: (_, step) => step.message ?? (step.output[0] ?? '-'),
                },
              ]}
            />
            <Space wrap style={{marginBottom: 8}}>
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
                disabled={openRunLogs.length === 0}
                icon={<CopyOutlined />}
                onClick={() => void navigator.clipboard?.writeText(openRunLogs.join('\n'))}
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
            <div className="workflow-log-panel" ref={logPanelRef}>
              {renderLogContent()}
            </div>
            <Modal
              title={`日志 · ${openRun.pipelineName}`}
              open={logExpanded}
              footer={null}
              width="85vw"
              onCancel={() => setLogExpanded(false)}
            >
              <div className="log-panel log-panel-large" ref={logModalPanelRef}>
                {renderLogContent()}
              </div>
            </Modal>
          </Space>
        ) : null}
      </Modal>
    </>
  )
}

const stepStatusColor = (status: string) => {
  switch (status) {
    case 'running': return 'processing'
    case 'success': return 'success'
    case 'failed': return 'error'
    case 'skipped': return 'default'
    default: return 'default'
  }
}
