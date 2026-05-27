import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act } from '@testing-library/react'
import { createRef } from 'react'
import { RateLimitPane, type RateLimitPaneHandle } from './RateLimitPane'
import * as api from '../api'

function mockApi() {
  return vi.spyOn(api, 'sendLlmRateLimiting')
}

describe('RateLimitPane', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('appends user + model turns and accumulates token counters on success', async () => {
    mockApi().mockResolvedValueOnce({
      text: 'It is Rayleigh scattering.',
      totalTokens: 25,
      raw: {},
    })

    const ref = createRef<RateLimitPaneHandle>()
    render(
      <RateLimitPane
        ref={ref}
        tier="bronze"
        label="Bronze"
        limit={2000}
        projectId="p"
        region="r"
        model="m"
      />,
    )

    await act(async () => {
      await ref.current!.send('Why is the sky blue?')
    })

    expect(screen.getByText('Why is the sky blue?')).toBeInTheDocument()
    expect(screen.getByText('It is Rayleigh scattering.')).toBeInTheDocument()
    expect(screen.getByText('25 / 2000')).toBeInTheDocument()
  })

  it('renders an error turn with explanatory copy when the API returns 429', async () => {
    mockApi().mockRejectedValueOnce({ status: 429, message: 'Token quota exceeded' })

    const ref = createRef<RateLimitPaneHandle>()
    render(
      <RateLimitPane
        ref={ref}
        tier="bronze"
        label="Bronze"
        limit={2000}
        projectId="p"
        region="r"
        model="m"
      />,
    )

    let result: { ok: boolean } = { ok: true }
    await act(async () => {
      result = await ref.current!.send('hi')
    })

    expect(result.ok).toBe(false)
    expect(
      screen.getByText(/Token limit reached.*Apigee's 5-minute window/i),
    ).toBeInTheDocument()
  })

  it('Clear conversation empties turns but leaves cumulative tokens intact', async () => {
    mockApi().mockResolvedValueOnce({
      text: 'response',
      totalTokens: 15,
      raw: {},
    })

    const ref = createRef<RateLimitPaneHandle>()
    render(
      <RateLimitPane
        ref={ref}
        tier="bronze"
        label="Bronze"
        limit={2000}
        projectId="p"
        region="r"
        model="m"
      />,
    )

    await act(async () => {
      await ref.current!.send('hi')
    })
    expect(screen.getByText('hi')).toBeInTheDocument()
    expect(screen.getByText('15 / 2000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /clear conversation/i }))

    await waitFor(() => {
      expect(screen.queryByText('hi')).not.toBeInTheDocument()
    })
    expect(screen.getByText('15 / 2000')).toBeInTheDocument()
  })

  it('Reset meter zeroes cumulative tokens but keeps the transcript', async () => {
    mockApi().mockResolvedValueOnce({
      text: 'response',
      totalTokens: 15,
      raw: {},
    })

    const ref = createRef<RateLimitPaneHandle>()
    render(
      <RateLimitPane
        ref={ref}
        tier="bronze"
        label="Bronze"
        limit={2000}
        projectId="p"
        region="r"
        model="m"
      />,
    )

    await act(async () => {
      await ref.current!.send('hi')
    })
    expect(screen.getByText('15 / 2000')).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: /reset meter/i }))

    expect(screen.getByText('0 / 2000')).toBeInTheDocument()
    expect(screen.getByText('hi')).toBeInTheDocument()
  })

  it('sends stateful contents — second send includes the prior user + model turn', async () => {
    const spy = mockApi()
    spy.mockResolvedValueOnce({
      text: 'A1',
      totalTokens: 10,
      raw: {},
    })
    spy.mockResolvedValueOnce({
      text: 'A2',
      totalTokens: 12,
      raw: {},
    })

    const ref = createRef<RateLimitPaneHandle>()
    render(
      <RateLimitPane
        ref={ref}
        tier="silver"
        label="Silver"
        limit={5000}
        projectId="p"
        region="r"
        model="m"
      />,
    )

    await act(async () => {
      await ref.current!.send('Q1')
    })
    await act(async () => {
      await ref.current!.send('Q2')
    })

    expect(spy).toHaveBeenCalledTimes(2)
    const secondCall = spy.mock.calls[1][0]
    expect(secondCall.contents).toEqual([
      { role: 'user', parts: [{ text: 'Q1' }] },
      { role: 'model', parts: [{ text: 'A1' }] },
      { role: 'user', parts: [{ text: 'Q2' }] },
    ])
  })

  it('disables Clear conversation while a request is in flight', async () => {
    let resolve: (v: unknown) => void = () => {}
    mockApi().mockReturnValueOnce(new Promise((r) => { resolve = r }) as never)

    const ref = createRef<RateLimitPaneHandle>()
    render(
      <RateLimitPane
        ref={ref}
        tier="bronze"
        label="Bronze"
        limit={2000}
        projectId="p"
        region="r"
        model="m"
      />,
    )

    act(() => {
      void ref.current!.send('hi')
    })
    const btn = await screen.findByRole('button', { name: /clear conversation/i })
    expect(btn).toBeDisabled()

    await act(async () => {
      resolve({
        text: 'ok', totalTokens: 2, raw: {},
      })
    })
  })
})
