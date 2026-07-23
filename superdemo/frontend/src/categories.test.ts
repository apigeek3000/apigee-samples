import { describe, it, expect } from 'vitest'
import { groupByCategory, CATEGORIES } from './categories'
import type { DemoMetadata } from './types'

const demo = (id: string, category: DemoMetadata['category']): DemoMetadata => ({
  id,
  title: id,
  description: 'd',
  icon: '🔧',
  status: 'placeholder',
  category,
})

describe('CATEGORIES', () => {
  it('lists the four categories in fixed order', () => {
    expect(CATEGORIES.map((c) => c.id)).toEqual([
      'ai-llm',
      'security-auth',
      'operations-portals',
      'backends-integration',
    ])
  })
})

describe('groupByCategory', () => {
  it('returns categories in CATEGORIES order regardless of input order', () => {
    const groups = groupByCategory([
      demo('a', 'backends-integration'),
      demo('b', 'ai-llm'),
    ])
    expect(groups.map((g) => g.category.id)).toEqual([
      'ai-llm',
      'backends-integration',
    ])
  })

  it('nests each demo under its category, preserving input order', () => {
    const groups = groupByCategory([
      demo('second', 'ai-llm'),
      demo('first', 'ai-llm'),
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].category.id).toBe('ai-llm')
    expect(groups[0].demos.map((d) => d.id)).toEqual(['second', 'first'])
  })

  it('omits categories that have no demos', () => {
    const groups = groupByCategory([demo('x', 'operations-portals')])
    expect(groups.map((g) => g.category.id)).toEqual(['operations-portals'])
  })

  it('drops demos whose category is missing or unknown', () => {
    const groups = groupByCategory([
      demo('x', 'ai-llm'),
      { id: 'y', title: 'y', description: 'd', icon: '🔧', status: 'placeholder' },
    ])
    expect(groups).toHaveLength(1)
    expect(groups[0].demos.map((d) => d.id)).toEqual(['x'])
  })
})
