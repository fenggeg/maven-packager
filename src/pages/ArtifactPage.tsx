import {CopyOutlined, DeleteOutlined, FolderOpenOutlined, RocketOutlined} from '@ant-design/icons'
import {Button, Empty, List, Popconfirm, Space, Tag, Tooltip, Typography} from 'antd'
import {api} from '../services/tauri-api'
import {useAppStore} from '../store/useAppStore'
import {useNavigationStore} from '../store/navigationStore'
import type {BuildArtifact} from '../types/domain'

const {Title, Text} = Typography

const formatSize = (size: number) => {
  if (size >= 1024 * 1024) {
    return `${(size / 1024 / 1024).toFixed(2)} MB`
  }
  if (size >= 1024) {
    return `${(size / 1024).toFixed(1)} KB`
  }
  return `${size} B`
}

const dedupeArtifacts = (artifacts: BuildArtifact[]) => {
  const seen = new Set<string>()
  return artifacts.filter((artifact) => {
    if (seen.has(artifact.path)) {
      return false
    }
    seen.add(artifact.path)
    return true
  })
}

export function ArtifactPage() {
  const artifacts = useAppStore((state) => state.artifacts)
  const history = useAppStore((state) => state.history)
  const setActivePage = useNavigationStore((state) => state.setActivePage)
  const removeArtifact = useAppStore((state) => state.removeArtifact)
  const allArtifacts = dedupeArtifacts([
    ...artifacts,
    ...history.flatMap((record) => record.artifacts ?? []),
  ])

  return (
    <main className="workspace-page">
      <div className="workspace-heading">
        <div>
          <Title level={3}>产物管理</Title>
          <Text type="secondary">集中查看构建产物，复制路径、打开目录，并进入部署。</Text>
        </div>
      </div>
      {allArtifacts.length === 0 ? (
        <Empty description="暂无构建产物" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          className="workspace-list"
          bordered
          dataSource={allArtifacts}
          renderItem={(artifact) => (
            <List.Item
              style={{ padding: '8px 12px' }}
              actions={[
                <Tooltip key="copy" title="复制路径">
                  <Button
                    size="small"
                    type="text"
                    icon={<CopyOutlined />}
                    onClick={() => void navigator.clipboard?.writeText(artifact.path)}
                  />
                </Tooltip>,
                <Tooltip key="open" title="打开目录">
                  <Button
                    size="small"
                    type="text"
                    icon={<FolderOpenOutlined />}
                    onClick={() => void api.openPathInExplorer(artifact.path)}
                  />
                </Tooltip>,
                <Popconfirm
                  key="delete"
                  title="删除产物文件？"
                  description={`确定要删除 ${artifact.fileName} 吗？此操作不可恢复。`}
                  okText="删除"
                  okType="danger"
                  cancelText="取消"
                  onConfirm={() => void removeArtifact(artifact.path)}
                >
                  <Tooltip title="删除">
                    <Button
                      size="small"
                      type="text"
                      danger
                      icon={<DeleteOutlined />}
                    />
                  </Tooltip>
                </Popconfirm>,
                <Button
                  key="deploy"
                  size="small"
                  type="primary"
                  icon={<RocketOutlined />}
                  onClick={() => setActivePage('deployment')}
                >
                  部署
                </Button>,
              ]}
            >
              <Space direction="vertical" size={2} style={{maxWidth: '100%'}}>
                <Space size={6} wrap>
                  <Text strong style={{fontSize: 14}}>{artifact.fileName}</Text>
                  <Tag>{artifact.extension}</Tag>
                  <Tag color="green">{formatSize(artifact.sizeBytes)}</Tag>
                </Space>
                <Text type="secondary" style={{fontSize: 12, lineHeight: '16px'}}>
                  {artifact.modulePath || '根项目'}
                </Text>
                <Text type="secondary" className="path-text" style={{fontSize: 11, lineHeight: '14px'}}>
                  {artifact.path}
                </Text>
              </Space>
            </List.Item>
          )}
        />
      )}
    </main>
  )
}
