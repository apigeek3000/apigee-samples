import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { ThreatProtectionDemo } from './ThreatProtectionDemo'
import type { DemoMetadata } from '../types'

vi.mock('../api', () => ({
  sendThreatRegex: vi.fn(),
  sendThreatJson: vi.fn(),
}))

import { sendThreatRegex, sendThreatJson } from '../api'

const demo: DemoMetadata = {
  id: 'threat-protection',
  title: 'Threat Protection',
  description: 'demo desc',
  icon: '🧱',
  status: 'passing',
  max_json_object_keys: 5,
  blocked_keywords: ['delete', 'exec', 'drop table'],
}

beforeEach(() => {
  vi.resetAllMocks()
})

describe('ThreatProtectionDemo — RegEx panel', () => {
  it('sends a benign query and shows ALLOWED badge', async () => {
    vi.mocked(sendThreatRegex).mockResolvedValueOnce({
      httpStatus: 200,
      body: { args: { query: 'select' } },
      blocked: false,
      policy: 'regex',
    })
    const user = userEvent.setup()

    render(<ThreatProtectionDemo demo={demo} />)

    await user.click(screen.getByRole('button', { name: /^select$/i }))

    expect(sendThreatRegex).toHaveBeenCalledWith('select')
    expect(await screen.findByText(/^ALLOWED$/)).toBeInTheDocument()
  })

  it('sends a malicious query and shows BLOCKED badge', async () => {
    vi.mocked(sendThreatRegex).mockResolvedValueOnce({
      httpStatus: 500,
      body: { fault: { faultstring: 'Regex blocked' } },
      blocked: true,
      policy: 'regex',
    })
    const user = userEvent.setup()

    render(<ThreatProtectionDemo demo={demo} />)

    await user.click(screen.getByRole('button', { name: /^delete$/i }))

    expect(await screen.findByText(/^BLOCKED$/)).toBeInTheDocument()
  })

  it('renders blocked_keywords as chips above the RegEx panel', () => {
    render(<ThreatProtectionDemo demo={demo} />)
    expect(screen.getByText('delete', { selector: 'code' })).toBeInTheDocument()
    expect(screen.getByText('exec', { selector: 'code' })).toBeInTheDocument()
    expect(screen.getByText('drop table', { selector: 'code' })).toBeInTheDocument()
  })

  it('sends the custom input value when the custom Send button is clicked', async () => {
    vi.mocked(sendThreatRegex).mockResolvedValueOnce({
      httpStatus: 200,
      body: null,
      blocked: false,
      policy: 'regex',
    })
    const user = userEvent.setup()

    render(<ThreatProtectionDemo demo={demo} />)

    const input = screen.getByLabelText(/regex custom query/i)
    await user.clear(input)
    await user.type(input, 'banana')
    await user.click(screen.getByRole('button', { name: /send regex query/i }))

    expect(sendThreatRegex).toHaveBeenCalledWith('banana')
  })
})

describe('ThreatProtectionDemo — JSON Threat panel', () => {
  it('renders the JSONThreatProtection limit subtitle from metadata', () => {
    render(<ThreatProtectionDemo demo={demo} />)
    expect(screen.getByText(/JSONThreatProtection limit: 5 entries/i)).toBeInTheDocument()
  })

  it('sends the 5-key preset and shows ALLOWED badge', async () => {
    vi.mocked(sendThreatJson).mockResolvedValueOnce({
      httpStatus: 200,
      body: { ok: true },
      blocked: false,
      policy: 'json',
    })
    const user = userEvent.setup()

    render(<ThreatProtectionDemo demo={demo} />)

    await user.click(screen.getByRole('button', { name: /5-key body/i }))

    expect(sendThreatJson).toHaveBeenCalledWith({
      f1: 't1',
      f2: 't2',
      f3: 't3',
      f4: 't4',
      f5: 't5',
    })
    expect(await screen.findByText(/^ALLOWED$/)).toBeInTheDocument()
  })

  it('sends the 6-key preset and shows BLOCKED badge', async () => {
    vi.mocked(sendThreatJson).mockResolvedValueOnce({
      httpStatus: 500,
      body: { fault: 'JSON' },
      blocked: true,
      policy: 'json',
    })
    const user = userEvent.setup()

    render(<ThreatProtectionDemo demo={demo} />)

    await user.click(screen.getByRole('button', { name: /6-key body/i }))

    expect(sendThreatJson).toHaveBeenCalledWith({
      f1: 't1',
      f2: 't2',
      f3: 't3',
      f4: 't4',
      f5: 't5',
      f6: 't6',
    })
    expect(await screen.findByText(/^BLOCKED$/)).toBeInTheDocument()
  })

  it('does not call sendThreatJson when the custom JSON is invalid', async () => {
    const user = userEvent.setup()
    render(<ThreatProtectionDemo demo={demo} />)

    const textarea = screen.getByLabelText(/json custom payload/i)
    await user.clear(textarea)
    await user.type(textarea, '{{invalid')
    await user.click(screen.getByRole('button', { name: /send json payload/i }))

    expect(sendThreatJson).not.toHaveBeenCalled()
    expect(screen.getByText(/invalid JSON/i)).toBeInTheDocument()
  })
})
