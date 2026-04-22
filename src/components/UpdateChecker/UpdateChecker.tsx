import {useCallback, useEffect, useMemo, useState} from 'react'
import {App, Button, Modal, Progress, Space, Typography} from 'antd'
import type {Update} from '@tauri-apps/plugin-updater'
import ReactMarkdown from 'react-markdown'
import {
  type AppUpdateDownloadEvent,
  checkForAppUpdate,
  getCurrentAppVersion,
  installAppUpdate,
  isTauriRuntime,
} from '../../services/tauri-api'

const { Text } = Typography

type DownloadProgress = {
  downloaded: number
  total?: number
  finished: boolean
}

type UpdatePhase = 'check' | 'download' | 'install'

const formatBytes = (bytes: number) => {
  if (bytes <= 0) {
    return '0 B'
  }

  const units = ['B', 'KB', 'MB', 'GB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  const value = bytes / 1024 ** index

  return `${value.toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

const getErrorMessage = (error: unknown) =>
  error instanceof Error ? error.message : String(error)

const getRawUpdateNotes = (update: Update) => {
  const notes = update.rawJson.notes

  if (typeof update.body === 'string' && update.body.trim()) {
    return update.body
  }

  if (typeof notes === 'string') {
    return notes
  }

  if (Array.isArray(notes)) {
    return notes.filter((item) => typeof item === 'string').join('\n')
  }

  return ''
}

const formatUpdateNotes = (update: Update) => {
  const notes = getRawUpdateNotes(update).trim()

  return notes || '本次更新未提供更新日志。'
}

const formatReleaseDate = (date: string) => {
  const parsed = new Date(date)

  if (Number.isNaN(parsed.getTime())) {
    return date
  }

  return parsed.toLocaleString()
}

const getFriendlyUpdateErrorMessage = (error: unknown, phase: UpdatePhase) => {
  const rawMessage = getErrorMessage(error).toLowerCase()
  const prefix =
    phase === 'check'
      ? '检查更新失败'
      : phase === 'download'
        ? '下载更新失败'
        : '安装更新失败'

  if (rawMessage.includes('timeout') || rawMessage.includes('timed out')) {
    return `${prefix}：连接更新服务超时，请稍后重试。`
  }

  if (
    rawMessage.includes('decode') ||
    rawMessage.includes('decoding') ||
    rawMessage.includes('body') ||
    rawMessage.includes('unexpected eof') ||
    rawMessage.includes('incomplete') ||
    rawMessage.includes('truncated')
  ) {
    return `${prefix}：更新包下载中断或内容不完整，请检查网络后重新下载。`
  }

  if (
    rawMessage.includes('network') ||
    rawMessage.includes('fetch') ||
    rawMessage.includes('dns') ||
    rawMessage.includes('resolve') ||
    rawMessage.includes('connection') ||
    rawMessage.includes('request') ||
    rawMessage.includes('response')
  ) {
    return `${prefix}：暂时无法连接更新服务，请检查网络后重试。`
  }

  if (
    rawMessage.includes('signature') ||
    rawMessage.includes('pubkey') ||
    rawMessage.includes('verify') ||
    rawMessage.includes('verification')
  ) {
    return `${prefix}：更新包校验未通过，请等待重新发布后再试。`
  }

  if (
    rawMessage.includes('404') ||
    rawMessage.includes('not found') ||
    rawMessage.includes('asset')
  ) {
    return `${prefix}：未找到适合当前安装方式的更新包，请稍后重试。`
  }

  if (
    rawMessage.includes('json') ||
    rawMessage.includes('parse') ||
    rawMessage.includes('format')
  ) {
    return `${prefix}：更新信息格式异常，请等待重新发布后再试。`
  }

  if (
    rawMessage.includes('permission') ||
    rawMessage.includes('access denied') ||
    rawMessage.includes('denied')
  ) {
    return `${prefix}：当前权限不足，请以管理员身份运行后重试。`
  }

  if (
    rawMessage.includes('install') ||
    rawMessage.includes('installer') ||
    rawMessage.includes('process') ||
    rawMessage.includes('exit')
  ) {
    return `${prefix}：安装程序没有正常完成，请关闭应用后重试。`
  }

  return `${prefix}：更新服务暂时不可用，请稍后重试。`
}

export function UpdateChecker() {
  const { message } = App.useApp()
  const [checking, setChecking] = useState(false)
  const [installing, setInstalling] = useState(false)
  const [updatePhase, setUpdatePhase] = useState<Exclude<UpdatePhase, 'check'> | null>(null)
  const [currentVersion, setCurrentVersion] = useState(() =>
    isTauriRuntime() ? '' : '开发预览',
  )
  const [update, setUpdate] = useState<Update | null>(null)
  const [progress, setProgress] = useState<DownloadProgress>({
    downloaded: 0,
    finished: false,
  })

  const progressPercent = useMemo(() => {
    if (!progress.total) {
      return 0
    }

    return Math.min(100, Math.round((progress.downloaded / progress.total) * 100))
  }, [progress.downloaded, progress.total])

  const resetProgress = () => {
    setProgress({ downloaded: 0, finished: false })
  }

  const checkUpdate = useCallback(
    async (silent = false) => {
      if (!isTauriRuntime()) {
        if (!silent) {
          void message.info('请在桌面应用中检查更新。')
        }
        return
      }

      setChecking(true)
      try {
        const nextUpdate = await checkForAppUpdate()
        if (!nextUpdate) {
          if (!silent) {
            void message.success(
              currentVersion
                ? `当前已是最新版本：${currentVersion}`
                : '当前已是最新版本。',
            )
          }
          return
        }

        resetProgress()
        setUpdate(nextUpdate)
      } catch (error) {
        if (!silent) {
          void message.error(getFriendlyUpdateErrorMessage(error, 'check'))
        }
      } finally {
        setChecking(false)
      }
    },
    [currentVersion, message],
  )

  useEffect(() => {
    if (!isTauriRuntime()) {
      return
    }

    let disposed = false

    void getCurrentAppVersion()
      .then((version) => {
        if (!disposed) {
          setCurrentVersion(version)
        }
      })
      .catch(() => {
        if (!disposed) {
          setCurrentVersion('')
        }
      })

    return () => {
      disposed = true
    }
  }, [])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void checkUpdate(true)
    }, 3500)

    return () => window.clearTimeout(timer)
  }, [checkUpdate])

  const handleDownloadEvent = (event: AppUpdateDownloadEvent) => {
    if (event.event === 'Started') {
      setProgress({
        downloaded: 0,
        total: event.data.contentLength,
        finished: false,
      })
      return
    }

    if (event.event === 'Progress') {
      setProgress((current) => ({
        ...current,
        downloaded: current.downloaded + event.data.chunkLength,
      }))
      return
    }

    setProgress((current) => ({
      ...current,
      finished: true,
    }))
  }

  const installUpdate = async () => {
    if (!update) {
      return
    }

    setInstalling(true)
    let phase: Exclude<UpdatePhase, 'check'> = 'download'
    setUpdatePhase('download')
    try {
      await installAppUpdate(update, handleDownloadEvent, () => {
        phase = 'install'
        setUpdatePhase('install')
      })
      void message.success('更新已安装，正在重启应用。')
    } catch (error) {
      void message.error(getFriendlyUpdateErrorMessage(error, phase))
      setInstalling(false)
      setUpdatePhase(null)
    }
  }

  const closeModal = () => {
    if (installing) {
      return
    }

    setUpdate(null)
    setUpdatePhase(null)
    resetProgress()
  }

  return (
    <Space size={8} className="update-checker">
      {currentVersion && (
        <Text type="secondary" className="current-version">
          当前版本 {currentVersion}
        </Text>
      )}
      <Button loading={checking} onClick={() => void checkUpdate(false)}>
        检查更新
      </Button>
      <Modal
        title="发现新版本"
        open={Boolean(update)}
        onCancel={closeModal}
        closable={!installing}
        maskClosable={!installing}
        footer={[
          <Button key="later" disabled={installing} onClick={closeModal}>
            稍后
          </Button>,
          <Button
            key="install"
            type="primary"
            loading={installing}
            onClick={() => void installUpdate()}
          >
            {updatePhase === 'download' ? '下载中' : updatePhase === 'install' ? '安装中' : '立即更新'}
          </Button>,
        ]}
      >
        {update && (
          <Space direction="vertical" size={12} className="update-modal-content">
            <Text>
              当前版本 {update.currentVersion || currentVersion}，最新版本 {update.version}
            </Text>
            {update.date && (
              <Text type="secondary">发布时间：{formatReleaseDate(update.date)}</Text>
            )}
            <div className="update-notes">
              <ReactMarkdown
                components={{
                  a: ({ children, href }) => (
                    <a href={href} target="_blank" rel="noreferrer">
                      {children}
                    </a>
                  ),
                }}
              >
                {formatUpdateNotes(update)}
              </ReactMarkdown>
            </div>
            {installing && (
              <div className="update-progress">
                <Progress
                  percent={progress.finished ? 100 : progressPercent}
                  status={progress.finished ? 'success' : 'active'}
                />
                <Text type="secondary">
                  {progress.finished
                    ? '下载完成，正在安装'
                    : progress.total
                      ? `${formatBytes(progress.downloaded)} / ${formatBytes(progress.total)}`
                      : `${formatBytes(progress.downloaded)} 已下载`}
                </Text>
              </div>
            )}
          </Space>
        )}
      </Modal>
    </Space>
  )
}
