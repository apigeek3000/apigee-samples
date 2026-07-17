import { useState } from 'react'
import { sendSemanticCache } from '../api'
import { apigeeProxyLinks, demoInfo } from '../demoInfo'
import type { DemoMetadata, DemosResponse, SemanticCacheResponse } from '../types'
import { MoreInfo } from './MoreInfo'
import styles from './LlmSemanticCacheDemo.module.css'

interface Props {
  demos: DemosResponse
  demo: DemoMetadata
}

const BASE_PROMPT = 'What is the deadline to file my taxes?'

// Semantically similar rewordings of BASE_PROMPT. After the base prompt
// populates the cache, sending one of these should return from Apigee's
// semantic cache (far faster) because their embeddings land within the
// similarity threshold.
const SIMILAR_PROMPTS = [
  "What's the deadline for filing my taxes?",
  'What is the due date to file my taxes?',
  'When is the deadline to file my taxes?',
]

interface Attempt {
  n: number
  prompt: string
  latencyMs: number
  httpStatus: number
  text: string
}

export function LlmSemanticCacheDemo({ demos, demo }: Props) {
  const projectId = demos.project_id ?? ''
  const region = demo.region ?? ''
  const model = demo.model ?? ''
  const missingConfig = !projectId || !region || !model

  const [prompt, setPrompt] = useState(BASE_PROMPT)
  const [history, setHistory] = useState<Attempt[]>([])
  const [loading, setLoading] = useState(false)

  async function send() {
    const text = prompt.trim()
    if (!text || loading || missingConfig) return
    setLoading(true)
    try {
      const res: SemanticCacheResponse = await sendSemanticCache({
        prompt: text,
        projectId,
        region,
        model,
      })
      setHistory((prev) => [
        ...prev,
        {
          n: prev.length + 1,
          prompt: text,
          latencyMs: res.latencyMs,
          httpStatus: res.httpStatus,
          text: res.text,
        },
      ])
    } finally {
      setLoading(false)
    }
  }

  // The first call pays full model latency and populates the cache; later
  // calls are compared against it. We only ever claim time SAVED (never lost),
  // so a slower-than-baseline call contributes zero.
  const baseline = history[0]?.latencyMs
  const timeSavedMs =
    baseline === undefined
      ? 0
      : history
          .slice(1)
          .reduce((acc, a) => acc + Math.max(0, baseline - a.latencyMs), 0)

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>
          <span aria-hidden="true">{demo.icon}</span> {demo.title}
        </h2>
        <p>{demo.description}</p>
      </header>

      <section className={styles.panel}>
        <div className={styles.configBar}>
          {missingConfig
            ? 'Config missing — run deploy-superdemo.sh'
            : `${model} · ${region} · embeddings ${demo.embeddings_model ?? '—'} · threshold ${demo.similarity_threshold ?? '—'} · TTL ${demo.ttl_seconds ?? '—'}s`}
        </div>

        <p className={styles.hint}>
          Send the base question once to populate the cache, then send a
          reworded version. A semantically similar prompt comes back from
          Apigee's cache — watch the latency drop.
        </p>

        <div className={styles.presets}>
          {[BASE_PROMPT, ...SIMILAR_PROMPTS].map((p) => (
            <button
              key={p}
              type="button"
              className={styles.chip}
              disabled={loading}
              onClick={() => setPrompt(p)}
            >
              {p}
            </button>
          ))}
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
            disabled={loading || !prompt.trim() || missingConfig}
            onClick={() => void send()}
          >
            {loading ? 'Sending…' : 'Send'}
          </button>
          {history.length > 0 && (
            <button
              type="button"
              disabled={loading}
              onClick={() => setHistory([])}
            >
              Reset
            </button>
          )}
        </div>

        {history.length > 0 && (
          <div className={styles.summary} data-testid="time-saved">
            {history.length} request{history.length === 1 ? '' : 's'} · ~
            {timeSavedMs}ms saved vs. the first (uncached) call
          </div>
        )}

        <ol className={styles.attempts}>
          {history.map((a) => (
            <li key={a.n} className={styles.attempt} data-testid="history-item">
              <span className={styles.attemptNum}>#{a.n}</span>
              <span className={styles.latency}>{a.latencyMs}ms</span>
              <span className={styles.attemptPrompt}>{a.prompt}</span>
              <span className={styles.attemptText}>{a.text}</span>
            </li>
          ))}
        </ol>
      </section>

      <MoreInfo
        {...demoInfo['llm-semantic-cache-v2']}
        apigeeProxyLinks={apigeeProxyLinks('llm-semantic-cache-v2', demos.project_id)}
      />
    </div>
  )
}
