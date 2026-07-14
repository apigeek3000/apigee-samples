import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmTokenLimitsPerUserDemo } from './LlmTokenLimitsPerUserDemo'
import { sendPerUserTokenLimits } from '../api'
import type { DemoMetadata, DemosResponse } from '../types'

vi.mock('../api', () => ({
  sendPerUserTokenLimits: vi.fn(),
}))

const demo: DemoMetadata = {
  id: 'llm-token-limits-per-user',
  title: 'Per-User Token Limits',
  description: 'Token quotas per user.',
  icon: '👤',
  status: 'passing',
  bronze_token_limit: 2000,
  silver_token_limit: 5000,
  interval_minutes: 5,
  model: 'gemini-2.5-flash',
  region: 'us-central1',
}

const demos: DemosResponse = {
  status: 'ready',
  project_id: 'test-project',
  demos: [demo],
}

describe('LlmTokenLimitsPerUserDemo', () => {
  beforeEach(() => {
    vi.mocked(sendPerUserTokenLimits).mockReset()
  })

  it('sends as the pane owner and tallies that user\'s tokens', async () => {
    const user = userEvent.setup()
    vi.mocked(sendPerUserTokenLimits).mockResolvedValue({
      httpStatus: 200,
      quotaExceeded: false,
      text: 'hello',
      totalTokens: 42,
      body: {},
    })

    render(<LlmTokenLimitsPerUserDemo demos={demos} demo={demo} />)
    const alicePane = screen.getByTestId('pane-alice')
    await user.click(within(alicePane).getByRole('button', { name: /send/i }))

    expect(sendPerUserTokenLimits).toHaveBeenCalledWith(
      expect.objectContaining({ userId: 'alice', tier: 'bronze' }),
    )
    expect(await within(alicePane).findByText(/42 \/ 2000/)).toBeInTheDocument()
  })

  it('shows a 429 badge for the exhausted user only', async () => {
    const user = userEvent.setup()
    vi.mocked(sendPerUserTokenLimits).mockResolvedValue({
      httpStatus: 429,
      quotaExceeded: true,
      text: '',
      body: { fault: { faultstring: 'quota violation' } },
    })

    render(<LlmTokenLimitsPerUserDemo demos={demos} demo={demo} />)
    const alicePane = screen.getByTestId('pane-alice')
    await user.click(within(alicePane).getByRole('button', { name: /send/i }))

    expect(await within(alicePane).findByText(/429/)).toBeInTheDocument()
    const bobPane = screen.getByTestId('pane-bob')
    expect(within(bobPane).queryByText(/429/)).not.toBeInTheDocument()
  })

  it('switching to silver raises the limit shown on both meters', async () => {
    const user = userEvent.setup()
    render(<LlmTokenLimitsPerUserDemo demos={demos} demo={demo} />)

    await user.click(screen.getByRole('button', { name: /silver/i }))

    expect(screen.getAllByText(/0 \/ 5000/)).toHaveLength(2)
    expect(sendPerUserTokenLimits).not.toHaveBeenCalled()
  })

  it('resets the tally and last response when switching tiers', async () => {
    const user = userEvent.setup()
    vi.mocked(sendPerUserTokenLimits).mockResolvedValue({
      httpStatus: 200,
      quotaExceeded: false,
      text: 'hello',
      totalTokens: 42,
      body: {},
    })

    render(<LlmTokenLimitsPerUserDemo demos={demos} demo={demo} />)
    const alicePane = screen.getByTestId('pane-alice')
    await user.click(within(alicePane).getByRole('button', { name: /send/i }))

    expect(await within(alicePane).findByText(/42 \/ 2000/)).toBeInTheDocument()
    expect(within(alicePane).getByText(/HTTP 200/)).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: /silver/i }))

    expect(within(alicePane).getByText(/0 \/ 5000/)).toBeInTheDocument()
    expect(within(alicePane).queryByText(/HTTP 200/)).not.toBeInTheDocument()
  })
})
