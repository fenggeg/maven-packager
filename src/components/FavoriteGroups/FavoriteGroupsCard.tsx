import {Button, Card, Dropdown, Empty, Input, List, Modal, Space, Typography} from 'antd'
import {
    DeleteOutlined,
    EditOutlined,
    MoreOutlined,
    PushpinFilled,
    PushpinOutlined,
    SaveOutlined
} from '@ant-design/icons'
import {useState} from 'react'
import {useAppStore} from '../../store/useAppStore'
import type {BuildTemplate} from '../../types/domain'

const { Text } = Typography

export function FavoriteGroupsCard() {
  const project = useAppStore((state) => state.project)
  const templates = useAppStore((state) => state.templates)
  const applyTemplate = useAppStore((state) => state.applyTemplate)
  const saveTemplate = useAppStore((state) => state.saveTemplate)
  const updateTemplate = useAppStore((state) => state.updateTemplate)
  const deleteTemplate = useAppStore((state) => state.deleteTemplate)
  const [saving, setSaving] = useState(false)
  const [savingLoading, setSavingLoading] = useState(false)
  const [editing, setEditing] = useState<BuildTemplate>()
  const [editingLoading, setEditingLoading] = useState(false)
  const [name, setName] = useState('')
  const [editingName, setEditingName] = useState('')

  const openEdit = (template: BuildTemplate) => {
    setEditing(template)
    setEditingName(template.name)
  }

  const saveEditing = async () => {
    if (!editing || !editingName.trim()) {
      return
    }
    setEditingLoading(true)
    await updateTemplate({ ...editing, name: editingName.trim() })
    setEditingLoading(false)
    setEditing(undefined)
    setEditingName('')
  }

  return (
    <Card
      title="常用组合"
      className="panel-card favorite-groups-card"
      size="small"
      extra={
        <Button
          size="small"
          type="text"
          icon={<SaveOutlined />}
          disabled={!project}
          onClick={() => setSaving(true)}
        />
      }
    >
      {templates.length === 0 ? (
        <Empty description="暂无常用组合" image={Empty.PRESENTED_IMAGE_SIMPLE} />
      ) : (
        <List
          size="small"
          dataSource={templates}
          renderItem={(template) => (
            <List.Item
              style={{ padding: '6px 0' }}
              actions={[
                <Button key="apply" size="small" type="primary" onClick={() => applyTemplate(template)}>
                  应用
                </Button>,
                <Dropdown
                  key="more"
                  menu={{
                    items: [
                      {
                        key: 'pin',
                        icon: template.pinned ? <PushpinFilled /> : <PushpinOutlined />,
                        label: template.pinned ? '取消置顶' : '置顶',
                        onClick: () => void updateTemplate({ ...template, pinned: !template.pinned }),
                      },
                      {
                        key: 'edit',
                        icon: <EditOutlined />,
                        label: '编辑名称',
                        onClick: () => openEdit(template),
                      },
                      {
                        key: 'delete',
                        icon: <DeleteOutlined />,
                        label: '删除',
                        danger: true,
                        onClick: () => {
                          Modal.confirm({
                            title: '删除常用组合？',
                            content: `确定要删除「${template.name || '未命名组合'}」吗？`,
                            okText: '删除',
                            okType: 'danger',
                            cancelText: '取消',
                            onOk: () => void deleteTemplate(template.id),
                          })
                        },
                      },
                    ],
                  }}
                  trigger={['click']}
                >
                  <Button size="small" type="text" icon={<MoreOutlined />} />
                </Dropdown>,
              ]}
            >
              <Space className="favorite-item" direction="vertical" size={2}>
                <div
                  style={{
                    fontWeight: 'bold',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    maxWidth: '100%',
                  }}
                  title={template.name || '未命名组合'}
                >
                  {template.pinned ? <PushpinFilled className="favorite-pin" /> : null}
                  {template.name || '未命名组合'}
                </div>
                <Text type="secondary" className="favorite-meta" ellipsis={{ tooltip: template.modulePath || '全部项目' }}>
                  {template.modulePath || '全部项目'}
                </Text>
              </Space>
            </List.Item>
          )}
        />
      )}

      <Modal
        title="保存当前选择为常用组合"
        open={saving}
        okText="保存"
        cancelText="取消"
        confirmLoading={savingLoading}
        onCancel={() => {
          if (!savingLoading) {
            setSaving(false)
          }
        }}
        onOk={async () => {
          const trimmed = name.trim()
          if (!trimmed) {
            return
          }
          setSavingLoading(true)
          await saveTemplate(trimmed)
          setSavingLoading(false)
          setName('')
          setSaving(false)
        }}
      >
        <Input
          placeholder="例如 网关联调"
          value={name}
          onChange={(event) => setName(event.target.value)}
        />
      </Modal>
      <Modal
        title="编辑常用组合"
        open={Boolean(editing)}
        okText="保存"
        cancelText="取消"
        confirmLoading={editingLoading}
        onCancel={() => {
          if (!editingLoading) {
            setEditing(undefined)
            setEditingName('')
          }
        }}
        onOk={saveEditing}
      >
        <Input
          placeholder="组合名称"
          value={editingName}
          onChange={(event) => setEditingName(event.target.value)}
        />
      </Modal>
    </Card>
  )
}
