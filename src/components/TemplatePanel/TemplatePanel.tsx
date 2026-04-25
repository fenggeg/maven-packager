import {FullscreenOutlined} from '@ant-design/icons'
import {Button, Modal, Popconfirm, Space, Table, Tabs, Tooltip} from 'antd'
import type {ColumnsType} from 'antd/es/table'
import {useState} from 'react'
import {useAppStore} from '../../store/useAppStore'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {BuildTemplate, TaskPipeline} from '../../types/domain'

export function TemplatePanel() {
  const templates = useAppStore((state) => state.templates)
  const applyTemplate = useAppStore((state) => state.applyTemplate)
  const deleteTemplate = useAppStore((state) => state.deleteTemplate)
  const taskPipelines = useWorkflowStore((state) => state.taskPipelines)
  const deleteTaskPipeline = useWorkflowStore((state) => state.deleteTaskPipeline)
  const startTaskPipeline = useWorkflowStore((state) => state.startTaskPipeline)
  const [expanded, setExpanded] = useState(false)

  const columns: ColumnsType<BuildTemplate> = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 160,
    },
    {
      title: '模块',
      dataIndex: 'modulePath',
      render: (value: string) => value || '全部项目',
    },
    {
      title: 'Goals',
      dataIndex: 'goals',
      width: 140,
      render: (value: string[]) => value.join(' '),
    },
    {
      title: '操作',
      width: 160,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => applyTemplate(record)}>
            应用
          </Button>
          <Popconfirm
            title="删除模板？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void deleteTemplate(record.id)}
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const taskColumns: ColumnsType<TaskPipeline> = [
    {
      title: '名称',
      dataIndex: 'name',
      width: 180,
    },
    {
      title: '模块范围',
      dataIndex: 'moduleIds',
      render: (value: string[]) => value.length > 0 ? `${value.length} 个模块` : '全部项目',
    },
    {
      title: '步骤数',
      dataIndex: 'steps',
      width: 90,
      render: (value: TaskPipeline['steps']) => value.length,
    },
    {
      title: '操作',
      width: 180,
      render: (_, record) => (
        <Space>
          <Button size="small" type="primary" onClick={() => void startTaskPipeline(record)}>
            执行
          </Button>
          <Popconfirm
            title="删除自动化模板？"
            okText="删除"
            cancelText="取消"
            onConfirm={() => void deleteTaskPipeline(record.id)}
          >
            <Button size="small" danger>
              删除
            </Button>
          </Popconfirm>
        </Space>
      ),
    },
  ]

  const table = (large = false) => (
    <Tabs
      tabBarExtraContent={
        <Tooltip title="放大查看">
          <Button
            aria-label="放大查看模板"
            icon={<FullscreenOutlined />}
            size="small"
            type="text"
            onClick={() => setExpanded(true)}
          />
        </Tooltip>
      }
      items={[
        {
          key: 'build',
          label: '构建模板',
          children: (
            <Table
              rowKey="id"
              size={large ? 'middle' : 'small'}
              columns={columns}
              dataSource={templates}
              pagination={{ pageSize: large ? 12 : 6 }}
              scroll={{ x: 680 }}
            />
          ),
        },
        {
          key: 'pipeline',
          label: '高级自动化模板',
          children: (
            <Table
              rowKey="id"
              size={large ? 'middle' : 'small'}
              columns={taskColumns}
              dataSource={taskPipelines}
              pagination={{ pageSize: large ? 12 : 6 }}
              scroll={{ x: 680 }}
            />
          ),
        },
      ]}
    />
  )

  return (
    <>
      {table()}
      <Modal
        title="模板"
        open={expanded}
        footer={null}
        width="88vw"
        onCancel={() => setExpanded(false)}
      >
        {table(true)}
      </Modal>
    </>
  )
}
