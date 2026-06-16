import { useEffect, useState } from 'react'
import { onAuthStateChanged, type User } from 'firebase/auth'
import { auth, authEnabled, signInWithGoogle, signOutUser } from '../auth'

export interface AuthState {
  user: User | null
  loading: boolean
  signIn: () => Promise<unknown>
  signOut: () => Promise<void>
}

export function useAuth(): AuthState {
  const [user, setUser] = useState<User | null>(null)
  // When auth is disabled there's nothing to wait for, so we start un-loaded.
  const [loading, setLoading] = useState(authEnabled)

  useEffect(() => {
    if (!authEnabled || !auth) {
      setLoading(false)
      return
    }
    const unsubscribe = onAuthStateChanged(auth, (u) => {
      setUser(u)
      setLoading(false)
    })
    return unsubscribe
  }, [])

  return { user, loading, signIn: signInWithGoogle, signOut: signOutUser }
}
