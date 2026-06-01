import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MoreInfo } from './MoreInfo'

vi.mock('mermaid', () => ({
  default: {
    initialize: vi.fn(),
    render: vi.fn(async (_id: string) => ({ svg: '<svg data-testid="rendered-svg"></svg>' })),
  },
}))

const baseProps = {
  diagram: 'flowchart LR\n  A --> B',
  description: 'A short description of the demo.',
  policyLinks: [
    { label: 'VerifyAPIKey', href: 'https://example.com/vak' },
    { label: 'Quota', href: 'https://example.com/quota' },
  ],
  githubHref: 'https://github.com/example/repo/tree/main/demo',
}

describe('MoreInfo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('renders a closed summary by default', () => {
    render(<MoreInfo {...baseProps} />)
    const summary = screen.getByText(/more info/i)
    expect(summary).toBeInTheDocument()
    expect(screen.queryByText(baseProps.description)).not.toBeInTheDocument()
  })

  it('shows description and links after the panel is opened', async () => {
    render(<MoreInfo {...baseProps} />)
    await userEvent.click(screen.getByText(/more info/i))
    expect(screen.getByText(baseProps.description)).toBeVisible()
    const vakLink = screen.getByRole('link', { name: 'VerifyAPIKey' })
    expect(vakLink).toHaveAttribute('href', 'https://example.com/vak')
    const githubLink = screen.getByRole('link', { name: /view this demo on github/i })
    expect(githubLink).toHaveAttribute('href', baseProps.githubHref)
  })

  it('renders all policy links with target="_blank" and rel noopener', async () => {
    render(<MoreInfo {...baseProps} />)
    await userEvent.click(screen.getByText(/more info/i))
    for (const link of baseProps.policyLinks) {
      const el = screen.getByRole('link', { name: link.label })
      expect(el).toHaveAttribute('target', '_blank')
      expect(el).toHaveAttribute('rel', expect.stringContaining('noopener'))
    }
  })

  it('renders the mermaid SVG after the panel is opened', async () => {
    render(<MoreInfo {...baseProps} />)
    await userEvent.click(screen.getByText(/more info/i))
    const svg = await screen.findByTestId('rendered-svg')
    expect(svg).toBeInTheDocument()
  })

  it('only renders mermaid once across multiple opens', async () => {
    const mermaid = (await import('mermaid')).default
    render(<MoreInfo {...baseProps} />)
    const summary = screen.getByText(/more info/i)
    await userEvent.click(summary) // open
    await screen.findByTestId('rendered-svg')
    await userEvent.click(summary) // close
    await userEvent.click(summary) // open again
    expect(mermaid.render).toHaveBeenCalledTimes(1)
  })

  it('falls back to a <pre> with raw diagram source when render fails', async () => {
    const mermaid = (await import('mermaid')).default
    ;(mermaid.render as unknown as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error('boom'),
    )
    render(<MoreInfo {...baseProps} />)
    await userEvent.click(screen.getByText(/more info/i))
    expect(await screen.findByText(/flowchart LR/)).toBeInTheDocument()
    expect(screen.queryByTestId('rendered-svg')).not.toBeInTheDocument()
  })
})
