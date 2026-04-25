import {
    AppstoreOutlined,
    BuildOutlined,
    CloudServerOutlined,
    DatabaseOutlined,
    HistoryOutlined,
    ToolOutlined,
} from '@ant-design/icons'
import {Badge, Button, Tooltip} from 'antd'
import type {ReactNode} from 'react'
import {useAppStore} from '../store/useAppStore'
import {type AppPage, useNavigationStore} from '../store/navigationStore'
import {useWorkflowStore} from '../store/useWorkflowStore'

const pageItems: Array<{key: AppPage; label: string; icon: ReactNode}> = [
  {key: 'build', label: '构建', icon: <BuildOutlined />},
  {key: 'artifacts', label: '产物', icon: <DatabaseOutlined />},
  {key: 'deployment', label: '部署', icon: <CloudServerOutlined />},
  {key: 'services', label: '服务', icon: <AppstoreOutlined />},
  {key: 'environment', label: '环境', icon: <ToolOutlined />},
  {key: 'history', label: '历史', icon: <HistoryOutlined />},
]

const hasRunningDeployment = (status?: string) =>
  Boolean(status && !['success', 'failed', 'cancelled'].includes(status))

export function ActivityBar() {
  const activePage = useNavigationStore((state) => state.activePage)
  const setActivePage = useNavigationStore((state) => state.setActivePage)
  const buildStatus = useAppStore((state) => state.buildStatus)
  const currentDeploymentTask = useWorkflowStore((state) => state.currentDeploymentTask)

  const renderIcon = (item: {key: AppPage; icon: ReactNode}) => {
    const running = (item.key === 'build' && buildStatus === 'RUNNING')
      || (item.key === 'deployment' && hasRunningDeployment(currentDeploymentTask?.status))

    return running ? <Badge status="processing">{item.icon}</Badge> : item.icon
  }

  return (
    <nav className="activity-bar" aria-label="一级功能导航">
      {pageItems.map((item) => (
        <Tooltip key={item.key} title={item.label} placement="right">
          <Button
            type={activePage === item.key ? 'primary' : 'text'}
            className="activity-button"
            icon={renderIcon(item)}
            aria-label={item.label}
            onClick={() => setActivePage(item.key)}
          />
        </Tooltip>
      ))}
    </nav>
  )
}
