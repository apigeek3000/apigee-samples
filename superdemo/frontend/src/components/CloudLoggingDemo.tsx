import { useMemo, useState } from 'react'
import { fetchRecentLog, sendCloudLogging } from '../api'
import { apigeeProxyLinks, demoInfo } from '../demoInfo'
import type {
  ApiError,
  CloudLogEntry,
  CloudLoggingResponse,
  DemoMetadata,
  DemosResponse,
} from '../types'
import { MoreInfo } from './MoreInfo'
import styles from './CloudLoggingDemo.module.css'

interface Props {
  demos: DemosResponse
  demo: DemoMetadata
}

// Cloud Logging is eventually consistent: a freshly written entry can take
// tens of seconds to become queryable via the API. Poll long enough to absorb
// that latency rather than giving up after a few seconds.
const POLL_ATTEMPTS = 25
const POLL_INTERVAL_MS = 1000

export function CloudLoggingDemo({ demos, demo }: Props) {
  const [loading, setLoading] = useState(false)
  const [response, setResponse] = useState<CloudLoggingResponse | null>(null)
  const [entry, setEntry] = useState<CloudLogEntry | null>(null)
  const [polling, setPolling] = useState(false)
  const [pollExhausted, setPollExhausted] = useState(false)
  const [permissionError, setPermissionError] = useState<string | null>(null)

  const projectId = demos.project_id ?? ''
  const proxyName = demo.proxy_name ?? 'sample-cloud-logging'

  const deepLinkHref = useMemo(() => {
    if (!projectId) return null
    const filter = `logName="projects/${projectId}/logs/apigee" jsonPayload.proxy="${proxyName}"`
    return `https://console.cloud.google.com/logs/query;query=${encodeURIComponent(filter)}?project=${projectId}`
  }, [projectId, proxyName])

  async function pollForEntry(sentAt: string) {
    setPolling(true)
    setPollExhausted(false)
    setEntry(null)
    setPermissionError(null)

    for (let attempt = 0; attempt < POLL_ATTEMPTS; attempt++) {
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
      try {
        const result = await fetchRecentLog(sentAt)
        if (result.entry) {
          setEntry(result.entry)
          setPolling(false)
          return
        }
      } catch (e) {
        const apiErr = e as ApiError
        if (apiErr.status === 403) {
          setPermissionError(apiErr.message)
        } else {
          setPermissionError(`Failed to fetch log entry: ${apiErr.message}`)
        }
        setPolling(false)
        return
      }
    }

    setPolling(false)
    setPollExhausted(true)
  }

  async function handleSend() {
    setLoading(true)
    setResponse(null)
    setEntry(null)
    setPollExhausted(false)
    setPermissionError(null)
    try {
      const r = await sendCloudLogging()
      setResponse(r)
      void pollForEntry(r.sentAt)
    } finally {
      setLoading(false)
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

      <div className={styles.controls}>
        <button
          type="button"
          className={styles.send}
          onClick={handleSend}
          disabled={loading}
        >
          {loading ? 'Sending…' : 'Send Request'}
        </button>
      </div>

      <div className={styles.cards}>
        <section className={styles.card}>
          <h3 className={styles.cardTitle}>Response</h3>
          {response ? (
            <>
              <div className={styles.statusLine}>HTTP {response.httpStatus}</div>
              <pre className={styles.responseCard}>
                {typeof response.body === 'string'
                  ? response.body
                  : JSON.stringify(response.body, null, 2)}
              </pre>
            </>
          ) : (
            <div className={styles.statusLine}>No request sent yet.</div>
          )}
        </section>

        <section className={styles.card}>
          <h3 className={styles.cardTitle}>Cloud Logging</h3>
          {deepLinkHref && (
            <a
              className={styles.deepLinkButton}
              href={deepLinkHref}
              target="_blank"
              rel="noreferrer noopener"
            >
              Open in Logs Explorer
            </a>
          )}
          {polling && (
            <div className={styles.statusLine}>Waiting for log entry…</div>
          )}
          {entry && (
            <pre className={styles.responseCard}>
              {JSON.stringify(entry.jsonPayload, null, 2)}
            </pre>
          )}
          {pollExhausted && !entry && (
            <div className={styles.statusLine}>
              Log not yet visible — refresh in Logs Explorer.
            </div>
          )}
          {permissionError && (
            <div className={styles.errorLine}>{permissionError}</div>
          )}
        </section>
      </div>

      <MoreInfo
        {...demoInfo['cloud-logging']}
        apigeeProxyLinks={apigeeProxyLinks('cloud-logging', demos.project_id)}
      />
    </div>
  )
}
