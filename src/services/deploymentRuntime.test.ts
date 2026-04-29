import {describe, expect, it} from 'vitest'
import type {DeploymentStage} from '../types/domain'
import {shouldFlushUploadProgress, summarizeDeploymentPipeline} from './deploymentRuntime'

const stage = (key: string, status: DeploymentStage['status']): DeploymentStage => ({
  key,
  label: key,
  status,
})

describe('summarizeDeploymentPipeline', () => {
  it('tracks done count, percent, and the active running stage', () => {
    const summary = summarizeDeploymentPipeline([
      stage('prepare', 'success'),
      stage('upload', 'running'),
      stage('start', 'pending'),
    ])

    expect(summary.done).toBe(1)
    expect(summary.total).toBe(3)
    expect(summary.percent).toBe(33)
    expect(summary.activeIndex).toBe(1)
  })

  it('keeps failed stages visible as the active stage', () => {
    const summary = summarizeDeploymentPipeline([
      stage('prepare', 'success'),
      stage('check', 'failed'),
      stage('tail', 'pending'),
    ])

    expect(summary.failedStage?.key).toBe('check')
    expect(summary.activeIndex).toBe(1)
  })
})

describe('shouldFlushUploadProgress', () => {
  it('flushes the first sample and completion', () => {
    expect(shouldFlushUploadProgress(undefined, {percent: 0.4, elapsedMs: 0})).toBe(true)
    expect(shouldFlushUploadProgress({percent: 98, elapsedMs: 1000}, {percent: 100, elapsedMs: 1001})).toBe(true)
  })

  it('flushes meaningful deltas, time intervals, and milestones', () => {
    expect(shouldFlushUploadProgress({percent: 10, elapsedMs: 0}, {percent: 12.1, elapsedMs: 10})).toBe(true)
    expect(shouldFlushUploadProgress({percent: 10, elapsedMs: 0}, {percent: 10.4, elapsedMs: 600})).toBe(true)
    expect(shouldFlushUploadProgress({percent: 24.8, elapsedMs: 0}, {percent: 25, elapsedMs: 10})).toBe(true)
  })

  it('skips tiny high-frequency updates', () => {
    expect(shouldFlushUploadProgress({percent: 10, elapsedMs: 0}, {percent: 10.4, elapsedMs: 100})).toBe(false)
  })
})
