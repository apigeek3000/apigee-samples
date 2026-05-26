import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Sidebar } from './Sidebar'

const demos = [
  { id: 'basic-quota', title: 'Basic Quota', description: 'd1', icon: '⏱️' },
  { id: 'llm-security', title: 'LLM Security v2', description: 'd2', icon: '🛡️' },
]

describe('Sidebar', () => {
  it('renders each demo title', () => {
    render(
      <Sidebar demos={demos} activeDemoId={null} onSelect={() => {}} />,
    )
    expect(screen.getByText('Basic Quota')).toBeInTheDocument()
    expect(screen.getByText('LLM Security v2')).toBeInTheDocument()
  })

  it('marks the active demo as selected via aria-current', () => {
    render(
      <Sidebar
        demos={demos}
        activeDemoId="basic-quota"
        onSelect={() => {}}
      />,
    )
    const active = screen.getByRole('button', { name: /Basic Quota/i })
    expect(active).toHaveAttribute('aria-current', 'page')
  })

  it('invokes onSelect with the demo id when clicked', async () => {
    const onSelect = vi.fn()
    render(
      <Sidebar demos={demos} activeDemoId={null} onSelect={onSelect} />,
    )
    await userEvent.click(
      screen.getByRole('button', { name: /LLM Security v2/i }),
    )
    expect(onSelect).toHaveBeenCalledWith('llm-security')
  })

  it('shows an empty-state hint when no demos are deployed', () => {
    render(<Sidebar demos={[]} activeDemoId={null} onSelect={() => {}} />)
    expect(screen.getByText(/no demos deployed/i)).toBeInTheDocument()
  })
})
