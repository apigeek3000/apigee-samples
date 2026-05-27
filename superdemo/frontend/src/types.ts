export type DemoStatus = 'passing' | 'failing' | 'undeployed' | 'unknown'

export interface DemoMetadata {
  id: string
  title: string
  description: string
  icon: string
  status: DemoStatus
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
