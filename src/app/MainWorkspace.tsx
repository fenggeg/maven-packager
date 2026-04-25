import {type AppPage} from '../store/navigationStore'
import type {ReactElement} from 'react'
import {ArtifactPage} from '../pages/ArtifactPage'
import {BuildPage} from '../pages/BuildPage'
import {DeploymentPage} from '../pages/DeploymentPage'
import {EnvironmentPage} from '../pages/EnvironmentPage'
import {HistoryPage} from '../pages/HistoryPage'
import {ServicePage} from '../pages/ServicePage'
import {SettingsPage} from '../pages/SettingsPage'

interface MainWorkspaceProps {
  activePage: AppPage
}

export function MainWorkspace({activePage}: MainWorkspaceProps) {
  const pages: Record<AppPage, ReactElement> = {
    build: <BuildPage />,
    artifacts: <ArtifactPage />,
    deployment: <DeploymentPage />,
    services: <ServicePage />,
    environment: <EnvironmentPage />,
    history: <HistoryPage />,
    settings: <SettingsPage />,
  }

  return <section className="main-workspace">{pages[activePage]}</section>
}
