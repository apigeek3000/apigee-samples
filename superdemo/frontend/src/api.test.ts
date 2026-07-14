import { describe, it, expect, vi, afterEach, beforeEach, type Mock } from 'vitest'
import {
  authedFetch,
  fetchDemos,
  parseQuotaResponse,
  sendBasicQuota,
  sendCircuitBreaking,
  sendLlmSecurity,
  sendPerUserTokenLimits,
} from './api'

vi.mock('./auth', () => ({
  authEnabled: true,
  auth: { currentUser: { getIdToken: vi.fn().mockResolvedValue('tok-123') } },
}))

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('authedFetch', () => {
  it('attaches the bearer token to the request', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await authedFetch('/api/demos')

    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.get('Authorization')).toBe('Bearer tok-123')
    vi.unstubAllGlobals()
  })

  it('refreshes the token once and retries on 401', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 401 }))
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    const resp = await authedFetch('/api/demos')

    expect(resp.status).toBe(200)
    expect(fetchMock).toHaveBeenCalledTimes(2)
    vi.unstubAllGlobals()
  })

  it('attaches no Authorization header when auth is disabled', async () => {
    vi.resetModules()
    vi.doMock('./auth', () => ({ authEnabled: false, auth: null }))
    const { authedFetch: af } = await import('./api')
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response('{}', { status: 200 }))
    vi.stubGlobal('fetch', fetchMock)

    await af('/api/demos')

    const init = fetchMock.mock.calls[0][1]
    expect(init.headers.get('Authorization')).toBeNull()
    vi.unstubAllGlobals()
    vi.doUnmock('./auth')
    vi.resetModules()
  })
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
        demos: [
          {
            id: 'basic-quota',
            title: 'Basic Quota',
            description: 'd',
            icon: 'i',
            status: 'passing',
          },
        ],
      }),
    )

    const result = await fetchDemos()

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/demos')
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok-123')
    expect(result.status).toBe('ready')
    expect(result.demos).toHaveLength(1)
    expect(result.demos[0].status).toBe('passing')
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

  it('preserves demo-specific extension fields through normalization', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        project_id: 'my-proj',
        demos: [
          {
            id: 'llm-security',
            title: 'LLM Security',
            description: 'd',
            icon: 'i',
            status: 'passing',
            model_name: 'gemini-2.5-flash',
            model_armor_region: 'us-central1',
          },
          {
            id: 'llm-token-limits-v2',
            title: 'LLM Rate Limiting',
            description: 'd',
            icon: 'i',
            status: 'failing',
            bronze_token_limit: 2000,
            silver_token_limit: 5000,
            interval_minutes: 5,
            model: 'gemini-2.5-flash',
            region: 'us-central1',
          },
        ],
      }),
    )

    const result = await fetchDemos()

    expect(result.demos[0]).toMatchObject({
      model_name: 'gemini-2.5-flash',
      model_armor_region: 'us-central1',
    })
    expect(result.demos[1]).toMatchObject({
      bronze_token_limit: 2000,
      silver_token_limit: 5000,
      interval_minutes: 5,
      model: 'gemini-2.5-flash',
      region: 'us-central1',
    })
  })

  it('passes placeholder status and placeholder flag through normalization', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        demos: [
          {
            id: 'llm-routing',
            title: 'LLM Model Routing',
            description: 'd',
            icon: '🔀',
            status: 'placeholder',
            placeholder: true,
          },
        ],
      }),
    )

    const result = await fetchDemos()

    expect(result.demos[0].status).toBe('placeholder')
    expect(result.demos[0].placeholder).toBe(true)
  })
})

describe('sendBasicQuota', () => {
  it('sends x-quota-tier header matching the tier', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(jsonResponse({ allowed: '10', used: '1' }))

    await sendBasicQuota('premium')

    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/proxy/basic-quota/')
    expect(init.method).toBe('GET')
    expect((init.headers as Headers).get('x-quota-tier')).toBe('premium')
    expect((init.headers as Headers).get('Authorization')).toBe('Bearer tok-123')
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

describe('fetchDemos status normalization', () => {
  it('preserves valid status values', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        demos: [
          { id: 'a', title: 't', description: 'd', icon: 'i', status: 'passing' },
          { id: 'b', title: 't', description: 'd', icon: 'i', status: 'failing' },
          { id: 'c', title: 't', description: 'd', icon: 'i', status: 'undeployed' },
        ],
      }),
    )
    const result = await fetchDemos()
    expect(result.demos.map((d) => d.status)).toEqual([
      'passing',
      'failing',
      'undeployed',
    ])
  })

  it('normalizes unrecognized status to "unknown"', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        demos: [{ id: 'x', title: 't', description: 'd', icon: 'i', status: 'bogus' }],
      }),
    )
    const result = await fetchDemos()
    expect(result.demos[0].status).toBe('unknown')
  })

  it('normalizes missing status to "unknown"', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        demos: [{ id: 'x', title: 't', description: 'd', icon: 'i' }],
      }),
    )
    const result = await fetchDemos()
    expect(result.demos[0].status).toBe('unknown')
  })
})

