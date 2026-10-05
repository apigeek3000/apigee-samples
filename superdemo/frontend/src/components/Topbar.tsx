import { useEffect, useRef, useState } from 'react'
import type { DemoMetadata } from '../types'
import styles from './Topbar.module.css'

interface Props {
  isSidebarCollapsed: boolean
  onToggleSidebar: () => void
  activeDemo: DemoMetadata | null
  onNavigateHome: () => void
  userEmail?: string
  /** Display name and photo from the Firebase user, when present. */
  userName?: string
  userPhotoUrl?: string
  onSignOut?: () => void
  /** When set, shows a small "Users" link (admins only). */
  onOpenUsers?: () => void
  /** True while the Users page is showing; adds a "Users" breadcrumb. */
  showingUsers?: boolean
}

export function Topbar({
  isSidebarCollapsed,
  onToggleSidebar,
  activeDemo,
  onNavigateHome,
  userEmail,
  userName,
  userPhotoUrl,
  onSignOut,
  onOpenUsers,
  showingUsers,
}: Props) {
  const [menuOpen, setMenuOpen] = useState(false)
  const [photoFailed, setPhotoFailed] = useState(false)
  const accountRef = useRef<HTMLDivElement>(null)

  // A new photo URL (e.g. a different user) gets a fresh chance to load.
  useEffect(() => setPhotoFailed(false), [userPhotoUrl])

  // Close the menu on an outside click or Escape.
  useEffect(() => {
    if (!menuOpen) return
    const onPointerDown = (e: MouseEvent) => {
      if (!accountRef.current?.contains(e.target as Node)) setMenuOpen(false)
    }
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    document.addEventListener('mousedown', onPointerDown)
    document.addEventListener('keydown', onKeyDown)
    return () => {
      document.removeEventListener('mousedown', onPointerDown)
      document.removeEventListener('keydown', onKeyDown)
    }
  }, [menuOpen])

  const initial = (userName || userEmail || '').trim().charAt(0).toUpperCase()
  const showPhoto = Boolean(userPhotoUrl) && !photoFailed

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
          className={`${styles.crumb} ${!activeDemo && !showingUsers ? styles.crumbActive : ''}`}
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

        {showingUsers && (
          <>
            <span className={styles.separator}>/</span>
            <span className={`${styles.crumb} ${styles.crumbActive}`}>Users</span>
          </>
        )}
      </div>

      {(userEmail || onOpenUsers) && (
        <div className={styles.account} ref={accountRef}>
          <button
            type="button"
            className={styles.avatarBtn}
            onClick={() => setMenuOpen((open) => !open)}
            aria-label="Account menu"
            aria-haspopup="true"
            aria-expanded={menuOpen}
            title={userEmail}
          >
            {showPhoto ? (
              <img
                src={userPhotoUrl}
                alt=""
                className={styles.avatarImg}
                referrerPolicy="no-referrer"
                onError={() => setPhotoFailed(true)}
              />
            ) : initial ? (
              <span className={styles.avatarInitial} aria-hidden="true">{initial}</span>
            ) : (
              <svg className={styles.avatarIcon} viewBox="0 0 24 24" aria-hidden="true">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 20c0-4 3.6-6 8-6s8 2 8 6" />
              </svg>
            )}
          </button>

          {menuOpen && (
            <div className={styles.menu}>
              {(userName || userEmail) && (
                <div className={styles.menuHeader}>
                  {userName && <div className={styles.menuName}>{userName}</div>}
                  {userEmail && <div className={styles.menuEmail}>{userEmail}</div>}
                </div>
              )}
              {onOpenUsers && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false)
                    onOpenUsers()
                  }}
                >
                  Users
                </button>
              )}
              {userEmail && onSignOut && (
                <button
                  type="button"
                  className={styles.menuItem}
                  onClick={() => {
                    setMenuOpen(false)
                    onSignOut()
                  }}
                >
                  Sign out
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </header>
  )
}
