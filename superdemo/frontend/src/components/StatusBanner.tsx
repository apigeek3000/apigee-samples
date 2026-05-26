import type { DemosResponse } from '../types'
import styles from './StatusBanner.module.css'

interface Props {
  demos: DemosResponse | null
  error: string | null
}

export function StatusBanner({ demos, error }: Props) {
  if (error) {
    return (
      <div className={`${styles.banner} ${styles.bannerError}`}>
        <span>
          <span className={`${styles.dot} ${styles.dotError}`} />
          {error}
        </span>
      </div>
    )
  }

  if (!demos) {
    return (
      <div className={styles.banner}>
        <span>
          <span className={styles.dot} />
          Loading backend status…
        </span>
      </div>
    )
  }

  if (demos.status !== 'ready') {
    return (
      <div className={`${styles.banner} ${styles.bannerWarning}`}>
        <span>
          <span className={`${styles.dot} ${styles.dotWarning}`} />
          Backend reachable but unconfigured. Run{' '}
          <code>./superdemo/deploy/deploy-superdemo.sh</code> to populate Secret
          Manager.
        </span>
      </div>
    )
  }

  return (
    <div className={`${styles.banner} ${styles.bannerReady}`}>
      <span>
        <span className={`${styles.dot} ${styles.dotReady}`} />
        Connected to Apigee
      </span>
      <span className={styles.meta}>
        {demos.host} · {demos.project_id}
      </span>
    </div>
  )
}
