import type {BuildArtifact, DeploymentProfile, MavenModule, ServerProfile} from '../types/domain'

export const flattenModules = (modules: MavenModule[]): MavenModule[] =>
  modules.flatMap((module) => [module, ...flattenModules(module.children ?? [])])

export const normalizeModulePath = (value?: string) =>
  (value ?? '').replace(/\\/g, '/').replace(/^\/+|\/+$/g, '')

export const globToRegex = (pattern: string) =>
  new RegExp(`^${pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*/g, '.*')
    .replace(/\?/g, '.')}$`, 'i')

export const isTestEnvironment = (server?: ServerProfile) => {
  const text = `${server?.name ?? ''} ${server?.group ?? ''}`.toLowerCase()
  return text.includes('test') || text.includes('测试')
}

export const pickDefaultTestServer = (servers: ServerProfile[]) =>
  servers.find(isTestEnvironment) ?? servers[0]

export const moduleLabel = (modules: MavenModule[], moduleId?: string) => {
  if (!moduleId) {
    return '全部项目'
  }

  const module = modules.find((item) => item.id === moduleId)
  return module?.artifactId ?? '当前项目不存在该模块'
}

export const artifactMatchesDeploymentProfile = (
  artifact: BuildArtifact,
  profile: DeploymentProfile,
  modules: MavenModule[],
) => {
  const matcher = globToRegex(profile.localArtifactPattern || '*')
  if (!matcher.test(artifact.fileName)) {
    return false
  }

  if (!profile.moduleId) {
    return true
  }

  const module = modules.find((item) => item.id === profile.moduleId)
  return module
    ? normalizeModulePath(artifact.modulePath) === normalizeModulePath(module.relativePath)
    : false
}

export const findDeployableArtifacts = (
  artifacts: BuildArtifact[],
  profile: DeploymentProfile,
  modules: MavenModule[],
) => artifacts.filter((artifact) => artifactMatchesDeploymentProfile(artifact, profile, modules))
