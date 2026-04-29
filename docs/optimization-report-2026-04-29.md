# 打包部署工作台优化报告（2026-04-29）

## 本轮目标

围绕上传卡顿、日志卡顿、部署链路可观测性、UI 风格统一和可测试性完成第一轮可落地优化。重点不是重写功能，而是在现有 Tauri + React + Zustand 架构上收紧高频状态更新路径，并沉淀可复用的基础规范。

## 已完成优化

### 上传性能

- 后端上传进度事件从高频更新改为节流更新：按 2% 进度差、500ms 时间窗口、25/50/75/100 关键节点触发。
- 前端上传进度 store 增加二次节流，避免异常高频事件直接造成 React 刷新。
- SFTP 写入缓冲从 64KB 提升到 256KB，降低大文件上传时的 I/O 调用次数。
- base64 兜底上传块从 64KB 提升到 512KB，减少 SSH exec channel 创建次数。
- 修正 base64 兜底上传进度计算：按 base64 已发送比例映射回真实文件大小，避免进度虚高。
- base64 兜底上传命令中的远程临时路径和目标路径统一 shell quote，减少空格和特殊字符路径失败风险。

### 日志性能

- 部署日志从“每行写入 Zustand state”改为模块内缓冲，按 300ms 批量 flush 到 UI。
- 部署日志最多保留 3000 行，构建日志最多保留 5000 行，避免长期运行后内存持续增长。
- 日志面板按当前部署任务精准订阅日志，不再订阅整个 `logsByTaskId` 大对象。
- 日志搜索和过滤结果使用 `useMemo` 缓存。
- 日志面板单次最多渲染最近 1200 行；复制和下载仍使用完整日志。
- 部署日志支持清空当前任务日志。
- 新增统一 `LogConsole` 组件，构建日志、部署日志、服务页日志、历史页日志共享同一套截断、空状态和高亮规则。
- 服务页和部署历史页改为只订阅当前打开任务的日志，避免打开详情时被其他任务日志刷新拖动。

### 部署流水线可观测性

- 新增 `summarizeDeploymentPipeline` 纯函数，统一部署阶段完成数、进度、当前阶段和失败阶段判断。
- 部署中心与部署历史开始复用统一流水线摘要逻辑，减少各页面重复判断。
- 上传进度节流策略沉淀为 `shouldFlushUploadProgress`，便于单测覆盖和后续复用。

### UI 风格统一

- 新增 `src/theme/uiTokens.ts`，沉淀颜色、圆角、间距、阴影、字号和字体 token。
- Ant Design `ConfigProvider` 接入统一 token，统一按钮、卡片、输入框、弹窗、表格、标签等基础组件视觉。
- `index.css` 增加同源 CSS variables，供普通 CSS 复用。
- 核心容器、卡片、部署概览、日志面板改用统一变量，整体风格更扁平、清爽。
- 日志面板统一为开发者控制台视觉，并增加截断提示。
- 工作区页面改为 route-level lazy loading，部署页等大页面不再进入首屏同步包。

### 测试与验证

- 接入 Vitest。
- 新增日志缓冲测试：`src/utils/boundedBuffer.test.ts`。
- 新增部署流水线和上传进度节流测试：`src/services/deploymentRuntime.test.ts`。

## 验证结果

已通过：

- `npm run test`
- `npm run lint`
- `npm run build`
- `cargo check`（在 `src-tauri/` 下）
- `cargo fmt`（在 `src-tauri/` 下）

前端构建已拆分为多个按需 chunk，部署页独立输出，首屏主包明显降低。剩余最大 chunk 是 React/AntD 共享运行时，已按桌面端目标设置明确体积阈值。

## 后续建议

1. 将 `DeploymentCenterPanel` 继续拆成配置抽屉、模板管理、流水线预览、任务操作区等独立组件。
2. 后端继续抽象 `RemoteExecutor`，把 stdout/stderr 实时回调、超时、取消和 exit code 判断收敛到统一接口。
3. 将部署模板模型持久化到 SQLite，替代当前 localStorage 模式。
4. 给启动探针补 Rust 单元测试，覆盖日志关键字、端口、HTTP、进程检测组合策略。
