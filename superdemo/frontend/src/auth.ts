import { initializeApp } from 'firebase/app'
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signOut,
} from 'firebase/auth'

// Whether the app enforces sign-in. On by default when deployed to Cloud Run
// (the deploy script bakes VITE_AUTH_ENABLED=true); off by default in local
// dev, so the dev loop needs no Firebase config and no sign-in.
export const authEnabled = import.meta.env.VITE_AUTH_ENABLED === 'true'

// Public Firebase web config — safe to ship in the browser. Baked at build time
// from VITE_FIREBASE_* (the deploy script writes frontend/.env.production).
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
}

// Only initialize Firebase when auth is enabled — otherwise local dev would
// need a real web API key just to boot. `auth` is null when disabled; callers
// guard on `authEnabled` before touching it.
const firebaseApp = authEnabled ? initializeApp(firebaseConfig) : null
export const auth = firebaseApp ? getAuth(firebaseApp) : null

const provider = new GoogleAuthProvider()

export function signInWithGoogle(): Promise<unknown> {
  if (!auth) return Promise.resolve()
  return signInWithPopup(auth, provider)
}

export function signOutUser(): Promise<void> {
  if (!auth) return Promise.resolve()
  return signOut(auth)
}
