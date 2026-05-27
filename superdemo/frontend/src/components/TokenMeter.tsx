import styles from './TokenMeter.module.css'

interface Props {
  label: string
  used: number
  limit: number | undefined
}

export function TokenMeter({ label, used, limit }: Props) {
  const hasLimit = typeof limit === 'number' && limit > 0
  const pct = hasLimit ? Math.min(100, (used / limit!) * 100) : 0
  const overLimit = hasLimit && used >= limit!

  return (
    <div className={styles.wrap}>
      <div className={styles.head}>
        <span className={styles.label}>{label}</span>
        <span className={styles.numerals}>
          {hasLimit ? `${used} / ${limit}` : '-- / --'}
        </span>
      </div>
      <div className={styles.bar} aria-hidden="true">
        <div
          className={`${styles.barFill} ${overLimit ? styles.barFillOver : ''}`}
          data-testid="token-meter-bar"
          data-over-limit={overLimit ? 'true' : 'false'}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  )
}
