import { useState } from 'react'
import { sendCircuitBreaking } from '../api'
import { apigeeProxyLinks, demoInfo } from '../demoInfo'
import type {
  CircuitBreakingResponse,
  DemoMetadata,
  DemosResponse,
} from '../types'
import { MoreInfo } from './MoreInfo'
import styles from './LlmCircuitBreakingDemo.module.css'

interface Props {
  demos: DemosResponse
  demo: DemoMetadata
}

const DEFAULT_PROMPT = 'Why is the sky blue?'

// One more than the failover threshold. The quota ALLOWS 2 failures in the
// window, so it is the 3rd that trips it — sending exactly 2 leaves the breaker
// closed.
const BREAK_REQUESTS = 3

// Vertex AI 404s a model it does not publish, every time, in every region. The
// primary target's FaultRule counts any status above 399 exactly as it counts a
// 429, so this opens the breaker deterministically — unlike request volume,
// which cannot, because Gemini 2.5 is served under dynamic shared quota and has
// no per-project limit to exceed.
const MISSING_MODEL = 'gemini-does-not-exist'

interface Attempt extends CircuitBreakingResponse {
  n: number
}

/**
 * The breaker's counter lives in Apigee and we cannot read it. What we can read
 * is which pool served each request, and a *successful* call is the honest
 * signal: the RouteRule only sends a healthy request to secondary when the
 * breaker is open. A failed call reaching secondary proves nothing about the
 * breaker — the FaultRule retries every failure there regardless.
 */
function breakerState(attempts: Attempt[]): 'open' | 'closed' | 'unknown' {
  const lastOk = [...attempts].reverse().find((a) => a.httpStatus < 400)
  if (!lastOk || lastOk.targetPool === 'unknown') return 'unknown'
  return lastOk.targetPool === 'secondary' ? 'open' : 'closed'
}

function routeLabel(a: Attempt): string {
  if (a.targetPool === 'unknown') return ''
  if (a.targetPool === 'primary') return 'routed to primary'
  return a.httpStatus >= 400
    ? 'retried into secondary by the FaultRule'
    : 'routed to secondary — breaker is open'
}

export function LlmCircuitBreakingDemo({ demos, demo }: Props) {
  const threshold = demo.failover_threshold ?? 2
  const windowMinutes = demo.window_minutes ?? 2
  const model = demo.model ?? 'gemini-2.5-flash'
  const region = demo.primary_region ?? 'us-central1'
  const projectId = demos.project_id ?? ''

  const [prompt, setPrompt] = useState(DEFAULT_PROMPT)
  const [attempts, setAttempts] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(false)

  async function send(times: number, requestModel: string = model) {
    setLoading(true)
    try {
      const results = await Promise.all(
        Array.from({ length: times }, () =>
          sendCircuitBreaking({
            prompt,
            projectId,
            region,
            model: requestModel,
          }),
        ),
      )
      setAttempts((prev) => [
        ...prev,
        ...results.map((result, i) => ({ ...result, n: prev.length + i + 1 })),
      ])
    } finally {
      setLoading(false)
    }
  }

  const state = breakerState(attempts)

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>
          <span aria-hidden="true">{demo.icon}</span> {demo.title}
        </h2>
        <p>{demo.description}</p>
      </header>

      <section className={styles.panel}>
        <div className={styles.stateBar}>
          <span
            data-testid="breaker-state"
            className={
              state === 'open'
                ? styles.stateOpen
                : state === 'closed'
                  ? styles.stateClosed
                  : styles.stateUnknown
            }
          >
            breaker: {state}
          </span>
          <span className={styles.stateHint}>
            {state === 'open'
              ? `primary is out of rotation — traffic goes to ${demo.secondary_region ?? 'the secondary region'} until the ${windowMinutes}-minute window rolls off`
              : state === 'closed'
                ? `primary (${region}) is healthy and serving traffic`
                : 'send a request to see which pool serves it'}
          </span>
        </div>

        <div className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>Watch the breaker</h3>
          <p className={styles.panelSubtitle}>
            Traffic goes to <code>{region}</code>. The breaker counts{' '}
            <strong>upstream failures</strong>, not requests: once Vertex AI
            returns {threshold} errors within {windowMinutes} minutes, the
            RouteRule parks traffic on{' '}
            <code>{demo.secondary_region ?? 'the secondary region'}</code> until
            the window rolls off.
          </p>
        </div>

        <div className={styles.custom}>
          <input
            type="text"
            aria-label="Prompt"
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
          />
          <button
            type="button"
            className={styles.send}
            disabled={loading || !prompt}
            onClick={() => send(1)}
          >
            Send
          </button>
          <button
            type="button"
            className={styles.breakBtn}
            disabled={loading}
            onClick={() => send(BREAK_REQUESTS, MISSING_MODEL)}
          >
            Break the Circuit ({BREAK_REQUESTS})
          </button>
          {attempts.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => setAttempts([])}
            >
              Reset
            </button>
          )}
        </div>

        <ol className={styles.attempts}>
          {attempts.map((a) => (
            <li key={a.n} className={styles.attempt}>
              <span className={styles.attemptNum}>#{a.n}</span>
              <span
                data-testid="target-pool-badge"
                className={
                  a.targetPool === 'secondary'
                    ? styles.badgeSecondary
                    : a.targetPool === 'primary'
                      ? styles.badgePrimary
                      : styles.badgeUnknown
                }
              >
                {a.targetPool}
              </span>
              <span className={styles.attemptMeta}>
                {a.targetRegion ?? '--'} · HTTP {a.httpStatus} · {a.latencyMs}ms
              </span>
              <span className={styles.attemptLabel}>{routeLabel(a)}</span>
              <span className={styles.attemptText}>{a.text}</span>
            </li>
          ))}
        </ol>

        {/* Only a SUCCESSFUL response missing the header implicates the patch.
            An error response can lose it for other reasons, and claiming
            "unpatched" there sends you chasing a deploy that is in fact fine. */}
        {attempts.some(
          (a) => a.targetPool === 'unknown' && a.httpStatus < 400,
        ) && (
          <p className={styles.warning}>
            A successful response came back with no <code>x-target-pool</code>{' '}
            header. The proxy is running an unpatched revision — re-run{' '}
            <code>deploy-superdemo.sh</code>.
          </p>
        )}
      </section>

      <MoreInfo
        {...demoInfo['llm-circuit-breaking']}
        apigeeProxyLinks={apigeeProxyLinks('llm-circuit-breaking', demos.project_id)}
      />
    </div>
  )
}
