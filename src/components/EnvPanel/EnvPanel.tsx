import { Alert, Button, Card, Input, Space, Switch, Tag, Typography } from 'antd'
import { FolderOpenOutlined, FileSearchOutlined } from '@ant-design/icons'
import { selectLocalDirectory, selectLocalFile } from '../../services/tauri-api'
import { useAppStore } from '../../store/useAppStore'

const { Text } = Typography

export function EnvPanel() {
  const environment = useAppStore((state) => state.environment)
  const updateEnvironment = useAppStore((state) => state.updateEnvironment)

  const javaValue = environment?.javaHome ?? ''
  const mavenValue = environment?.mavenHome ?? environment?.mavenPath ?? ''

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
    <Card title="环境识别" className="panel-card" size="small">
      <Space direction="vertical" size={14} style={{ width: '100%' }}>
        <div className="env-row">
          <div className="env-heading">
            <Text strong>JDK</Text>
            <Tag color={environment?.javaVersion ? 'green' : 'red'}>
              {environment?.javaVersion ?? '未识别'}
            </Tag>
          </div>
          <Input.Group compact>
            <Input
              key={`java-${javaValue}`}
              className="env-path-input"
              placeholder="选择或粘贴 JDK 目录"
              defaultValue={javaValue}
              onBlur={(event) => void saveJavaHome(event.target.value.trim() || undefined)}
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
              选择
            </Button>
          </Input.Group>
          {environment?.javaPath ? (
            <Text className="path-text" type="secondary">
              当前 java.exe：{environment.javaPath}
            </Text>
          ) : null}
        </div>

        <div className="env-row">
          <div className="env-heading">
            <Text strong>Maven</Text>
            <Tag color={environment?.mavenVersion ? 'green' : 'red'}>
              {environment?.mavenVersion ?? '未识别'}
            </Tag>
          </div>
          <Input.Group compact>
            <Input
              key={`maven-${mavenValue}`}
              className="env-path-input"
              placeholder="选择或粘贴 Maven 目录 / mvn.cmd"
              defaultValue={mavenValue}
              onBlur={(event) => void saveMavenHome(event.target.value.trim() || undefined)}
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

        <div className="env-row">
          <div className="env-heading">
            <Text strong>settings.xml</Text>
            <Tag color={environment?.settingsXmlPath ? 'green' : 'default'}>
              {environment?.settingsXmlPath ? '已找到' : '未找到'}
            </Tag>
          </div>
          <Text className="path-text" type="secondary">
            {environment?.settingsXmlPath ?? '优先读取用户目录 .m2/settings.xml，其次读取 Maven conf/settings.xml'}
          </Text>
        </div>

        <div className="env-row env-inline">
          <div>
            <Text strong>mvnw.cmd</Text>
            <div>
              <Text type="secondary">
                {environment?.mavenWrapperPath ?? '当前项目根目录未发现 Maven Wrapper'}
              </Text>
            </div>
          </div>
          <Switch
            checked={environment?.useMavenWrapper ?? false}
            disabled={!environment?.hasMavenWrapper}
            checkedChildren="优先 mvnw"
            unCheckedChildren="使用 Maven"
            onChange={(checked) =>
              void updateEnvironment({
                javaHome: environment?.javaHome,
                mavenHome: environment?.mavenHome,
                useMavenWrapper: checked,
              })
            }
          />
        </div>

        {environment?.errors.map((error) => (
          <Alert key={error} type="warning" showIcon message={error} />
        ))}
      </Space>
    </Card>
  )
}
