import type { DemoMetadata } from '../types'
import styles from './Topbar.module.css'

interface Props {
  isSidebarCollapsed: boolean
  onToggleSidebar: () => void
  activeDemo: DemoMetadata | null
  onNavigateHome: () => void
}

export function Topbar({
  isSidebarCollapsed,
  onToggleSidebar,
  activeDemo,
  onNavigateHome,
}: Props) {
  return (
    <header className={styles.topbar}>
      <button
        type="button"
        className={`${styles.toggleBtn} ${isSidebarCollapsed ? styles.toggleBtnCollapsed : ''}`}
        onClick={onToggleSidebar}
        aria-label={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={isSidebarCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      >
        <span className={styles.hamburgerLine} />
        <span className={styles.hamburgerLine} />
        <span className={styles.hamburgerLine} />
      </button>

      <div className={styles.breadcrumb}>
        {isSidebarCollapsed && (
          <button
            type="button"
            className={styles.brandLink}
            onClick={onNavigateHome}
            aria-label="Go to Home"
          >
            <img src="/favicon.ico" alt="" className={styles.logo} />
            <span className={styles.brandName}>Apigee Superdemo</span>
          </button>
        )}

        {isSidebarCollapsed && <span className={styles.separator}>/</span>}

        <button
          type="button"
          className={`${styles.crumb} ${!activeDemo ? styles.crumbActive : ''}`}
          onClick={onNavigateHome}
        >
          {!activeDemo ? 'Home' : 'Home'}
        </button>

        {activeDemo && (
          <>
            <span className={styles.separator}>/</span>
            <span className={`${styles.crumb} ${styles.crumbActive}`}>
              <span className={styles.demoIcon} aria-hidden="true">
                {activeDemo.icon}
              </span>
              <span>{activeDemo.title}</span>
            </span>
          </>
        )}
      </div>
    </header>
  )
}
