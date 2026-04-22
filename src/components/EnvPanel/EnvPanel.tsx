import {Alert, Button, Card, Collapse, Input, Space, Switch, Tag, Typography} from 'antd'
import {FileSearchOutlined, FolderOpenOutlined} from '@ant-design/icons'
import {selectLocalDirectory, selectLocalFile} from '../../services/tauri-api'
import {useAppStore} from '../../store/useAppStore'

const { Text } = Typography

const compactVersion = (value?: string) => {
  if (!value) {
    return '未识别'
  }

  return value.split(/\r?\n/)[0].trim()
}

export function EnvPanel() {
  const environment = useAppStore((state) => state.environment)
  const updateEnvironment = useAppStore((state) => state.updateEnvironment)

  const javaValue = environment?.javaHome ?? ''
  const mavenValue = environment?.mavenHome ?? environment?.mavenPath ?? ''
  const javaVersion = compactVersion(environment?.javaVersion)
  const mavenVersion = compactVersion(environment?.mavenVersion)

  const saveJavaHome = (javaHome?: string) =>
    updateEnvironment({
      javaHome,
      mavenHome: environment?.mavenHome,
      useMavenWrapper: environment?.useMavenWrapper ?? false,
    })

  const saveMavenHome = (mavenHome?: string) =>
    updateEnvironment({
      javaHome: environment?.javaHome,
      mavenHome,
      useMavenWrapper: environment?.useMavenWrapper ?? false,
    })

  return (
    <Card title="环境识别" className="panel-card env-card" size="small">
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div className="env-summary-grid">
          <div className="env-summary-item">
            <div className="env-summary-main">
              <Text strong>JDK</Text>
              <Tag color={environment?.javaVersion ? 'green' : 'red'}>{javaVersion}</Tag>
            </div>
            <Text className="env-summary-path" type="secondary" title={environment?.javaPath}>
              {environment?.javaPath ?? '未找到 java.exe'}
            </Text>
          </div>

          <div className="env-summary-item">
            <div className="env-summary-main">
              <Text strong>Maven</Text>
              <Tag color={environment?.mavenVersion ? 'green' : 'red'}>{mavenVersion}</Tag>
            </div>
            <Text className="env-summary-path" type="secondary" title={mavenValue}>
              {mavenValue || '未找到 Maven'}
            </Text>
          </div>

          <div className="env-summary-item">
            <div className="env-summary-main">
              <Text strong>settings.xml</Text>
              <Tag color={environment?.settingsXmlPath ? 'green' : 'default'}>
                {environment?.settingsXmlPath ? '已找到' : '未找到'}
              </Tag>
            </div>
            <Text
              className="env-summary-path"
              type="secondary"
              title={environment?.settingsXmlPath}
            >
              {environment?.settingsXmlPath ?? '使用 Maven 默认配置'}
            </Text>
          </div>

          <div className="env-summary-item">
            <div className="env-summary-main">
              <Text strong>mvnw.cmd</Text>
              <Switch
                size="small"
                checked={environment?.useMavenWrapper ?? false}
                disabled={!environment?.hasMavenWrapper}
                checkedChildren="mvnw"
                unCheckedChildren="Maven"
                onChange={(checked) =>
                  void updateEnvironment({
                    javaHome: environment?.javaHome,
                    mavenHome: environment?.mavenHome,
                    useMavenWrapper: checked,
                  })
                }
              />
            </div>
            <Text
              className="env-summary-path"
              type="secondary"
              title={environment?.mavenWrapperPath}
            >
              {environment?.mavenWrapperPath ?? '未发现 Maven Wrapper'}
            </Text>
          </div>
        </div>

        <Collapse
          ghost
          size="small"
          className="env-config-collapse"
          items={[
            {
              key: 'manual',
              label: '手动配置 JDK / Maven',
              children: (
                <Space direction="vertical" size={10} style={{ width: '100%' }}>
                  <div className="env-row">
                    <Input.Group compact>
                      <Input
                        key={`java-${javaValue}`}
                        className="env-path-input env-path-input-single-action"
                        placeholder="选择或粘贴 JDK 目录"
                        defaultValue={javaValue}
                        onBlur={(event) =>
                          void saveJavaHome(event.target.value.trim() || undefined)
                        }
                        onPressEnter={(event) => event.currentTarget.blur()}
                      />
                      <Button
                        icon={<FolderOpenOutlined />}
                        onClick={async () => {
                          const selected = await selectLocalDirectory('选择 JDK 目录')
                          if (selected) {
                            await saveJavaHome(selected)
                          }
                        }}
                      >
                        JDK
                      </Button>
                    </Input.Group>
                  </div>

                  <div className="env-row">
                    <Input.Group compact>
                      <Input
                        key={`maven-${mavenValue}`}
                        className="env-path-input env-path-input-double-action"
                        placeholder="选择或粘贴 Maven 目录 / mvn.cmd"
                        defaultValue={mavenValue}
                        onBlur={(event) =>
                          void saveMavenHome(event.target.value.trim() || undefined)
                        }
                        onPressEnter={(event) => event.currentTarget.blur()}
                      />
                      <Button
                        icon={<FileSearchOutlined />}
                        onClick={async () => {
                          const selected = await selectLocalFile('选择 mvn.cmd')
                          if (selected) {
                            await saveMavenHome(selected)
                          }
                        }}
                      >
                        文件
                      </Button>
                      <Button
                        icon={<FolderOpenOutlined />}
                        onClick={async () => {
                          const selected = await selectLocalDirectory('选择 Maven 目录')
                          if (selected) {
                            await saveMavenHome(selected)
                          }
                        }}
                      >
                        目录
                      </Button>
                    </Input.Group>
                  </div>
                </Space>
              ),
            },
          ]}
        />

        {environment?.errors.map((error) => (
          <Alert key={error} type="warning" showIcon message={error} />
        ))}
      </Space>
    </Card>
  )
}
