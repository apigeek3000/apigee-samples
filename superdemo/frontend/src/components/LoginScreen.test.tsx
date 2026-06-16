import { describe, it, expect, vi } from 'vitest'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { LoginScreen } from './LoginScreen'

describe('LoginScreen', () => {
  it('renders a sign-in button and calls onSignIn', async () => {
    const onSignIn = vi.fn()
    const user = userEvent.setup()

    render(<LoginScreen onSignIn={onSignIn} />)

    const btn = screen.getByRole('button', { name: /sign in with google/i })
    await user.click(btn)
    expect(onSignIn).toHaveBeenCalledOnce()
  })

  it('renders an access-denied message and sign-out when denied', async () => {
    const onSignOut = vi.fn()
    const user = userEvent.setup()

    render(
      <LoginScreen
        onSignIn={vi.fn()}
        denied
        deniedEmail="eve@evil.com"
        onSignOut={onSignOut}
      />,
    )

    expect(screen.getByText(/not authorized/i)).toBeInTheDocument()
    expect(screen.getByText(/eve@evil.com/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /sign out/i }))
    expect(onSignOut).toHaveBeenCalledOnce()
  })
})
