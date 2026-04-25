import {Typography} from 'antd'
import {EnvPanel} from '../components/EnvPanel/EnvPanel'

const {Title, Text} = Typography

export function EnvironmentPage() {
  return (
    <main className="workspace-page">
      <div className="workspace-heading">
        <div>
          <Title level={3}>环境管理</Title>
          <Text type="secondary">管理 JDK、Maven、Wrapper、settings.xml、本地仓库和 Git 检测结果。</Text>
        </div>
      </div>
      <EnvPanel />
    </main>
  )
}
