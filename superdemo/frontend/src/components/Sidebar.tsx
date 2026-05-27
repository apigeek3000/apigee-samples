import type { DemoMetadata, DemoStatus } from '../types'
import styles from './Sidebar.module.css'

interface Props {
  demos: DemoMetadata[]
  activeDemoId: string | null
  onSelect: (id: string) => void
  showStatus: boolean
  onShowStatusChange: (next: boolean) => void
}

const STATUS_DOT_CLASS: Record<DemoStatus, string> = {
  passing: styles.statusDotPassing,
  failing: styles.statusDotFailing,
  undeployed: styles.statusDotUndeployed,
  unknown: styles.statusDotUnknown,
}

const STATUS_LABEL: Record<DemoStatus, string> = {
  passing: 'Status: passing',
  failing: 'Status: failing',
  undeployed: 'Status: undeployed',
  unknown: 'Status: unknown',
}

export function Sidebar({
  demos,
  activeDemoId,
  onSelect,
  showStatus,
  onShowStatusChange,
}: Props) {
  return (
    <nav className={styles.sidebar} aria-label="Demos">
      <div className={styles.brand}>
        <img src="/favicon.ico" alt="" className={styles.brandLogo} />
        <span>Apigee Superdemo</span>
      </div>
      {demos.length === 0 && (
        <div className={styles.empty}>No demos deployed yet.</div>
      )}
      {demos.map((demo) => {
        const isActive = demo.id === activeDemoId
        return (
          <button
            key={demo.id}
            type="button"
            className={`${styles.item} ${isActive ? styles.itemActive : ''}`}
            aria-current={isActive ? 'page' : undefined}
            onClick={() => onSelect(demo.id)}
          >
            <span className={styles.icon} aria-hidden="true">
              {demo.icon}
            </span>
            <span>{demo.title}</span>
            {showStatus && (
              <span
                className={`${styles.statusDot} ${STATUS_DOT_CLASS[demo.status]}`}
                aria-label={STATUS_LABEL[demo.status]}
                title={STATUS_LABEL[demo.status]}
              />
            )}
          </button>
        )
      })}
      <div className={styles.spacer} />
      <label className={styles.footer}>
        <span>Show demo status</span>
        <input
          type="checkbox"
          role="switch"
          className={styles.toggle}
          checked={showStatus}
          onChange={(e) => onShowStatusChange(e.target.checked)}
          aria-label="Show demo status"
        />
      </label>
    </nav>
  )
}
