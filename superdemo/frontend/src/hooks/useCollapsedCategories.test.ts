import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useCollapsedCategories } from './useCollapsedCategories'

const STORAGE_KEY = 'superdemo:expanded-categories'

describe('useCollapsedCategories', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('treats every category as collapsed by default', () => {
    const { result } = renderHook(() => useCollapsedCategories())
    const [isCollapsed] = result.current
    expect(isCollapsed('ai-llm')).toBe(true)
    expect(isCollapsed('security-auth')).toBe(true)
  })

  it('expands a category on toggle and persists the expanded set', () => {
    const { result } = renderHook(() => useCollapsedCategories())
    act(() => {
      result.current[1]('ai-llm')
    })
    expect(result.current[0]('ai-llm')).toBe(false)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([
      'ai-llm',
    ])
  })

  it('collapses an expanded category on a second toggle', () => {
    const { result } = renderHook(() => useCollapsedCategories())
    act(() => {
      result.current[1]('ai-llm')
    })
    act(() => {
      result.current[1]('ai-llm')
    })
    expect(result.current[0]('ai-llm')).toBe(true)
    expect(JSON.parse(window.localStorage.getItem(STORAGE_KEY)!)).toEqual([])
  })

  it('restores the expanded set from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(['operations-portals']))
    const { result } = renderHook(() => useCollapsedCategories())
    expect(result.current[0]('operations-portals')).toBe(false)
    expect(result.current[0]('ai-llm')).toBe(true)
  })

  it('falls back to all-collapsed when stored value is malformed', () => {
    window.localStorage.setItem(STORAGE_KEY, 'not json')
    const { result } = renderHook(() => useCollapsedCategories())
    expect(result.current[0]('ai-llm')).toBe(true)
  })
})
