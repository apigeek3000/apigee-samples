import {
  forwardRef,
  useImperativeHandle,
  useRef,
  useState,
} from 'react'
import { sendLlmRateLimiting } from '../api'
import type {
  ApiError,
  RateLimitTier,
  RateLimitTurn,
  VertexContent,
} from '../types'
import { TokenMeter } from './TokenMeter'
import styles from './RateLimitPane.module.css'

export interface RateLimitPaneHandle {
  send(prompt: string): Promise<{ ok: boolean; httpStatus?: number }>
  setBurstProgress(current: number, total: number): void
  clearBurstProgress(): void
}

interface Props {
  tier: RateLimitTier
  label: string
  limit: number | undefined
  projectId: string
  region: string
  model: string
}

let TURN_ID = 0
function nextId(): string {
  TURN_ID += 1
  return `turn-${TURN_ID}`
}

export const RateLimitPane = forwardRef<RateLimitPaneHandle, Props>(
  function RateLimitPane(
    { tier, label, limit, projectId, region, model },
    ref,
  ) {
    const [turns, setTurns] = useState<RateLimitTurn[]>([])
    const [cumulativeTotal, setCumulativeTotal] = useState(0)
    const [loading, setLoading] = useState(false)
    const [burst, setBurst] = useState<{ current: number; total: number } | null>(null)

    const turnsRef = useRef<RateLimitTurn[]>([])
    turnsRef.current = turns
    const loadingRef = useRef(false)

    useImperativeHandle(ref, () => ({
      async send(prompt) {
        if (loadingRef.current) {
          return { ok: false }
        }
        loadingRef.current = true
        const userTurn: RateLimitTurn = {
          id: nextId(),
          role: 'user',
          text: prompt,
        }
        setTurns((prev) => [...prev, userTurn])
        setLoading(true)
        try {
          const contents: VertexContent[] = [
            ...turnsRef.current
              .filter((t) => t.role === 'user' || t.role === 'model')
              .map<VertexContent>((t) => ({
                role: t.role as 'user' | 'model',
                parts: [{ text: t.text }],
              })),
            { role: 'user', parts: [{ text: prompt }] },
          ]
          const result = await sendLlmRateLimiting({
            tier,
            contents,
            projectId,
            region,
            model,
          })
          setTurns((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'model',
              text: result.text,
              totalTokens: result.totalTokens,
            },
          ])
          if (typeof result.totalTokens === 'number') {
            setCumulativeTotal((n) => n + result.totalTokens!)
          }
          return { ok: true }
        } catch (e) {
          const err = e as ApiError
          const status = err?.status ?? 0
          const message =
            status === 429
              ? "Token limit reached — Apigee's 5-minute window will reset shortly."
              : `Request failed (${status || 'network'}): ${err?.message ?? ''}`
          setTurns((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'error',
              text: message,
              httpStatus: status || undefined,
            },
          ])
          return { ok: false, httpStatus: status || undefined }
        } finally {
          loadingRef.current = false
          setLoading(false)
        }
      },
      setBurstProgress(current, total) {
        setBurst({ current, total })
      },
      clearBurstProgress() {
        setBurst(null)
      },
    }))

    function handleClearConversation() {
      setTurns([])
    }

    function handleResetMeter() {
      setCumulativeTotal(0)
    }

    return (
      <section className={styles.wrap} aria-label={label}>
        <header className={styles.head}>
          <span
            className={`${styles.tierBadge} ${
              tier === 'bronze' ? styles.tierBronze : styles.tierSilver
            }`}
          >
            {label}
          </span>
          <div className={styles.actions}>
            {burst && (
              <span className={styles.burstChip}>
                Burst: {burst.current}/{burst.total}
              </span>
            )}
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleClearConversation}
              disabled={loading}
            >
              Clear conversation
            </button>
            <button
              type="button"
              className={styles.actionBtn}
              onClick={handleResetMeter}
              disabled={loading}
              title="Apigee's 5-minute counter is independent of this view; this only clears the local tally."
            >
              Reset meter
            </button>
          </div>
        </header>

        <TokenMeter
          label={`${label} cumulative tokens`}
          used={cumulativeTotal}
          limit={limit}
        />

        <div className={styles.transcript} role="log" aria-live="polite">
          {turns.map((t) => {
            const klass =
              t.role === 'user'
                ? styles.turnUser
                : t.role === 'model'
                  ? styles.turnModel
                  : styles.turnError
            return (
              <div
                key={t.id}
                className={`${styles.turn} ${klass}`}
                role={t.role === 'error' ? 'alert' : undefined}
              >
                {t.text}
              </div>
            )
          })}
        </div>
      </section>
    )
  },
)
