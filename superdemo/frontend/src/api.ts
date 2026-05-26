import type {
  ApiError,
  DemosResponse,
  QuotaResponse,
  QuotaTier,
} from './types'

const DEMOS_URL = '/api/demos'
const PROXY_PREFIX = '/api/proxy'

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
  return (await response.json()) as DemosResponse
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
