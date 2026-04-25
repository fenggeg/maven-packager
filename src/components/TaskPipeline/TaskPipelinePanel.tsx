import {
    Alert,
    Button,
    Card,
    Checkbox,
    Empty,
    Input,
    Popconfirm,
    Select,
    Space,
    Steps,
    Switch,
    Tag,
    Tooltip,
    Typography,
} from 'antd'
import {
    DeleteOutlined,
    DownOutlined,
    PlayCircleOutlined,
    PlusOutlined,
    SaveOutlined,
    UpOutlined,
} from '@ant-design/icons'
import {useCallback, useMemo, useState} from 'react'
import {useAppStore} from '../../store/useAppStore'
import {useWorkflowStore} from '../../store/useWorkflowStore'
import type {MavenModule, TaskPipeline, TaskStep, TaskStepRunStatus, TaskStepType} from '../../types/domain'

const {Text} = Typography

const flattenModules = (modules: MavenModule[]): MavenModule[] =>
  modules.flatMap((module) => [module, ...flattenModules(module.children ?? [])])

const splitArgs = (value: string) =>
  value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const stepTypeLabel: Record<TaskStepType, string> = {
  maven_goal: 'Maven 构建',
  shell_command: 'Shell 命令',
  open_directory: '打开目录',
  notify: '通知',
}

const createStep = (type: TaskStepType): TaskStep => ({
  id: crypto.randomUUID(),
  type,
  label: stepTypeLabel[type],
  enabled: true,
  payload: {
    maven_goal: {
      goals: ['clean', 'package'],
      profiles: [],
      properties: {},
      alsoMake: true,
      skipTests: true,
      customArgs: [],
    },
    shell_command: {
      command: '',
      workingDirectory: '',
    },
    open_directory: {
      location: 'module_target',
      path: '',
    },
    notify: {
      title: '任务完成',
      message: '任务链已执行完成。',
    },
  }[type],
})

const createPipeline = (moduleIds: string[] = []): TaskPipeline => ({
  id: crypto.randomUUID(),
  name: '',
  moduleIds,
  steps: [createStep('maven_goal')],
})

const pipelineStepStatus = (status: TaskStepRunStatus) => {
  switch (status) {
    case 'success': return 'finish'
    case 'failed': return 'error'
    case 'running': return 'process'
    default: return 'wait'
  }
}

interface TaskPipelinePanelProps {
  title?: string
}

