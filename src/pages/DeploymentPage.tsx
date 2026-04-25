import {Typography} from 'antd'
import {DeploymentCenterPanel} from '../components/Deployment/DeploymentCenterPanel'

const {Title, Text} = Typography

export function DeploymentPage() {
  return (
    <main className="workspace-page">
      <div className="workspace-heading">
        <div>
          <Title level={3}>部署中心</Title>
          <Text type="secondary">从最近产物进入服务映射、环境选择、部署步骤与健康检查。</Text>
        </div>
      </div>
      <DeploymentCenterPanel />
    </main>
  )
}
