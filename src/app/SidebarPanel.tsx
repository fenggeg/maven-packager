import {Card, Space, Tabs, Tag, Typography} from 'antd'
import {FavoriteGroupsCard} from '../components/FavoriteGroups/FavoriteGroupsCard'
import {GitStatusCard} from '../components/GitStatus/GitStatusCard'
import {ModuleTreePanel} from '../components/ModuleTree/ModuleTreePanel'
import {ProjectSelector} from '../components/ProjectSelector/ProjectSelector'
import {useAppStore} from '../store/useAppStore'
import {type AppPage, useNavigationStore} from '../store/navigationStore'
import {useWorkflowStore} from '../store/useWorkflowStore'

const {Text} = Typography

interface SidebarPanelProps {
  activePage: AppPage
}

export function SidebarPanel({activePage}: SidebarPanelProps) {
  const history = useAppStore((state) => state.history)
  const environment = useAppStore((state) => state.environment)
  const deploymentTasks = useWorkflowStore((state) => state.deploymentTasks)
  const buildSidebarTab = useNavigationStore((state) => state.buildSidebarTab)
  const setBuildSidebarTab = useNavigationStore((state) => state.setBuildSidebarTab)

  if (activePage === 'build') {
    return (
      <aside className="sidebar-panel build-sidebar">
        <Tabs
          className="build-sidebar-tabs"
          activeKey={buildSidebarTab}
          onChange={(key) => setBuildSidebarTab(key as typeof buildSidebarTab)}
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

  if (activePage === 'deployment' || activePage === 'artifacts' || activePage === 'services') {
    return null
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

  return (
    <aside className="sidebar-panel">
      <Card title="工作区" className="panel-card" size="small">
        <Text type="secondary">选择左侧功能后，这里会显示对应的辅助信息。</Text>
      </Card>
    </aside>
  )
}
