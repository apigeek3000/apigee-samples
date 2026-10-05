import { describe, it, expect, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
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

  it('shows the email and a Sign out item inside the account menu', async () => {
    const onSignOut = vi.fn()
    const user = userEvent.setup()
    renderTopbar({ userEmail: 'tester@example.com', userName: 'Test User', onSignOut })

    // Closed by default: only the avatar is visible.
    expect(screen.queryByText('tester@example.com')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByText('Test User')).toBeInTheDocument()
    expect(screen.getByText('tester@example.com')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('shows the user photo on the avatar, without sending a referrer', () => {
    const { container } = renderTopbar({
      userEmail: 'tester@example.com',
      userPhotoUrl: 'https://example.com/me.png',
    })
    const img = container.querySelector('img[src="https://example.com/me.png"]')
    expect(img).not.toBeNull()
    expect(img).toHaveAttribute('referrerpolicy', 'no-referrer')
  })

  it('falls back to the first initial when there is no photo or it fails to load', () => {
    const { container, rerender } = renderTopbar({ userEmail: 'tester@example.com', userName: 'Raven' })
    expect(screen.getByText('R')).toBeInTheDocument()

    rerender(
      <Topbar
        isSidebarCollapsed={false}
        onToggleSidebar={() => {}}
        activeDemo={null}
        onNavigateHome={() => {}}
        userEmail="tester@example.com"
        userPhotoUrl="https://example.com/broken.png"
      />,
    )
    const img = container.querySelector('img[src="https://example.com/broken.png"]')
    expect(img).not.toBeNull()
    fireEvent.error(img!)
    expect(container.querySelector('img[src="https://example.com/broken.png"]')).toBeNull()
    expect(screen.getByText('T')).toBeInTheDocument()
  })

  it('closes the menu on Escape and on an outside click', async () => {
    const user = userEvent.setup()
    renderTopbar({ userEmail: 'tester@example.com', onSignOut: () => {} })
    const avatar = screen.getByRole('button', { name: 'Account menu' })

    await user.click(avatar)
    expect(avatar).toHaveAttribute('aria-expanded', 'true')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()

    await user.click(avatar)
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
    await user.click(document.body)
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('shows no account menu when signed out and not an admin', () => {
    renderTopbar()
    expect(screen.queryByRole('button', { name: 'Account menu' })).not.toBeInTheDocument()
  })

  it('shows no Users item unless onOpenUsers is passed', async () => {
    const user = userEvent.setup()
    renderTopbar({ userEmail: 'tester@example.com', onSignOut: () => {} })
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('button', { name: /sign out/i })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('shows a Users item that calls onOpenUsers and closes the menu', async () => {
    const onOpenUsers = vi.fn()
    const user = userEvent.setup()
    renderTopbar({ userEmail: 'tester@example.com', onSignOut: () => {}, onOpenUsers })

    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    await user.click(screen.getByRole('button', { name: 'Users' }))
    expect(onOpenUsers).toHaveBeenCalledOnce()
    expect(screen.queryByRole('button', { name: 'Users' })).not.toBeInTheDocument()
  })

  it('shows the Users item even without a signed-in email (local dev)', async () => {
    const user = userEvent.setup()
    renderTopbar({ onOpenUsers: () => {} })
    await user.click(screen.getByRole('button', { name: 'Account menu' }))
    expect(screen.getByRole('button', { name: 'Users' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /sign out/i })).not.toBeInTheDocument()
  })

  it('shows a Users breadcrumb while the Users page is open', () => {
    renderTopbar({ onOpenUsers: () => {}, showingUsers: true })
    expect(screen.getByText('Users')).toBeInTheDocument()
  })
})
