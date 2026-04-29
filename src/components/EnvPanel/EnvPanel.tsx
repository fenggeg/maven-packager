import {Alert, Button, Card, Collapse, Input, Modal, Popconfirm, Segmented, Select, Space, Tag, Typography} from 'antd'
import {
    DeleteOutlined,
    EditOutlined,
    FileSearchOutlined,
    FolderOpenOutlined,
    PlusOutlined,
    ReloadOutlined,
    SettingOutlined,
} from '@ant-design/icons'
import {useState} from 'react'
import {buildEnvironmentCenterItems, sourceText, statusColor,} from '../../services/environmentCenterService'
import {selectLocalDirectory, selectLocalFile} from '../../services/tauri-api'
import {useAppStore} from '../../store/useAppStore'
import type {EnvironmentProfile} from '../../types/domain'

const { Text } = Typography
type EnvProfileMode = 'create' | 'edit'

export function EnvPanel() {
  const environment = useAppStore((state) => state.environment)
  const environmentSettings = useAppStore((state) => state.environmentSettings)
  const updateEnvironment = useAppStore((state) => state.updateEnvironment)
  const refreshEnvironment = useAppStore((state) => state.refreshEnvironment)
  const applyEnvironmentProfile = useAppStore((state) => state.applyEnvironmentProfile)
  const saveEnvironmentProfile = useAppStore((state) => state.saveEnvironmentProfile)
  const deleteEnvironmentProfile = useAppStore((state) => state.deleteEnvironmentProfile)
  const [profileName, setProfileName] = useState('')
  const [profileMode, setProfileMode] = useState<EnvProfileMode>('create')
  const [profileModalOpen, setProfileModalOpen] = useState(false)
  const [pathModalOpen, setPathModalOpen] = useState(false)

  const javaValue = environment?.javaHome ?? ''
  const mavenValue = environment?.mavenHome ?? environment?.mavenPath ?? ''
  const settingsValue = environment?.settingsXmlPath ?? ''
  const localRepoValue = environment?.localRepoPath ?? ''
  const profiles = environmentSettings?.profiles ?? []
  const activeProfile = profiles.find((profile) => profile.id === environmentSettings?.activeProfileId)
  const profileValue = environmentSettings?.activeProfileId ?? '__auto__'
  const items = buildEnvironmentCenterItems(environment)
  const currentExecutor = environment?.useMavenWrapper
    ? environment.mavenWrapperPath ?? 'mvnw.cmd'
    : environment?.mavenPath ?? 'mvn.cmd'

  const updateActiveProfile = (patch: Partial<EnvironmentProfile>) => {
    const profile: EnvironmentProfile = {
      id: activeProfile?.id ?? crypto.randomUUID(),
      name: activeProfile?.name ?? (profileName.trim() || '自定义环境'),
      useMavenWrapper: environment?.useMavenWrapper ?? false,
      ...activeProfile,
      ...patch,
      updatedAt: new Date().toISOString(),
    }
    void updateEnvironment({
      ...(environmentSettings ?? { profiles: [] }),
      activeProfileId: profile.id,
      profiles: [
        profile,
        ...profiles.filter((item) => item.id !== profile.id),
      ],
    })
  }

  const saveJavaHome = (javaHome?: string) =>
    updateActiveProfile({ javaHome })

  const saveMavenHome = (mavenHome?: string) =>
    updateActiveProfile({ mavenHome })

  const saveSettingsXml = (settingsXmlPath?: string) =>
    updateActiveProfile({ settingsXmlPath })

  const saveLocalRepo = (localRepoPath?: string) =>
    updateActiveProfile({ localRepoPath })

  const openCreateProfileModal = () => {
    setProfileMode('create')
    setProfileName('')
    setProfileModalOpen(true)
  }

  const openEditProfileModal = () => {
    setProfileMode('edit')
    setProfileName(activeProfile?.name ?? '')
    setProfileModalOpen(true)
  }

  const submitProfileModal = () => {
    void saveEnvironmentProfile(profileName || activeProfile?.name || '自定义环境')
    setProfileName('')
    setProfileMode('edit')
    setProfileModalOpen(false)
  }

  return (
    <Card
      title="环境中心"
      className="panel-card env-card"
      size="small"
      extra={
        <Button
          size="small"
          icon={<ReloadOutlined />}
          onClick={() => void refreshEnvironment()}
        >
          刷新
        </Button>
      }
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div className="env-profile-panel">
          <Select
            className="env-profile-select"
            value={profileValue}
            options={[
              { label: '自动识别', value: '__auto__' },
              ...profiles.map((profile) => ({
                label: profile.name,
                value: profile.id,
              })),
            ]}
            onChange={(value) => {
              if (value === '__auto__') {
                setProfileMode('create')
                setProfileName('')
                void updateEnvironment({
                  ...(environmentSettings ?? { profiles: [] }),
                  activeProfileId: undefined,
                  profiles,
                })
                return
              }
              setProfileMode('edit')
              const profile = profiles.find((item) => item.id === value)
              setProfileName(profile?.name ?? '')
              void applyEnvironmentProfile(value)
            }}
          />
          <div className="env-profile-actions">
            <Button
              icon={<PlusOutlined />}
              onClick={openCreateProfileModal}
            >
              新增方案
            </Button>
            <Button
              icon={<EditOutlined />}
              disabled={!activeProfile}
              onClick={openEditProfileModal}
            >
              编辑方案
            </Button>
            <Button icon={<SettingOutlined />} onClick={() => setPathModalOpen(true)}>
              手动覆盖
            </Button>
            <Popconfirm
              title="删除当前环境方案？"
              okText="删除"
              cancelText="取消"
              disabled={!activeProfile}
              onConfirm={() => {
                if (activeProfile) {
                  void deleteEnvironmentProfile(activeProfile.id)
                  setProfileMode('create')
                  setProfileName('')
                }
              }}
            >
              <Button danger disabled={!activeProfile} icon={<DeleteOutlined />} />
            </Popconfirm>
          </div>
        </div>

        <div className="env-executor">
          <Text strong>当前执行器</Text>
          <Text className="env-summary-path" title={currentExecutor}>
            {currentExecutor}
          </Text>
        </div>
        <div className="env-summary-grid">
          {items.map((item) => (
            <div className="env-summary-item" key={item.key}>
              <div className="env-summary-main">
                <Text strong className="env-summary-title">
                  {item.title}
                </Text>
                <Space size={4} className="env-summary-tags">
                  <Tag color={statusColor(item.status)}>{item.value}</Tag>
                  <Tag>{sourceText(item.source)}</Tag>
                </Space>
              </div>
              <Text className="env-summary-path" type="secondary" title={item.detail}>
                {item.detail}
              </Text>
            </div>
          ))}

          <div className="env-summary-item env-wrapper-toggle">
            <div className="env-summary-main">
              <Text strong className="env-summary-title">
                执行器切换
              </Text>
              <Segmented
                className="env-executor-toggle"
                size="small"
                value={environment?.useMavenWrapper ? 'wrapper' : 'maven'}
                options={[
                  { label: 'Maven', value: 'maven' },
                  {
                    label: 'mvnw',
                    value: 'wrapper',
                    disabled: !environment?.hasMavenWrapper,
                  },
                ]}
                onChange={(value) =>
                  updateActiveProfile({ useMavenWrapper: value === 'wrapper' })
                }
              />
            </div>
            <Text className="env-summary-path" type="secondary">
              {environment?.hasMavenWrapper ? '可在 Maven 与 Wrapper 间切换' : '当前项目不可切换'}
            </Text>
          </div>
        </div>

        <Collapse
          ghost
          size="small"
          className="env-config-collapse"
          items={[
            {
              key: 'manual',
              label: '手动覆盖路径',
              children: (
                <Button icon={<SettingOutlined />} onClick={() => setPathModalOpen(true)}>
                  打开路径覆盖弹窗
                </Button>
              ),
            },
          ]}
        />

        {environment?.errors.map((error) => (
          <Alert key={error} type="warning" showIcon message={error} />
        ))}
      </Space>
      <Modal
        title={profileMode === 'edit' ? '编辑环境方案' : '新增环境方案'}
        open={profileModalOpen}
        okText={profileMode === 'edit' ? '保存修改' : '新增方案'}
        cancelText="取消"
        onOk={submitProfileModal}
        onCancel={() => setProfileModalOpen(false)}
      >
        <Input
          autoFocus
          placeholder={profileMode === 'edit' ? '编辑当前方案名称' : '新增方案名称'}
          value={profileName}
          onChange={(event) => setProfileName(event.target.value)}
          onPressEnter={submitProfileModal}
        />
      </Modal>
      <Modal
        title="手动覆盖路径"
        open={pathModalOpen}
        okText="完成"
        cancelText="关闭"
        onOk={() => setPathModalOpen(false)}
        onCancel={() => setPathModalOpen(false)}
      >
        <Space direction="vertical" size={10} style={{ width: '100%' }}>
          <div className="env-row">
            <Text className="env-row-label">JDK</Text>
            <Input.Group compact>
              <Input
                key={`java-${javaValue}`}
                className="env-path-input env-path-input-single-action"
                placeholder="选择或粘贴 JDK 目录"
                defaultValue={javaValue}
                onBlur={(event) =>
                  void saveJavaHome(event.target.value.trim() || undefined)
                }
                onPressEnter={(event) => event.currentTarget.blur()}
              />
              <Button
                icon={<FolderOpenOutlined />}
                title="选择 JDK 目录"
                onClick={async () => {
                  const selected = await selectLocalDirectory('选择 JDK 目录')
                  if (selected) {
                    await saveJavaHome(selected)
                  }
                }}
              />
            </Input.Group>
          </div>

          <div className="env-row">
            <Text className="env-row-label">Maven</Text>
            <Input.Group compact>
              <Input
                key={`maven-${mavenValue}`}
                className="env-path-input env-path-input-double-action"
                placeholder="选择或粘贴 Maven 目录 / mvn.cmd"
                defaultValue={mavenValue}
                onBlur={(event) =>
                  void saveMavenHome(event.target.value.trim() || undefined)
                }
                onPressEnter={(event) => event.currentTarget.blur()}
              />
              <Button
                icon={<FileSearchOutlined />}
                title="选择 mvn.cmd"
                onClick={async () => {
                  const selected = await selectLocalFile('选择 mvn.cmd')
                  if (selected) {
                    await saveMavenHome(selected)
                  }
                }}
              />
              <Button
                icon={<FolderOpenOutlined />}
                title="选择 Maven 目录"
                onClick={async () => {
                  const selected = await selectLocalDirectory('选择 Maven 目录')
                  if (selected) {
                    await saveMavenHome(selected)
                  }
                }}
              />
            </Input.Group>
          </div>

          <div className="env-row">
            <Text className="env-row-label">settings.xml</Text>
            <Input.Group compact>
              <Input
                key={`settings-${settingsValue}`}
                className="env-path-input env-path-input-single-action"
                placeholder="选择或粘贴 settings.xml"
                defaultValue={settingsValue}
                onBlur={(event) =>
                  void saveSettingsXml(event.target.value.trim() || undefined)
                }
                onPressEnter={(event) => event.currentTarget.blur()}
              />
              <Button
                icon={<FileSearchOutlined />}
                title="选择 settings.xml"
                onClick={async () => {
                  const selected = await selectLocalFile('选择 settings.xml')
                  if (selected) {
                    await saveSettingsXml(selected)
                  }
                }}
              />
            </Input.Group>
          </div>

          <div className="env-row">
            <Text className="env-row-label">本地仓库</Text>
            <Input.Group compact>
              <Input
                key={`repo-${localRepoValue}`}
                className="env-path-input env-path-input-single-action"
                placeholder="选择或粘贴本地仓库目录"
                defaultValue={localRepoValue}
                onBlur={(event) =>
                  void saveLocalRepo(event.target.value.trim() || undefined)
                }
                onPressEnter={(event) => event.currentTarget.blur()}
              />
              <Button
                icon={<FolderOpenOutlined />}
                title="选择本地仓库目录"
                onClick={async () => {
                  const selected = await selectLocalDirectory('选择本地仓库目录')
                  if (selected) {
                    await saveLocalRepo(selected)
                  }
                }}
              />
            </Input.Group>
          </div>
        </Space>
      </Modal>
    </Card>
  )
}
