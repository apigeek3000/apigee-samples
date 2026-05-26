import type { ApiError } from '../types'
import styles from './ResponseCard.module.css'

interface Props {
  title: string
  payload?: unknown
  error?: ApiError | null
}

function formatBody(payload: unknown): string {
  if (payload === undefined || payload === null) return ''
  if (typeof payload === 'string') return payload
  try {
    return JSON.stringify(payload, null, 2)
  } catch {
    return String(payload)
  }
}

export function ResponseCard({ title, payload, error }: Props) {
  if (error) {
    return (
      <section className={`${styles.card} ${styles.cardError}`}>
        <div className={styles.title}>
          {title} · error {error.status}
        </div>
        <pre className={styles.body}>
          {error.message}
          {error.body !== undefined && error.body !== null
            ? '\n\n' + formatBody(error.body)
            : ''}
        </pre>
      </section>
    )
  }
  if (payload === undefined) return null
  return (
    <section className={styles.card}>
      <div className={styles.title}>{title}</div>
      <pre className={styles.body}>{formatBody(payload)}</pre>
    </section>
  )
}
