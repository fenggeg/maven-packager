import {SettingOutlined} from '@ant-design/icons'
import {Card, Space, Typography} from 'antd'
import {TaskPipelinePanel} from '../components/TaskPipeline/TaskPipelinePanel'
import {TemplatePanel} from '../components/TemplatePanel/TemplatePanel'

const {Title, Text} = Typography

export function SettingsPage() {
  return (
    <main className="workspace-page">
      <div className="workspace-heading">
        <div>
          <Title level={3}>设置与高级能力</Title>
          <Text type="secondary">模板、自动化和高级配置集中收纳，不干扰日常构建主流程。</Text>
        </div>
      </div>
      <Space direction="vertical" size={20} style={{width: '100%'}}>
        <Card
          title={(
            <Space size={8}>
              <SettingOutlined />
              <span>模板管理</span>
            </Space>
          )}
          className="panel-card"
          size="small"
        >
          <TemplatePanel />
        </Card>
        <TaskPipelinePanel title="高级自动化配置" />
      </Space>
    </main>
  )
}
