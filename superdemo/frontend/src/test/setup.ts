import '@testing-library/jest-dom/vitest'
import { vi } from 'vitest'

// Globally mock the Firebase auth module so tests that import the real ./api
// (which now imports ./auth) don't try to initialize Firebase with an
// undefined web API key. Tests that need specific auth behavior override this
// with their own vi.mock('./auth', ...) / vi.mock('../auth', ...).
vi.mock('../auth', () => ({
  authEnabled: true,
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('test-token') } },
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
}))
