import {Tabs} from 'antd'
import {DeploymentHistoryTable} from '../Deployment/DeploymentHistoryTable'
import {HistoryTable} from './HistoryTable'

export function WorkbenchHistoryPanel() {
  return (
    <Tabs
      items={[
        {
          key: 'build',
          label: '构建记录',
          children: <HistoryTable />,
        },
        {
          key: 'deployment',
          label: '部署记录',
          children: <DeploymentHistoryTable />,
        },
      ]}
    />
  )
}
