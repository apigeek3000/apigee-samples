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
  },
  {
    id: 'placeholder-demo',
    title: 'Planned Feature',
    description: 'This is a description that is intentionally extremely long to verify that the character truncation function works as intended on the homepage card layout. It should cut off right around the two hundred character mark to ensure the layout remains completely neat and tidy across different viewport widths.',
    icon: '🚀',
    status: 'placeholder',
    placeholder: true,
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

  it('hides status badges when showStatus is false', () => {
    renderHomepage({ showStatus: false })
    expect(screen.queryByText('Ready / Passing')).not.toBeInTheDocument()
  })

  it('renders status badges and placeholder tags when showStatus is true', () => {
    renderHomepage({ showStatus: true })
    expect(screen.getByText('Ready / Passing')).toBeInTheDocument()
    expect(screen.getByText('Planned')).toBeInTheDocument()
  })
})
