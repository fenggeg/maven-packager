# Maven Packager 任务编排与部署中心结构性重构

## 调整后的信息架构

```text
Maven Packager
├─ 左侧上下文
│  ├─ 项目
│  ├─ Git
│  ├─ 模块
│  └─ 常用
├─ 构建中心（主入口）
│  ├─ 构建中心：目标模块、Goals、Profiles、附加参数
│  ├─ 构建环境：JDK、Maven、settings.xml、本地仓库
│  ├─ 部署中心：承接构建产物和服务映射
│  └─ 高级参数
├─ 构建成功后的下一步操作
│  ├─ 已有服务映射：选择服务映射、测试环境服务器和产物后直接部署
│  ├─ 无服务映射：引导到部署中心创建服务映射
│  └─ 产物定位：打开最近构建产物
└─ 输出区
   ├─ 日志
   ├─ 历史：构建记录、自动化执行、部署记录
   └─ 模板：构建模板、高级自动化模板
```

## 修改后的目录结构

```text
src/
├─ App.tsx
├─ App.css
├─ components/
│  ├─ BuildCenter/
│  │  └─ BuildNextActionsPanel.tsx
│  ├─ Deployment/
│  │  ├─ DeploymentCenterPanel.tsx
│  │  └─ DeploymentHistoryTable.tsx
│  ├─ TaskPipeline/
│  │  ├─ TaskPipelinePanel.tsx
│  │  ├─ TaskPipelineHistoryTable.tsx
│  │  └─ TaskPipelineLogPanel.tsx
│  ├─ TemplatePanel/
│  │  └─ TemplatePanel.tsx
│  └─ HistoryTable/
│     └─ WorkbenchHistoryPanel.tsx
├─ services/
│  ├─ deploymentTopologyService.ts
│  └─ tauri-api.ts
├─ store/
│  ├─ useAppStore.ts
│  └─ useWorkflowStore.ts
└─ types/
   └─ domain.ts
```

## 删除/隐藏的组件

- 隐藏一级入口：`App.tsx` 中移除了“任务编排”顶层 Tab。
- 保留底层能力：`TaskPipelinePanel`、`TaskPipelineHistoryTable`、`TaskPipelineLogPanel`、Tauri `task_pipeline` commands、`task_pipeline_executor` 和 `pipeline_repo` 均保留。
- 入口重命名：任务模板改为“高级自动化模板”，任务执行历史改为“自动化执行”。
- 承载位置调整：`TaskPipelinePanel` 被移动到部署中心的“高级自动化”页签，作为构建后动作、部署步骤和高级模板的统一编辑器。

## 新增数据模型

新增前端领域模型位于 `src/types/domain.ts`：

- `DeploymentEnvironmentKind`：环境类型，包含 `test`、`staging`、`production`、`custom`。
- `ServiceMapping`：模块到服务的映射，包含 `moduleId`、`serviceName`、`artifactPattern`、`deploymentProfileId`。
- `DeploymentEnvironment`：环境实例，绑定 `serverId` 并记录环境状态。
- `DeploymentConfiguration`：服务在环境上的部署配置，关联服务映射、环境、服务器和远端部署路径。
- `ModuleArtifactServiceLink`：用于表达 `模块 -> 产物 -> 服务 -> 环境 -> 部署配置` 的链路节点。

当前实现先兼容已有 `DeploymentProfile` 和 `ServerProfile` 存储：`DeploymentProfile` 作为服务映射/部署配置的落地点，`ServerProfile.group` 作为环境分组来源。

## 主流程说明

1. 在构建中心选择项目、模块和构建参数。
2. 执行构建，成功后扫描 `jar/war` 产物。
3. 构建成功后显示“下一步操作”面板。
4. 如果产物匹配已有服务映射，用户可选择测试环境服务器并直接部署。
5. 如果没有服务映射，界面引导进入部署中心的“服务映射”。
6. 部署中心首页展示最近产物、最近部署、环境状态和完整链路。
7. 部署执行页读取服务映射筛选产物，再调用原有部署执行能力。
8. 高级自动化模板继续调用原任务链能力，作为高级入口保留。

## 测试清单

- 构建中心默认作为第一个页签展示。
- 顶层不再出现“任务编排”入口。
- 构建成功且有产物时出现“下一步操作”面板。
- 有服务映射时，可从下一步面板选择服务映射、服务器和产物。
- 无服务映射时，下一步面板展示创建映射引导。
- 部署中心首页展示最近产物、最近部署、环境状态和链路列表。
- 服务映射页可新增、编辑、删除映射。
- 部署执行页仍可手动选择产物并部署。
- 高级自动化页可保存和执行原任务链模板。
- 构建历史、部署历史、自动化执行历史仍可查看。
