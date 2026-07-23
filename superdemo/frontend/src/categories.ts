import type { DemoMetadata } from './types'

export type DemoCategory =
  | 'ai-llm'
  | 'security-auth'
  | 'operations-portals'
  | 'backends-integration'

export interface CategoryInfo {
  id: DemoCategory
  label: string
  icon: string
}

/** Single source of truth for category order, label, and icon. */
export const CATEGORIES: CategoryInfo[] = [
  { id: 'ai-llm', label: 'AI & LLM', icon: '🤖' },
  { id: 'security-auth', label: 'Security & Auth', icon: '🛡️' },
  { id: 'operations-portals', label: 'Operations & Traffic', icon: '📊' },
  { id: 'backends-integration', label: 'Backends & Integration', icon: '🔗' },
]

export interface CategoryGroup {
  category: CategoryInfo
  demos: DemoMetadata[]
}

/**
 * Group demos by category, in CATEGORIES order, preserving input order within
 * each category. Categories with no demos are omitted; demos with a missing or
 * unrecognized category are dropped (never happens at runtime — the backend
 * always emits a valid category).
 */
export function groupByCategory(demos: DemoMetadata[]): CategoryGroup[] {
  return CATEGORIES.map((category) => ({
    category,
    demos: demos.filter((d) => d.category === category.id),
  })).filter((group) => group.demos.length > 0)
}
