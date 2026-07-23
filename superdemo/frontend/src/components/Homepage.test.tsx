import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Homepage } from './Homepage'
import type { DemoMetadata } from '../types'

const mockDemos: DemoMetadata[] = [
  {
    id: 'basic-quota',
    title: 'Basic Quota',
    description: 'Enforces different quotas based on product tiers.',
    icon: '⏱️',
    status: 'passing',
    category: 'operations-portals',
  },
  {
    id: 'placeholder-demo',
    title: 'Planned Feature',
    description: 'This is a description that is intentionally extremely long to verify that the character truncation function works as intended on the homepage card layout. It should cut off right around the two hundred character mark to ensure the layout remains completely neat and tidy across different viewport widths.',
    icon: '🚀',
    status: 'placeholder',
    placeholder: true,
    category: 'ai-llm',
  },
]

function renderHomepage(overrides: Partial<Parameters<typeof Homepage>[0]> = {}) {
  const props = {
    demos: mockDemos,
    onSelect: () => {},
    showStatus: false,
    ...overrides,
  }
  return render(<Homepage {...props} />)
}

describe('Homepage', () => {
  it('renders welcome hero title and subtitle', () => {
    renderHomepage()
    expect(screen.getByRole('heading', { level: 1, name: /Apigee Super Demos/i })).toBeInTheDocument()
    expect(screen.getByText(/Explore hands-on interactive demonstrations/i)).toBeInTheDocument()
  })

  it('renders a card tile for each demo in the list', () => {
    renderHomepage()
    expect(screen.getByRole('heading', { level: 3, name: 'Basic Quota' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { level: 3, name: 'Planned Feature' })).toBeInTheDocument()
  })

  it('renders a section heading for each non-empty category', () => {
    renderHomepage()
    expect(screen.getByRole('heading', { name: /AI & LLM/ })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: /Operations & Traffic/ }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('heading', { name: /Backends & Integration/ }),
    ).not.toBeInTheDocument()
  })

  it('truncates descriptions exceeding 200 characters gracefully', () => {
    renderHomepage()
    
    // The truncated text should be under 205 characters and end with '...'
    const truncatedDesc = screen.getByText(/This is a description that is intentionally extremely long.*two hundre\.\.\./i)
    expect(truncatedDesc).toBeInTheDocument()
    expect(truncatedDesc.textContent).toContain('...')
    expect(truncatedDesc.textContent!.length).toBeLessThanOrEqual(203)
  })

  it('invokes onSelect when clicking a card tile', async () => {
    const onSelect = vi.fn()
    const user = userEvent.setup()
    renderHomepage({ onSelect })

    const card = screen.getByRole('button', { name: /Open demo: Basic Quota/i })
    await user.click(card)

    expect(onSelect).toHaveBeenCalledWith('basic-quota')
  })

  it('hides status badges and placeholder tags when showStatus is false', () => {
    renderHomepage({ showStatus: false })
    expect(screen.queryByText('Ready / Passing')).not.toBeInTheDocument()
    expect(screen.queryByText('Planned')).not.toBeInTheDocument()
  })

  it('renders status badges and placeholder tags when showStatus is true', () => {
    renderHomepage({ showStatus: true })
    expect(screen.getByText('Ready / Passing')).toBeInTheDocument()
    expect(screen.getByText('Planned')).toBeInTheDocument()
  })

  it('renders a search input on the homepage', () => {
    renderHomepage()
    expect(screen.getByRole('searchbox', { name: /search demos/i })).toBeInTheDocument()
  })

  describe('per-section 8-demo cap', () => {
    // 10 demos in a single category so the section overflows SECTION_LIMIT (8).
    const manyDemos: DemoMetadata[] = Array.from({ length: 10 }, (_, i) => ({
      id: `quota-${i}`,
      title: `Quota Demo ${i}`,
      description: `Demo number ${i}`,
      icon: '⏱️',
      status: 'passing',
      category: 'operations-portals',
    }))

    it('caps a section at 8 cards and offers a show-more control', () => {
      renderHomepage({ demos: manyDemos })
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(8)
      expect(screen.queryByText('Quota Demo 9')).not.toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /show more demos \(2\)/i }),
      ).toBeInTheDocument()
    })

    it('reveals the remaining demos when show more is clicked', async () => {
      const user = userEvent.setup()
      renderHomepage({ demos: manyDemos })
      await user.click(
        screen.getByRole('button', { name: /show more demos \(2\)/i }),
      )
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(10)
      expect(screen.getByText('Quota Demo 9')).toBeInTheDocument()
      expect(
        screen.getByRole('button', { name: /show less/i }),
      ).toBeInTheDocument()
    })

    it('collapses back to 8 when show less is clicked', async () => {
      const user = userEvent.setup()
      renderHomepage({ demos: manyDemos })
      await user.click(
        screen.getByRole('button', { name: /show more demos/i }),
      )
      await user.click(screen.getByRole('button', { name: /show less/i }))
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(8)
    })

    it('shows no cap control for sections with 8 or fewer demos', () => {
      renderHomepage({ demos: manyDemos.slice(0, 8) })
      expect(
        screen.queryByRole('button', { name: /show more demos/i }),
      ).not.toBeInTheDocument()
    })
  })

  describe('search', () => {
    const searchDemos: DemoMetadata[] = [
      {
        id: 'basic-quota',
        title: 'Basic Quota',
        description: 'Enforces different quotas based on product tiers.',
        icon: '⏱️',
        status: 'passing',
        category: 'operations-portals',
      },
      {
        id: 'llm-security',
        title: 'LLM Security',
        description: 'Runs prompts through Model Armor.',
        icon: '🛡️',
        status: 'passing',
        category: 'ai-llm',
      },
    ]

    it('filters demos by title as the user types', async () => {
      const user = userEvent.setup()
      renderHomepage({ demos: searchDemos })
      await user.type(
        screen.getByRole('searchbox', { name: /search demos/i }),
        'security',
      )
      expect(screen.getByRole('heading', { level: 3, name: 'LLM Security' })).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { level: 3, name: 'Basic Quota' }),
      ).not.toBeInTheDocument()
    })

    it('matches against the description too, case-insensitively', async () => {
      const user = userEvent.setup()
      renderHomepage({ demos: searchDemos })
      await user.type(
        screen.getByRole('searchbox', { name: /search demos/i }),
        'ARMOR',
      )
      expect(screen.getByRole('heading', { level: 3, name: 'LLM Security' })).toBeInTheDocument()
      expect(
        screen.queryByRole('heading', { level: 3, name: 'Basic Quota' }),
      ).not.toBeInTheDocument()
    })

    it('lifts the 8-cap while searching so all matches show', async () => {
      const user = userEvent.setup()
      // 10 matching demos in one category.
      const many: DemoMetadata[] = Array.from({ length: 10 }, (_, i) => ({
        id: `armor-${i}`,
        title: `Armored Demo ${i}`,
        description: 'x',
        icon: '🛡️',
        status: 'passing',
        category: 'operations-portals',
      }))
      renderHomepage({ demos: many })
      await user.type(
        screen.getByRole('searchbox', { name: /search demos/i }),
        'Armored',
      )
      expect(screen.getAllByRole('heading', { level: 3 })).toHaveLength(10)
      expect(
        screen.queryByRole('button', { name: /show more demos/i }),
      ).not.toBeInTheDocument()
    })

    it('shows a no-results message when nothing matches', async () => {
      const user = userEvent.setup()
      renderHomepage({ demos: searchDemos })
      await user.type(
        screen.getByRole('searchbox', { name: /search demos/i }),
        'zzzznotademo',
      )
      expect(screen.getByText(/no demos match/i)).toBeInTheDocument()
    })
  })
})