export function TaskPipelinePanel({title = '高级自动化模板'}: TaskPipelinePanelProps = {}) {
  const project = useAppStore((state) => state.project)
  const selectedModuleIds = useAppStore((state) => state.selectedModuleIds)
  const error = useWorkflowStore((state) => state.error)
  const taskPipelines = useWorkflowStore((state) => state.taskPipelines)
  const currentTaskPipelineRun = useWorkflowStore((state) => state.currentTaskPipelineRun)
  const saveTaskPipeline = useWorkflowStore((state) => state.saveTaskPipeline)
  const deleteTaskPipeline = useWorkflowStore((state) => state.deleteTaskPipeline)
  const startTaskPipeline = useWorkflowStore((state) => state.startTaskPipeline)
  const [editingPipeline, setEditingPipeline] = useState<TaskPipeline>(() => createPipeline())
  const [collapsedSteps, setCollapsedSteps] = useState<Set<string>>(new Set())

  const moduleOptions = useMemo(
    () => flattenModules(project?.modules ?? []).map((module) => ({
      label: `${module.artifactId}${module.relativePath ? ` · ${module.relativePath}` : ''}`,
      value: module.id,
    })),
    [project?.modules],
  )

  const updateStep = useCallback((stepId: string, updater: (step: TaskStep) => TaskStep) => {
    setEditingPipeline((state) => ({
      ...state,
      steps: state.steps.map((step) => (step.id === stepId ? updater(step) : step)),
    }))
  }, [])

  const moveStep = useCallback((stepId: string, direction: 'up' | 'down') => {
    setEditingPipeline((state) => {
      const index = state.steps.findIndex((s) => s.id === stepId)
      if (index < 0) {
        return state
      }
      const targetIndex = direction === 'up' ? index - 1 : index + 1
      if (targetIndex < 0 || targetIndex >= state.steps.length) {
        return state
      }
      const newSteps = [...state.steps]
      const temp = newSteps[index]
      newSteps[index] = newSteps[targetIndex]
      newSteps[targetIndex] = temp
      return {...state, steps: newSteps}
    })
  }, [])

  const toggleCollapse = useCallback((stepId: string) => {
    setCollapsedSteps((prev) => {
      const next = new Set(prev)
      if (next.has(stepId)) {
        next.delete(stepId)
      } else {
        next.add(stepId)
      }
      return next
    })
  }, [])

  const selectPipeline = (pipelineId: string) => {
    const pipeline = taskPipelines.find((item) => item.id === pipelineId)
    if (pipeline) {
      setEditingPipeline({
        ...pipeline,
        steps: pipeline.steps.map((step) => ({
          ...step,
          payload: {...step.payload},
        })),
      })
      setCollapsedSteps(new Set())
    }
  }

  const isRunning = currentTaskPipelineRun?.status === 'running'

  const pipelineProgressCurrent = useMemo(() => {
    if (!currentTaskPipelineRun) {
      return 0
    }
    const activeIndex = currentTaskPipelineRun.steps.findIndex((step) => step.status === 'running')
    if (activeIndex >= 0) {
      return activeIndex
    }
    const pendingIndex = currentTaskPipelineRun.steps.findIndex((step) => step.status === 'pending')
    if (pendingIndex >= 0) {
      return pendingIndex
    }
    return Math.max(currentTaskPipelineRun.steps.length - 1, 0)
  }, [currentTaskPipelineRun])

  return (
    <Space direction="vertical" size={12} style={{width: '100%'}}>
      <Card title={title} className="panel-card" size="small">
        <Space direction="vertical" size={12} style={{width: '100%'}}>
          <Space wrap>
            <Select
              placeholder="加载自动化模板"
              style={{minWidth: 240}}
              value={taskPipelines.some((item) => item.id === editingPipeline.id) ? editingPipeline.id : undefined}
              options={taskPipelines.map((item) => ({label: item.name, value: item.id}))}
              onChange={selectPipeline}
            />
            <Button onClick={() => { setEditingPipeline(createPipeline(selectedModuleIds)); setCollapsedSteps(new Set()) }}>
              新建模板
            </Button>
            <Button
              type="primary"
              icon={<SaveOutlined />}
              disabled={!editingPipeline.name.trim()}
              onClick={() => void saveTaskPipeline(editingPipeline)}
            >
              保存模板
            </Button>
            <Button
              type="primary"
              ghost
              icon={<PlayCircleOutlined />}
              disabled={!editingPipeline.name.trim() || editingPipeline.steps.length === 0 || isRunning}
              onClick={() => void startTaskPipeline(editingPipeline)}
            >
              执行模板
            </Button>
            {taskPipelines.some((item) => item.id === editingPipeline.id) ? (
              <Popconfirm
                title="删除当前自动化模板？"
                okText="删除"
                cancelText="取消"
                onConfirm={() => void deleteTaskPipeline(editingPipeline.id)}
              >
                <Button danger icon={<DeleteOutlined />}>删除模板</Button>
              </Popconfirm>
            ) : null}
          </Space>

          {error ? <Alert type="error" showIcon message={error} closable /> : null}

          <Input
            addonBefore="模板名称"
            placeholder="例如：构建后通知 + 打开产物目录"
            value={editingPipeline.name}
            onChange={(event) => setEditingPipeline((state) => ({...state, name: event.target.value}))}
          />

          <div style={{marginTop: 4}}>
            <Text type="secondary" style={{fontSize: 12, marginBottom: 6, display: 'block'}}>绑定模块范围</Text>
            <Select
              mode="multiple"
              allowClear
              placeholder="为空时表示整个项目"
              value={editingPipeline.moduleIds}
              options={moduleOptions}
              onChange={(value) => setEditingPipeline((state) => ({...state, moduleIds: value}))}
              style={{width: '100%'}}
            />
          </div>

          <div style={{marginTop: 4}}>
            <Text type="secondary" style={{fontSize: 12, marginBottom: 6, display: 'block'}}>添加步骤</Text>
            <Space wrap size={8}>
              <Button icon={<PlusOutlined />} onClick={() => setEditingPipeline((state) => ({...state, steps: [...state.steps, createStep('maven_goal')]}))}>
                构建后动作
              </Button>
              <Button icon={<PlusOutlined />} onClick={() => setEditingPipeline((state) => ({...state, steps: [...state.steps, createStep('shell_command')]}))}>
                部署步骤
              </Button>
              <Button icon={<PlusOutlined />} onClick={() => setEditingPipeline((state) => ({...state, steps: [...state.steps, createStep('open_directory')]}))}>
                打开目录
              </Button>
              <Button icon={<PlusOutlined />} onClick={() => setEditingPipeline((state) => ({...state, steps: [...state.steps, createStep('notify')]}))}>
                通知
              </Button>
            </Space>
          </div>

          {editingPipeline.steps.length === 0 ? (
            <Empty description="先添加至少一个步骤" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <div className="workflow-step-list">
              {editingPipeline.steps.map((step, index) => {
                const isCollapsed = collapsedSteps.has(step.id)
                return (
                  <div
                    key={step.id}
                    className={`workflow-step${isCollapsed ? ' collapsed' : ''}${step.enabled ? '' : ' disabled'}`}
                  >
                    <div className="workflow-step-header">
                      <div className="workflow-step-title">
                        <span className="workflow-step-index">
                          {index + 1}
                        </span>
                        <Input
                          placeholder="步骤名称"
                          className="workflow-step-name"
                          size="small"
                          value={step.label}
                          onChange={(event) => updateStep(step.id, (item) => ({...item, label: event.target.value}))}
                        />
                      </div>
                      <div className="workflow-step-actions">
                        <Tooltip title="上移">
                          <Button
                            size="small"
                            type="text"
                            icon={<UpOutlined />}
                            disabled={index === 0}
                            onClick={() => moveStep(step.id, 'up')}
                            aria-label="上移步骤"
                          />
                        </Tooltip>
                        <Tooltip title="下移">
                          <Button
                            size="small"
                            type="text"
                            icon={<DownOutlined />}
                            disabled={index === editingPipeline.steps.length - 1}
                            onClick={() => moveStep(step.id, 'down')}
                            aria-label="下移步骤"
                          />
                        </Tooltip>
                        <Tooltip title={step.enabled ? '停用步骤' : '启用步骤'}>
                          <Switch
                            size="small"
                            checked={step.enabled}
                            onChange={(checked) => updateStep(step.id, (item) => ({...item, enabled: checked}))}
                          />
                        </Tooltip>
                        <Tooltip title={isCollapsed ? '展开步骤' : '折叠步骤'}>
                          <Button
                            size="small"
                            type="text"
                            icon={isCollapsed ? <DownOutlined /> : <UpOutlined />}
                            onClick={() => toggleCollapse(step.id)}
                            aria-label={isCollapsed ? '展开步骤' : '折叠步骤'}
                          />
                        </Tooltip>
                        <Popconfirm
                          title="删除此步骤？"
                          okText="删除"
                          cancelText="取消"
                          onConfirm={() =>
                            setEditingPipeline((state) => ({
                              ...state,
                              steps: state.steps.filter((item) => item.id !== step.id),
                            }))}
                        >
                          <Button size="small" type="text" danger icon={<DeleteOutlined />} aria-label="删除步骤" />
                        </Popconfirm>
                      </div>
                    </div>
                    {isCollapsed ? null : (
                      <div className="step-card-body">
                        <div className="step-field">
                          <Text type="secondary" style={{fontSize: 12}}>步骤类型</Text>
                          <Select<TaskStepType>
                            value={step.type}
                            style={{width: '100%'}}
                            options={[
                              {label: 'Maven Goal', value: 'maven_goal'},
                              {label: 'Shell Command', value: 'shell_command'},
                              {label: '打开目录', value: 'open_directory'},
                              {label: '通知', value: 'notify'},
                            ]}
                            onChange={(value) => updateStep(step.id, () => createStep(value))}
                          />
                        </div>
                        {step.type === 'maven_goal' ? (
                          <>
                            <div className="step-field">
                              <Text type="secondary" style={{fontSize: 12}}>Maven Goal</Text>
                              <Checkbox.Group
                                className="goal-checkbox-grid"
                                value={Array.isArray(step.payload.goals) ? step.payload.goals as string[] : []}
                                options={[
                                  {label: 'clean', value: 'clean'},
                                  {label: 'package', value: 'package'},
                                  {label: 'install', value: 'install'},
                                  {label: 'verify', value: 'verify'},
                                ]}
                                onChange={(value) =>
                                  updateStep(step.id, (item) => ({
                                    ...item,
                                    payload: {...item.payload, goals: value.map(String)},
                                  }))}
                              />
                            </div>
                            <div className="step-field-row">
                              <Input
                                addonBefore="Profiles"
                                placeholder="dev,test"
                                value={Array.isArray(step.payload.profiles) ? (step.payload.profiles as string[]).join(',') : ''}
                                onChange={(event) =>
                                  updateStep(step.id, (item) => ({
                                    ...item,
                                    payload: {...item.payload, profiles: splitArgs(event.target.value)},
                                  }))}
                              />
                              <Input
                                addonBefore="参数"
                                placeholder="-DskipITs -U"
                                value={Array.isArray(step.payload.customArgs) ? (step.payload.customArgs as string[]).join(' ') : ''}
                                onChange={(event) =>
                                  updateStep(step.id, (item) => ({
                                    ...item,
                                    payload: {...item.payload, customArgs: splitArgs(event.target.value)},
                                  }))}
                              />
                            </div>
                            <div className="step-field step-field-full">
                              <Space wrap>
                                <Checkbox
                                  checked={Boolean(step.payload.alsoMake ?? true)}
                                  onChange={(event) =>
                                    updateStep(step.id, (item) => ({
                                      ...item,
                                      payload: {...item.payload, alsoMake: event.target.checked},
                                    }))}
                                >
                                  联动依赖模块
                                </Checkbox>
                                <Checkbox
                                  checked={Boolean(step.payload.skipTests ?? true)}
                                  onChange={(event) =>
                                    updateStep(step.id, (item) => ({
                                      ...item,
                                      payload: {...item.payload, skipTests: event.target.checked},
                                    }))}
                                >
                                  跳过测试
                                </Checkbox>
                              </Space>
                            </div>
                          </>
                        ) : null}

                      {step.type === 'shell_command' ? (
                        <>
                          <div className="step-field">
                            <Text type="secondary" style={{fontSize: 12}}>命令</Text>
                            <Input.TextArea
                              autoSize={{minRows: 2, maxRows: 4}}
                              placeholder="例如：dir target"
                              value={String(step.payload.command ?? '')}
                              onChange={(event) =>
                                updateStep(step.id, (item) => ({
                                  ...item,
                                  payload: {...item.payload, command: event.target.value},
                                }))}
                            />
                          </div>
                          <div className="step-field">
                            <Text type="secondary" style={{fontSize: 12}}>工作目录</Text>
                            <Input
                              placeholder="可留空使用项目根目录"
                              value={String(step.payload.workingDirectory ?? '')}
                              onChange={(event) =>
                                updateStep(step.id, (item) => ({
                                  ...item,
                                  payload: {...item.payload, workingDirectory: event.target.value},
                                }))}
                            />
                          </div>
                        </>
                      ) : null}

                      {step.type === 'open_directory' ? (
                        <>
                          <div className="step-field">
                            <Text type="secondary" style={{fontSize: 12}}>打开位置</Text>
                            <Select
                              value={String(step.payload.location ?? 'module_target')}
                              style={{width: '100%'}}
                              options={[
                                {label: '项目根目录', value: 'project_root'},
                                {label: '模块根目录', value: 'module_root'},
                                {label: '模块 target 目录', value: 'module_target'},
                                {label: '自定义路径', value: 'custom'},
                              ]}
                              onChange={(value) =>
                                updateStep(step.id, (item) => ({
                                  ...item,
                                  payload: {...item.payload, location: value},
                                }))}
                            />
                          </div>
                          {step.payload.location === 'custom' ? (
                            <div className="step-field">
                              <Input
                                placeholder="自定义相对路径或绝对路径"
                                value={String(step.payload.path ?? '')}
                                onChange={(event) =>
                                  updateStep(step.id, (item) => ({
                                    ...item,
                                    payload: {...item.payload, path: event.target.value},
                                  }))}
                              />
                            </div>
                          ) : null}
                        </>
                      ) : null}

                      {step.type === 'notify' ? (
                        <>
                          <div className="step-field">
                            <Text type="secondary" style={{fontSize: 12}}>通知标题</Text>
                            <Input
                              placeholder="通知标题"
                              value={String(step.payload.title ?? '')}
                              onChange={(event) =>
                                updateStep(step.id, (item) => ({
                                  ...item,
                                  payload: {...item.payload, title: event.target.value},
                                }))}
                            />
                          </div>
                          <div className="step-field">
                            <Text type="secondary" style={{fontSize: 12}}>通知内容</Text>
                            <Input.TextArea
                              autoSize={{minRows: 2, maxRows: 4}}
                              placeholder="通知内容"
                              value={String(step.payload.message ?? '')}
                              onChange={(event) =>
                                updateStep(step.id, (item) => ({
                                  ...item,
                                  payload: {...item.payload, message: event.target.value},
                                }))}
                            />
                          </div>
                        </>
                      ) : null}
                      </div>
                    )}
                  </div>
                )
              })}
            </div>
          )}

          {currentTaskPipelineRun ? (
            <div className="pipeline-run-bar">
              <Space size={8} wrap className="pipeline-run-heading">
                <Tag color={currentTaskPipelineRun.status === 'success' ? 'green' : currentTaskPipelineRun.status === 'failed' ? 'red' : 'processing'}>
                  {currentTaskPipelineRun.status === 'running' ? '执行中' : currentTaskPipelineRun.status === 'success' ? '执行完成' : '执行失败'}
                </Tag>
                <Text>{currentTaskPipelineRun.pipelineName}</Text>
              </Space>
              <Steps
                direction="vertical"
                size="small"
                current={pipelineProgressCurrent}
                status={currentTaskPipelineRun.status === 'failed' ? 'error' : currentTaskPipelineRun.status === 'success' ? 'finish' : 'process'}
                items={currentTaskPipelineRun.steps.map((step) => ({
                  title: step.label,
                  status: pipelineStepStatus(step.status),
                  description: step.message,
                }))}
              />
            </div>
          ) : null}
        </Space>
      </Card>
    </Space>
  )
}
