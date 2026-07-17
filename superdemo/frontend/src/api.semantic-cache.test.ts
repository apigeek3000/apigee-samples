import { afterEach, describe, expect, it, vi } from 'vitest'
import { sendSemanticCache } from './api'

describe('sendSemanticCache', () => {
  afterEach(() => vi.restoreAllMocks())

  it('POSTs the prompt to the generateContent path and returns latency + text', async () => {
    const fetchMock = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(
        JSON.stringify({
          candidates: [{ content: { parts: [{ text: 'April 15' }] } }],
          usageMetadata: { totalTokenCount: 20 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } },
      ),
    )

    const res = await sendSemanticCache({
      prompt: 'When are taxes due?',
      projectId: 'proj',
      region: 'us-central1',
      model: 'gemini-fake',
    })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toBe(
      '/api/proxy/llm-semantic-cache-v2/v1/projects/proj/locations/us-central1/publishers/google/models/gemini-fake:generateContent',
    )
    expect(init?.method).toBe('POST')
    expect(JSON.parse(String(init?.body))).toEqual({
      contents: [{ role: 'user', parts: [{ text: 'When are taxes due?' }] }],
    })
    expect(res.httpStatus).toBe(200)
    expect(res.text).toBe('April 15')
    expect(res.totalTokens).toBe(20)
    expect(typeof res.latencyMs).toBe('number')
  })
})
