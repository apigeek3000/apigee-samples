import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, waitFor, act } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { CloudLoggingDemo } from './CloudLoggingDemo'
import type { DemoMetadata, DemosResponse } from '../types'

vi.mock('../api', () => ({
  sendCloudLogging: vi.fn(),
  fetchRecentLog: vi.fn(),
}))

import { sendCloudLogging, fetchRecentLog } from '../api'

const demo: DemoMetadata = {
  id: 'cloud-logging',
  title: 'Cloud Logging',
  description: 'demo desc',
  icon: '🪵',
  status: 'passing',
  log_name: 'projects/fake-project/logs/apigee',
  proxy_name: 'sample-cloud-logging',
}

const demos: DemosResponse = {
  status: 'ready',
  host: 'apigee.test',
  project_id: 'fake-project',
  demos: [demo],
}

beforeEach(() => {
  vi.resetAllMocks()
  vi.useFakeTimers({ shouldAdvanceTime: true })
})

afterEach(() => {
  vi.useRealTimers()
})

describe('CloudLoggingDemo', () => {
  it('renders the Open in Logs Explorer link with the correct href', () => {
    render(<CloudLoggingDemo demos={demos} demo={demo} />)
    const link = screen.getByRole('link', { name: /open in logs explorer/i })
    const href = link.getAttribute('href')!
    expect(href).toContain('console.cloud.google.com/logs/query')
    expect(href).toContain('project=fake-project')
    expect(href).toContain(encodeURIComponent('logName="projects/fake-project/logs/apigee"'))
    expect(href).toContain(encodeURIComponent('jsonPayload.proxy="sample-cloud-logging"'))
  })

  it('sends a request and shows the proxy response in the Response card', async () => {
    vi.mocked(sendCloudLogging).mockResolvedValueOnce({
      httpStatus: 200,
      body: { url: 'https://httpbin.org/get' },
      sentAt: '2026-05-29T12:00:00.000Z',
    })
    vi.mocked(fetchRecentLog).mockResolvedValue({
      entry: null,
      queried_at: '2026-05-29T12:00:01Z',
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<CloudLoggingDemo demos={demos} demo={demo} />)

    await user.click(screen.getByRole('button', { name: /send request/i }))

    expect(await screen.findByText(/httpbin.org\/get/i)).toBeInTheDocument()
  })

  it('polls fetchRecentLog and renders the entry when one becomes available', async () => {
    vi.mocked(sendCloudLogging).mockResolvedValueOnce({
      httpStatus: 200,
      body: { url: 'https://httpbin.org/get' },
      sentAt: '2026-05-29T12:00:00.000Z',
    })
    vi.mocked(fetchRecentLog)
      .mockResolvedValueOnce({ entry: null, queried_at: '2026-05-29T12:00:01Z' })
      .mockResolvedValueOnce({
        entry: {
          timestamp: '2026-05-29T12:00:02Z',
          jsonPayload: { proxy: 'sample-cloud-logging', verb: 'GET' },
        },
        queried_at: '2026-05-29T12:00:02Z',
      })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<CloudLoggingDemo demos={demos} demo={demo} />)

    await user.click(screen.getByRole('button', { name: /send request/i }))

    // First poll fires immediately (or after the first 1s tick).
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })

    await waitFor(() => {
      expect(screen.getByText(/sample-cloud-logging/)).toBeInTheDocument()
    })
  })

  it('keeps polling past the old 8s budget to absorb ingestion latency', async () => {
    vi.mocked(sendCloudLogging).mockResolvedValueOnce({
      httpStatus: 200,
      body: {},
      sentAt: '2026-05-29T12:00:00.000Z',
    })
    vi.mocked(fetchRecentLog).mockResolvedValue({
      entry: null,
      queried_at: '2026-05-29T12:00:01Z',
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<CloudLoggingDemo demos={demos} demo={demo} />)
    await user.click(screen.getByRole('button', { name: /send request/i }))

    // Advance ~15s — well past the old 8-attempt (8s) window.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(15000)
    })

    // Still polling: must not have given up yet, and must have polled
    // many more than the old 8 times.
    expect(screen.queryByText(/log not yet visible/i)).not.toBeInTheDocument()
    expect(vi.mocked(fetchRecentLog).mock.calls.length).toBeGreaterThan(8)
  })

  it('shows the permission-error message when fetchRecentLog throws 403', async () => {
    vi.mocked(sendCloudLogging).mockResolvedValueOnce({
      httpStatus: 200,
      body: {},
      sentAt: '2026-05-29T12:00:00.000Z',
    })
    vi.mocked(fetchRecentLog).mockRejectedValueOnce({
      status: 403,
      message: 'roles/logging.viewer required',
    })
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })

    render(<CloudLoggingDemo demos={demos} demo={demo} />)

    await user.click(screen.getByRole('button', { name: /send request/i }))
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1100)
    })

    expect(await screen.findByText(/roles\/logging\.viewer/i)).toBeInTheDocument()
  })
})
