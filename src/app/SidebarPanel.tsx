import {Card, Empty, List, Space, Tabs, Tag, Typography} from 'antd'
import {FavoriteGroupsCard} from '../components/FavoriteGroups/FavoriteGroupsCard'
import {GitStatusCard} from '../components/GitStatus/GitStatusCard'
import {ModuleTreePanel} from '../components/ModuleTree/ModuleTreePanel'
import {ProjectSelector} from '../components/ProjectSelector/ProjectSelector'
import {useAppStore} from '../store/useAppStore'
import {type AppPage} from '../store/navigationStore'
import {useWorkflowStore} from '../store/useWorkflowStore'
import {flattenModules} from '../services/deploymentTopologyService'

const {Text} = Typography

interface SidebarPanelProps {
  activePage: AppPage
}

export function SidebarPanel({activePage}: SidebarPanelProps) {
  const project = useAppStore((state) => state.project)
  const artifacts = useAppStore((state) => state.artifacts)
  const history = useAppStore((state) => state.history)
  const environment = useAppStore((state) => state.environment)
  const serverProfiles = useWorkflowStore((state) => state.serverProfiles)
  const deploymentProfiles = useWorkflowStore((state) => state.deploymentProfiles)
  const deploymentTasks = useWorkflowStore((state) => state.deploymentTasks)

  if (activePage === 'build') {
    return (
      <aside className="sidebar-panel build-sidebar">
        <Tabs
          className="build-sidebar-tabs"
          defaultActiveKey="modules"
          items={[
            {
              key: 'project',
              label: '项目',
              children: <ProjectSelector />,
            },
            {
              key: 'git',
              label: 'Git',
              children: <GitStatusCard />,
            },
            {
              key: 'modules',
              label: '模块',
              children: <ModuleTreePanel />,
            },
            {
              key: 'favorites',
              label: '常用',
              children: <FavoriteGroupsCard />,
            },
          ]}
        />
      </aside>
    )
  }

  if (activePage === 'deployment') {
    return (
      <aside className="sidebar-panel">
        <Card title="部署上下文" className="panel-card" size="small">
          <Space direction="vertical" size={12} style={{width: '100%'}}>
            <div>
              <Text type="secondary">环境列表</Text>
              <List
                size="small"
                dataSource={serverProfiles.slice(0, 8)}
                locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无环境" />}}
                renderItem={(server) => (
                  <List.Item>
                    <Space direction="vertical" size={0}>
                      <Text strong>{server.name}</Text>
                      <Text type="secondary">{server.group || '默认环境'}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
            <div>
              <Text type="secondary">服务列表</Text>
              <List
                size="small"
                dataSource={deploymentProfiles.slice(0, 8)}
                locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无服务映射" />}}
                renderItem={(profile) => (
                  <List.Item>
                    <Space direction="vertical" size={0}>
                      <Text strong>{profile.name}</Text>
                      <Text type="secondary">{profile.localArtifactPattern}</Text>
                    </Space>
                  </List.Item>
                )}
              />
            </div>
          </Space>
        </Card>
      </aside>
    )
  }

  if (activePage === 'artifacts') {
    const modules = flattenModules(project?.modules ?? [])
    return (
      <aside className="sidebar-panel">
        <Card title="产物筛选" className="panel-card" size="small">
          <Space direction="vertical" size={12} style={{width: '100%'}}>
            <Text type="secondary">当前项目</Text>
            <Tag>{project?.artifactId ?? '未选择项目'}</Tag>
            <Text type="secondary">模块数</Text>
            <Tag>{modules.length}</Tag>
            <Text type="secondary">当前产物</Text>
            <Tag color="green">{artifacts.length}</Tag>
            <Text type="secondary">历史记录</Text>
            <Tag color="blue">{history.length}</Tag>
          </Space>
        </Card>
      </aside>
    )
  }

  if (activePage === 'environment') {
    return (
      <aside className="sidebar-panel">
        <Card title="环境摘要" className="panel-card" size="small">
          <Space direction="vertical" size={8} style={{width: '100%'}}>
            <Tag color={environment?.javaVersion ? 'green' : 'orange'}>JDK</Tag>
            <Text type="secondary">{environment?.javaVersion ?? '未识别'}</Text>
            <Tag color={environment?.mavenVersion ? 'green' : 'orange'}>Maven</Tag>
            <Text type="secondary">{environment?.mavenVersion ?? '未识别'}</Text>
            <Tag color={environment?.hasMavenWrapper ? 'blue' : 'default'}>Wrapper</Tag>
            <Text type="secondary">{environment?.hasMavenWrapper ? '可用' : '未发现'}</Text>
            <Tag color={environment?.settingsXmlPath ? 'green' : 'default'}>settings.xml</Tag>
            <Text type="secondary" className="path-text">{environment?.settingsXmlPath ?? '使用默认配置'}</Text>
            <Tag color={environment?.gitPath ? 'green' : 'default'}>Git</Tag>
            <Text type="secondary">{environment?.gitVersion ?? '未识别'}</Text>
          </Space>
        </Card>
      </aside>
    )
  }

  if (activePage === 'history') {
    const buildSuccess = history.filter((h) => h.status === 'SUCCESS').length
    const buildFailed = history.filter((h) => h.status === 'FAILED').length
    const lastBuild = history[0]
    const lastDeployment = deploymentTasks[0]

    return (
      <aside className="sidebar-panel">
        <Card title="历史摘要" className="panel-card" size="small">
          <Space direction="vertical" size={16} style={{width: '100%'}}>
            <div>
              <Text type="secondary">构建记录</Text>
              <div style={{marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                <Tag color="blue">总计 {history.length}</Tag>
                <Tag color="green">成功 {buildSuccess}</Tag>
                <Tag color="red">失败 {buildFailed}</Tag>
              </div>
              {lastBuild ? (
                <Text type="secondary" style={{fontSize: 12, marginTop: 4, display: 'block'}}>
                  最近：{new Date(lastBuild.createdAt).toLocaleString()} · {lastBuild.status === 'SUCCESS' ? '成功' : lastBuild.status === 'FAILED' ? '失败' : '已取消'}
                </Text>
              ) : null}
            </div>
            <div>
              <Text type="secondary">部署记录</Text>
              <div style={{marginTop: 4, display: 'flex', gap: 8, flexWrap: 'wrap'}}>
                <Tag color="blue">总计 {deploymentTasks.length}</Tag>
              </div>
              {lastDeployment ? (
                <Text type="secondary" style={{fontSize: 12, marginTop: 4, display: 'block'}}>
                  最近：{lastDeployment.deploymentProfileName ?? '-'} · {lastDeployment.status}
                </Text>
              ) : null}
            </div>
          </Space>
        </Card>
      </aside>
    )
  }

  if (activePage === 'services') {
    const recentTasks = deploymentTasks.slice(0, 5)
    return (
      <aside className="sidebar-panel">
        <Space direction="vertical" size={16} style={{width: '100%'}}>
          <Card title="服务器资源" className="panel-card" size="small">
            <List
              size="small"
              dataSource={serverProfiles}
              locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无服务器" />}}
              renderItem={(server) => (
                <List.Item>
                  <Space direction="vertical" size={0}>
                    <Text strong>{server.name}</Text>
                    <Text type="secondary">{server.username}@{server.host}:{server.port}</Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
          <Card title="最近部署" className="panel-card" size="small">
            <List
              size="small"
              dataSource={recentTasks}
              locale={{emptyText: <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="暂无部署记录" />}}
              renderItem={(task) => (
                <List.Item>
                  <Space direction="vertical" size={0}>
                    <Space size={4}>
                      <Text strong>{task.deploymentProfileName ?? '-'}</Text>
                      <Tag
                        color={
                          task.status === 'success'
                            ? 'green'
                            : task.status === 'failed'
                              ? 'red'
                              : task.status === 'cancelled'
                                ? 'orange'
                                : 'processing'
                        }
                      >
                        {task.status}
                      </Tag>
                    </Space>
                    <Text type="secondary">
                      {task.serverName ?? task.serverId} · {new Date(task.createdAt).toLocaleString()}
                    </Text>
                  </Space>
                </List.Item>
              )}
            />
          </Card>
        </Space>
      </aside>
    )
  }

  return (
    <aside className="sidebar-panel">
      <Card title="工作区" className="panel-card" size="small">
        <Text type="secondary">选择左侧功能后，这里会显示对应的辅助信息。</Text>
      </Card>
    </aside>
  )
}
