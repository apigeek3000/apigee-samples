import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { LlmRateLimitingDemo } from './LlmRateLimitingDemo'
import * as api from '../api'
import type { DemoMetadata, DemosResponse } from '../types'

const DEMO: DemoMetadata = {
  id: 'llm-token-limits-v2',
  title: 'LLM Rate Limiting',
  description: 'desc',
  icon: '⚡',
  status: 'passing',
  bronze_token_limit: 2000,
  silver_token_limit: 5000,
  interval_minutes: 5,
  model: 'gemini-2.5-flash',
  region: 'us-central1',
}

const DEMOS: DemosResponse = {
  status: 'ready',
  host: 'apigee.test.example.com',
  project_id: 'proj',
  demos: [DEMO],
}

function mockApi() {
  return vi.spyOn(api, 'sendLlmRateLimiting')
}

describe('LlmRateLimitingDemo', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('renders both panes with the correct limits surfaced from the demo metadata', () => {
    render(<LlmRateLimitingDemo demos={DEMOS} demo={DEMO} />)
    expect(screen.getByText('Bronze')).toBeInTheDocument()
    expect(screen.getByText('Silver')).toBeInTheDocument()
    expect(screen.getByText('0 / 2000')).toBeInTheDocument()
    expect(screen.getByText('0 / 5000')).toBeInTheDocument()
  })

  it('Send fires two API calls — one per tier — with the same prompt', async () => {
    const spy = mockApi()
      .mockResolvedValueOnce({ text: 'b', totalTokens: 2, raw: {} })
      .mockResolvedValueOnce({ text: 's', totalTokens: 2, raw: {} })

    render(<LlmRateLimitingDemo demos={DEMOS} demo={DEMO} />)
    fireEvent.change(screen.getByLabelText(/prompt/i), {
      target: { value: 'why is the sky blue?' },
    })
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /^send$/i }))
    })

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(2))
    const tiers = spy.mock.calls.map((c) => c[0].tier).sort()
    expect(tiers).toEqual(['bronze', 'silver'])
  })

  it('Send is disabled when input is empty', () => {
    render(<LlmRateLimitingDemo demos={DEMOS} demo={DEMO} />)
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()
  })

  it('Burst fires up to 5 sequential rounds per pane, stopping a pane that 429s', async () => {
    const spy = mockApi()
    // bronze pane: 1st OK, 2nd 429, 3rd-5th never called
    // silver pane: all 5 OK
    spy.mockImplementation((req) => {
      if (req.tier === 'bronze') {
        const c = spy.mock.calls.filter((x) => x[0].tier === 'bronze').length
        if (c <= 1) {
          return Promise.resolve({ text: 'b', totalTokens: 2, raw: {} })
        }
        return Promise.reject({ status: 429, message: 'Token quota exceeded' })
      }
      return Promise.resolve({ text: 's', totalTokens: 2, raw: {} })
    })

    render(<LlmRateLimitingDemo demos={DEMOS} demo={DEMO} />)
    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: /trigger 429 burst/i }))
    })

    await waitFor(() => {
      const bronzeCalls = spy.mock.calls.filter((x) => x[0].tier === 'bronze').length
      const silverCalls = spy.mock.calls.filter((x) => x[0].tier === 'silver').length
      expect(bronzeCalls).toBe(2)
      expect(silverCalls).toBe(5)
    })
  })

  it('input + Send disabled while bursting', async () => {
    let pending: ((v: unknown) => void)[] = []
    mockApi().mockImplementation(() =>
      new Promise((resolve) => {
        pending.push(resolve)
      }) as never,
    )

    render(<LlmRateLimitingDemo demos={DEMOS} demo={DEMO} />)
    act(() => {
      fireEvent.click(screen.getByRole('button', { name: /trigger 429 burst/i }))
    })
    expect(screen.getByLabelText(/prompt/i)).toBeDisabled()
    expect(screen.getByRole('button', { name: /^send$/i })).toBeDisabled()

    // Resolve all pending to let test cleanly finish
    await act(async () => {
      pending.forEach((r) =>
        r({ text: 'x', totalTokens: 2, raw: {} }),
      )
    })
  })
})
