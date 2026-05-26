import type { DemoMetadata } from '../types'
import styles from './Sidebar.module.css'

interface Props {
  demos: DemoMetadata[]
  activeDemoId: string | null
  onSelect: (id: string) => void
}

export function Sidebar({ demos, activeDemoId, onSelect }: Props) {
  return (
    <nav className={styles.sidebar} aria-label="Demos">
      <div className={styles.brand}>Apigee Superdemo</div>
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
          </button>
        )
      })}
    </nav>
  )
}
