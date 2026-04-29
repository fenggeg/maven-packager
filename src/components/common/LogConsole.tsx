import {forwardRef, useMemo} from 'react'
import {Typography} from 'antd'

const {Text} = Typography

export type LogLineTone = '' | 'success' | 'error' | 'warn' | 'warning'

interface LogConsoleProps {
  lines: readonly string[]
  classifyLine?: (line: string) => LogLineTone
  className?: string
  emptyTitle: string
  emptyDescription?: string
  renderLimit?: number
  keyPrefix?: string
}

const toneClassName = (tone: LogLineTone) => tone === 'warning' ? 'warn' : tone

export const LogConsole = forwardRef<HTMLDivElement, LogConsoleProps>(function LogConsole({
  lines,
  classifyLine,
  className = 'log-panel',
  emptyTitle,
  emptyDescription,
  renderLimit = 1200,
  keyPrefix = 'log',
}, ref) {
  const {hiddenCount, renderedLines, offset} = useMemo(() => {
    const nextLines = lines.slice(-renderLimit)
    return {
      hiddenCount: Math.max(0, lines.length - nextLines.length),
      renderedLines: nextLines,
      offset: Math.max(0, lines.length - nextLines.length),
    }
  }, [lines, renderLimit])

  return (
    <div className={className} ref={ref}>
      {lines.length === 0 ? (
        <div className="log-empty">
          <Text>{emptyTitle}</Text>
          {emptyDescription ? <Text type="secondary">{emptyDescription}</Text> : null}
        </div>
      ) : (
        <>
          {hiddenCount > 0 ? (
            <div className="log-truncated">已折叠较早的 {hiddenCount} 行，复制/下载仍包含完整日志。</div>
          ) : null}
          {renderedLines.map((line, index) => (
            <pre
              className={`log-line ${toneClassName(classifyLine?.(line) ?? '')}`}
              key={`${keyPrefix}-${offset + index}`}
            >
              {line}
            </pre>
          ))}
        </>
      )}
    </div>
  )
})
