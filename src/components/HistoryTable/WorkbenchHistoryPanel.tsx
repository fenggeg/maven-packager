import {Tabs} from 'antd'
import {DeploymentHistoryTable} from '../Deployment/DeploymentHistoryTable'
import {TaskPipelineHistoryTable} from '../TaskPipeline/TaskPipelineHistoryTable'
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
          key: 'pipeline',
          label: '自动化执行',
          children: <TaskPipelineHistoryTable />,
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
