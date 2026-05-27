import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LlmSecurityDemo } from './LlmSecurityDemo'
import type { DemoMetadata, DemosResponse } from '../types'

vi.mock('../api', () => ({
  sendLlmSecurity: vi.fn(),
}))

import { sendLlmSecurity } from '../api'

const llmDemo: DemoMetadata = {
  id: 'llm-security',
  title: 'LLM Security v2',
  description: 'd',
  icon: '🛡️',
  status: 'passing',
  model_name: 'gemini-fake',
  model_armor_region: 'us-central1',
}

const demos: DemosResponse = {
  status: 'ready',
  host: 'apigee.test',
  project_id: 'fake-project',
  demos: [llmDemo],
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('LlmSecurityDemo', () => {
  it('calls sendLlmSecurity with the typed prompt and config from props', async () => {
    vi.mocked(sendLlmSecurity).mockResolvedValueOnce({ candidates: [] })
    const user = userEvent.setup()

    render(<LlmSecurityDemo demos={demos} demo={llmDemo} />)

    await user.type(screen.getByLabelText(/prompt/i), 'hello world')
    await user.click(screen.getByRole('button', { name: /Send Prompt/i }))

    expect(sendLlmSecurity).toHaveBeenCalledWith({
      projectId: 'fake-project',
      region: 'us-central1',
      model: 'gemini-fake',
      prompt: 'hello world',
    })
  })

  it('renders the response payload in the response card on success', async () => {
    vi.mocked(sendLlmSecurity).mockResolvedValueOnce({
      candidates: [{ content: { parts: [{ text: 'hi from gemini' }] } }],
    })
    const user = userEvent.setup()

    render(<LlmSecurityDemo demos={demos} demo={llmDemo} />)
    await user.type(screen.getByLabelText(/prompt/i), 'hello')
    await user.click(screen.getByRole('button', { name: /Send Prompt/i }))

    expect(await screen.findByText(/hi from gemini/i)).toBeInTheDocument()
  })

  it('renders the blocked-request error in the response card', async () => {
    vi.mocked(sendLlmSecurity).mockRejectedValueOnce({
      status: 422,
      message: 'Request blocked or failed (422)',
      body: { blocked: true },
    })
    const user = userEvent.setup()

    render(<LlmSecurityDemo demos={demos} demo={llmDemo} />)
    await user.type(screen.getByLabelText(/prompt/i), 'jailbreak')
    await user.click(screen.getByRole('button', { name: /Send Prompt/i }))

    expect(
      await screen.findByText(/request blocked or failed \(422\)/i),
    ).toBeInTheDocument()
    expect(screen.getByText(/error 422/i)).toBeInTheDocument()
  })
})
