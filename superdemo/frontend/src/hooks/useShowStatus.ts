import { useCallback, useState } from 'react'

const STORAGE_KEY = 'superdemo:show-status'

function readInitial(): boolean {
  if (typeof window === 'undefined') return false
  try {
    return window.localStorage.getItem(STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function useShowStatus(): [boolean, (next: boolean) => void] {
  const [value, setValue] = useState<boolean>(readInitial)

  const setShowStatus = useCallback((next: boolean) => {
    setValue(next)
    try {
      window.localStorage.setItem(STORAGE_KEY, next ? 'true' : 'false')
    } catch {
      // localStorage may be unavailable (private mode, quota); ignore.
    }
  }, [])

  return [value, setShowStatus]
}
