import { Card, Checkbox, Input, Space, Tooltip, Typography } from 'antd'
import { InfoCircleOutlined } from '@ant-design/icons'
import { useAppStore } from '../../store/useAppStore'

const { Text } = Typography

const splitArgs = (value: string) =>
  value
    .split(/[,\s]+/)
    .map((item) => item.trim())
    .filter(Boolean)

const commonArgs = [
  {
    label: '强制更新依赖快照',
    value: '-U',
    tip: '强制检查远程仓库中的 SNAPSHOT 和 release 更新。',
  },
  {
    label: '离线构建',
    value: '-o',
    tip: '不访问远程仓库，仅使用本地 Maven 仓库。',
  },
  {
    label: '显示完整错误',
    value: '-e',
    tip: '构建失败时输出完整异常栈。',
  },
  {
    label: '调试日志',
    value: '-X',
    tip: '输出 Maven debug 日志，日志会明显变多。',
  },
  {
    label: '安静模式',
    value: '-q',
    tip: '减少 Maven 输出，排查问题时不建议使用。',
  },
  {
    label: '跳过集成测试',
    value: '-DskipITs',
    tip: '常见于 Failsafe 集成测试阶段。',
  },
]

const commonArgValues = commonArgs.map((item) => item.value)

export function BuildOptionsPanel() {
  const buildOptions = useAppStore((state) => state.buildOptions)
  const setBuildOption = useAppStore((state) => state.setBuildOption)
  const checkedCommonArgs = buildOptions.customArgs.filter((arg) =>
    commonArgValues.includes(arg),
  )
  const manualCustomArgs = buildOptions.customArgs.filter(
    (arg) => !commonArgValues.includes(arg),
  )

  const setCommonArgs = (values: string[]) => {
    setBuildOption('customArgs', [...manualCustomArgs, ...values])
  }

  const setManualArgs = (value: string) => {
    setBuildOption('customArgs', [...checkedCommonArgs, ...splitArgs(value)])
  }

  return (
    <Card title="打包参数" className="panel-card" size="small">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <Text type="secondary">
          默认已启用“同时构建依赖模块”和“跳过测试”，其余参数按需勾选。
        </Text>

        <div className="option-block">
          <Text strong>构建目标</Text>
          <Checkbox.Group
            value={buildOptions.goals}
            options={[
              { label: '清理 clean', value: 'clean' },
              { label: '打包 package', value: 'package' },
              { label: '安装到本地仓库 install', value: 'install' },
              { label: '校验 verify', value: 'verify' },
            ]}
            onChange={(values) =>
              setBuildOption(
                'goals',
                values.map(String),
              )
            }
          />
        </div>

        <div className="option-block">
          <Text strong>常用开关</Text>
          <Space direction="vertical" size={8}>
            <Checkbox
              checked={buildOptions.alsoMake}
              onChange={(event) => setBuildOption('alsoMake', event.target.checked)}
            >
              同时构建依赖模块 (-am){' '}
              <Tooltip title="同时构建目标模块依赖的上游模块。">
                <InfoCircleOutlined />
              </Tooltip>
            </Checkbox>
            <Checkbox
              checked={buildOptions.skipTests}
              onChange={(event) => setBuildOption('skipTests', event.target.checked)}
            >
              跳过测试 (-Dmaven.test.skip=true){' '}
              <Tooltip title="跳过测试编译和执行，适合本地快速打包。">
                <InfoCircleOutlined />
              </Tooltip>
            </Checkbox>
          </Space>
        </div>

        <div className="option-block">
          <Text strong>附加参数</Text>
          <Checkbox.Group
            value={checkedCommonArgs}
            onChange={(values) => setCommonArgs(values.map(String))}
          >
            <Space direction="vertical" size={8}>
              {commonArgs.map((arg) => (
                <Checkbox key={arg.value} value={arg.value}>
                  {arg.label} ({arg.value}){' '}
                  <Tooltip title={arg.tip}>
                    <InfoCircleOutlined />
                  </Tooltip>
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
        </div>

        <Input
          addonBefore="Profiles"
          placeholder="例如 dev,test，会生成 -Pdev,test"
          value={buildOptions.profiles.join(',')}
          onChange={(event) => setBuildOption('profiles', splitArgs(event.target.value))}
        />
        <Input
          addonBefore="自定义"
          placeholder="例如 -DskipDocker -Drevision=1.0.0"
          value={manualCustomArgs.join(' ')}
          onChange={(event) => setManualArgs(event.target.value)}
        />
      </Space>
    </Card>
  )
}
