import { useState } from 'react'
import { sendPerUserTokenLimits } from '../api'
import { apigeeProxyLinks, demoInfo } from '../demoInfo'
import type {
  DemoMetadata,
  DemosResponse,
  PerUserId,
  PerUserResponse,
  RateLimitTier,
} from '../types'
import { MoreInfo } from './MoreInfo'
import { TokenMeter } from './TokenMeter'
import styles from './LlmTokenLimitsPerUserDemo.module.css'

interface Props {
  demos: DemosResponse
  demo: DemoMetadata
}

const USERS: { id: PerUserId; label: string }[] = [
  { id: 'alice', label: 'Alice' },
  { id: 'bob', label: 'Bob' },
]

const DEFAULT_PROMPT = 'Write a haiku about API gateways.'

export function LlmTokenLimitsPerUserDemo({ demos, demo }: Props) {
  const model = demo.model ?? 'gemini-2.5-flash'
  const region = demo.region ?? 'us-central1'
  const projectId = demos.project_id ?? ''
  const intervalMinutes = demo.interval_minutes ?? 5

  const [tier, setTier] = useState<RateLimitTier>('bronze')
  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [used, setUsed] = useState<Record<PerUserId, number>>({ alice: 0, bob: 0 })
  const [last, setLast] = useState<Record<PerUserId, PerUserResponse | null>>({
    alice: null,
    bob: null,
  })
  const [loading, setLoading] = useState<PerUserId | null>(null)

  const limit = tier === 'silver' ? demo.silver_token_limit : demo.bronze_token_limit

  function changeTier(next: RateLimitTier) {
    setTier(next)
    // The tally is per tier — switching tier means a different quota bucket.
    setUsed({ alice: 0, bob: 0 })
    setLast({ alice: null, bob: null })
  }

  async function send(userId: PerUserId) {
    setLoading(userId)
    try {
      const result = await sendPerUserTokenLimits({
        tier,
        userId,
        prompt,
        projectId,
        region,
        model,
      })
      setLast((prev) => ({ ...prev, [userId]: result }))
      if (result.totalTokens) {
        setUsed((prev) => ({
          ...prev,
          [userId]: prev[userId] + result.totalTokens!,
        }))
      }
    } finally {
      setLoading(null)
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>
          <span aria-hidden="true">{demo.icon}</span> {demo.title}
        </h2>
        <p>{demo.description}</p>
      </header>

      <section className={styles.panel}>
        <div className={styles.controls}>
          <div className={styles.tiers} role="group" aria-label="Tier">
            {(['bronze', 'silver'] as RateLimitTier[]).map((t) => (
              <button
                key={t}
                type="button"
                aria-pressed={tier === t}
                className={tier === t ? styles.tierActive : styles.tier}
                onClick={() => changeTier(t)}
              >
                {t}
              </button>
            ))}
          </div>
          <input
            type="text"
            aria-label="Prompt"
            className={styles.prompt}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
        </div>

        <p className={styles.panelSubtitle}>
          Both users send the <strong>same API key</strong>. The{' '}
          <code>{tier}</code> product allows {limit ?? '--'} tokens per{' '}
          {intervalMinutes} minutes, counted separately for each{' '}
          <code>x-userid</code>. Spend Alice&apos;s budget and she gets a 429 —
          Bob keeps working.
        </p>

        <div className={styles.panes}>
          {USERS.map((u) => (
            <div
              key={u.id}
              className={styles.pane}
              data-testid={`pane-${u.id}`}
            >
              <div className={styles.paneHead}>
                <h3 className={styles.paneTitle}>{u.label}</h3>
                <code className={styles.userId}>x-userid: {u.id}</code>
              </div>

              <TokenMeter label={`${tier} tokens`} used={used[u.id]} limit={limit} />

              <button
                type="button"
                className={styles.send}
                disabled={loading !== null || !prompt}
                onClick={() => send(u.id)}
              >
                {loading === u.id ? 'Sending…' : 'Send'}
              </button>

              {last[u.id] && (
                <div className={styles.result}>
                  <span
                    className={
                      last[u.id]!.quotaExceeded
                        ? styles.badgeBlocked
                        : styles.badgeAllowed
                    }
                  >
                    HTTP {last[u.id]!.httpStatus}
                  </span>
                  <pre className={styles.responseCard}>
                    {last[u.id]!.quotaExceeded
                      ? 'Token quota exhausted for this user.'
                      : last[u.id]!.text}
                  </pre>
                </div>
              )}
            </div>
          ))}
        </div>

        <p className={styles.caveat}>
          The meters are a <strong>client-side tally</strong> of each response&apos;s
          reported token count — the proxy does not return a remaining-quota
          header, and the tally resets if you reload. The authoritative signal is
          the 429.
        </p>
      </section>

      <MoreInfo
        {...demoInfo['llm-token-limits-per-user']}
        apigeeProxyLinks={apigeeProxyLinks(
          'llm-token-limits-per-user',
          demos.project_id,
        )}
      />
    </div>
  )
}
