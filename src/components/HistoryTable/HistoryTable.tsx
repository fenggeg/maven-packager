import { Button, List, Modal, Space, Table, Tag, Typography } from 'antd'
import type { ColumnsType } from 'antd/es/table'
import { useState } from 'react'
import { api } from '../../services/tauri-api'
import { useAppStore } from '../../store/useAppStore'
import type { BuildHistoryRecord } from '../../types/domain'

const { Link, Text } = Typography

const statusColor: Record<BuildHistoryRecord['status'], string> = {
  SUCCESS: 'green',
  FAILED: 'red',
  CANCELLED: 'gold',
}

const historyPath = (record: BuildHistoryRecord) => {
  if (!record.modulePath || record.modulePath.includes(',')) {
    return record.projectRoot
  }
  return targetPath(modulePath(record.projectRoot, record.modulePath))
}

const modulePath = (projectRoot: string, moduleRelativePath: string) => {
  const normalizedModulePath = moduleRelativePath.replace(/^\.?[\\/]/, '')
  return `${projectRoot}\\${normalizedModulePath}`
}

const targetPath = (basePath: string) => `${basePath}\\target`

const modulePaths = (record: BuildHistoryRecord) =>
  record.modulePath
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)

const isMultiModuleRecord = (record: BuildHistoryRecord) =>
  modulePaths(record).length > 1

export function HistoryTable() {
  const history = useAppStore((state) => state.history)
  const rerunHistory = useAppStore((state) => state.rerunHistory)
  const [expanded, setExpanded] = useState(false)
  const [openRecord, setOpenRecord] = useState<BuildHistoryRecord>()

  const handleOpen = (record: BuildHistoryRecord) => {
    if (isMultiModuleRecord(record)) {
      setOpenRecord(record)
      return
    }
    void api.openPathInExplorer(historyPath(record))
  }

  const columns: ColumnsType<BuildHistoryRecord> = [
    {
      title: '时间',
      dataIndex: 'createdAt',
      width: 170,
      render: (value: string) => new Date(value).toLocaleString(),
    },
    {
      title: '模块',
      dataIndex: 'moduleArtifactId',
      width: 170,
      ellipsis: true,
      render: (_, record) => {
        const moduleLabel = record.moduleArtifactId ?? (record.modulePath || '全部项目')
        return (
          <Link
            className="history-module-link"
            ellipsis
            title={`${moduleLabel}，点击打开目录`}
            onClick={() => handleOpen(record)}
          >
            {moduleLabel}
          </Link>
        )
      },
    },
    {
      title: '结果',
      dataIndex: 'status',
      width: 110,
      render: (value: BuildHistoryRecord['status']) => <Tag color={statusColor[value]}>{value}</Tag>,
    },
    {
      title: '耗时',
      dataIndex: 'durationMs',
      width: 90,
      render: (value: number) => `${Math.round(value / 1000)}s`,
    },
    {
      title: '操作',
      width: 150,
      render: (_, record) => (
        <Space>
          <Button size="small" onClick={() => rerunHistory(record)}>
            回填
          </Button>
          <Button size="small" onClick={() => handleOpen(record)}>
            打开
          </Button>
        </Space>
      ),
    },
  ]

  const table = (large = false) => (
    <Table
      rowKey="id"
      size={large ? 'middle' : 'small'}
      columns={columns}
      dataSource={history}
      pagination={{ pageSize: large ? 12 : 6 }}
      scroll={{ x: 720 }}
    />
  )

  return (
    <>
      <div className="table-toolbar">
        <Button size="small" onClick={() => setExpanded(true)}>放大</Button>
      </div>
      {table()}
      <Modal
        title="历史记录"
        open={expanded}
        footer={null}
        width="88vw"
        onCancel={() => setExpanded(false)}
      >
        {table(true)}
      </Modal>
      <Modal
        title="选择要打开的模块目录"
        open={Boolean(openRecord)}
        footer={null}
        width={720}
        onCancel={() => setOpenRecord(undefined)}
      >
        {openRecord ? (
          <Space direction="vertical" size={12} style={{ width: '100%' }}>
            <Button onClick={() => void api.openPathInExplorer(openRecord.projectRoot)}>
              打开项目根目录
            </Button>
            <List
              bordered
              dataSource={modulePaths(openRecord)}
              renderItem={(path) => {
                const fullPath = targetPath(modulePath(openRecord.projectRoot, path))
                return (
                  <List.Item
                    actions={[
                      <Button
                        key="open"
                        size="small"
                        onClick={() => void api.openPathInExplorer(fullPath)}
                      >
                        打开
                      </Button>,
                    ]}
                  >
                    <Text className="path-text" ellipsis={{ tooltip: fullPath }}>
                      {path}\target
                    </Text>
                  </List.Item>
                )
              }}
            />
          </Space>
        ) : null}
      </Modal>
    </>
  )
}
