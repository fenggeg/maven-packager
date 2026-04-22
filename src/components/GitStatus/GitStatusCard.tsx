import {Alert, Button, Card, Empty, List, Select, Space, Tag, Typography} from 'antd'
import {DownloadOutlined, ReloadOutlined} from '@ant-design/icons'
import {useAppStore} from '../../store/useAppStore'

const { Text } = Typography

const formatCommitTime = (value: string) => {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }
  return date.toLocaleString()
}

export function GitStatusCard() {
  const project = useAppStore((state) => state.project)
  const gitStatus = useAppStore((state) => state.gitStatus)
  const gitCommits = useAppStore((state) => state.gitCommits)
  const gitChecking = useAppStore((state) => state.gitChecking)
  const gitCommitsLoading = useAppStore((state) => state.gitCommitsLoading)
  const gitPulling = useAppStore((state) => state.gitPulling)
  const gitSwitching = useAppStore((state) => state.gitSwitching)
  const loadGitCommits = useAppStore((state) => state.loadGitCommits)
  const fetchGitUpdates = useAppStore((state) => state.fetchGitUpdates)
  const pullGitUpdates = useAppStore((state) => state.pullGitUpdates)
  const switchGitBranch = useAppStore((state) => state.switchGitBranch)

  if (!project) {
    return null
  }

  if (!gitStatus?.isGitRepo) {
    return (
      <Card title="Git 状态" className="panel-card" size="small">
        <Text type="secondary">当前目录未识别为 Git 仓库。</Text>
      </Card>
    )
  }

  const statusTag = gitStatus.hasRemoteUpdates
    ? <Tag color="orange">落后 {gitStatus.behindCount}</Tag>
    : gitStatus.hasLocalChanges
      ? <Tag color="gold">本地有改动</Tag>
      : <Tag color="green">已同步</Tag>

  return (
    <Card
      title="Git 状态"
      className="panel-card"
      size="small"
      extra={statusTag}
    >
      <Space direction="vertical" size={10} style={{ width: '100%' }}>
        <div className="git-row">
          <Text type="secondary">当前分支</Text>
          <Select
            showSearch
            size="small"
            value={gitStatus.branch}
            placeholder="detached HEAD 或无本地分支"
            loading={gitChecking || gitSwitching}
            disabled={gitSwitching || gitStatus.branches.length === 0}
            options={gitStatus.branches.map((branch) => ({
              label: branch.isCurrent ? `${branch.name}（当前）` : branch.name,
              value: branch.name,
            }))}
            onChange={(branchName) => {
              if (branchName !== gitStatus.branch) {
                void switchGitBranch(branchName)
              }
            }}
          />
        </div>

        <Space wrap>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={gitChecking}
            onClick={() => void fetchGitUpdates()}
          >
            检查远端
          </Button>
          <Button
            size="small"
            icon={<ReloadOutlined />}
            loading={gitCommitsLoading}
            onClick={() => void loadGitCommits()}
          >
            刷新提交
          </Button>
          <Button
            size="small"
            type="primary"
            icon={<DownloadOutlined />}
            loading={gitPulling}
            disabled={!gitStatus.hasRemoteUpdates}
            onClick={() => void pullGitUpdates()}
          >
            应用内拉取
          </Button>
        </Space>

        {gitStatus.hasRemoteUpdates ? (
          <Alert
            type="warning"
            showIcon
            message={`远端有 ${gitStatus.behindCount} 个提交尚未拉取`}
            description="应用内拉取会使用快进模式；如果需要合并或处理冲突，请在代码编辑器中完成。"
          />
        ) : null}

        {gitStatus.hasLocalChanges ? (
          <Text type="warning" className="git-compact-tip">
            本地有未提交改动，不影响打包。
          </Text>
        ) : null}

        {!gitStatus.hasRemoteUpdates && !gitStatus.hasLocalChanges && gitStatus.message ? (
          <Alert type={gitStatus.upstream ? 'success' : 'info'} showIcon message={gitStatus.message} />
        ) : null}

        <div className="git-commit-section">
          <div className="git-commit-heading">
            <Text strong>最近提交</Text>
            <Text type="secondary">{gitCommits.length} 条</Text>
          </div>
          {gitCommits.length === 0 && !gitCommitsLoading ? (
            <Empty description="暂无提交记录" image={Empty.PRESENTED_IMAGE_SIMPLE} />
          ) : (
            <List
              className="git-commit-list"
              loading={gitCommitsLoading}
              dataSource={gitCommits}
              renderItem={(commit) => (
                <List.Item className="git-commit-item">
                  <Space direction="vertical" size={3} className="git-commit-content">
                    <Text strong ellipsis={{ tooltip: commit.subject }}>
                      {commit.subject}
                    </Text>
                    <Space size={8} wrap>
                      <Tag color="blue">{commit.shortHash}</Tag>
                      <Text type="secondary">{commit.author}</Text>
                      <Text type="secondary">{formatCommitTime(commit.date)}</Text>
                    </Space>
                  </Space>
                </List.Item>
              )}
            />
          )}
        </div>
      </Space>
    </Card>
  )
}
