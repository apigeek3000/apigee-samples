import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { LlmSemanticCacheDemo } from './LlmSemanticCacheDemo'
import { sendSemanticCache } from '../api'
import type { DemoMetadata, DemosResponse } from '../types'

vi.mock('../api', () => ({
  sendSemanticCache: vi.fn(),
}))

const demo: DemoMetadata = {
  id: 'llm-semantic-cache-v2',
  title: 'LLM Semantic Cache',
  description: 'Caches semantically-similar prompts.',
  icon: '🧠',
  status: 'passing',
  model: 'gemini-fake',
  region: 'us-central1',
  embeddings_model: 'text-embedding-005',
  similarity_threshold: 0.95,
  ttl_seconds: 300,
}

const demos: DemosResponse = {
  status: 'ready',
  project_id: 'test-project',
  demos: [demo],
}

describe('LlmSemanticCacheDemo', () => {
  beforeEach(() => vi.mocked(sendSemanticCache).mockReset())

  it('records each request latency in the history log', async () => {
    const user = userEvent.setup()
    vi.mocked(sendSemanticCache).mockResolvedValue({
      httpStatus: 200,
      text: 'April 15',
      latencyMs: 1500,
      totalTokens: 20,
      body: {},
    })

    render(<LlmSemanticCacheDemo demos={demos} demo={demo} />)
    await user.click(screen.getByRole('button', { name: /^send$/i }))

    expect(sendSemanticCache).toHaveBeenCalledTimes(1)
    const item = await screen.findByTestId('history-item')
    expect(item).toHaveTextContent('1500ms')
    expect(item).toHaveTextContent('April 15')
  })

  it('tallies time saved on a faster cached follow-up', async () => {
    const user = userEvent.setup()
    vi.mocked(sendSemanticCache)
      .mockResolvedValueOnce({ httpStatus: 200, text: 'April 15', latencyMs: 1500, body: {} })
      .mockResolvedValueOnce({ httpStatus: 200, text: 'April 15', latencyMs: 200, body: {} })

    render(<LlmSemanticCacheDemo demos={demos} demo={demo} />)
    const sendBtn = screen.getByRole('button', { name: /^send$/i })
    await user.click(sendBtn)
    await screen.findByTestId('history-item')
    await user.click(sendBtn)
    await waitFor(() =>
      expect(screen.getAllByTestId('history-item')).toHaveLength(2),
    )

    // baseline 1500 - 200 = 1300ms saved
    expect(screen.getByTestId('time-saved')).toHaveTextContent('1300ms')
  })

  it('fills the prompt box when a preset chip is clicked', async () => {
    const user = userEvent.setup()
    render(<LlmSemanticCacheDemo demos={demos} demo={demo} />)
    await user.click(
      screen.getByRole('button', { name: /when is the deadline to file my taxes\?/i }),
    )
    expect(screen.getByLabelText('Prompt')).toHaveValue(
      'When is the deadline to file my taxes?',
    )
  })
})