import { sendLlmRateLimiting } from './api'

describe('sendLlmRateLimiting', () => {
  beforeEach(() => {
    vi.restoreAllMocks()
  })

  it('POSTs to the expected path with the tier header and JSON body', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'hello' }] } }],
          usageMetadata: {
            promptTokenCount: 5,
            candidatesTokenCount: 3,
            totalTokenCount: 8,
          },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await sendLlmRateLimiting({
      tier: 'silver',
      contents: [{ role: 'user', parts: [{ text: 'hi' }] }],
      projectId: 'proj',
      region: 'us-central1',
      model: 'gemini-2.5-flash',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      '/api/proxy/llm-token-limits-v2/v1/projects/proj/locations/us-central1/publishers/google/models/gemini-2.5-flash:generateContent',
    )
    expect((init as RequestInit).method).toBe('POST')
    const headers = new Headers((init as RequestInit).headers)
    expect(headers.get('x-rate-limit-tier')).toBe('silver')
    expect(headers.get('content-type')).toBe('application/json')
    expect((init as RequestInit).body).toBe(
      JSON.stringify({ contents: [{ role: 'user', parts: [{ text: 'hi' }] }] }),
    )

    expect(result.text).toBe('hello')
    expect(result.totalTokens).toBe(8)
  })

  it('throws an ApiError on non-2xx, preserving status + body', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({ fault: { faultstring: 'Rate limit quota violation' } }),
        { status: 429, headers: { 'content-type': 'application/json' } },
      ),
    )

    await expect(
      sendLlmRateLimiting({
        tier: 'bronze',
        contents: [],
        projectId: 'p',
        region: 'r',
        model: 'm',
      }),
    ).rejects.toMatchObject({ status: 429 })
  })

  it('handles a malformed response (missing usageMetadata) by surfacing undefined token counts', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'broken' }] } }],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await sendLlmRateLimiting({
      tier: 'bronze',
      contents: [],
      projectId: 'p',
      region: 'r',
      model: 'm',
    })

    expect(result.text).toBe('broken')
    expect(result.totalTokens).toBeUndefined()
  })
})

import { fetchMcpTools, streamMcpChat } from './api'
import type { McpChatEvent } from './types'

describe('fetchMcpTools', () => {
  it('returns the tools list', async () => {
    const tools = [
      { name: 'list_customers', description: 'List', openapi_op: 'GET /customers' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: true,
      json: async () => tools,
    } as Response))

    const result = await fetchMcpTools()
    expect(result).toEqual(tools)
  })

  it('throws on non-2xx', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => JSON.stringify({ detail: 'not deployed' }),
    } as Response))

    await expect(fetchMcpTools()).rejects.toMatchObject({
      status: 503,
      message: 'not deployed',
    })
  })
})

describe('streamMcpChat', () => {
  function makeStreamingResponse(events: McpChatEvent[]): Response {
    const encoder = new TextEncoder()
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const e of events) {
          controller.enqueue(encoder.encode(`data: ${JSON.stringify(e)}\n\n`))
        }
        controller.close()
      },
    })
    return new Response(stream, {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    })
  }

  it('emits parsed events in order', async () => {
    const events: McpChatEvent[] = [
      { type: 'delta', text: 'A' },
      { type: 'tool_call', id: 't1', name: 'x', args: {} },
      { type: 'tool_result', id: 't1', is_error: false, body: 'ok' },
      { type: 'done' },
    ]
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(makeStreamingResponse(events)))

    const received: McpChatEvent[] = []
    await streamMcpChat('sess-1', 'hi', (e: McpChatEvent) => received.push(e))
    expect(received).toEqual(events)
  })

  it('throws on non-2xx response', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      statusText: 'Service Unavailable',
      text: async () => JSON.stringify({ detail: 'not deployed' }),
    } as Response))

    await expect(
      streamMcpChat('sess-1', 'hi', () => undefined),
    ).rejects.toMatchObject({ status: 503 })
  })
})

