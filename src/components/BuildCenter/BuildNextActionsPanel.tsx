import {Alert, Button, Card, Empty, Input, List, Modal, Select, Space, Tag, Typography} from 'antd'
import {FolderOpenOutlined, RocketOutlined, SettingOutlined} from '@ant-design/icons'
import {useMemo, useState} from 'react'
import {api} from '../../services/tauri-api'
import {
    belongsToProject,
    findDeployableArtifacts,
    flattenModules,
    normalizeProjectRoot,
    pickDefaultTestServer,
} from '../../services/deploymentTopologyService'
import {useAppStore} from '../../store/useAppStore'
import {useWorkflowStore} from '../../store/useWorkflowStore'

const {Text} = Typography

const deploymentFinished = (status?: string) =>
  Boolean(status && ['success', 'failed', 'cancelled'].includes(status))

export function BuildNextActionsPanel() {
  const project = useAppStore((state) => state.project)
  const buildStatus = useAppStore((state) => state.buildStatus)
  const artifacts = useAppStore((state) => state.artifacts)
  const currentBuildId = useAppStore((state) => state.currentBuildId)
  const deploymentProfiles = useWorkflowStore((state) => state.deploymentProfiles)
  const serverProfiles = useWorkflowStore((state) => state.serverProfiles)
  const currentDeploymentTask = useWorkflowStore((state) => state.currentDeploymentTask)
  const startDeployment = useWorkflowStore((state) => state.startDeployment)
  const [selectedDeploymentProfileId, setSelectedDeploymentProfileId] = useState<string>()
  const [selectedServerId, setSelectedServerId] = useState<string>()
  const [selectedArtifactPath, setSelectedArtifactPath] = useState<string>()
  const [serverPickerOpen, setServerPickerOpen] = useState(false)
  const [serverPickerKeyword, setServerPickerKeyword] = useState('')

  const modules = useMemo(() => flattenModules(project?.modules ?? []), [project?.modules])
  const mappedProfiles = useMemo(
    () => deploymentProfiles.filter((profile) =>
      belongsToProject(profile, project?.rootPath) &&
      artifacts.some((artifact) => findDeployableArtifacts([artifact], profile, modules).length > 0)),
    [artifacts, deploymentProfiles, modules, project?.rootPath],
  )
  const effectiveDeploymentProfileId = mappedProfiles.some((profile) => profile.id === selectedDeploymentProfileId)
    ? selectedDeploymentProfileId
    : mappedProfiles[0]?.id
  const selectedProfile = mappedProfiles.find((profile) => profile.id === effectiveDeploymentProfileId)
  const visibleDeploymentTask = currentDeploymentTask
    && normalizeProjectRoot(currentDeploymentTask.projectRoot) === normalizeProjectRoot(project?.rootPath)
    ? currentDeploymentTask
    : undefined
  const artifactOptions = useMemo(
    () => selectedProfile
      ? findDeployableArtifacts(artifacts, selectedProfile, modules).map((artifact) => ({
          label: `${artifact.fileName}${artifact.modulePath ? ` · ${artifact.modulePath}` : ''}`,
          value: artifact.path,
        }))
      : [],
    [artifacts, modules, selectedProfile],
  )
  const deploymentRunning = Boolean(visibleDeploymentTask && !deploymentFinished(visibleDeploymentTask.status))
  const hasServiceMapping = mappedProfiles.length > 0
  const defaultTestServer = useMemo(() => pickDefaultTestServer(serverProfiles), [serverProfiles])
  const effectiveServerId = serverProfiles.some((server) => server.id === selectedServerId)
    ? selectedServerId
    : defaultTestServer?.id
  const effectiveServer = serverProfiles.find((server) => server.id === effectiveServerId)
  const filteredServers = useMemo(() => {
    const keyword = serverPickerKeyword.trim().toLowerCase()
    if (!keyword) {
      return serverProfiles
    }
    return serverProfiles.filter((server) =>
      [server.name, server.group, server.host, server.username, String(server.port)]
        .filter(Boolean)
        .some((value) => String(value).toLowerCase().includes(keyword)))
  }, [serverPickerKeyword, serverProfiles])
  const effectiveArtifactPath = artifactOptions.some((artifact) => artifact.value === selectedArtifactPath)
    ? selectedArtifactPath
    : artifactOptions[0]?.value

  if (buildStatus !== 'SUCCESS') {
    return null
  }

  return (
    <Card title="下一步操作" className="panel-card next-action-panel" size="small">
      <Space direction="vertical" size={12} style={{width: '100%'}}>
        {artifacts.length === 0 ? (
          <Alert
            type="warning"
            showIcon
            message="构建成功，但未发现 jar/war 产物"
          />
        ) : null}

        {hasServiceMapping ? (
          <div className="next-action-deploy">
            <Space direction="vertical" size={10} style={{width: '100%'}}>
              <Space size={8} wrap>
                <Tag color="green">已有服务映射</Tag>
                <Text strong>可直接部署到测试环境</Text>
              </Space>
              <Space wrap>
                <Select
                  placeholder="服务映射"
                  style={{minWidth: 220}}
                  value={effectiveDeploymentProfileId}
                  options={mappedProfiles.map((profile) => ({label: profile.name, value: profile.id}))}
                  onChange={(value) => {
                    setSelectedDeploymentProfileId(value)
                    setSelectedArtifactPath(undefined)
                  }}
                />
                <div className="deployment-server-select">
                  <Button onClick={() => setServerPickerOpen(true)}>
                    {effectiveServer
                      ? `${effectiveServer.name}（${effectiveServer.username}@${effectiveServer.host}:${effectiveServer.port}）`
                      : '选择测试服务器'}
                  </Button>
                  <Text type="secondary">当前仅支持单服务器部署</Text>
                </div>
                <Select
                  placeholder="构建产物"
                  style={{minWidth: 260}}
                  value={effectiveArtifactPath}
                  options={artifactOptions}
                  onChange={setSelectedArtifactPath}
                  notFoundContent="当前映射没有匹配产物"
                />
                <Button
                  type="primary"
                  icon={<RocketOutlined />}
                  disabled={!effectiveDeploymentProfileId || !effectiveServerId || !effectiveArtifactPath || deploymentRunning}
                  onClick={() => {
                    if (effectiveDeploymentProfileId && effectiveServerId && effectiveArtifactPath) {
                      void startDeployment(
                        effectiveDeploymentProfileId,
                        effectiveServerId,
                        effectiveArtifactPath,
                        currentBuildId,
                      )
                    }
                  }}
                >
                  部署到测试
                </Button>
              </Space>
            </Space>
          </div>
        ) : (
          <Alert
            type="info"
            showIcon
            icon={<SettingOutlined />}
            message="未找到当前产物的服务映射"
            description="请在部署中心的“服务映射”中绑定模块、产物规则、服务名称和部署配置。"
          />
        )}

        {artifacts.length > 0 ? (
          <List
            size="small"
            bordered
            dataSource={artifacts.slice(0, 4)}
            renderItem={(artifact) => (
              <List.Item
                actions={[
                  <Button
                    key="open"
                    size="small"
                    icon={<FolderOpenOutlined />}
                    onClick={() => void api.openPathInExplorer(artifact.path)}
                  >
                    定位
                  </Button>,
                ]}
              >
                <Space direction="vertical" size={0} className="artifact-item">
                  <Text strong ellipsis title={artifact.fileName}>{artifact.fileName}</Text>
                  <Text type="secondary" className="artifact-meta">
                    {artifact.modulePath || '根项目'} · {(artifact.sizeBytes / 1024 / 1024).toFixed(2)} MB
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        ) : (
          <Empty description="暂无可操作产物" image={Empty.PRESENTED_IMAGE_SIMPLE} />
        )}
      </Space>
      <Modal
        title="选择测试服务器"
        open={serverPickerOpen}
        width={720}
        footer={null}
        onCancel={() => setServerPickerOpen(false)}
      >
        <Space direction="vertical" size={12} style={{width: '100%'}}>
          <Input
            allowClear
            placeholder="搜索服务器名称、分组、主机、用户名或端口"
            value={serverPickerKeyword}
            onChange={(event) => setServerPickerKeyword(event.target.value)}
          />
          <List
            bordered
            className="deployment-server-list"
            dataSource={filteredServers}
            locale={{emptyText: '没有匹配的服务器'}}
            renderItem={(server) => (
              <List.Item
                className={server.id === effectiveServerId ? 'deployment-server-item active' : 'deployment-server-item'}
                actions={[
                  <Button
                    key="select"
                    type={server.id === effectiveServerId ? 'primary' : 'default'}
                    size="small"
                    onClick={() => {
                      setSelectedServerId(server.id)
                      setServerPickerOpen(false)
                    }}
                  >
                    {server.id === effectiveServerId ? '已选择' : '选择'}
                  </Button>,
                ]}
              >
                <Space direction="vertical" size={2} className="artifact-item">
                  <Space size={8} wrap>
                    <Text strong>{server.name}</Text>
                    <Tag>{server.group || '默认环境'}</Tag>
                    <Tag>{server.authType === 'password' ? '密码' : '私钥'}</Tag>
                  </Space>
                  <Text type="secondary">
                    {server.username}@{server.host}:{server.port}
                  </Text>
                </Space>
              </List.Item>
            )}
          />
        </Space>
      </Modal>
    </Card>
  )
}
