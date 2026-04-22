import {useEffect} from 'react'
import type {TabsProps} from 'antd'
import {App as AntApp, ConfigProvider, Layout, Tabs, theme, Typography} from 'antd'
import {BuildLogPanel} from './components/BuildLogPanel/BuildLogPanel'
import {BuildOptionsPanel} from './components/BuildOptions/BuildOptionsPanel'
import {CommandPreview} from './components/CommandPreview/CommandPreview'
import {EnvPanel} from './components/EnvPanel/EnvPanel'
import {HistoryTable} from './components/HistoryTable/HistoryTable'
import {ModuleTreePanel} from './components/ModuleTree/ModuleTreePanel'
import {ProjectSelector} from './components/ProjectSelector/ProjectSelector'
import {TemplatePanel} from './components/TemplatePanel/TemplatePanel'
import {UpdateChecker} from './components/UpdateChecker/UpdateChecker'
import {registerBuildEvents} from './services/tauri-api'
import {useAppStore} from './store/useAppStore'
import './App.css'

const { Header, Sider, Content } = Layout
const { Title, Text } = Typography

function App() {
  const initialize = useAppStore((state) => state.initialize)
  const appendBuildLog = useAppStore((state) => state.appendBuildLog)
  const finishBuild = useAppStore((state) => state.finishBuild)

  useEffect(() => {
    initialize()

    let cleanup: (() => void) | undefined
    void registerBuildEvents(appendBuildLog, finishBuild).then((unlisten) => {
      cleanup = unlisten
    })

    return () => cleanup?.()
  }, [appendBuildLog, finishBuild, initialize])

  const tabs: TabsProps['items'] = [
    {
      key: 'history',
      label: '历史记录',
      children: <HistoryTable />,
    },
    {
      key: 'templates',
      label: '常用模板',
      children: <TemplatePanel />,
    },
  ]

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 6,
          colorPrimary: '#167c5b',
          fontFamily:
            'Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
        },
      }}
    >
      <AntApp>
        <Layout className="app-shell">
          <Header className="app-header">
            <div className="app-header-copy">
              <Title level={3} className="app-title">
                Maven 多模块打包工具
              </Title>
              <Text type="secondary">
                选择项目、确认模块、检查环境，然后执行可编辑的 Maven 命令。
              </Text>
            </div>
            <UpdateChecker />
          </Header>
          <Layout className="app-main">
            <Sider width={360} className="app-sider">
              <ProjectSelector />
              <ModuleTreePanel />
            </Sider>
            <Content className="app-content">
              <div className="workbench-grid">
                <section className="workbench-column">
                  <CommandPreview />
                  <EnvPanel />
                  <BuildOptionsPanel />
                </section>
                <section className="workbench-column">
                  <BuildLogPanel />
                  <Tabs items={tabs} className="reuse-tabs" />
                </section>
              </div>
            </Content>
          </Layout>
        </Layout>
      </AntApp>
    </ConfigProvider>
  )
}

export default App
