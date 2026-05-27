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
