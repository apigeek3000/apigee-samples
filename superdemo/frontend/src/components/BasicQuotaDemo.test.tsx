import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { BasicQuotaDemo } from './BasicQuotaDemo'

vi.mock('../api', () => ({
  sendBasicQuota: vi.fn(),
}))

import { sendBasicQuota } from '../api'

beforeEach(() => {
  vi.resetAllMocks()
})

describe('BasicQuotaDemo', () => {
  it('sends the selected tier when Send is clicked', async () => {
    vi.mocked(sendBasicQuota).mockResolvedValueOnce({
      raw: { ok: true },
      quotaCount: 1,
      quotaLimit: 10,
    })
    const user = userEvent.setup()

    render(<BasicQuotaDemo />)

    await user.click(screen.getByRole('button', { name: /^Premium$/i }))
    await user.click(screen.getByRole('button', { name: /Send Request/i }))

    expect(sendBasicQuota).toHaveBeenCalledWith('premium')
  })

  it('renders quota count and limit on success', async () => {
    vi.mocked(sendBasicQuota).mockResolvedValueOnce({
      raw: { used: 4, allowed: 10 },
      quotaCount: 4,
      quotaLimit: 10,
    })
    const user = userEvent.setup()

    render(<BasicQuotaDemo />)
    await user.click(screen.getByRole('button', { name: /Send Request/i }))

    const counterSection = (await screen.findByText('Counter')).parentElement!
    expect(within(counterSection).getByText('4')).toBeInTheDocument()

    const limitSection = screen.getByText('Limit').parentElement!
    expect(within(limitSection).getByText('10')).toBeInTheDocument()
  })

  it('surfaces "Quota exceeded" error in the response card', async () => {
    vi.mocked(sendBasicQuota).mockRejectedValueOnce({
      status: 429,
      message: 'Quota exceeded',
      body: { fault: { faultstring: 'Rate limit quota violation' } },
    })
    const user = userEvent.setup()

    render(<BasicQuotaDemo />)
    await user.click(screen.getByRole('button', { name: /Send Request/i }))

    expect(await screen.findByText(/quota exceeded/i)).toBeInTheDocument()
    expect(screen.getByText(/error 429/i)).toBeInTheDocument()
  })
})
