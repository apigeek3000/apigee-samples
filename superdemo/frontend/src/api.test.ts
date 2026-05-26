import { describe, it, expect } from 'vitest'
import { parseQuotaResponse } from './api'

describe('parseQuotaResponse', () => {
  it('extracts numeric count and limit from snake_case keys', () => {
    const raw = { message: 'ok', quota_count: 3, quota_limit: 10 }
    const result = parseQuotaResponse(raw)
    expect(result.quotaCount).toBe(3)
    expect(result.quotaLimit).toBe(10)
    expect(result.message).toBe('ok')
    expect(result.raw).toBe(raw)
  })

  it('extracts numeric count and limit from camelCase keys', () => {
    const raw = { quotaCount: 7, quotaLimit: 100 }
    const result = parseQuotaResponse(raw)
    expect(result.quotaCount).toBe(7)
    expect(result.quotaLimit).toBe(100)
  })

  it('extracts count and limit from Apigee allowed/used keys', () => {
    const raw = { status: 'success', allowed: '10', available: '7', used: '3' }
    const result = parseQuotaResponse(raw)
    expect(result.quotaCount).toBe(3)
    expect(result.quotaLimit).toBe(10)
  })

  it('coerces string numerics', () => {
    const raw = { quota_count: '5', quota_limit: '10' }
    const result = parseQuotaResponse(raw)
    expect(result.quotaCount).toBe(5)
    expect(result.quotaLimit).toBe(10)
  })

  it('returns undefined fields when keys are missing', () => {
    const raw = { other: 'data' }
    const result = parseQuotaResponse(raw)
    expect(result.quotaCount).toBeUndefined()
    expect(result.quotaLimit).toBeUndefined()
    expect(result.raw).toBe(raw)
  })

  it('preserves the raw body even when not an object', () => {
    const result = parseQuotaResponse('plain text')
    expect(result.raw).toBe('plain text')
    expect(result.quotaCount).toBeUndefined()
  })
})
