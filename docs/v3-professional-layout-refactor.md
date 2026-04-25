# Maven Packager v3 专业版布局重构记录

## 新目录结构

```text
src/
├─ app/
│  ├─ ActivityBar.tsx
│  ├─ AppShell.tsx
│  ├─ BottomActionBar.tsx
│  ├─ InspectorDrawer.tsx
│  ├─ MainWorkspace.tsx
│  └─ SidebarPanel.tsx
├─ pages/
│  ├─ ArtifactPage.tsx
│  ├─ BuildPage.tsx
│  ├─ DeploymentPage.tsx
│  ├─ EnvironmentPage.tsx
│  ├─ HistoryPage.tsx
│  └─ ServicePage.tsx
├─ store/
│  └─ navigationStore.ts
└─ components/
   └─ 原业务组件继续复用
```

## 修改的组件清单

- `src/App.tsx`：移除旧三栏 Tab 布局，改为初始化业务事件后渲染 `AppShell`。
- `src/App.css`：新增 v3 专业工具布局样式，包含 ActivityBar、SidebarPanel、MainWorkspace、InspectorDrawer、BottomActionBar。
- `src/app/AppShell.tsx`：新增主应用壳。
- `src/app/ActivityBar.tsx`：新增左侧一级图标导航。
- `src/app/SidebarPanel.tsx`：新增当前页面辅助信息区。
- `src/app/MainWorkspace.tsx`：新增页面路由容器。
- `src/app/InspectorDrawer.tsx`：新增可折叠日志、诊断、详情面板。
- `src/app/BottomActionBar.tsx`：新增固定底部构建操作栏。
- `src/pages/*`：新增构建、产物、部署、服务、环境、历史页面骨架。
- `src/store/navigationStore.ts`：新增布局和导航状态。

## 删除或迁移的旧 Tab

- 构建中心 Tab → `BuildPage`
- 构建环境 Tab → `EnvironmentPage`，构建页仅保留折叠摘要
- 部署中心 Tab → `DeploymentPage`
- 日志 Tab → `InspectorDrawer`
- 历史 Tab → `HistoryPage`
- 高级参数 Tab → `BuildPage` 折叠区

## 新 AppShell 实现

```text
AppShell
├─ v3-header：应用上下文、项目、Git、更新检查
├─ v3-body
│  ├─ ActivityBar
│  ├─ SidebarPanel
│  ├─ MainWorkspace
│  └─ InspectorDrawer
└─ BottomActionBar
```

## 各页面骨架

- `BuildPage`：构建配置、构建环境摘要、高级参数、构建产物与下一步操作。
- `ArtifactPage`：产物列表、复制路径、打开目录、部署入口。
- `DeploymentPage`：部署中心总览、服务映射、环境资源、部署执行、部署记录。
- `ServicePage`：模块、产物、服务、环境、部署配置链路视图。
- `EnvironmentPage`：完整环境管理。
- `HistoryPage`：构建、部署历史。

## 布局状态管理

`navigationStore` 管理：

- `activePage`
- `inspectorOpen`
- `inspectorTab`

Inspector 自动交互：

- 构建中：自动展开日志
- 构建失败：自动切换诊断
- 部署中：自动展开日志

## 测试清单

- 首屏默认进入构建中心。
- ActivityBar 替代旧多层 Tab。
- 模块树位于构建页 Sidebar。
- 构建按钮固定在 BottomActionBar。
- 日志默认不占用主工作区。
- 构建中 Inspector 自动展开日志。
- 构建失败 Inspector 自动切换诊断。
- 部署、产物、服务、环境、历史、设置均为独立页面。
- 高级参数默认折叠。
- 原有构建、部署、历史、模板能力仍可访问。
- `npm run build` 通过。
