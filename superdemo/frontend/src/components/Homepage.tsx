import type { DemoMetadata, DemoStatus } from '../types'
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

export function Homepage({ demos, onSelect, showStatus }: Props) {
  // Truncate description text helper to keep cards uniform and neat
  const getTruncatedDescription = (desc: string) => {
    if (desc.length <= 200) return desc
    return desc.slice(0, 200).trim() + '...'
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
      </section>

      {/* Grid of demo cards */}
      <div className={styles.gridSection}>
        <h2 className={styles.sectionHeading}>Available Demonstrations</h2>
        <div className={styles.grid}>
          {demos.map((demo) => {
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
                  {isPlaceholder && (
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
                  <span className={styles.actionText}>
                    {isPlaceholder ? 'View Details' : 'Launch Demo'}
                  </span>
                  <span className={styles.arrow} aria-hidden="true">→</span>
                </div>
              </button>
            )
          })}
        </div>
      </div>
    </div>
  )
}
