import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import type { DemosResponse } from './types'

vi.mock('./api', () => ({
  fetchDemos: vi.fn(),
  sendBasicQuota: vi.fn(),
  sendLlmSecurity: vi.fn(),
}))

import { fetchDemos } from './api'

const readyDemos: DemosResponse = {
  status: 'ready',
  host: 'apigee.test',
  project_id: 'fake-project',
  demos: [
    { id: 'basic-quota', title: 'Basic Quota', description: 'd1', icon: '⏱️', status: 'passing' },
    {
      id: 'llm-security',
      title: 'LLM Security v2',
      description: 'd2',
      icon: '🛡️',
      status: 'passing',
      model_name: 'gemini-fake',
      model_armor_region: 'us-central1',
    },
  ],
}

const unconfiguredDemos: DemosResponse = {
  status: 'unconfigured',
  demos: readyDemos.demos,
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('App — loading state', () => {
  it('shows the loading status banner before demos resolve', () => {
    vi.mocked(fetchDemos).mockReturnValue(new Promise(() => {}))

    render(<App />)

    expect(screen.getByText(/loading backend status/i)).toBeInTheDocument()
  })
})

describe('App — ready state', () => {
  it('renders the first demo panel after fetchDemos resolves with status ready', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce(readyDemos)

    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 2, name: /^Basic Quota$/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/connected to apigee/i)).toBeInTheDocument()
  })
})

describe('App — unconfigured state', () => {
  it('shows the unconfigured banner when fetchDemos resolves with status unconfigured', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce(unconfiguredDemos)

    render(<App />)

    expect(
      await screen.findByText(/backend reachable but unconfigured/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/select a demo from the sidebar/i)).toBeInTheDocument()
  })
})

describe('App — sidebar navigation', () => {
  it('switches the active panel when a different sidebar item is clicked', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce(readyDemos)
    const user = userEvent.setup()

    render(<App />)

    await screen.findByRole('heading', { level: 2, name: /^Basic Quota$/i })

    await user.click(
      screen.getByRole('button', { name: /LLM Security v2/i }),
    )

    expect(
      await screen.findByRole('heading', { level: 2, name: /LLM Security v2/i }),
    ).toBeInTheDocument()
  })
})
