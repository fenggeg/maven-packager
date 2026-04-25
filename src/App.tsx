import {useEffect} from 'react'
import {App as AntApp, ConfigProvider, theme} from 'antd'
import {AppShell} from './app/AppShell'
import {registerBuildEvents, registerDeploymentEvents} from './services/tauri-api'
import {useAppStore} from './store/useAppStore'
import {useWorkflowStore} from './store/useWorkflowStore'
import './App.css'

function App() {
  const initialize = useAppStore((state) => state.initialize)
  const appendBuildLog = useAppStore((state) => state.appendBuildLog)
  const finishBuild = useAppStore((state) => state.finishBuild)
  const project = useAppStore((state) => state.project)
  const initializeWorkflow = useWorkflowStore((state) => state.initialize)
  const loadDependencyGraph = useWorkflowStore((state) => state.loadDependencyGraph)
  const clearDependencyGraph = useWorkflowStore((state) => state.clearDependencyGraph)
  const appendDeploymentLog = useWorkflowStore((state) => state.appendDeploymentLog)
  const updateDeploymentTask = useWorkflowStore((state) => state.updateDeploymentTask)
  const finishDeploymentTask = useWorkflowStore((state) => state.finishDeploymentTask)

  useEffect(() => {
    initialize()
    void initializeWorkflow()

    let cleanupBuild: (() => void) | undefined
    let cleanupDeployment: (() => void) | undefined
    let disposed = false

    void registerBuildEvents(appendBuildLog, finishBuild).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanupBuild = unlisten
    })
    void registerDeploymentEvents(
      appendDeploymentLog,
      updateDeploymentTask,
      finishDeploymentTask,
    ).then((unlisten) => {
      if (disposed) {
        unlisten()
        return
      }
      cleanupDeployment = unlisten
    })

    return () => {
      disposed = true
      cleanupBuild?.()
      cleanupDeployment?.()
    }
  }, [
    appendBuildLog,
    appendDeploymentLog,
    finishBuild,
    finishDeploymentTask,
    initialize,
    initializeWorkflow,
    updateDeploymentTask,
  ])

  useEffect(() => {
    if (project?.rootPath) {
      void loadDependencyGraph(project.rootPath)
    } else {
      clearDependencyGraph()
    }
  }, [clearDependencyGraph, loadDependencyGraph, project?.rootPath])

  return (
    <ConfigProvider
      theme={{
        algorithm: theme.defaultAlgorithm,
        token: {
          borderRadius: 6,
          colorPrimary: '#16a34a',
          fontFamily: 'Inter, "Segoe UI", "Microsoft YaHei", system-ui, sans-serif',
        },
      }}
    >
      <AntApp>
        <AppShell />
      </AntApp>
    </ConfigProvider>
  )
}

export default App
