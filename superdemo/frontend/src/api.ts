import type {
  ApiError,
  DemoMetadata,
  DemoStatus,
  DemosResponse,
  McpChatEvent,
  McpTool,
  QuotaResponse,
  QuotaTier,
  RateLimitResponse,
  RateLimitTier,
  VertexContent,
} from './types'

const DEMOS_URL = '/api/demos'
const PROXY_PREFIX = '/api/proxy'

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
  const response = await fetch(DEMOS_URL)
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
  const response = await fetch(`${PROXY_PREFIX}/basic-quota`, {
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
  const response = await fetch(`${PROXY_PREFIX}/llm-security/${path}`, {
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
  const response = await fetch(`${PROXY_PREFIX}/llm-token-limits-v2/${path}`, {
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
  const response = await fetch(`${PROXY_PREFIX}/apigee-mcp/tools`)
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
  const response = await fetch(`${PROXY_PREFIX}/apigee-mcp/chat`, {
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
