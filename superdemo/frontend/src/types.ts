export type DemoStatus = 'passing' | 'failing' | 'undeployed' | 'unknown' | 'placeholder'

export interface DemoMetadata {
  id: string
  title: string
  description: string
  icon: string
  status: DemoStatus
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
