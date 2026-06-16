import type {
  ApiError,
  CloudLoggingResponse,
  CloudLogEntry,
  DemoMetadata,
  DemoStatus,
  DemosResponse,
  McpChatEvent,
  McpTool,
  QuotaResponse,
  QuotaTier,
  RateLimitResponse,
  RateLimitTier,
  RecentLogResponse,
  ThreatResponse,
  VertexContent,
} from './types'

import { auth, authEnabled } from './auth'

const DEMOS_URL = '/api/demos'
const PROXY_PREFIX = '/api/proxy'

/**
 * fetch wrapper that attaches the Firebase ID token. On a 401 (expired token)
 * it force-refreshes once and retries — the security check itself lives on the
 * backend. When auth is disabled (local dev by default) it's a plain fetch.
 */
export async function authedFetch(
  input: RequestInfo | URL,
  init: RequestInit = {},
  _retried = false,
): Promise<Response> {
  const user = authEnabled ? auth?.currentUser : null
  const headers = new Headers(init.headers)
  if (user) {
    const token = await user.getIdToken(_retried)
    headers.set('Authorization', `Bearer ${token}`)
  }
  const response = await fetch(input, { ...init, headers })
  if (response.status === 401 && user && !_retried) {
    return authedFetch(input, init, true)
  }
  return response
}

const VALID_STATUSES: ReadonlySet<DemoStatus> = new Set<DemoStatus>([
  'passing',
  'failing',
  'undeployed',
  'unknown',
  'placeholder',
])

function normalizeStatus(value: unknown): DemoStatus {
  if (typeof value === 'string' && VALID_STATUSES.has(value as DemoStatus)) {
    return value as DemoStatus
  }
  return 'unknown'
}

function normalizeDemo(raw: unknown): DemoMetadata {
  const d = raw as Partial<DemoMetadata> & { status?: unknown }
  return {
    id: d.id ?? '',
    title: d.title ?? '',
    description: d.description ?? '',
    icon: d.icon ?? '',
    status: normalizeStatus(d.status),
    placeholder: d.placeholder,
    model_name: d.model_name,
    model_armor_region: d.model_armor_region,
    bronze_token_limit: d.bronze_token_limit,
    silver_token_limit: d.silver_token_limit,
    interval_minutes: d.interval_minutes,
    model: d.model,
    region: d.region,
    mcp_endpoint: d.mcp_endpoint,
    log_name: d.log_name,
    proxy_name: d.proxy_name,
    max_json_object_keys: d.max_json_object_keys,
    blocked_keywords: d.blocked_keywords,
  }
}

async function parseError(response: Response): Promise<ApiError> {
  let body: unknown = null
  const text = await response.text()
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  const message =
    (body && typeof body === 'object' && 'detail' in body
      ? String((body as { detail: unknown }).detail)
      : text) || response.statusText
  return { status: response.status, message, body }
}

export async function fetchDemos(): Promise<DemosResponse> {
  const response = await authedFetch(DEMOS_URL)
  if (!response.ok) {
    throw await parseError(response)
  }
  const data = (await response.json()) as Omit<DemosResponse, 'demos'> & {
    demos: unknown[]
  }
  return {
    ...data,
    demos: Array.isArray(data.demos) ? data.demos.map(normalizeDemo) : [],
  }
}

export async function sendBasicQuota(tier: QuotaTier): Promise<QuotaResponse> {
  // Trailing slash matters: the proxy route is /api/proxy/{demo}/{path:path},
  // so without it the backend issues a 307 to the slashed URL — which, in local
  // dev, redirects cross-origin (:8000) out of the Vite proxy and trips CORS.
  const response = await authedFetch(`${PROXY_PREFIX}/basic-quota/`, {
    method: 'GET',
    headers: { 'x-quota-tier': tier },
  })
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    const err: ApiError = {
      status: response.status,
      message:
        body && typeof body === 'object' && 'fault' in body
          ? 'Quota exceeded'
          : `Request failed (${response.status})`,
      body,
    }
    throw err
  }
  return parseQuotaResponse(body)
}

interface LlmRequest {
  projectId: string
  region: string
  model: string
  prompt: string
}

export async function sendLlmSecurity(req: LlmRequest): Promise<unknown> {
  const path = `v1/projects/${req.projectId}/locations/${req.region}/publishers/google/models/${req.model}:generateContent`
  const response = await authedFetch(`${PROXY_PREFIX}/llm-security/${path}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [{ text: req.prompt }] }],
      generationConfig: { candidateCount: 1 },
    }),
  })
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    const err: ApiError = {
      status: response.status,
      message: `Request blocked or failed (${response.status})`,
      body,
    }
    throw err
  }
  return body
}

function toNumber(value: unknown): number | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

export function parseQuotaResponse(raw: unknown): QuotaResponse {
  if (!raw || typeof raw !== 'object') {
    return { raw }
  }
  const record = raw as Record<string, unknown>
  const quotaCount = toNumber(
    record.used ?? record.quota_count ?? record.quotaCount,
  )
  const quotaLimit = toNumber(
    record.allowed ?? record.quota_limit ?? record.quotaLimit,
  )
  const message =
    typeof record.message === 'string' ? record.message : undefined
  return { message, quotaCount, quotaLimit, raw }
}

interface LlmRateLimitingRequest {
  tier: RateLimitTier
  contents: VertexContent[]
  projectId: string
  region: string
  model: string
}

export async function sendLlmRateLimiting(
  req: LlmRateLimitingRequest,
): Promise<RateLimitResponse> {
  const path = `v1/projects/${req.projectId}/locations/${req.region}/publishers/google/models/${req.model}:generateContent`
  const response = await authedFetch(`${PROXY_PREFIX}/llm-token-limits-v2/${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-rate-limit-tier': req.tier,
    },
    body: JSON.stringify({ contents: req.contents }),
  })
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    const err: ApiError = {
      status: response.status,
      message:
        body && typeof body === 'object' && 'fault' in body
          ? 'Token quota exceeded'
          : `Request failed (${response.status})`,
      body,
    }
    throw err
  }
  return parseRateLimitResponse(body)
}

