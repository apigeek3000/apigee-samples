import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmCircuitBreakingDemo } from './LlmCircuitBreakingDemo'
import { sendCircuitBreaking } from '../api'
import type { CircuitBreakingResponse, DemoMetadata, DemosResponse } from '../types'

vi.mock('../api', () => ({
  sendCircuitBreaking: vi.fn(),
}))

const demo: DemoMetadata = {
  id: 'llm-circuit-breaking',
  title: 'LLM Circuit Breaking',
  description: 'Fails over to a secondary region.',
  icon: '🚧',
  status: 'passing',
  primary_region: 'us-central1',
  secondary_region: 'us-east4',
  failover_threshold: 2,
  window_minutes: 2,
}

const demos: DemosResponse = {
  status: 'ready',
  project_id: 'test-project',
  demos: [demo],
}

describe('LlmCircuitBreakingDemo', () => {
  beforeEach(() => {
    vi.mocked(sendCircuitBreaking).mockReset()
  })

  it('renders a card showing which target pool served the request', async () => {
    const user = userEvent.setup()
    vi.mocked(sendCircuitBreaking).mockResolvedValue({
      httpStatus: 200,
      targetPool: 'primary',
      targetRegion: 'us-central1',
      text: 'blue sky',
      latencyMs: 120,
      body: {},
    })

    render(<LlmCircuitBreakingDemo demos={demos} demo={demo} />)
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    expect(sendCircuitBreaking).toHaveBeenCalledTimes(1)
    expect(await screen.findByTestId('target-pool-badge')).toHaveTextContent(
      'primary',
    )
    expect(screen.getByText(/us-central1 · HTTP 200/)).toBeInTheDocument()
  })

  it('fires the whole break concurrently instead of one request at a time', async () => {
    // A sequential `for` loop with `await` would only have one request in
    // flight until the first resolves. We hold every response open, so the
    // invocation count observed while nothing has resolved is the whole test:
    // 3 means concurrent, 1 means sequential.
    const user = userEvent.setup()

    const resolvers: Array<(value: CircuitBreakingResponse) => void> = []
    vi.mocked(sendCircuitBreaking).mockImplementation(
      () =>
        new Promise<CircuitBreakingResponse>((resolve) => {
          resolvers.push(resolve)
        }),
    )

    render(<LlmCircuitBreakingDemo demos={demos} demo={demo} />)
    await user.click(screen.getByRole('button', { name: /break the circuit/i }))

    await waitFor(() => expect(sendCircuitBreaking).toHaveBeenCalledTimes(3))
    expect(resolvers).toHaveLength(3)
    expect(screen.queryAllByTestId('target-pool-badge')).toHaveLength(0)

    // Resolve out of order: results must still be numbered by dispatch order.
    const regions = ['us-east4', 'us-central1', 'us-east4'] as const
    for (const i of [2, 0, 1]) {
      resolvers[i]({
        httpStatus: 404,
        targetPool: 'secondary',
        targetRegion: regions[i],
        text: `response ${i}`,
        latencyMs: 40,
        body: {},
      })
    }

    const badges = await screen.findAllByTestId('target-pool-badge')
    expect(badges).toHaveLength(3)
    expect(
      screen.getAllByText(/us-east4 · HTTP 404|us-central1 · HTTP 404/),
    ).toHaveLength(3)
  })

  it('breaks the circuit by requesting a model Vertex AI does not publish', async () => {
    const user = userEvent.setup()
    vi.mocked(sendCircuitBreaking).mockResolvedValue({
      httpStatus: 404,
      targetPool: 'secondary',
      targetRegion: 'us-east4',
      text: 'model not found',
      latencyMs: 40,
      body: {},
    })

    render(<LlmCircuitBreakingDemo demos={demos} demo={demo} />)
    await user.click(screen.getByRole('button', { name: /break the circuit/i }))

    // 3, not 2: the quota ALLOWS failover_threshold (2) failures in the window,
    // so it is the 3rd that trips it. Every call must carry the bogus model —
    // a real model name would return 200 and never feed the FaultRule.
    expect(sendCircuitBreaking).toHaveBeenCalledTimes(3)
    for (const call of vi.mocked(sendCircuitBreaking).mock.calls) {
      expect(call[0].model).toBe('gemini-does-not-exist')
    }
    expect(await screen.findAllByTestId('target-pool-badge')).toHaveLength(3)
  })

  it('does not call the breaker open just because a failed request hit secondary', async () => {
    // The FaultRule retries EVERY failure into secondary, so a 4xx tagged
    // 'secondary' says nothing about the breaker. Only a successful request
    // reaching secondary proves the RouteRule is skipping primary.
    const user = userEvent.setup()
    vi.mocked(sendCircuitBreaking).mockResolvedValue({
      httpStatus: 404,
      targetPool: 'secondary',
      targetRegion: 'us-east4',
      text: 'model not found',
      latencyMs: 40,
      body: {},
    })

    render(<LlmCircuitBreakingDemo demos={demos} demo={demo} />)
    expect(screen.getByTestId('breaker-state')).toHaveTextContent('unknown')

    await user.click(screen.getByRole('button', { name: /break the circuit/i }))
    await screen.findAllByTestId('target-pool-badge')

    expect(screen.getByTestId('breaker-state')).toHaveTextContent('unknown')
    expect(
      screen.getAllByText(/retried into secondary by the FaultRule/i),
    ).toHaveLength(3)
  })

  it('reports the breaker open once a successful request is served by secondary', async () => {
    const user = userEvent.setup()
    vi.mocked(sendCircuitBreaking).mockResolvedValue({
      httpStatus: 200,
      targetPool: 'primary',
      targetRegion: 'us-central1',
      text: 'blue sky',
      latencyMs: 120,
      body: {},
    })

    render(<LlmCircuitBreakingDemo demos={demos} demo={demo} />)
    await user.click(screen.getByRole('button', { name: /^send$/i }))
    await waitFor(() =>
      expect(screen.getByTestId('breaker-state')).toHaveTextContent('closed'),
    )

    vi.mocked(sendCircuitBreaking).mockResolvedValue({
      httpStatus: 200,
      targetPool: 'secondary',
      targetRegion: 'us-east4',
      text: 'blue sky',
      latencyMs: 130,
      body: {},
    })
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    await waitFor(() =>
      expect(screen.getByTestId('breaker-state')).toHaveTextContent('open'),
    )
    expect(
      screen.getByText(/routed to secondary — breaker is open/i),
    ).toBeInTheDocument()
  })

  it('does not blame the deploy when a FAILED request lacks the target-pool header', async () => {
    // Regression: the warning fired on any missing header, so a correctly
    // patched proxy accused itself of being unpatched every time an error
    // response came back without one.
    const user = userEvent.setup()
    vi.mocked(sendCircuitBreaking).mockResolvedValue({
      httpStatus: 404,
      targetPool: 'unknown',
      targetRegion: undefined,
      text: 'model not found',
      latencyMs: 40,
      body: {},
    })

    render(<LlmCircuitBreakingDemo demos={demos} demo={demo} />)
    await user.click(screen.getByRole('button', { name: /break the circuit/i }))
    await screen.findAllByTestId('target-pool-badge')

    expect(screen.queryByText(/unpatched revision/i)).not.toBeInTheDocument()
  })

  it('does blame the deploy when a SUCCESSFUL request lacks the target-pool header', async () => {
    const user = userEvent.setup()
    vi.mocked(sendCircuitBreaking).mockResolvedValue({
      httpStatus: 200,
      targetPool: 'unknown',
      targetRegion: undefined,
      text: 'blue sky',
      latencyMs: 120,
      body: {},
    })

    render(<LlmCircuitBreakingDemo demos={demos} demo={demo} />)
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    expect(await screen.findByText(/unpatched revision/i)).toBeInTheDocument()
  })

})
