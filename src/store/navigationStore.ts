import {create} from 'zustand'

export type AppPage = 'build' | 'artifacts' | 'deployment' | 'services' | 'environment' | 'history'

export type InspectorTab = 'logs' | 'diagnosis' | 'details'

export type InspectorLogSource = 'build' | 'deployment'

interface NavigationState {
  activePage: AppPage
  inspectorOpen: boolean
  inspectorTab: InspectorTab
  inspectorLogSource: InspectorLogSource
  deploymentPreselectProfileId?: string
  setActivePage: (page: AppPage) => void
  setInspectorOpen: (open: boolean) => void
  setInspectorTab: (tab: InspectorTab) => void
  setInspectorLogSource: (source: InspectorLogSource) => void
  openInspector: (tab?: InspectorTab) => void
  navigateToDeployment: (profileId?: string) => void
  clearDeploymentPreselect: () => void
}

export const useNavigationStore = create<NavigationState>((set) => ({
  activePage: 'build',
  inspectorOpen: false,
  inspectorTab: 'logs',
  inspectorLogSource: 'build',
  setActivePage: (activePage) => set({activePage}),
  setInspectorOpen: (inspectorOpen) => set({inspectorOpen}),
  setInspectorTab: (inspectorTab) => set({inspectorTab}),
  setInspectorLogSource: (inspectorLogSource) => set({inspectorLogSource}),
  openInspector: (inspectorTab = 'logs') => set({inspectorOpen: true, inspectorTab}),
  navigateToDeployment: (deploymentPreselectProfileId) =>
    set({activePage: 'deployment', deploymentPreselectProfileId}),
  clearDeploymentPreselect: () => set({deploymentPreselectProfileId: undefined}),
}))