import {
  fetchRecentLog,
  sendCloudLogging,
  sendThreatJson,
  sendThreatRegex,
} from './api'

describe('sendCloudLogging', () => {
  it('captures sentAt before fetching and returns httpStatus + body', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(jsonResponse({ args: {}, url: 'https://httpbin.org/get' }))

    const before = new Date().toISOString()
    const result = await sendCloudLogging()
    const after = new Date().toISOString()

    expect(result.httpStatus).toBe(200)
    expect(result.sentAt >= before && result.sentAt <= after).toBe(true)
    expect(result.body).toMatchObject({ url: 'https://httpbin.org/get' })

    // The request must go to the proxy with trailing slash.
    expect(fetch).toHaveBeenCalledWith('/api/proxy/cloud-logging/', expect.any(Object))
  })
})

describe('fetchRecentLog', () => {
  it('passes after_ts as a query param and returns the entry', async () => {
    const fetch = mockFetch()
    const entry = {
      timestamp: '2026-05-29T12:00:00.000Z',
      jsonPayload: { proxy: 'sample-cloud-logging' },
    }
    fetch.mockResolvedValueOnce(jsonResponse({ entry, queried_at: '2026-05-29T12:00:01Z' }))

    const result = await fetchRecentLog('2026-05-29T11:59:55.000Z')

    expect(result.entry).toEqual(entry)
    const url = fetch.mock.calls[0][0] as string
    expect(url).toContain('/api/cloud-logging/recent')
    expect(url).toContain('after_ts=2026-05-29T11')
  })

  it('returns entry: null when the backend reports no match', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({ entry: null, queried_at: '2026-05-29T12:00:01Z' }),
    )
    const result = await fetchRecentLog('2026-05-29T11:59:55.000Z')
    expect(result.entry).toBeNull()
  })

  it('throws an ApiError on 403 so the UI can show the permission hint', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({ detail: 'roles/logging.viewer required' }, { status: 403 }),
    )
    await expect(fetchRecentLog('2026-05-29T11:59:55.000Z')).rejects.toMatchObject({
      status: 403,
    })
  })
})

describe('sendThreatRegex', () => {
  it('GETs /api/proxy/threat-protection/json with the query encoded', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(jsonResponse({ args: { query: 'select' } }))

    const result = await sendThreatRegex('select')

    expect(result.blocked).toBe(false)
    expect(result.policy).toBe('regex')
    expect(result.httpStatus).toBe(200)
    const url = fetch.mock.calls[0][0] as string
    expect(url).toBe('/api/proxy/threat-protection/json?query=select')
  })

  it('encodes the query and returns blocked: true on HTTP 500', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({ fault: { faultstring: 'Regex' } }, { status: 500 }),
    )

    const result = await sendThreatRegex('drop table')

    expect(result.blocked).toBe(true)
    expect(result.httpStatus).toBe(500)
    const url = fetch.mock.calls[0][0] as string
    expect(url).toBe('/api/proxy/threat-protection/json?query=drop+table')
  })
})

describe('sendThreatJson', () => {
  it('POSTs the body to /api/proxy/threat-protection/echo and returns blocked=false on 200', async () => {
    const fetch = mockFetch()
    const body = { f1: 't1', f2: 't2', f3: 't3', f4: 't4', f5: 't5' }
    fetch.mockResolvedValueOnce(jsonResponse({ echo: body }))

    const result = await sendThreatJson(body)

    expect(result.blocked).toBe(false)
    expect(result.policy).toBe('json')
    expect(result.httpStatus).toBe(200)
    const [url, init] = fetch.mock.calls[0]
    expect(url).toBe('/api/proxy/threat-protection/echo')
    expect(init.method).toBe('POST')
    expect((init.headers as Headers).get('Content-Type')).toBe('application/json')
  })

  it('returns blocked=true on 500', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({ fault: { faultstring: 'JSON' } }, { status: 500 }),
    )

    const result = await sendThreatJson({ f1: '1', f2: '2', f3: '3', f4: '4', f5: '5', f6: '6' })

    expect(result.blocked).toBe(true)
    expect(result.httpStatus).toBe(500)
  })
})

// ── LLM Circuit Breaking demo ────────────────────────────────────────

