import { useMemo, useState } from 'react'
import type { DemoMetadata, DemoStatus } from '../types'
import { groupByCategory } from '../categories'
import styles from './Homepage.module.css'

interface Props {
  demos: DemoMetadata[]
  onSelect: (id: string) => void
  showStatus: boolean
}

const STATUS_LABEL: Record<DemoStatus, string> = {
  passing: 'Ready / Passing',
  failing: 'Ready / Failing',
  undeployed: 'Not Deployed',
  unknown: 'Unknown Status',
  placeholder: 'Not Yet Implemented',
}

/** Max demos shown per section before a "Show more" control appears. */
const SECTION_LIMIT = 8

export function Homepage({ demos, onSelect, showStatus }: Props) {
  const [query, setQuery] = useState('')
  // Category ids whose section is expanded past SECTION_LIMIT.
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Truncate description text helper to keep cards uniform and neat
  const getTruncatedDescription = (desc: string) => {
    if (desc.length <= 200) return desc
    return desc.slice(0, 200).trim() + '...'
  }

  const trimmedQuery = query.trim().toLowerCase()
  const isSearching = trimmedQuery.length > 0

  const filteredDemos = useMemo(() => {
    if (!isSearching) return demos
    return demos.filter(
      (d) =>
        d.title.toLowerCase().includes(trimmedQuery) ||
        d.description.toLowerCase().includes(trimmedQuery),
    )
  }, [demos, isSearching, trimmedQuery])

  const groups = groupByCategory(filteredDemos)

  const toggleExpanded = (categoryId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(categoryId)) next.delete(categoryId)
      else next.add(categoryId)
      return next
    })
  }

  return (
    <div className={styles.container}>
      {/* Premium welcome hero section */}
      <section className={styles.hero}>
        <div className={styles.heroGlow} aria-hidden="true" />
        <h1 className={styles.title}>Apigee Super Demos</h1>
        <p className={styles.subtitle}>
          Explore hands-on interactive demonstrations of enterprise-grade API management, security, quotas, and AI-powered logic built on Apigee X and hybrid.
        </p>
        <div className={styles.searchRow}>
          <span className={styles.searchIcon} aria-hidden="true">🔍</span>
          <input
            type="search"
            className={styles.searchInput}
            placeholder="Search demos…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            aria-label="Search demos"
          />
        </div>
      </section>

      {isSearching && groups.length === 0 && (
        <p className={styles.noResults}>No demos match “{query.trim()}”.</p>
      )}

      {/* One section per non-empty category */}
      {groups.map(({ category, demos: groupDemos }) => {
        // While searching, show every match (cap lifted). Otherwise cap at
        // SECTION_LIMIT unless the section has been expanded.
        const isExpanded = expanded.has(category.id)
        const overLimit = groupDemos.length > SECTION_LIMIT
        const showAll = isSearching || isExpanded || !overLimit
        const visibleDemos = showAll
          ? groupDemos
          : groupDemos.slice(0, SECTION_LIMIT)
        const hiddenCount = groupDemos.length - SECTION_LIMIT

        return (
          <div key={category.id} className={styles.gridSection}>
            <h2 className={styles.sectionHeading}>
              <span className={styles.sectionIcon} aria-hidden="true">
                {category.icon}
              </span>
              {category.label}
            </h2>
            <div className={styles.grid}>
              {visibleDemos.map((demo) => {
                const isPlaceholder = !!demo.placeholder
                const truncatedDesc = getTruncatedDescription(demo.description)

                return (
                  <button
                    key={demo.id}
                    type="button"
                    className={`${styles.card} ${isPlaceholder ? styles.cardPlaceholder : ''}`}
                    onClick={() => onSelect(demo.id)}
                    aria-label={`Open demo: ${demo.title}. ${demo.description}`}
                  >
                    <div className={styles.cardHeader}>
                      <span className={styles.icon} aria-hidden="true">
                        {demo.icon}
                      </span>
                      {showStatus && isPlaceholder && (
                        <span className={styles.placeholderBadge}>Planned</span>
                      )}
                      {showStatus && !isPlaceholder && (
                        <span
                          className={`${styles.statusBadge} ${
                            styles[`statusBadge_${demo.status}`] || styles.statusBadge_unknown
                          }`}
                        >
                          {STATUS_LABEL[demo.status]}
                        </span>
                      )}
                    </div>

                    <h3 className={styles.cardTitle}>{demo.title}</h3>
                    <p className={styles.cardDescription}>{truncatedDesc}</p>

                    <div className={styles.cardFooter}>
                      <span className={styles.actionText}>Launch Demo</span>
                      <span className={styles.arrow} aria-hidden="true">→</span>
                    </div>
                  </button>
                )
              })}
            </div>

            {/* Cap toggle — only when not searching and the section overflows */}
            {!isSearching && overLimit && (
              <button
                type="button"
                className={styles.showMore}
                onClick={() => toggleExpanded(category.id)}
                aria-expanded={isExpanded}
              >
                {isExpanded ? 'Show less' : `Show more demos (${hiddenCount})`}
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}
