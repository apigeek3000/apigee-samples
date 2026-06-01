import { useState } from 'react'
import { sendBasicQuota } from '../api'
import type { ApiError, QuotaResponse, QuotaTier } from '../types'
import { MoreInfo } from './MoreInfo'
import { ResponseCard } from './ResponseCard'
import { demoInfo } from '../demoInfo'
import styles from './BasicQuotaDemo.module.css'

export function BasicQuotaDemo() {
  const [tier, setTier] = useState<QuotaTier>('trial')
  const [loading, setLoading] = useState(false)
  const [result, setResult] = useState<QuotaResponse | null>(null)
  const [error, setError] = useState<ApiError | null>(null)

  async function handleSend() {
    setLoading(true)
    setError(null)
    try {
      const next = await sendBasicQuota(tier)
      setResult(next)
    } catch (e) {
      setError(e as ApiError)
      setResult(null)
    } finally {
      setLoading(false)
    }
  }

  const limit = result?.quotaLimit ?? 0
  const count = result?.quotaCount ?? 0
  const pct = limit > 0 ? Math.min(100, (count / limit) * 100) : 0
  const overLimit = limit > 0 && count > limit

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>Basic Quota</h2>
        <p>
          Sends a request to the <code>basic-quota</code> Apigee proxy. Trial
          tier allows 10 req/min; premium tier allows 1000 req/hour. Switch
          tier to see Apigee enforce different limits using the same proxy.
        </p>
      </header>

      <div className={styles.controls}>
        <div className={styles.tier} role="group" aria-label="Tier">
          {(['trial', 'premium'] as QuotaTier[]).map((t) => (
            <button
              key={t}
              type="button"
              aria-pressed={tier === t}
              onClick={() => setTier(t)}
            >
              {t === 'trial' ? 'Trial' : 'Premium'}
            </button>
          ))}
        </div>
        <button
          type="button"
          className={styles.send}
          onClick={handleSend}
          disabled={loading}
        >
          {loading ? 'Sending…' : 'Send Request'}
        </button>
      </div>

      {result && (
        <div className={styles.counters}>
          <div className={styles.counter}>
            <div className={styles.counterLabel}>Counter</div>
            <div className={styles.counterValue}>
              {result.quotaCount ?? '—'}
            </div>
          </div>
          <div className={styles.counter}>
            <div className={styles.counterLabel}>Limit</div>
            <div className={styles.counterValue}>
              {result.quotaLimit ?? '—'}
            </div>
            {limit > 0 && (
              <div className={styles.bar} aria-hidden="true">
                <div
                  className={`${styles.barFill} ${
                    overLimit ? styles.barFillOver : ''
                  }`}
                  style={{ width: `${pct}%` }}
                />
              </div>
            )}
          </div>
        </div>
      )}

      <ResponseCard
        title={`Response (tier: ${tier})`}
        payload={result?.raw}
        error={error}
      />

      <MoreInfo {...demoInfo['basic-quota']} />
    </div>
  )
}
