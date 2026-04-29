import {BranchesOutlined, FolderOutlined} from '@ant-design/icons'
import {Modal, Space, Tag, Typography} from 'antd'
import {useMemo, useState} from 'react'
import {ProjectSelector} from '../components/ProjectSelector/ProjectSelector'
import {UpdateChecker} from '../components/UpdateChecker/UpdateChecker'
import {useAppStore} from '../store/useAppStore'
import {useNavigationStore} from '../store/navigationStore'
import {ActivityBar} from './ActivityBar'
import {BottomActionBar} from './BottomActionBar'
import {InspectorDrawer} from './InspectorDrawer'
import {MainWorkspace} from './MainWorkspace'
import {SidebarPanel} from './SidebarPanel'

const {Text} = Typography

const noSidebarPages = new Set(['deployment', 'artifacts', 'services'])

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
  const [projectSwitcherOpen, setProjectSwitcherOpen] = useState(false)

  const sidebarHidden = noSidebarPages.has(activePage)
  const bodyStyle = useMemo(
    () => ({gridTemplateColumns: sidebarHidden ? '56px minmax(0, 1fr) auto' : undefined}),
    [sidebarHidden],
  )

  return (
    <div className="v3-shell">
      <header className="v3-header">
        <div className="app-header-copy">
          <Space size={8} wrap className="app-context">
            <Tag
              icon={<FolderOutlined />}
              color={project ? 'blue' : 'default'}
              className="quick-project-switch"
              role="button"
              tabIndex={0}
              onClick={() => setProjectSwitcherOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setProjectSwitcherOpen(true)
                }
              }}
            >
              {project?.artifactId ?? '尚未选择项目'}
            </Tag>
            <Tag
              icon={<BranchesOutlined />}
              color={branchStatusColor(gitStatus?.hasLocalChanges, gitStatus?.hasRemoteUpdates)}
            >
              {gitStatus?.branch ?? '未识别分支'}
            </Tag>
            <Text
              type="secondary"
              className="app-path quick-project-switch"
              title={project?.rootPath}
              role="button"
              tabIndex={0}
              onClick={() => setProjectSwitcherOpen(true)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  setProjectSwitcherOpen(true)
                }
              }}
            >
              {project?.rootPath ?? '选择项目后自动识别模块、Git 与构建环境'}
            </Text>
          </Space>
        </div>
        <UpdateChecker />
      </header>
      <div className="v3-body" style={bodyStyle}>
        <ActivityBar />
        <SidebarPanel activePage={activePage} />
        <MainWorkspace activePage={activePage} />
        <InspectorDrawer />
      </div>
      <BottomActionBar />
      <Modal
        title="项目切换"
        open={projectSwitcherOpen}
        footer={null}
        width={640}
        onCancel={() => setProjectSwitcherOpen(false)}
      >
        <ProjectSelector framed={false} onProjectSelected={() => setProjectSwitcherOpen(false)} />
      </Modal>
    </div>
  )
}
