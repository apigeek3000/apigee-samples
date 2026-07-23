import { useCallback, useState } from 'react'

const STORAGE_KEY = 'superdemo:expanded-categories'

/**
 * Tracks which navbar category sections are expanded, persisted to
 * localStorage. We store the *expanded* set (not collapsed) so the zero state —
 * an empty set on first visit or unreadable storage — means every category
 * starts collapsed.
 */
function readInitial(): Set<string> {
  if (typeof window === 'undefined') return new Set()
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return new Set()
    const parsed = JSON.parse(raw)
    if (Array.isArray(parsed)) return new Set(parsed.filter((id) => typeof id === 'string'))
    return new Set()
  } catch {
    return new Set()
  }
}

export function useCollapsedCategories(): [
  (categoryId: string) => boolean,
  (categoryId: string) => void,
] {
  const [expanded, setExpanded] = useState<Set<string>>(readInitial)

  const toggle = useCallback((categoryId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      try {
        window.localStorage.setItem(STORAGE_KEY, JSON.stringify([...next]))
      } catch {
        // localStorage may be unavailable (private mode, quota); ignore.
      }
      return next
    })
  }, [])

  const isCollapsed = useCallback(
    (categoryId: string) => !expanded.has(categoryId),
    [expanded],
  )

  return [isCollapsed, toggle]
}