describe('sendCircuitBreaking', () => {
  it('reads the target pool and region from the response headers', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'blue sky' }] } }],
        }),
        {
          status: 200,
          headers: {
            'content-type': 'application/json',
            'x-target-pool': 'secondary',
            'x-target-region': 'us-east4',
          },
        },
      ),
    )

    const result = await sendCircuitBreaking({
      prompt: 'why is the sky blue?',
      projectId: 'p',
      region: 'us-central1',
      model: 'gemini-2.5-flash',
    })

    expect(result.targetPool).toBe('secondary')
    expect(result.targetRegion).toBe('us-east4')
    expect(result.httpStatus).toBe(200)
    expect(result.text).toBe('blue sky')
    expect(typeof result.latencyMs).toBe('number')

    const url = fetchSpy.mock.calls[0][0] as string
    expect(url).toContain('/api/proxy/llm-circuit-breaking/')
    expect(url).toContain('gemini-2.5-flash:generateContent')
  })

  it('falls back to targetPool "unknown" when the header is absent', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ candidates: [] }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await sendCircuitBreaking({
      prompt: 'hi',
      projectId: 'p',
      region: 'us-central1',
      model: 'gemini-2.5-flash',
    })

    expect(result.targetPool).toBe('unknown')
    expect(result.targetRegion).toBeUndefined()
  })
})

// ── Per-User Token Limits demo ───────────────────────────────────────

describe('sendPerUserTokenLimits', () => {
  it('sends the tier and user id headers and returns the token count', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'hello' }] } }],
          usageMetadata: { totalTokenCount: 42 },
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    )

    const result = await sendPerUserTokenLimits({
      tier: 'bronze',
      userId: 'alice',
      prompt: 'hi',
      projectId: 'p',
      region: 'us-central1',
      model: 'gemini-2.5-flash',
    })

    expect(result.httpStatus).toBe(200)
    expect(result.quotaExceeded).toBe(false)
    expect(result.totalTokens).toBe(42)
    expect(result.text).toBe('hello')

    const init = fetchSpy.mock.calls[0][1] as RequestInit
    const headers = new Headers(init.headers)
    expect(headers.get('x-rate-limit-tier')).toBe('bronze')
    expect(headers.get('x-userid')).toBe('alice')
  })

  it('does NOT throw on 429 — the 429 is the demo', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ fault: { faultstring: 'quota violation' } }), {
        status: 429,
        headers: { 'content-type': 'application/json' },
      }),
    )

    const result = await sendPerUserTokenLimits({
      tier: 'bronze',
      userId: 'alice',
      prompt: 'hi',
      projectId: 'p',
      region: 'us-central1',
      model: 'gemini-2.5-flash',
    })

    expect(result.httpStatus).toBe(429)
    expect(result.quotaExceeded).toBe(true)
  })
})

describe('fetchDemos — new metadata fields', () => {
  it('passes through log_name, proxy_name, max_json_object_keys, blocked_keywords', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        host: 'apigee.test',
        project_id: 'p',
        demos: [
          {
            id: 'cloud-logging',
            title: 'Cloud Logging',
            description: 'd',
            icon: '🪵',
            status: 'passing',
            log_name: 'projects/p/logs/apigee',
            proxy_name: 'sample-cloud-logging',
          },
          {
            id: 'threat-protection',
            title: 'Threat Protection',
            description: 'd',
            icon: '🧱',
            status: 'passing',
            max_json_object_keys: 5,
            blocked_keywords: ['delete', 'exec'],
          },
        ],
      }),
    )

    const data = await fetchDemos()
    const cl = data.demos.find((d) => d.id === 'cloud-logging')!
    const tp = data.demos.find((d) => d.id === 'threat-protection')!
    expect(cl.log_name).toBe('projects/p/logs/apigee')
    expect(cl.proxy_name).toBe('sample-cloud-logging')
    expect(tp.max_json_object_keys).toBe(5)
    expect(tp.blocked_keywords).toEqual(['delete', 'exec'])
  })

  it('passes circuit-breaking failover fields through normalizeDemo', async () => {
    const fetch = mockFetch()
    fetch.mockResolvedValueOnce(
      jsonResponse({
        status: 'ready',
        demos: [
          {
            id: 'llm-circuit-breaking',
            title: 'LLM Circuit Breaking',
            description: 'd',
            icon: '🚧',
            status: 'passing',
            primary_region: 'us-central1',
            secondary_region: 'us-east4',
            failover_threshold: 2,
            window_minutes: 2,
          },
        ],
      }),
    )

    const result = await fetchDemos()

    expect(result.demos[0].primary_region).toBe('us-central1')
    expect(result.demos[0].secondary_region).toBe('us-east4')
    expect(result.demos[0].failover_threshold).toBe(2)
    expect(result.demos[0].window_minutes).toBe(2)
  })
})
