import {Typography} from 'antd'
import {WorkbenchHistoryPanel} from '../components/HistoryTable/WorkbenchHistoryPanel'

const {Title, Text} = Typography

export function HistoryPage() {
  return (
    <main className="workspace-page">
      <div className="workspace-heading">
        <div>
          <Title level={3}>历史管理</Title>
          <Text type="secondary">统一查看构建记录、自动化执行和部署记录。</Text>
        </div>
      </div>
      <WorkbenchHistoryPanel />
    </main>
  )
}
