import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import type { DemosResponse } from './types'

vi.mock('./api', () => ({
  fetchDemos: vi.fn(),
  sendBasicQuota: vi.fn(),
  sendLlmSecurity: vi.fn(),
  sendLlmRateLimiting: vi.fn(),
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

  it('renders LlmRateLimitingDemo when llm-token-limits-v2 is the active demo', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce({
      status: 'ready',
      host: 'h',
      project_id: 'p',
      demos: [
        {
          id: 'llm-token-limits-v2',
          title: 'LLM Rate Limiting',
          description: 'd',
          icon: '⚡',
          status: 'passing',
          bronze_token_limit: 2000,
          silver_token_limit: 5000,
          interval_minutes: 5,
          model: 'gemini-2.5-flash',
          region: 'us-central1',
        },
      ],
    })

    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'LLM Rate Limiting' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Bronze')).toBeInTheDocument()
    expect(screen.getByLabelText('Silver')).toBeInTheDocument()
  })
})

describe('App — placeholder demos', () => {
  it('renders PlaceholderDemo when a placeholder demo is active', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce({
      status: 'ready',
      host: 'h',
      project_id: 'p',
      demos: [
        {
          id: 'llm-routing',
          title: 'LLM Model Routing',
          description: 'Routes prompts between cheap and premium models.',
          icon: '🔀',
          status: 'placeholder',
          placeholder: true,
        },
      ],
    })

    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 2, name: /LLM Model Routing/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/not yet implemented/i)).toBeInTheDocument()
  })

  it('does not render a real demo component when the active demo is a placeholder', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce({
      status: 'ready',
      host: 'h',
      project_id: 'p',
      demos: [
        {
          id: 'llm-routing',
          title: 'LLM Model Routing',
          description: 'd',
          icon: '🔀',
          status: 'placeholder',
          placeholder: true,
        },
      ],
    })

    render(<App />)

    await screen.findByText(/not yet implemented/i)
    // No real demo's "Send" button should be present.
    expect(screen.queryByRole('button', { name: /^Send$/i })).not.toBeInTheDocument()
  })
})
