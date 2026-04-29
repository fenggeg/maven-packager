import {Alert, Button, Card, Empty, Input, List, Popconfirm, Space, Typography} from 'antd'
import {DeleteOutlined, FolderOpenOutlined, ReloadOutlined} from '@ant-design/icons'
import {useState} from 'react'
import {useAppStore} from '../../store/useAppStore'

const { Text } = Typography

const projectNameFromPath = (path: string) => {
  const parts = path.split(/[\\/]/).filter(Boolean)
  return parts.at(-1) ?? path
}

interface ProjectSelectorProps {
  framed?: boolean
  onProjectSelected?: () => void
}

export function ProjectSelector({framed = true, onProjectSelected}: ProjectSelectorProps) {
  const project = useAppStore((state) => state.project)
  const savedProjectPaths = useAppStore((state) => state.savedProjectPaths)
  const error = useAppStore((state) => state.error)
  const loading = useAppStore((state) => state.loading)
  const chooseProject = useAppStore((state) => state.chooseProject)
  const parseProjectPath = useAppStore((state) => state.parseProjectPath)
  const removeSavedProject = useAppStore((state) => state.removeSavedProject)
  const [manualPath, setManualPath] = useState('')

  const currentPath = project?.rootPath ?? ''

  const content = (
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <Button
          type="primary"
          icon={<FolderOpenOutlined />}
          block
          loading={loading}
          onClick={chooseProject}
        >
          选择 Maven 项目
        </Button>
        <Input.Search
          placeholder="也可以粘贴项目根目录"
          enterButton={<ReloadOutlined />}
          value={manualPath}
          onChange={(event) => setManualPath(event.target.value)}
          onSearch={(value) => {
            if (value.trim()) {
              void parseProjectPath(value.trim()).then(onProjectSelected)
              setManualPath('')
            }
          }}
        />
        {currentPath ? (
          <Text className="path-text" type="secondary">
            {currentPath}
          </Text>
        ) : (
          <Text type="secondary">请选择包含 pom.xml 的父工程目录。</Text>
        )}
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <div className="project-list-block">
          <Text strong>已保存项目</Text>
          {savedProjectPaths.length === 0 ? (
            <Empty description="暂无保存项目" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              className="project-list"
              dataSource={savedProjectPaths}
              renderItem={(path) => {
                const active = path.toLowerCase() === currentPath.toLowerCase()
                return (
                  <List.Item
                    className={`project-list-item ${active ? 'active' : ''}`}
                    actions={[
                      <Popconfirm
                        key="delete"
                        title="从列表移除该项目？"
                        okText="移除"
                        cancelText="取消"
                        onConfirm={() => void removeSavedProject(path)}
                      >
                        <Button
                          aria-label="移除项目"
                          danger
                          icon={<DeleteOutlined />}
                          size="small"
                          type="text"
                        />
                      </Popconfirm>,
                    ]}
                    onClick={() => {
                      if (!active) {
                        void parseProjectPath(path).then(onProjectSelected)
                      }
                    }}
                  >
                    <Space direction="vertical" size={2} className="project-list-content">
                      <Text strong ellipsis={{ tooltip: projectNameFromPath(path) }}>
                        {projectNameFromPath(path)}
                      </Text>
                      <Text type="secondary" className="project-list-path" ellipsis={{ tooltip: path }}>
                        {path}
                      </Text>
                    </Space>
                  </List.Item>
                )
              }}
            />
          )}
        </div>
      </Space>
  )

  if (!framed) {
    return content
  }

  return (
    <Card title="项目选择" className="panel-card" size="small">
      {content}
    </Card>
  )
}
