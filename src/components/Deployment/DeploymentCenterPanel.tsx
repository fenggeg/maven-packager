import {
    Alert,
    Button,
    Card,
    Checkbox,
    Empty,
    Input,
    List,
    Modal,
    Popconfirm,
    Select,
    Space,
    Steps,
    Tabs,
    Tag,
    Typography,
} from 'antd'
import {
    CloudServerOutlined,
    DeleteOutlined,
    DeploymentUnitOutlined,
    HistoryOutlined,
    InboxOutlined,
    MinusCircleOutlined,
    PlayCircleOutlined,
    PlusOutlined,
    SaveOutlined,
    StopOutlined,
} from '@ant-design/icons'
import {useEffect, useMemo, useState} from 'react'
import {TaskPipelinePanel} from '../TaskPipeline/TaskPipelinePanel'
import {findDeployableArtifacts, flattenModules, moduleLabel,} from '../../services/deploymentTopologyService'
import {selectLocalFile} from '../../services/tauri-api'
import {useAppStore} from '../../store/useAppStore'
import {useNavigationStore} from '../../store/navigationStore'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {
    BuildArtifact,
    DeploymentCustomCommand,
    DeploymentProfile,
    DeploymentStage,
    SaveServerProfilePayload,
    ServerProfile,
} from '../../types/domain'

const {Text} = Typography

const createServerDraft = (): SaveServerProfilePayload => ({
  name: '',
  host: '',
  port: 22,
  username: '',
  authType: 'private_key',
  password: '',
  privateKeyPath: '',
  group: '',
})

const createDeploymentDraft = (): DeploymentProfile => ({
  id: crypto.randomUUID(),
  name: '',
  moduleId: '',
  localArtifactPattern: '*.jar',
  remoteDeployPath: '',
  customCommands: [],
})

const deploymentStageStatus = (status: DeploymentStage['status']) => {
  switch (status) {
    case 'success': return 'finish'
    case 'failed': return 'error'
    case 'cancelled': return 'error'
    case 'running': return 'process'
    default: return 'wait'
  }
}

const deploymentTaskFinished = (status?: string) =>
  Boolean(status && ['success', 'failed', 'cancelled'].includes(status))

const deploymentTaskLabel = (status: string) => {
  switch (status) {
    case 'success': return '部署完成'
    case 'failed': return '部署失败'
    case 'cancelled': return '已停止'
    default: return '部署中'
  }
}

const deploymentTaskColor = (status: string) => {
  switch (status) {
    case 'success': return 'green'
    case 'failed': return 'red'
    case 'cancelled': return 'orange'
    default: return 'processing'
  }
}

const defaultDeploymentStages: DeploymentStage[] = [
  {key: 'upload', label: '上传产物', status: 'pending'},
  {key: 'stop', label: '停止旧服务', status: 'pending'},
  {key: 'replace', label: '替换文件', status: 'pending'},
  {key: 'start', label: '启动服务', status: 'pending'},
  {key: 'health', label: '健康检查', status: 'pending'},
]

const deploymentProgressCurrent = (stages: DeploymentStage[]) => {
  const activeIndex = stages.findIndex((stage) => stage.status === 'running')
  if (activeIndex >= 0) {
    return activeIndex
  }
  const pendingIndex = stages.findIndex((stage) => stage.status === 'pending')
  if (pendingIndex >= 0) {
    return pendingIndex
  }
  return Math.max(stages.length - 1, 0)
}

const collectArtifacts = (currentArtifacts: BuildArtifact[], historyArtifacts: BuildArtifact[]) => {
  const all = [...currentArtifacts, ...historyArtifacts]
  const seen = new Set<string>()
  return all.filter((artifact) => {
    if (seen.has(artifact.path)) {
      return false
    }
    seen.add(artifact.path)
    return true
  })
}

const normalizePath = (value: string) => value.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase()