function parseRateLimitResponse(raw: unknown): RateLimitResponse {
  const record = (raw ?? {}) as Record<string, unknown>
  const candidates = record.candidates as
    | { content?: { parts?: { text?: string }[] } }[]
    | undefined
  const text = candidates?.[0]?.content?.parts?.[0]?.text ?? ''
  const usage = (record.usageMetadata ?? {}) as Record<string, unknown>
  return {
    text,
    totalTokens: toNumber(usage.totalTokenCount),
    raw,
  }
}

export async function fetchMcpTools(): Promise<McpTool[]> {
  const response = await authedFetch(`${PROXY_PREFIX}/apigee-mcp/tools`)
  if (!response.ok) {
    throw await parseError(response)
  }
  return (await response.json()) as McpTool[]
}

// Note: the backend exposes POST /api/proxy/apigee-mcp/sessions for clients
// that prefer the server to mint the session id. The browser generates its
// own UUID via crypto.randomUUID() and doesn't call that endpoint.

export async function streamMcpChat(
  sessionId: string,
  prompt: string,
  onEvent: (event: McpChatEvent) => void,
): Promise<void> {
  const response = await authedFetch(`${PROXY_PREFIX}/apigee-mcp/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ session_id: sessionId, prompt }),
  })
  if (!response.ok) {
    throw await parseError(response)
  }
  if (!response.body) {
    throw {
      status: 500,
      message: 'Missing response body for streaming chat',
    } satisfies ApiError
  }

  const reader = response.body.getReader()
  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { value, done } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    // sse_starlette frames events with \r\n. Normalize so the \n\n
    // separator search below finds event boundaries.
    buffer = buffer.replace(/\r\n/g, '\n')

    let sep: number
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const chunk = buffer.slice(0, sep)
      buffer = buffer.slice(sep + 2)
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data:')) continue
        const json = line.slice('data:'.length).trim()
        if (!json) continue
        try {
          onEvent(JSON.parse(json) as McpChatEvent)
        } catch {
          // Ignore unparseable lines — backend always emits JSON.
        }
      }
    }
  }
}

// ── Cloud Logging demo ───────────────────────────────────────────────

export async function sendCloudLogging(): Promise<CloudLoggingResponse> {
  const sentAt = new Date().toISOString()
  const response = await authedFetch(`${PROXY_PREFIX}/cloud-logging/`, {
    method: 'GET',
  })
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  if (!response.ok) {
    const err: ApiError = {
      status: response.status,
      message: `Cloud Logging proxy returned ${response.status}`,
      body,
    }
    throw err
  }
  return { httpStatus: response.status, body, sentAt }
}

export async function fetchRecentLog(
  afterIso: string,
): Promise<RecentLogResponse> {
  const url = `/api/cloud-logging/recent?after_ts=${encodeURIComponent(afterIso)}`
  const response = await authedFetch(url)
  if (!response.ok) {
    throw await parseError(response)
  }
  const data = (await response.json()) as { entry: CloudLogEntry | null; queried_at: string }
  return data
}

// ── Threat Protection demo ───────────────────────────────────────────

export async function sendThreatRegex(query: string): Promise<ThreatResponse> {
  const url = `${PROXY_PREFIX}/threat-protection/json?query=${encodeURIComponent(query).replace(/%20/g, '+')}`
  const response = await authedFetch(url, { method: 'GET' })
  const text = await response.text()
  let body: unknown
  try {
    body = text ? JSON.parse(text) : null
  } catch {
    body = text
  }
  // Do NOT throw on 500 — the 500 IS the demo (the proxy blocked the threat).
  return {
    httpStatus: response.status,
    body,
    blocked: response.status !== 200,
    policy: 'regex',
  }
}

export async function sendThreatJson(body: object): Promise<ThreatResponse> {
  const response = await authedFetch(`${PROXY_PREFIX}/threat-protection/echo`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  const text = await response.text()
  let respBody: unknown
  try {
    respBody = text ? JSON.parse(text) : null
  } catch {
    respBody = text
  }
  return {
    httpStatus: response.status,
    body: respBody,
    blocked: response.status !== 200,
    policy: 'json',
  }
}
