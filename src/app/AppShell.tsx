import {BranchesOutlined, FolderOutlined} from '@ant-design/icons'
import {Space, Tag, Typography} from 'antd'
import {UpdateChecker} from '../components/UpdateChecker/UpdateChecker'
import {useAppStore} from '../store/useAppStore'
import {useNavigationStore} from '../store/navigationStore'
import {ActivityBar} from './ActivityBar'
import {BottomActionBar} from './BottomActionBar'
import {InspectorDrawer} from './InspectorDrawer'
import {MainWorkspace} from './MainWorkspace'
import {SidebarPanel} from './SidebarPanel'

const {Title, Text} = Typography

const branchStatusColor = (hasLocalChanges?: boolean, hasRemoteUpdates?: boolean) => {
  if (hasRemoteUpdates) {
    return 'orange'
  }
  if (hasLocalChanges) {
    return 'gold'
  }
  return 'green'
}

export function AppShell() {
  const activePage = useNavigationStore((state) => state.activePage)
  const project = useAppStore((state) => state.project)
  const gitStatus = useAppStore((state) => state.gitStatus)

  return (
    <div className="v3-shell">
      <header className="v3-header">
        <div className="app-header-copy">
          <Title level={3} className="app-title">Maven Packager</Title>
          <Space size={8} wrap className="app-context">
            <Tag icon={<FolderOutlined />} color={project ? 'blue' : 'default'}>
              {project?.artifactId ?? '尚未选择项目'}
            </Tag>
            <Tag
              icon={<BranchesOutlined />}
              color={branchStatusColor(gitStatus?.hasLocalChanges, gitStatus?.hasRemoteUpdates)}
            >
              {gitStatus?.branch ?? '未识别分支'}
            </Tag>
            <Text type="secondary" className="app-path" title={project?.rootPath}>
              {project?.rootPath ?? '选择项目后自动识别模块、Git 与构建环境'}
            </Text>
          </Space>
        </div>
        <UpdateChecker />
      </header>
      <div className="v3-body">
        <ActivityBar />
        <SidebarPanel activePage={activePage} />
        <MainWorkspace activePage={activePage} />
        <InspectorDrawer />
      </div>
      <BottomActionBar />
    </div>
  )
}
