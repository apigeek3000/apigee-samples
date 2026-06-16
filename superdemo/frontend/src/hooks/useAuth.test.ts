import { describe, it, expect, vi, beforeEach } from 'vitest'
import { renderHook, waitFor } from '@testing-library/react'

const listeners: ((user: unknown) => void)[] = []

const authMock = vi.hoisted(() => ({ enabled: true }))

vi.mock('../auth', () => ({
  get authEnabled() {
    return authMock.enabled
  },
  auth: {},
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
}))

vi.mock('firebase/auth', () => ({
  onAuthStateChanged: (_auth: unknown, cb: (user: unknown) => void) => {
    listeners.push(cb)
    return () => {}
  },
}))

import { useAuth } from './useAuth'

describe('useAuth', () => {
  beforeEach(() => {
    authMock.enabled = true
  })

  it('starts loading then reports the signed-in user', async () => {
    const { result } = renderHook(() => useAuth())
    expect(result.current.loading).toBe(true)

    // Simulate Firebase firing the auth-state callback.
    listeners[listeners.length - 1]({ email: 'alice@example.com', uid: 'u1' })

    await waitFor(() => expect(result.current.loading).toBe(false))
    expect(result.current.user?.email).toBe('alice@example.com')
  })

  it('is immediately un-loaded with no user when auth is disabled', () => {
    authMock.enabled = false
    const { result } = renderHook(() => useAuth())
    expect(result.current.loading).toBe(false)
    expect(result.current.user).toBeNull()
  })
})
