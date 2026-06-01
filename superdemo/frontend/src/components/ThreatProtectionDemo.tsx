import { useState } from 'react'
import { sendThreatJson, sendThreatRegex } from '../api'
import type { DemoMetadata, ThreatResponse } from '../types'
import styles from './ThreatProtectionDemo.module.css'

interface Props {
  demo: DemoMetadata
}

const JSON_5_KEY = { f1: 't1', f2: 't2', f3: 't3', f4: 't4', f5: 't5' }
const JSON_6_KEY = { f1: 't1', f2: 't2', f3: 't3', f4: 't4', f5: 't5', f6: 't6' }

export function ThreatProtectionDemo({ demo }: Props) {
  const blockedKeywords = demo.blocked_keywords ?? []
  const maxKeys = demo.max_json_object_keys ?? 5

  // RegEx panel state
  const [regexInput, setRegexInput] = useState('')
  const [regexResult, setRegexResult] = useState<ThreatResponse | null>(null)
  const [regexLoading, setRegexLoading] = useState(false)

  // JSON panel state
  const [jsonInput, setJsonInput] = useState('{\n  "f1": "t1",\n  "f2": "t2"\n}')
  const [jsonResult, setJsonResult] = useState<ThreatResponse | null>(null)
  const [jsonLoading, setJsonLoading] = useState(false)
  const [jsonValidationError, setJsonValidationError] = useState<string | null>(null)

  async function runRegex(query: string) {
    setRegexInput(query)
    setRegexLoading(true)
    try {
      const r = await sendThreatRegex(query)
      setRegexResult(r)
    } finally {
      setRegexLoading(false)
    }
  }

  async function runJson(payload: object) {
    setJsonInput(JSON.stringify(payload, null, 2))
    setJsonLoading(true)
    setJsonValidationError(null)
    try {
      const r = await sendThreatJson(payload)
      setJsonResult(r)
    } finally {
      setJsonLoading(false)
    }
  }

  async function handleJsonCustomSend() {
    let parsed: object
    try {
      parsed = JSON.parse(jsonInput)
    } catch (e) {
      setJsonValidationError(
        `Invalid JSON: ${e instanceof Error ? e.message : String(e)}`,
      )
      return
    }
    await runJson(parsed)
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>
          <span aria-hidden="true">{demo.icon}</span> {demo.title}
        </h2>
        <p>{demo.description}</p>
      </header>

      {/* RegEx panel */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>RegularExpressionProtection — GET /json</h3>
          <p className={styles.panelSubtitle}>
            Blocks query values matching SQL keywords. Match → HTTP 500.
          </p>
        </div>

        {blockedKeywords.length > 0 && (
          <div className={styles.chips} aria-label="Blocked keywords">
            {blockedKeywords.map((kw) => (
              <code key={kw}>{kw}</code>
            ))}
          </div>
        )}

        <div className={styles.presets}>
          <button type="button" onClick={() => runRegex('select')}>select</button>
          <button type="button" onClick={() => runRegex('delete')}>delete</button>
          <button type="button" onClick={() => runRegex('drop table users')}>
            drop table users
          </button>
        </div>

        <div className={styles.custom}>
          <input
            type="text"
            aria-label="RegEx custom query"
            placeholder="Type a query value…"
            value={regexInput}
            onChange={(e) => setRegexInput(e.target.value)}
          />
          <button
            type="button"
            className={styles.send}
            aria-label="Send RegEx query"
            disabled={regexLoading || !regexInput}
            onClick={() => runRegex(regexInput)}
          >
            Send
          </button>
        </div>

        {regexResult && <ResultBlock result={regexResult} />}
      </section>

      {/* JSON Threat panel */}
      <section className={styles.panel}>
        <div className={styles.panelHeader}>
          <h3 className={styles.panelTitle}>JSONThreatProtection — POST /echo</h3>
          <p className={styles.panelSubtitle}>
            JSONThreatProtection limit: {maxKeys} entries. More → HTTP 500.
          </p>
        </div>

        <div className={styles.presets}>
          <button type="button" onClick={() => runJson(JSON_5_KEY)}>5-key body</button>
          <button type="button" onClick={() => runJson(JSON_6_KEY)}>6-key body</button>
        </div>

        <div className={styles.custom}>
          <textarea
            aria-label="JSON custom payload"
            value={jsonInput}
            onChange={(e) => setJsonInput(e.target.value)}
          />
          <button
            type="button"
            className={styles.send}
            aria-label="Send JSON payload"
            disabled={jsonLoading}
            onClick={handleJsonCustomSend}
          >
            Send
          </button>
        </div>

        {jsonValidationError && (
          <div className={styles.validationError}>{jsonValidationError}</div>
        )}

        {jsonResult && <ResultBlock result={jsonResult} />}
      </section>
    </div>
  )
}

function ResultBlock({ result }: { result: ThreatResponse }) {
  const badgeClass = result.blocked ? styles.badgeBlocked : styles.badgeAllowed
  const badgeText = result.blocked ? 'BLOCKED' : 'ALLOWED'
  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <span className={badgeClass}>{badgeText}</span>{' '}
        <span style={{ color: 'var(--text-dim)', fontSize: 12 }}>
          HTTP {result.httpStatus}
        </span>
      </div>
      <pre className={styles.responseCard}>
        {typeof result.body === 'string'
          ? result.body
          : JSON.stringify(result.body, null, 2)}
      </pre>
    </div>
  )
}
