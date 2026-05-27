import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'

const demos = [
  {
    id: 'basic-quota',
    title: 'Basic Quota',
    description: 'd1',
    icon: '⏱️',
    status: 'passing' as const,
  },
  {
    id: 'llm-security',
    title: 'LLM Security v2',
    description: 'd2',
    icon: '🛡️',
    status: 'failing' as const,
  },
]

function renderSidebar(overrides: Partial<Parameters<typeof Sidebar>[0]> = {}) {
  const props = {
    demos,
    activeDemoId: null,
    onSelect: () => {},
    showStatus: false,
    onShowStatusChange: () => {},
    ...overrides,
  }
  return render(<Sidebar {...props} />)
}

describe('Sidebar', () => {
  it('renders each demo title', () => {
    renderSidebar()
    expect(screen.getByText('Basic Quota')).toBeInTheDocument()
    expect(screen.getByText('LLM Security v2')).toBeInTheDocument()
  })

  it('marks the active demo as selected via aria-current', () => {
    renderSidebar({ activeDemoId: 'basic-quota' })
    const active = screen.getByRole('button', { name: /Basic Quota/i })
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('invokes onSelect with the demo id when clicked', async () => {
    const onSelect = vi.fn()
    renderSidebar({ onSelect })
    await userEvent.click(
      screen.getByRole('button', { name: /LLM Security v2/i }),
    )
    expect(onSelect).toHaveBeenCalledWith('llm-security')
  })

  it('shows an empty-state hint when no demos are deployed', () => {
    renderSidebar({ demos: [] })
    expect(screen.getByText(/no demos deployed/i)).toBeInTheDocument()
  })

  it('renders a status dot for each demo when showStatus is true', () => {
    renderSidebar({ showStatus: true })
    expect(screen.getByLabelText('Status: passing')).toBeInTheDocument()
    expect(screen.getByLabelText('Status: failing')).toBeInTheDocument()
  })

  it('does not render status dots when showStatus is false', () => {
    renderSidebar({ showStatus: false })
    expect(screen.queryByLabelText('Status: passing')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Status: failing')).not.toBeInTheDocument()
  })

  it('renders the show-status toggle in the footer', () => {
    renderSidebar()
    const toggle = screen.getByRole('switch', { name: /show demo status/i })
    expect(toggle).toBeInTheDocument()
    expect(toggle).not.toBeChecked()
  })

  it('reflects the showStatus prop on the toggle', () => {
    renderSidebar({ showStatus: true })
    expect(
      screen.getByRole('switch', { name: /show demo status/i }),
    ).toBeChecked()
  })

  it('invokes onShowStatusChange when the toggle is clicked', async () => {
    const onShowStatusChange = vi.fn()
    renderSidebar({ onShowStatusChange })
    await userEvent.click(
      screen.getByRole('switch', { name: /show demo status/i }),
    )
    expect(onShowStatusChange).toHaveBeenCalledWith(true)
  })

  it('renders an item for llm-token-limits-v2 when provided', () => {
    renderSidebar({
      demos: [
        {
          id: 'llm-token-limits-v2',
          title: 'LLM Rate Limiting',
          description: 'd',
          icon: '⚡',
          status: 'passing',
        },
      ],
      showStatus: true,
    })
    expect(screen.getByText('LLM Rate Limiting')).toBeInTheDocument()
  })
})
