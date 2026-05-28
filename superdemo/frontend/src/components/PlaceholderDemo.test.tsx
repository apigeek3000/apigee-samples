import { describe, it, expect } from 'vitest'
import { render, screen } from '@testing-library/react'
import { PlaceholderDemo } from './PlaceholderDemo'
import type { DemoMetadata } from '../types'

const demo: DemoMetadata = {
  id: 'llm-routing',
  title: 'LLM Model Routing',
  description: 'Routes prompts between cheap and premium models based on policy.',
  icon: '🔀',
  status: 'placeholder',
  placeholder: true,
}

describe('PlaceholderDemo', () => {
  it('renders the demo title as a level-2 heading', () => {
    render(<PlaceholderDemo demo={demo} />)
    expect(
      screen.getByRole('heading', { level: 2, name: /LLM Model Routing/i }),
    ).toBeInTheDocument()
  })

  it('renders a "Not yet implemented" badge', () => {
    render(<PlaceholderDemo demo={demo} />)
    expect(screen.getByText(/not yet implemented/i)).toBeInTheDocument()
  })

  it('renders the demo description text', () => {
    render(<PlaceholderDemo demo={demo} />)
    expect(
      screen.getByText(/cheap and premium models/i),
    ).toBeInTheDocument()
  })
})
