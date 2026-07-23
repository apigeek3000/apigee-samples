import type { DemoCategory } from './categories'

export type DemoStatus = 'passing' | 'failing' | 'undeployed' | 'unknown' | 'placeholder'

export interface DemoMetadata {
  id: string
  title: string
  description: string
  icon: string
  status: DemoStatus
  /** Category this demo is grouped under in the sidebar/homepage. Always set by the backend. */
  category?: DemoCategory
  /** True for sidebar placeholders that are not yet wired up. */
  placeholder?: boolean
  /** Present only on the `llm-security` demo. */
  model_name?: string
  /** Present only on the `llm-security` demo. */
  model_armor_region?: string
  /** Present only on the `llm-token-limits-v2` demo. */
  bronze_token_limit?: number
  /** Present only on the `llm-token-limits-v2` demo. */
  silver_token_limit?: number
  /** Present only on the `llm-token-limits-v2` demo. */
  interval_minutes?: number
  /** Present only on the `llm-token-limits-v2` demo. */
  model?: string
  /** Present only on the `llm-token-limits-v2` demo. */
  region?: string
  /** Present only on the `apigee-mcp` demo. */
  mcp_endpoint?: string
  /** Present only on the `cloud-logging` demo. */
  log_name?: string
  /** Present only on the `cloud-logging` demo. */
  proxy_name?: string
  /** Present only on the `threat-protection` demo. */
  max_json_object_keys?: number
  /** Present only on the `threat-protection` demo. */
  blocked_keywords?: string[]
  /** Present only on the `llm-circuit-breaking` demo. */
  primary_region?: string
  /** Present only on the `llm-circuit-breaking` demo. */
  secondary_region?: string
  /** Present only on the `llm-circuit-breaking` demo. Requests allowed before the breaker trips. */
  failover_threshold?: number
  /** Present only on the `llm-circuit-breaking` demo. Rolling window, in minutes. */
  window_minutes?: number
  /** Present only on the `llm-semantic-cache-v2` demo. */
  embeddings_model?: string
  /** Present only on the `llm-semantic-cache-v2` demo. Vector-distance cache-hit threshold. */
  similarity_threshold?: number
  /** Present only on the `llm-semantic-cache-v2` demo. Cache entry TTL, seconds. */
  ttl_seconds?: number
}

export interface DemosResponse {
  status: 'ready' | 'unconfigured' | 'error'
  host?: string
  project_id?: string
  demos: DemoMetadata[]
}

export type QuotaTier = 'trial' | 'premium'

export interface QuotaResponse {
  message?: string
  quotaCount?: number
  quotaLimit?: number
  raw: unknown
}

export interface ApiError {
  status: number
  message: string
  body?: unknown
}

export type RateLimitTier = 'bronze' | 'silver'

export interface VertexContent {
  role: 'user' | 'model'
  parts: { text: string }[]
}

export interface RateLimitTurn {
  id: string
  role: 'user' | 'model' | 'error'
  text: string
  totalTokens?: number
  httpStatus?: number
}

export interface RateLimitResponse {
  text: string
  totalTokens?: number
  raw: unknown
}

// ── Apigee MCP demo ──────────────────────────────────────────────────

export interface McpTool {
  name: string
  description: string
  openapi_op: string
}

export type McpChatEvent =
  | { type: 'session_restarted'; session_id: string }
  | { type: 'delta'; text: string }
  | { type: 'tool_call'; id: string; name: string; args: Record<string, unknown> }
  | { type: 'tool_result'; id: string; is_error: boolean; body: string }
  | { type: 'error'; message: string }
  | { type: 'done' }

// ── Cloud Logging demo ───────────────────────────────────────────────

export interface CloudLoggingResponse {
  httpStatus: number
  body: unknown
  sentAt: string // ISO timestamp captured client-side before fetch
}

export interface CloudLogEntry {
  timestamp: string
  jsonPayload: Record<string, unknown>
}

export interface RecentLogResponse {
  entry: CloudLogEntry | null
  queried_at: string
}

// ── Threat Protection demo ───────────────────────────────────────────

export type ThreatPolicy = 'regex' | 'json'

export interface ThreatResponse {
  httpStatus: number
  body: unknown
  blocked: boolean // derived: httpStatus !== 200
  policy: ThreatPolicy
}

// ── LLM Circuit Breaking demo ────────────────────────────────────────

export type TargetPool = 'primary' | 'secondary' | 'unknown'

export interface CircuitBreakingResponse {
  httpStatus: number
  /** From the x-target-pool response header the superdemo patch adds. */
  targetPool: TargetPool
  /** From the x-target-region response header. Undefined if absent. */
  targetRegion?: string
  text: string
  latencyMs: number
  body: unknown
}

// ── Per-User Token Limits demo ───────────────────────────────────────

export type PerUserId = 'alice' | 'bob'

export interface PerUserResponse {
  httpStatus: number
  /** True when the proxy rejected the call with 429 — the point of the demo. */
  quotaExceeded: boolean
  text: string
  totalTokens?: number
  body: unknown
}

// ── LLM Semantic Cache demo ──────────────────────────────────────────

export interface SemanticCacheResponse {
  httpStatus: number
  text: string
  /** Round-trip latency measured client-side with performance.now(). */
  latencyMs: number
  totalTokens?: number
  body: unknown
}
