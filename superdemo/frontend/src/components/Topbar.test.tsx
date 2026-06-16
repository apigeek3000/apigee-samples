import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Topbar } from './Topbar'
import type { DemoMetadata } from '../types'

const activeDemo: DemoMetadata = {
  id: 'basic-quota',
  title: 'Basic Quota',
  description: 'Test quota demo.',
  icon: '⏱️',
  status: 'passing',
}

function renderTopbar(overrides: Partial<Parameters<typeof Topbar>[0]> = {}) {
  const props = {
    isSidebarCollapsed: false,
    onToggleSidebar: () => {},
    activeDemo: null,
    onNavigateHome: () => {},
    ...overrides,
  }
  return render(<Topbar {...props} />)
}

describe('Topbar', () => {
  it('renders the hamburger toggle button with expand/collapse labels', () => {
    const { rerender } = renderTopbar({ isSidebarCollapsed: false })
    expect(screen.getByRole('button', { name: /Collapse sidebar/i })).toBeInTheDocument()

    rerender(<Topbar isSidebarCollapsed={true} onToggleSidebar={() => {}} activeDemo={null} onNavigateHome={() => {}} />)
    expect(screen.getByRole('button', { name: /Expand sidebar/i })).toBeInTheDocument()
  })

  it('invokes onToggleSidebar when the hamburger is clicked', async () => {
    const onToggleSidebar = vi.fn()
    const user = userEvent.setup()
    renderTopbar({ onToggleSidebar })

    await user.click(screen.getByRole('button', { name: /Collapse sidebar/i }))
    expect(onToggleSidebar).toHaveBeenCalled()
  })

  it('renders only Home breadcrumb when activeDemo is null', () => {
    renderTopbar({ activeDemo: null })
    expect(screen.getByRole('button', { name: /^Home$/i })).toBeInTheDocument()
    expect(screen.queryByText('Basic Quota')).not.toBeInTheDocument()
  })

  it('renders Home and active demo breadcrumbs when activeDemo is selected', () => {
    renderTopbar({ activeDemo })
    expect(screen.getByRole('button', { name: /^Home$/i })).toBeInTheDocument()
    expect(screen.getByText('Basic Quota')).toBeInTheDocument()
    expect(screen.getByText('⏱️')).toBeInTheDocument()
  })

  it('hides topbar brand link when sidebar is expanded', () => {
    renderTopbar({ isSidebarCollapsed: false })
    expect(screen.queryByRole('button', { name: /Go to Home/i })).not.toBeInTheDocument()
  })

  it('shows topbar brand link when sidebar is collapsed', () => {
    renderTopbar({ isSidebarCollapsed: true })
    expect(screen.getByRole('button', { name: /Go to Home/i })).toBeInTheDocument()
  })

  it('invokes onNavigateHome when Home breadcrumb is clicked', async () => {
    const onNavigateHome = vi.fn()
    const user = userEvent.setup()
    renderTopbar({ onNavigateHome, activeDemo })

    await user.click(screen.getByRole('button', { name: /^Home$/i }))
    expect(onNavigateHome).toHaveBeenCalled()
  })

  it('invokes onNavigateHome when brand logo is clicked (while collapsed)', async () => {
    const onNavigateHome = vi.fn()
    const user = userEvent.setup()
    renderTopbar({ onNavigateHome, isSidebarCollapsed: true })

    await user.click(screen.getByRole('button', { name: /Go to Home/i }))
    expect(onNavigateHome).toHaveBeenCalled()
  })

  it('shows the user email and a sign-out button', async () => {
    const onSignOut = vi.fn()
    const user = userEvent.setup()
    render(
      <Topbar
        isSidebarCollapsed={false}
        onToggleSidebar={() => {}}
        activeDemo={null}
        onNavigateHome={() => {}}
        userEmail="tester@example.com"
        onSignOut={onSignOut}
      />,
    )
    expect(screen.getByText('tester@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})

