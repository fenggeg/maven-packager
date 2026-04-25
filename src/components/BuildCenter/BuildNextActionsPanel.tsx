import {Alert, Button, Card, Empty, List, Select, Space, Tag, Typography} from 'antd'
import {FolderOpenOutlined, RocketOutlined, SettingOutlined} from '@ant-design/icons'
import {useEffect, useMemo, useState} from 'react'
import {api} from '../../services/tauri-api'
import {findDeployableArtifacts, flattenModules, pickDefaultTestServer,} from '../../services/deploymentTopologyService'
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

  const modules = useMemo(() => flattenModules(project?.modules ?? []), [project?.modules])
  const mappedProfiles = useMemo(
    () => deploymentProfiles.filter((profile) =>
      artifacts.some((artifact) => findDeployableArtifacts([artifact], profile, modules).length > 0)),
    [artifacts, deploymentProfiles, modules],
  )
  const selectedProfile = mappedProfiles.find((profile) => profile.id === selectedDeploymentProfileId)
  const artifactOptions = useMemo(
    () => selectedProfile
      ? findDeployableArtifacts(artifacts, selectedProfile, modules).map((artifact) => ({
          label: `${artifact.fileName}${artifact.modulePath ? ` · ${artifact.modulePath}` : ''}`,
          value: artifact.path,
        }))
      : [],
    [artifacts, modules, selectedProfile],
  )
  const deploymentRunning = Boolean(currentDeploymentTask && !deploymentFinished(currentDeploymentTask.status))
  const hasServiceMapping = mappedProfiles.length > 0
  const defaultTestServer = useMemo(() => pickDefaultTestServer(serverProfiles), [serverProfiles])

  useEffect(() => {
    if (!selectedDeploymentProfileId || !mappedProfiles.some((profile) => profile.id === selectedDeploymentProfileId)) {
      setSelectedDeploymentProfileId(mappedProfiles[0]?.id)
    }
  }, [mappedProfiles, selectedDeploymentProfileId])

  useEffect(() => {
    if (!selectedServerId || !serverProfiles.some((server) => server.id === selectedServerId)) {
      setSelectedServerId(defaultTestServer?.id)
    }
  }, [defaultTestServer?.id, selectedServerId, serverProfiles])

  useEffect(() => {
    if (!selectedArtifactPath || !artifactOptions.some((artifact) => artifact.value === selectedArtifactPath)) {
      setSelectedArtifactPath(artifactOptions[0]?.value)
    }
  }, [artifactOptions, selectedArtifactPath])

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
                  value={selectedDeploymentProfileId}
                  options={mappedProfiles.map((profile) => ({label: profile.name, value: profile.id}))}
                  onChange={(value) => {
                    setSelectedDeploymentProfileId(value)
                    setSelectedArtifactPath(undefined)
                  }}
                />
                <Select
                  placeholder="测试环境服务器"
                  style={{minWidth: 240}}
                  value={selectedServerId}
                  options={serverProfiles.map((server) => ({
                    label: `${server.name}${server.group ? ` · ${server.group}` : ''}`,
                    value: server.id,
                  }))}
                  onChange={setSelectedServerId}
                  notFoundContent="请先在部署中心添加服务器"
                />
                <Select
                  placeholder="构建产物"
                  style={{minWidth: 260}}
                  value={selectedArtifactPath}
                  options={artifactOptions}
                  onChange={setSelectedArtifactPath}
                  notFoundContent="当前映射没有匹配产物"
                />
                <Button
                  type="primary"
                  icon={<RocketOutlined />}
                  disabled={!selectedDeploymentProfileId || !selectedServerId || !selectedArtifactPath || deploymentRunning}
                  onClick={() => {
                    if (selectedDeploymentProfileId && selectedServerId && selectedArtifactPath) {
                      void startDeployment(
                        selectedDeploymentProfileId,
                        selectedServerId,
                        selectedArtifactPath,
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
    </Card>
  )
}
