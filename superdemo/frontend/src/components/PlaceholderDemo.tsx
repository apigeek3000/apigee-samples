import type { DemoMetadata } from '../types'
import styles from './PlaceholderDemo.module.css'

interface Props {
  demo: DemoMetadata
}

export function PlaceholderDemo({ demo }: Props) {
  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>
          <span className={styles.icon} aria-hidden="true">{demo.icon}</span>
          <span>{demo.title}</span>
          <span className={styles.badge}>Not yet implemented</span>
        </h2>
        <p>{demo.description}</p>
      </header>
      <p className={styles.body}>
        This demo isn't wired up in the superdemo wrapper yet. The underlying
        Apigee proxy exists in this repo and may be deployed independently.
      </p>
    </div>
  )
}
