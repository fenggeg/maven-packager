import {Collapse, Space, Typography} from 'antd'
import {AdvancedOptionsPanel} from '../components/AdvancedOptions/AdvancedOptionsPanel'
import {BuildNextActionsPanel} from '../components/BuildCenter/BuildNextActionsPanel'
import {BuildOptionsPanel} from '../components/BuildOptions/BuildOptionsPanel'
import {EnvPanel} from '../components/EnvPanel/EnvPanel'

const {Title, Text} = Typography

export function BuildPage() {
  return (
    <main className="workspace-page">
      <div className="workspace-heading">
        <div>
          <Title level={3}>构建中心</Title>
          <Text type="secondary">选模块、配参数、开始构建，构建结果会自然流向产物和部署。</Text>
        </div>
      </div>
      <Space direction="vertical" size={20} style={{width: '100%'}}>
        <BuildOptionsPanel />
        <Collapse
          className="workspace-collapse"
          items={[
            {
              key: 'environment',
              label: '构建环境摘要',
              children: <EnvPanel />,
            },
            {
              key: 'advanced',
              label: '高级参数',
              children: <AdvancedOptionsPanel />,
            },
          ]}
        />
        <BuildNextActionsPanel />
      </Space>
    </main>
  )
}
