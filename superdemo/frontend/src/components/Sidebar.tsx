import type { DemoMetadata, DemoStatus } from '../types'
import { groupByCategory } from '../categories'
import { useCollapsedCategories } from '../hooks/useCollapsedCategories'
import styles from './Sidebar.module.css'

interface Props {
  demos: DemoMetadata[]
  activeDemoId: string | null
  onSelect: (id: string | null) => void
  showStatus: boolean
  onShowStatusChange: (next: boolean) => void
  isCollapsed?: boolean
}

const STATUS_DOT_CLASS: Record<DemoStatus, string> = {
  passing: styles.statusDotPassing,
  failing: styles.statusDotFailing,
  undeployed: styles.statusDotUndeployed,
  unknown: styles.statusDotUnknown,
  placeholder: styles.statusDotPlaceholder,
}

const STATUS_LABEL: Record<DemoStatus, string> = {
  passing: 'Status: passing',
  failing: 'Status: failing',
  undeployed: 'Status: undeployed',
  unknown: 'Status: unknown',
  placeholder: 'Status: not yet implemented',
}

export function Sidebar({
  demos,
  activeDemoId,
  onSelect,
  showStatus,
  onShowStatusChange,
  isCollapsed = false,
}: Props) {
  const groups = groupByCategory(demos)
  const [isCategoryCollapsed, toggleCategory] = useCollapsedCategories()

  return (
    <nav
      className={`${styles.sidebar} ${isCollapsed ? styles.collapsed : ''}`}
      aria-label="Demos"
      inert={isCollapsed ? '' : undefined}
    >
      <button
        type="button"
        className={styles.brand}
        onClick={() => onSelect(null)}
        aria-label="Apigee Superdemo home"
      >
        <img src="/favicon.ico" alt="" className={styles.brandLogo} />
        <span className={styles.brandName}>Apigee Superdemo</span>
      </button>

      <button
        type="button"
        className={`${styles.item} ${activeDemoId === null ? styles.itemActive : ''}`}
        aria-current={activeDemoId === null ? 'page' : undefined}
        onClick={() => onSelect(null)}
      >
        <span className={styles.icon} aria-hidden="true">
          🏠
        </span>
        <span>Home</span>
      </button>

      {demos.length === 0 && (
        <div className={styles.empty}>No demos deployed yet.</div>
      )}

      {groups.map(({ category, demos: groupDemos }) => {
        const collapsed = isCategoryCollapsed(category.id)
        return (
          <div key={category.id} className={styles.group}>
            <button
              type="button"
              className={styles.categoryHeader}
              aria-expanded={!collapsed}
              onClick={() => toggleCategory(category.id)}
            >
              <span
                className={`${styles.categoryChevron} ${
                  collapsed ? '' : styles.categoryChevronOpen
                }`}
                aria-hidden="true"
              >
                ▸
              </span>
              <span className={styles.categoryIcon} aria-hidden="true">
                {category.icon}
              </span>
              <span>{category.label}</span>
            </button>
            {!collapsed &&
              groupDemos.map((demo) => {
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
          </div>
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
