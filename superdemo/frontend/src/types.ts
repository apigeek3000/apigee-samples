export interface DemoMetadata {
  id: string
  title: string
  description: string
  icon: string
}

export interface DemosResponse {
  status: 'ready' | 'unconfigured' | 'error'
  host?: string
  project_id?: string
  model_name?: string
  model_armor_region?: string
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
