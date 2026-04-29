import {type AppPage} from '../store/navigationStore'
import {lazy, Suspense} from 'react'

interface MainWorkspaceProps {
  activePage: AppPage
}

const pageComponents = {
  build: lazy(() => import('../pages/BuildPage').then((module) => ({default: module.BuildPage}))),
  artifacts: lazy(() => import('../pages/ArtifactPage').then((module) => ({default: module.ArtifactPage}))),
  deployment: lazy(() => import('../pages/DeploymentPage').then((module) => ({default: module.DeploymentPage}))),
  services: lazy(() => import('../pages/ServicePage').then((module) => ({default: module.ServicePage}))),
  environment: lazy(() => import('../pages/EnvironmentPage').then((module) => ({default: module.EnvironmentPage}))),
  history: lazy(() => import('../pages/HistoryPage').then((module) => ({default: module.HistoryPage}))),
} satisfies Record<AppPage, ReturnType<typeof lazy>>

export function MainWorkspace({activePage}: MainWorkspaceProps) {
  const Page = pageComponents[activePage]

  return (
    <section className="main-workspace">
      <Suspense fallback={<div className="workspace-loading">加载工作区...</div>}>
        <Page />
      </Suspense>
    </section>
  )
}
