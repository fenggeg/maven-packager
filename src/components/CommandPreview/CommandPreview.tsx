import {Button, Card, Input, Modal, Space, Tag, Typography} from 'antd'
import {PlayCircleOutlined, ReloadOutlined, SaveOutlined, StopOutlined} from '@ant-design/icons'
import {useState} from 'react'
import {useAppStore} from '../../store/useAppStore'
import type {BuildStatus} from '../../types/domain'

const { TextArea } = Input
const { Text, Title } = Typography

const statusText: Record<BuildStatus, string> = {
  IDLE: '未开始',
  RUNNING: '执行中',
  SUCCESS: '成功',
  FAILED: '失败',
  CANCELLED: '已取消',
}

const statusColor: Record<BuildStatus, string> = {
  IDLE: 'default',
  RUNNING: 'processing',
  SUCCESS: 'success',
  FAILED: 'error',
  CANCELLED: 'warning',
}

export function CommandPreview() {
  const buildOptions = useAppStore((state) => state.buildOptions)
  const buildStatus = useAppStore((state) => state.buildStatus)
  const durationMs = useAppStore((state) => state.durationMs)
  const setEditableCommand = useAppStore((state) => state.setEditableCommand)
  const refreshCommandPreview = useAppStore((state) => state.refreshCommandPreview)
  const startBuild = useAppStore((state) => state.startBuild)
  const cancelBuild = useAppStore((state) => state.cancelBuild)
  const saveTemplate = useAppStore((state) => state.saveTemplate)
  const [templateName, setTemplateName] = useState('')
  const [templateOpen, setTemplateOpen] = useState(false)

  const running = buildStatus === 'RUNNING'
  const durationText = durationMs ? `${(durationMs / 1000).toFixed(1)} 秒` : '暂无'

  return (
    <Card title="命令预览" className="panel-card command-preview-card" size="small">
      <Space direction="vertical" size={12} style={{ width: '100%' }}>
        <div className="command-status-bar">
          <div>
            <Text type="secondary">当前状态</Text>
            <div>
              <Tag color={statusColor[buildStatus]} className="status-tag">
                {statusText[buildStatus]}
              </Tag>
              <Text type="secondary">耗时：{durationText}</Text>
            </div>
          </div>
          <div className="command-actions">
            <Button icon={<ReloadOutlined />} onClick={() => void refreshCommandPreview()}>
              重新生成
            </Button>
            <Button
              type="primary"
              icon={<PlayCircleOutlined />}
              disabled={!buildOptions.projectRoot || !buildOptions.editableCommand.trim() || running}
              onClick={() => void startBuild()}
            >
              开始打包
            </Button>
            <Button danger icon={<StopOutlined />} disabled={!running} onClick={() => void cancelBuild()}>
              停止
            </Button>
            <Button icon={<SaveOutlined />} disabled={!buildOptions.projectRoot} onClick={() => setTemplateOpen(true)}>
              保存模板
            </Button>
          </div>
        </div>
        <div>
          <Title level={5} className="command-editor-title">最终执行命令</Title>
          <Text type="secondary">
            执行前会使用这里的命令；你可以直接编辑。
          </Text>
        </div>
        <TextArea
          className="command-textarea"
          rows={5}
          value={buildOptions.editableCommand}
          onChange={(event) => setEditableCommand(event.target.value)}
        />
      </Space>
      <Modal
        title="保存常用模板"
        open={templateOpen}
        okText="保存"
        cancelText="取消"
        onCancel={() => setTemplateOpen(false)}
        onOk={() => {
          if (templateName.trim()) {
            void saveTemplate(templateName.trim())
            setTemplateName('')
            setTemplateOpen(false)
          }
        }}
      >
        <Input
          placeholder="模板名称"
          value={templateName}
          onChange={(event) => setTemplateName(event.target.value)}
        />
      </Modal>
    </Card>
  )
}