export function DeploymentCenterPanel() {
  const project = useAppStore((state) => state.project)
  const artifacts = useAppStore((state) => state.artifacts)
  const history = useAppStore((state) => state.history)
  const buildOptions = useAppStore((state) => state.buildOptions)
  const buildStatus = useAppStore((state) => state.buildStatus)
  const startPackageBuild = useAppStore((state) => state.startPackageBuild)
  const error = useWorkflowStore((state) => state.error)
  const serverProfiles = useWorkflowStore((state) => state.serverProfiles)
  const deploymentProfiles = useWorkflowStore((state) => state.deploymentProfiles)
  const deploymentTasks = useWorkflowStore((state) => state.deploymentTasks)
  const currentDeploymentTask = useWorkflowStore((state) => state.currentDeploymentTask)
  const saveServerProfile = useWorkflowStore((state) => state.saveServerProfile)
  const deleteServerProfile = useWorkflowStore((state) => state.deleteServerProfile)
  const saveDeploymentProfile = useWorkflowStore((state) => state.saveDeploymentProfile)
  const deleteDeploymentProfile = useWorkflowStore((state) => state.deleteDeploymentProfile)
  const startDeployment = useWorkflowStore((state) => state.startDeployment)
  const cancelDeployment = useWorkflowStore((state) => state.cancelDeployment)
  const [serverDraft, setServerDraft] = useState<SaveServerProfilePayload>(createServerDraft())
  const [deploymentDraft, setDeploymentDraft] = useState<DeploymentProfile>(createDeploymentDraft())
  const [selectedDeploymentProfileId, setSelectedDeploymentProfileId] = useState<string>()
  const [selectedServerId, setSelectedServerId] = useState<string>()
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string>()
  const deploymentPreselectProfileId = useNavigationStore((state) => state.deploymentPreselectProfileId)
  const clearDeploymentPreselect = useNavigationStore((state) => state.clearDeploymentPreselect)

  useEffect(() => {
    if (deploymentPreselectProfileId) {
      const id = deploymentPreselectProfileId
      requestAnimationFrame(() => {
        setSelectedDeploymentProfileId(id)
        clearDeploymentPreselect()
      })
    }
  }, [deploymentPreselectProfileId, clearDeploymentPreselect])

  const projectRoot = project?.rootPath ?? ''
  const modules = useMemo(() => flattenModules(project?.modules ?? []), [project?.modules])
  const moduleById = useMemo(
    () => new Map(modules.map((module) => [module.id, module])),
    [modules],
  )
  const artifactPool = useMemo(
    () => {
      const currentProjectRoot = projectRoot ? normalizePath(projectRoot) : ''
      const historyArtifacts = currentProjectRoot
        ? history
            .filter((item) => normalizePath(item.projectRoot) === currentProjectRoot)
            .flatMap((item) => item.artifacts ?? [])
        : []

      return collectArtifacts(artifacts, historyArtifacts)
    },
    [artifacts, history, projectRoot],
  )
  const selectedProfile = deploymentProfiles.find((item) => item.id === selectedDeploymentProfileId)
  const selectedProfileModule = selectedProfile?.moduleId ? moduleById.get(selectedProfile.moduleId) : undefined
  const selectedProfileModuleMissing = Boolean(selectedProfile?.moduleId && !selectedProfileModule)
  const selectedServer = serverProfiles.find((item) => item.id === selectedServerId)
  const deploymentStages = currentDeploymentTask?.stages.length ? currentDeploymentTask.stages : defaultDeploymentStages
  const deploymentRunning = Boolean(currentDeploymentTask && !deploymentTaskFinished(currentDeploymentTask.status))
  const buildRunning = buildStatus === 'RUNNING'
  const packageBuildGoals = buildOptions.goals.some((goal) => ['package', 'install', 'verify', 'deploy'].includes(goal))
    ? buildOptions.goals
    : Array.from(new Set([...(buildOptions.goals.length > 0 ? buildOptions.goals : ['clean']), 'package']))
  const artifactOptions = useMemo(() => {
    if (!selectedProfile || (selectedProfile.moduleId && !selectedProfileModule)) {
      return []
    }

    return findDeployableArtifacts(artifactPool, selectedProfile, modules)
      .map((artifact) => ({
        label: `${artifact.fileName}${artifact.modulePath ? ` · ${artifact.modulePath}` : ''}`,
        value: artifact.path,
      }))
  }, [artifactPool, modules, selectedProfile, selectedProfileModule])
  const showPackageArtifactHint = Boolean(selectedProfile && !selectedProfileModuleMissing && artifactOptions.length === 0)
  const packageTargetLabel = selectedProfileModule?.artifactId ?? '当前项目'
  const buildOptionSummary = [
    packageBuildGoals.join(' '),
    buildOptions.alsoMake ? '同时构建依赖' : '仅目标模块',
    buildOptions.skipTests ? '跳过测试' : '执行测试',
  ].join('；')
  const recentArtifacts = artifactPool.slice(0, 5)
  const recentDeployments = deploymentTasks.slice(0, 5)
  const deploymentSuccessCount = deploymentTasks.filter((task) => task.status === 'success').length
  const runningDeploymentCount = deploymentTasks.filter((task) => !deploymentTaskFinished(task.status)).length
  const topologyRows = deploymentProfiles.slice(0, 6)
  const serverStatus = (serverId: string) => {
    const latestTask = deploymentTasks.find((task) => task.serverId === serverId)
    if (!latestTask) {
      return {label: '空闲', color: 'default'}
    }
    if (latestTask.status === 'success') {
      return {label: '最近成功', color: 'green'}
    }
    if (latestTask.status === 'failed') {
      return {label: '最近失败', color: 'red'}
    }
    if (latestTask.status === 'cancelled') {
      return {label: '已停止', color: 'orange'}
    }
    return {label: '部署中', color: 'processing'}
  }

  const openServer = (profile: ServerProfile) => {
    setServerDraft({
      id: profile.id,
      name: profile.name,
      host: profile.host,
      port: profile.port,
      username: profile.username,
      authType: profile.authType,
      password: '',
      privateKeyPath: profile.privateKeyPath,
      group: profile.group,
    })
  }

  const openDeployment = (profile: DeploymentProfile) => {
    setDeploymentDraft(profile)
  }

  const packageDeploymentArtifact = async () => {
    if (!selectedProfile || selectedProfileModuleMissing) {
      return
    }

    await startPackageBuild(selectedProfile.moduleId ? [selectedProfile.moduleId] : [])
  }

  return (
    <Card title="部署中心" className="panel-card" size="small">
      <Space direction="vertical" size={16} style={{width: '100%'}}>
        {error ? <Alert type="error" showIcon message={error} /> : null}
        <Tabs
          items={[
            {
              key: 'overview',
              label: '首页',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <div className="deployment-summary-grid">
                    <div className="deployment-summary-tile">
                      <InboxOutlined className="deployment-summary-icon" />
                      <div>
                        <Text type="secondary">最近产物</Text>
                        <div className="deployment-summary-number">{recentArtifacts.length}</div>
                      </div>
                    </div>
                    <div className="deployment-summary-tile">
                      <HistoryOutlined className="deployment-summary-icon" />
                      <div>
                        <Text type="secondary">最近部署</Text>
                        <div className="deployment-summary-number">{deploymentTasks.length}</div>
                        <Text type="secondary">{deploymentSuccessCount} 次成功</Text>
                      </div>
                    </div>
                    <div className="deployment-summary-tile">
                      <CloudServerOutlined className="deployment-summary-icon" />
                      <div>
                        <Text type="secondary">环境状态</Text>
                        <div className="deployment-summary-number">{serverProfiles.length}</div>
                        <Text type="secondary">{runningDeploymentCount > 0 ? `${runningDeploymentCount} 个部署中` : '无运行中部署'}</Text>
                      </div>
                    </div>
                  </div>

                  <div className="deployment-overview-grid">
                    <div className="deployment-overview-block">
                      <Space size={8} className="deployment-overview-heading">
                        <InboxOutlined />
                        <Text strong>最近产物</Text>
                      </Space>
                      {recentArtifacts.length === 0 ? (
                        <Empty description="暂无构建产物" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        <List
                          size="small"
                          dataSource={recentArtifacts}
                          renderItem={(artifact) => (
                            <List.Item>
                              <Space direction="vertical" size={0} className="artifact-item">
                                <Text strong ellipsis title={artifact.fileName}>{artifact.fileName}</Text>
                                <Text type="secondary" className="artifact-meta">
                                  {artifact.modulePath || '根项目'} · {(artifact.sizeBytes / 1024 / 1024).toFixed(2)} MB
                                </Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </div>

                    <div className="deployment-overview-block">
                      <Space size={8} className="deployment-overview-heading">
                        <HistoryOutlined />
                        <Text strong>最近部署</Text>
                      </Space>
                      {recentDeployments.length === 0 ? (
                        <Empty description="暂无部署记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                      ) : (
                        <List
                          size="small"
                          dataSource={recentDeployments}
                          renderItem={(task) => (
                            <List.Item>
                              <Space direction="vertical" size={0} className="artifact-item">
                                <Space size={8} wrap>
                                  <Tag color={deploymentTaskColor(task.status)}>{deploymentTaskLabel(task.status)}</Tag>
                                  <Text strong>{task.deploymentProfileName ?? task.deploymentProfileId}</Text>
                                </Space>
                                <Text type="secondary" className="artifact-meta">
                                  {task.serverName ?? task.serverId} · {task.artifactName}
                                </Text>
                              </Space>
                            </List.Item>
                          )}
                        />
                      )}
                    </div>
                  </div>

                  <div className="deployment-overview-block">
                    <Space size={8} className="deployment-overview-heading">
                      <CloudServerOutlined />
                      <Text strong>环境状态</Text>
                    </Space>
                    {serverProfiles.length === 0 ? (
                      <Empty description="暂无环境服务器" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                    ) : (
                      <List
                        size="small"
                        dataSource={serverProfiles}
                        renderItem={(server) => {
                          const status = serverStatus(server.id)
                          return (
                            <List.Item>
                              <Space size={8} wrap>
                                <Tag color={status.color}>{status.label}</Tag>
                                <Text strong>{server.name}</Text>
                                <Text type="secondary">
                                  {server.group || '默认环境'} · {server.username}@{server.host}:{server.port}
                                </Text>
                              </Space>
                            </List.Item>
                          )
                        }}
                      />
                    )}
                  </div>

                  <div className="deployment-overview-block">
                    <Space size={8} className="deployment-overview-heading">
                      <DeploymentUnitOutlined />
                      <Text strong>模块 → 产物 → 服务 → 环境 → 部署配置</Text>
                    </Space>
                    {topologyRows.length === 0 ? (
                      <Alert
                        type="info"
                        showIcon
                        message="尚未建立服务映射"
                        description="在“服务映射”中绑定模块、产物规则和部署配置后，构建成功即可进入部署。"
                      />
                    ) : (
                      <List
                        size="small"
                        dataSource={topologyRows}
                        renderItem={(profile) => (
                          <List.Item>
                            <Space direction="vertical" size={2} className="artifact-item">
                              <Space size={8} wrap>
                                <Tag>{moduleLabel(modules, profile.moduleId)}</Tag>
                                <Text strong>{profile.name}</Text>
                              </Space>
                              <Text type="secondary" className="artifact-meta">
                                {profile.localArtifactPattern} → {profile.name} → 环境服务器 → {profile.remoteDeployPath || '未配置远端目录'}
                              </Text>
                            </Space>
                          </List.Item>
                        )}
                      />
                    )}
                  </div>
                </Space>
              ),
            },
            {
              key: 'server',
              label: '环境资源',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <Space wrap>
                    <Input
                      placeholder="名称"
                      value={serverDraft.name}
                      onChange={(event) => setServerDraft((state) => ({...state, name: event.target.value}))}
                    />
                    <Input
                      placeholder="Host"
                      value={serverDraft.host}
                      onChange={(event) => setServerDraft((state) => ({...state, host: event.target.value}))}
                    />
                    <Input
                      placeholder="端口"
                      style={{width: 100}}
                      value={String(serverDraft.port)}
                      onChange={(event) => setServerDraft((state) => ({...state, port: Number(event.target.value) || 22}))}
                    />
                    <Input
                      placeholder="用户名"
                      value={serverDraft.username}
                      onChange={(event) => setServerDraft((state) => ({...state, username: event.target.value}))}
                    />
                  </Space>
                  <Space wrap>
                    <Select
                      value={serverDraft.authType}
                      style={{width: 160}}
                      options={[
                        {label: '私钥认证', value: 'private_key'},
                        {label: '密码认证', value: 'password'},
                      ]}
                      onChange={(value) => setServerDraft((state) => ({...state, authType: value}))}
                    />
                    {serverDraft.authType === 'private_key' ? (
                      <Input
                        placeholder="私钥路径"
                        style={{minWidth: 280}}
                        value={serverDraft.privateKeyPath}
                        onChange={(event) => setServerDraft((state) => ({...state, privateKeyPath: event.target.value}))}
                      />
                    ) : (
                      <Input.Password
                        placeholder="密码（留空则保留原密码）"
                        style={{minWidth: 260}}
                        value={serverDraft.password}
                        onChange={(event) => setServerDraft((state) => ({...state, password: event.target.value}))}
                      />
                    )}
                    <Input
                      placeholder="分组"
                      value={serverDraft.group}
                      onChange={(event) => setServerDraft((state) => ({...state, group: event.target.value}))}
                    />
                    <Button
                      type="primary"
                      icon={<SaveOutlined />}
                      onClick={() => void saveServerProfile(serverDraft)}
                    >
                      保存服务器
                    </Button>
                    <Button onClick={() => setServerDraft(createServerDraft())}>重置</Button>
                  </Space>
                  {serverProfiles.length === 0 ? (
                    <Empty description="暂无服务器配置" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      bordered
                      dataSource={serverProfiles}
                      renderItem={(profile) => (
                        <List.Item
                          actions={[
                            <Button key="edit" size="small" onClick={() => openServer(profile)}>
                              编辑
                            </Button>,
                            <Popconfirm
                              key="delete"
                              title="删除服务器配置？"
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => void deleteServerProfile(profile.id)}
                            >
                              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                            </Popconfirm>,
                          ]}
                        >
                          <Space direction="vertical" size={2}>
                            <Text strong>{profile.name}</Text>
                            <Text type="secondary">
                              {profile.username}@{profile.host}:{profile.port}
                            </Text>
                            <Space size={8} wrap>
                              <Tag>{profile.authType}</Tag>
                              {profile.passwordConfigured ? <Tag color="gold">已保存密码</Tag> : null}
                              {profile.group ? <Tag>{profile.group}</Tag> : null}
                            </Space>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}
                </Space>
              ),
            },
            {
              key: 'profile',
              label: '服务映射',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <Input
                    addonBefore="服务名称"
                    value={deploymentDraft.name}
                    onChange={(event) => setDeploymentDraft((state) => ({...state, name: event.target.value}))}
                  />
                  <Space wrap>
                    <Select
                      placeholder="绑定模块（用于筛选产物）"
                      style={{minWidth: 260}}
                      value={deploymentDraft.moduleId || undefined}
                      options={modules.map((item) => ({
                        label: `${item.artifactId}${item.relativePath ? ` · ${item.relativePath}` : ''}`,
                        value: item.id,
                      }))}
                      onChange={(value) => setDeploymentDraft((state) => ({...state, moduleId: value}))}
                    />
                    <Input
                      placeholder="产物匹配规则，如 *.jar"
                      style={{minWidth: 220}}
                      value={deploymentDraft.localArtifactPattern}
                      onChange={(event) => setDeploymentDraft((state) => ({...state, localArtifactPattern: event.target.value}))}
                    />
                  </Space>
                  <Input
                    addonBefore="远端目录"
                    value={deploymentDraft.remoteDeployPath}
                    onChange={(event) => setDeploymentDraft((state) => ({...state, remoteDeployPath: event.target.value}))}
                  />
                  <Card title="部署步骤命令" size="small" className="panel-card">
                    <Space direction="vertical" size={12} style={{width: '100%'}}>
                      {deploymentDraft.customCommands.map((cmd, index) => (
                        <Space key={cmd.id} wrap style={{width: '100%'}} align="start">
                          <Checkbox
                            checked={cmd.enabled}
                            onChange={(event) => {
                              const next = [...deploymentDraft.customCommands]
                              next[index] = {...cmd, enabled: event.target.checked}
                              setDeploymentDraft((state) => ({...state, customCommands: next}))
                            }}
                          />
                          <Input
                            placeholder="命令名称"
                            style={{width: 140}}
                            value={cmd.name}
                            onChange={(event) => {
                              const next = [...deploymentDraft.customCommands]
                              next[index] = {...cmd, name: event.target.value}
                              setDeploymentDraft((state) => ({...state, customCommands: next}))
                            }}
                          />
                          <Input
                            placeholder="远端命令或 URL"
                            style={{minWidth: 280, flex: 1}}
                            value={cmd.command}
                            onChange={(event) => {
                              const next = [...deploymentDraft.customCommands]
                              next[index] = {...cmd, command: event.target.value}
                              setDeploymentDraft((state) => ({...state, customCommands: next}))
                            }}
                          />
                          <Button
                            type="text"
                            danger
                            icon={<MinusCircleOutlined />}
                            onClick={() => {
                              const next = deploymentDraft.customCommands.filter((_, i) => i !== index)
                              setDeploymentDraft((state) => ({...state, customCommands: next}))
                            }}
                          />
                        </Space>
                      ))}
                      <Button
                        type="dashed"
                        icon={<PlusOutlined />}
                        onClick={() => {
                          const next: DeploymentCustomCommand[] = [
                            ...deploymentDraft.customCommands,
                            {
                              id: crypto.randomUUID(),
                              name: '',
                              command: '',
                              enabled: true,
                              stage: 'after_replace',
                            },
                          ]
                          setDeploymentDraft((state) => ({...state, customCommands: next}))
                        }}
                      >
                        添加命令
                      </Button>
                    </Space>
                  </Card>

                  <Space wrap>
                    <Button type="primary" icon={<SaveOutlined />} onClick={() => void saveDeploymentProfile(deploymentDraft)}>
                      保存服务映射
                    </Button>
                    <Button onClick={() => setDeploymentDraft(createDeploymentDraft())}>
                      新建映射
                    </Button>
                  </Space>
                  {deploymentProfiles.length === 0 ? (
                    <Empty description="暂无服务映射" image={Empty.PRESENTED_IMAGE_SIMPLE} />
                  ) : (
                    <List
                      bordered
                      dataSource={deploymentProfiles}
                      renderItem={(profile) => (
                        <List.Item
                          actions={[
                            <Button key="edit" size="small" onClick={() => openDeployment(profile)}>
                              编辑
                            </Button>,
                            <Popconfirm
                              key="delete"
                              title="删除服务映射？"
                              okText="删除"
                              cancelText="取消"
                              onConfirm={() => void deleteDeploymentProfile(profile.id)}
                            >
                              <Button size="small" danger icon={<DeleteOutlined />}>删除</Button>
                            </Popconfirm>,
                          ]}
                        >
                            <Space direction="vertical" size={2}>
                            <Text strong>{profile.name}</Text>
                            <Text type="secondary">
                              模块：{profile.moduleId ? (moduleById.get(profile.moduleId)?.artifactId ?? '当前项目不存在该模块') : '未绑定'}
                            </Text>
                            <Text type="secondary">{profile.remoteDeployPath}</Text>
                            <Text type="secondary">匹配：{profile.localArtifactPattern}</Text>
                            <Text type="secondary">
                              命令：{profile.customCommands.filter((c) => c.enabled).length} 条启用
                            </Text>
                          </Space>
                        </List.Item>
                      )}
                    />
                  )}
                </Space>
              ),
            },
            {
              key: 'run',
              label: '部署执行',
              children: (
                <Space direction="vertical" size={16} style={{width: '100%'}}>
                  <Select
                    placeholder="选择服务映射"
                    style={{minWidth: 260}}
                    value={selectedDeploymentProfileId}
                    options={deploymentProfiles.map((item) => ({label: item.name, value: item.id}))}
                    onChange={(value) => {
                      setSelectedDeploymentProfileId(value)
                      setSelectedArtifactPath(undefined)
                    }}
                  />
                  <Select
                    placeholder="选择目标服务器"
                    style={{minWidth: 260}}
                    value={selectedServerId}
                    options={serverProfiles.map((item) => ({
                      label: `${item.name}（${item.username}@${item.host}:${item.port}）`,
                      value: item.id,
                    }))}
                    onChange={setSelectedServerId}
                    notFoundContent="请先在环境资源中添加服务器"
                  />
                  <Select
                    placeholder="选择构建产物（来自配置绑定模块）"
                    style={{minWidth: 260}}
                    value={selectedArtifactPath}
                    options={artifactOptions}
                    onChange={setSelectedArtifactPath}
                    notFoundContent={
                      selectedProfile
                        ? selectedProfileModuleMissing
                          ? '服务映射绑定的模块不在当前项目中'
                          : '当前项目没有匹配该模块和规则的本地产物'
                        : '先选择服务映射'
                    }
                  />
                  {showPackageArtifactHint ? (
                    <Alert
                      type={buildRunning ? 'info' : 'warning'}
                      showIcon
                      message={buildRunning ? '正在打包产物' : '当前没有可部署产物'}
                      description={(
                        <Space direction="vertical" size={4}>
                          <Text type="secondary">
                            目标：{packageTargetLabel}；匹配规则：{selectedProfile?.localArtifactPattern || '*.jar'}
                          </Text>
                          <Text type="secondary">打包选项：{buildOptionSummary}</Text>
                        </Space>
                      )}
                      action={(
                        <Button
                          type="primary"
                          icon={<PlayCircleOutlined />}
                          loading={buildRunning}
                          disabled={buildRunning || !projectRoot}
                          onClick={() => void packageDeploymentArtifact()}
                        >
                          打包产物
                        </Button>
                      )}
                    />
                  ) : null}
                  <Space wrap>
                    <Button
                      onClick={() => {
                        void selectLocalFile('选择要部署的本地产物').then((path) => {
                          if (path) {
                            setSelectedArtifactPath(path)
                          }
                        })
                      }}
                    >
                      手动选择产物
                    </Button>
                    <Button
                      type="primary"
                      icon={<PlayCircleOutlined />}
                      disabled={!selectedDeploymentProfileId || !selectedServerId || !selectedArtifactPath || selectedProfileModuleMissing || deploymentRunning}
                      onClick={() => {
                        Modal.confirm({
                          title: '确认执行部署？',
                          content: `将部署到 ${selectedServer?.name ?? '目标服务器'}（${selectedServer?.host ?? ''}），请确认配置无误。`,
                          okText: '确认部署',
                          cancelText: '取消',
                          onOk: () => startDeployment(selectedDeploymentProfileId!, selectedServerId!, selectedArtifactPath!),
                        })
                      }}
                    >
                      开始部署
                    </Button>
                    <Button
                      danger
                      icon={<StopOutlined />}
                      disabled={!deploymentRunning || !currentDeploymentTask}
                      onClick={() => {
                        if (currentDeploymentTask) {
                          void cancelDeployment(currentDeploymentTask.id)
                        }
                      }}
                    >
                      停止部署
                    </Button>
                  </Space>
                  {selectedProfile ? (
                    <Alert
                      type={selectedProfileModuleMissing ? 'warning' : 'info'}
                      showIcon
                      message={`服务映射：${selectedProfile.name}`}
                      description={`模块：${selectedProfileModule?.artifactId ?? (selectedProfile.moduleId ? '当前项目不存在该模块' : '未绑定')}；目标目录：${selectedProfile.remoteDeployPath}；匹配规则：${selectedProfile.localArtifactPattern}${selectedServer ? `；服务器：${selectedServer.name}` : ''}`}
                    />
                  ) : null}
                  {currentDeploymentTask ? (
                    <div className="pipeline-run-bar">
                      <Space size={8} wrap className="pipeline-run-heading">
                          <Tag color={deploymentTaskColor(currentDeploymentTask.status)}>
                            {deploymentTaskLabel(currentDeploymentTask.status)}
                          </Tag>
                          <Text>{currentDeploymentTask.deploymentProfileName ?? currentDeploymentTask.deploymentProfileId}</Text>
                      </Space>
                      <Text type="secondary" className="path-text">{currentDeploymentTask.artifactPath}</Text>
                      <Steps
                        direction="vertical"
                        size="small"
                        current={deploymentProgressCurrent(deploymentStages)}
                        status={['failed', 'cancelled'].includes(currentDeploymentTask.status) ? 'error' : currentDeploymentTask.status === 'success' ? 'finish' : 'process'}
                        items={deploymentStages.map((stage) => ({
                          title: stage.label,
                          status: deploymentStageStatus(stage.status),
                          description: stage.message,
                        }))}
                      />
                    </div>
                  ) : null}
                </Space>
              ),
            },
            {
              key: 'automation',
              label: '高级自动化',
              children: <TaskPipelinePanel title="高级自动化模板" />,
            },
          ]}
        />
      </Space>
    </Card>
  )
}
