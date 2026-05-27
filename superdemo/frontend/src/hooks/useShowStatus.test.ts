import { describe, it, expect, beforeEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useShowStatus } from './useShowStatus'

const STORAGE_KEY = 'superdemo:show-status'

describe('useShowStatus', () => {
  beforeEach(() => {
    window.localStorage.clear()
  })

  it('defaults to false when localStorage is empty', () => {
    const { result } = renderHook(() => useShowStatus())
    expect(result.current[0]).toBe(false)
  })

  it('persists the value to localStorage on change', () => {
    const { result } = renderHook(() => useShowStatus())
    act(() => {
      result.current[1](true)
    })
    expect(result.current[0]).toBe(true)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('true')
  })

  it('restores the value from localStorage on mount', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    const { result } = renderHook(() => useShowStatus())
    expect(result.current[0]).toBe(true)
  })

  it('treats non-"true" stored values as false', () => {
    window.localStorage.setItem(STORAGE_KEY, 'garbage')
    const { result } = renderHook(() => useShowStatus())
    expect(result.current[0]).toBe(false)
  })

  it('can flip back to false and persists that too', () => {
    window.localStorage.setItem(STORAGE_KEY, 'true')
    const { result } = renderHook(() => useShowStatus())
    expect(result.current[0]).toBe(true)
    act(() => {
      result.current[1](false)
    })
    expect(result.current[0]).toBe(false)
    expect(window.localStorage.getItem(STORAGE_KEY)).toBe('false')
  })
})
