import { describe, it, expect, vi, afterEach, type Mock } from 'vitest'
import {
  fetchDemos,
  parseQuotaResponse,
  sendBasicQuota,
  sendLlmSecurity,
} from './api'

afterEach(() => {
  vi.unstubAllGlobals()
})

function mockFetch(): Mock {
  const fn = vi.fn()
  vi.stubGlobal('fetch', fn)
  return fn
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

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

describe('fetchDemos', () => {
  it('returns parsed body on 2xx', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        host: 'apigee.test',
        demos: [{ id: 'basic-quota', title: 'Basic Quota', description: 'd', icon: 'i' }],
      }),
    )

    const result = await fetchDemos()

    expect(fetch).toHaveBeenCalledWith('/api/demos')
    expect(result.status).toBe('ready')
    expect(result.demos).toHaveLength(1)
  })

  it('throws ApiError with status and detail on non-2xx', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({ detail: 'config missing' }, { status: 500 }),
    )

    await expect(fetchDemos()).rejects.toMatchObject({
      status: 500,
      message: 'config missing',
      body: { detail: 'config missing' },
    })
  })
})

describe('sendBasicQuota', () => {
  it('sends x-quota-tier header matching the tier', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(jsonResponse({ allowed: '10', used: '1' }))

    await sendBasicQuota('premium')

    expect(fetch).toHaveBeenCalledWith('/api/proxy/basic-quota', {
      method: 'GET',
      headers: { 'x-quota-tier': 'premium' },
    })
  })

  it('parses response via parseQuotaResponse', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(jsonResponse({ allowed: '10', used: '3' }))

    const result = await sendBasicQuota('trial')

    expect(result.quotaLimit).toBe(10)
    expect(result.quotaCount).toBe(3)
  })

  it('throws "Quota exceeded" when non-ok body contains a fault', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse(
        { fault: { faultstring: 'Rate limit quota violation' } },
        { status: 429 },
      ),
    )

    await expect(sendBasicQuota('trial')).rejects.toMatchObject({
      status: 429,
      message: 'Quota exceeded',
      body: { fault: { faultstring: 'Rate limit quota violation' } },
    })
  })
})

describe('sendLlmSecurity', () => {
  it('builds the Vertex path and posts the prompt body', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(jsonResponse({ candidates: [] }))

    await sendLlmSecurity({
      projectId: 'my-proj',
      region: 'us-central1',
      model: 'gemini-2.5-flash',
      prompt: 'hello',
    })

    expect(fetch).toHaveBeenCalledTimes(1)
    const [url, init] = (fetch.mock.calls[0] as [string, RequestInit])
    expect(url).toBe(
      '/api/proxy/llm-security/v1/projects/my-proj/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent',
    )
    expect(init.method).toBe('POST')
    expect(JSON.parse(init.body as string)).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'hello' }] }],
      generationConfig: { candidateCount: 1 },
    })
  })

  it('throws on non-ok with the documented message format', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({ blocked: true }, { status: 422 }),
    )

    await expect(
      sendLlmSecurity({
        projectId: 'p',
        region: 'r',
        model: 'm',
        prompt: 'bad prompt',
      }),
    ).rejects.toMatchObject({
      status: 422,
      message: 'Request blocked or failed (422)',
      body: { blocked: true },
    })
  })
})
