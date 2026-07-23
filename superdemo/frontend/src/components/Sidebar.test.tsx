import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'
import { CATEGORIES } from '../categories'

const EXPANDED_KEY = 'superdemo:expanded-categories'

/** Seed localStorage so every category starts expanded (sections are collapsed
 *  by default; most tests want the demo items visible). */
function expandAllCategories() {
  window.localStorage.setItem(
    EXPANDED_KEY,
    JSON.stringify(CATEGORIES.map((c) => c.id)),
  )
}

const demos = [
  {
    id: 'basic-quota',
    title: 'Basic Quota',
    description: 'd1',
    icon: '⏱️',
    status: 'passing' as const,
    category: 'operations-portals' as const,
  },
  {
    id: 'llm-security',
    title: 'LLM Security v2',
    description: 'd2',
    icon: '🛡️',
    status: 'failing' as const,
    category: 'ai-llm' as const,
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
  beforeEach(() => {
    window.localStorage.clear()
    expandAllCategories()
  })

  it('renders each demo title', () => {
    renderSidebar()
    expect(screen.getByText('Basic Quota')).toBeInTheDocument()
    expect(screen.getByText('LLM Security v2')).toBeInTheDocument()
  })

  it('renders a category header for each non-empty category', () => {
    renderSidebar()
    expect(screen.getByText('AI & LLM')).toBeInTheDocument()
    expect(screen.getByText('Operations & Traffic')).toBeInTheDocument()
    // Categories with no demos are not shown
    expect(screen.queryByText('Backends & Integration')).not.toBeInTheDocument()
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
          category: 'ai-llm',
        },
      ],
      showStatus: true,
    })
    expect(screen.getByText('LLM Rate Limiting')).toBeInTheDocument()
  })

  it('renders a purple status dot with the "not yet implemented" label for placeholder demos', () => {
    renderSidebar({
      demos: [
        {
          id: 'llm-routing',
          title: 'LLM Model Routing',
          description: 'd',
          icon: '🔀',
          status: 'placeholder',
          placeholder: true,
          category: 'ai-llm',
        },
      ],
      showStatus: true,
    })
    expect(
      screen.getByLabelText('Status: not yet implemented'),
    ).toBeInTheDocument()
  })

  it('collapses every category section by default (demos hidden)', () => {
    window.localStorage.clear()
    renderSidebar()
    // Headers are always visible...
    expect(screen.getByText('AI & LLM')).toBeInTheDocument()
    expect(screen.getByText('Operations & Traffic')).toBeInTheDocument()
    // ...but the demo items under them are hidden until expanded.
    expect(screen.queryByText('Basic Quota')).not.toBeInTheDocument()
    expect(screen.queryByText('LLM Security v2')).not.toBeInTheDocument()
  })

  it('marks a collapsed section header with aria-expanded=false', () => {
    window.localStorage.clear()
    renderSidebar()
    const header = screen.getByRole('button', { name: /AI & LLM/i })
    expect(header).toHaveAttribute('aria-expanded', 'false')
  })

  it('reveals a section’s demos when its header is clicked', async () => {
    window.localStorage.clear()
    renderSidebar()
    expect(screen.queryByText('LLM Security v2')).not.toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /AI & LLM/i }))
    expect(screen.getByText('LLM Security v2')).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: /AI & LLM/i }),
    ).toHaveAttribute('aria-expanded', 'true')
  })

  it('hides a section’s demos again when its header is clicked twice', async () => {
    renderSidebar() // starts expanded via beforeEach seed
    expect(screen.getByText('LLM Security v2')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: /AI & LLM/i }))
    expect(screen.queryByText('LLM Security v2')).not.toBeInTheDocument()
  })

  it('keeps placeholder rows clickable', async () => {
    const onSelect = vi.fn()
    renderSidebar({
      demos: [
        {
          id: 'llm-routing',
          title: 'LLM Model Routing',
          description: 'd',
          icon: '🔀',
          status: 'placeholder',
          placeholder: true,
          category: 'ai-llm',
        },
      ],
      onSelect,
    })
    await userEvent.click(
      screen.getByRole('button', { name: /LLM Model Routing/i }),
    )
    expect(onSelect).toHaveBeenCalledWith('llm-routing')
  })
})
