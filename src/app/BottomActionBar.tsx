import {CopyOutlined, PlayCircleOutlined, ReloadOutlined, SaveOutlined, StopOutlined,} from '@ant-design/icons'
import {Button, Input, Modal, Space, Tag, Tooltip, Typography} from 'antd'
import {useState} from 'react'
import {useAppStore} from '../store/useAppStore'
import type {BuildStatus} from '../types/domain'

const {Text} = Typography

const statusText: Record<BuildStatus, string> = {
  IDLE: '待构建',
  RUNNING: '构建中',
  SUCCESS: '成功',
  FAILED: '失败',
  CANCELLED: '已停止',
}

const statusColor: Record<BuildStatus, string> = {
  IDLE: 'default',
  RUNNING: 'processing',
  SUCCESS: 'success',
  FAILED: 'error',
  CANCELLED: 'warning',
}

export function BottomActionBar() {
  const buildOptions = useAppStore((state) => state.buildOptions)
  const buildStatus = useAppStore((state) => state.buildStatus)
  const buildCancelling = useAppStore((state) => state.buildCancelling)
  const selectedModules = useAppStore((state) => state.selectedModules)
  const project = useAppStore((state) => state.project)
  const setEditableCommand = useAppStore((state) => state.setEditableCommand)
  const refreshCommandPreview = useAppStore((state) => state.refreshCommandPreview)
  const startBuild = useAppStore((state) => state.startBuild)
  const cancelBuild = useAppStore((state) => state.cancelBuild)
  const saveTemplate = useAppStore((state) => state.saveTemplate)
  const [commandOpen, setCommandOpen] = useState(false)
  const [templateOpen, setTemplateOpen] = useState(false)
  const [templateName, setTemplateName] = useState('')

  const running = buildStatus === 'RUNNING'
  const commandReady = Boolean(buildOptions.projectRoot && buildOptions.editableCommand.trim())
  const targetLabel = selectedModules.length > 0
    ? selectedModules.length === 1
      ? selectedModules[0].artifactId
      : `${selectedModules.length} 个模块`
    : project
      ? '全部项目'
      : '未选择项目'
  const statusLabel = buildCancelling ? '停止中' : commandReady && buildStatus === 'IDLE' ? '待执行' : statusText[buildStatus]

  return (
    <footer className="bottom-action-bar">
      <div className="bottom-action-status">
        <Tag color={buildCancelling ? 'warning' : commandReady && buildStatus === 'IDLE' ? 'blue' : statusColor[buildStatus]}>
          {statusLabel}
        </Tag>
        <Text strong ellipsis={{tooltip: targetLabel}}>目标：{targetLabel}</Text>
      </div>
      <button
        className="bottom-command-summary"
        type="button"
        disabled={!buildOptions.editableCommand.trim()}
        onClick={() => setCommandOpen(true)}
        title={buildOptions.editableCommand}
      >
        {buildOptions.editableCommand || '选择项目后生成 Maven 命令'}
      </button>
      <Space size={8} className="bottom-actions">
        <Tooltip title="复制命令">
          <Button
            icon={<CopyOutlined />}
            disabled={!buildOptions.editableCommand.trim()}
            onClick={() => void navigator.clipboard?.writeText(buildOptions.editableCommand)}
          />
        </Tooltip>
        <Tooltip title="重新生成命令">
          <Button icon={<ReloadOutlined />} onClick={() => void refreshCommandPreview()} />
        </Tooltip>
        <Tooltip title="保存为模板">
          <Button icon={<SaveOutlined />} disabled={!buildOptions.projectRoot} onClick={() => setTemplateOpen(true)} />
        </Tooltip>
        {running ? (
          <Button
            danger
            icon={<StopOutlined />}
            disabled={buildCancelling}
            onClick={() => void cancelBuild()}
          >
            停止
          </Button>
        ) : (
          <Button
            type="primary"
            icon={<PlayCircleOutlined />}
            disabled={!commandReady}
            onClick={() => void startBuild()}
          >
            开始构建
          </Button>
        )}
      </Space>
      <Modal
        title="完整命令预览"
        open={commandOpen}
        okText="保存修改"
        cancelText="关闭"
        onCancel={() => setCommandOpen(false)}
        onOk={() => setCommandOpen(false)}
      >
        <Input.TextArea
          className="command-textarea"
          autoSize={{minRows: 4, maxRows: 8}}
          value={buildOptions.editableCommand}
          onChange={(event) => setEditableCommand(event.target.value)}
        />
      </Modal>
      <Modal
        title="保存构建模板"
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
    </footer>
  )
}
