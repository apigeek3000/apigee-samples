import { useEffect, useRef, useState } from 'react'
import styles from './MoreInfo.module.css'

export interface PolicyLink {
  label: string
  href: string
}

export interface MoreInfoProps {
  diagram: string
  description: string
  policyLinks: PolicyLink[]
  githubHref: string
}

let mermaidIdSeq = 0
function nextMermaidId(): string {
  mermaidIdSeq += 1
  return `more-info-diagram-${mermaidIdSeq}`
}

type DiagramState =
  | { kind: 'pending' }
  | { kind: 'rendered'; svg: string }
  | { kind: 'failed' }

type Mermaid = typeof import('mermaid')['default']

let mermaidPromise: Promise<Mermaid> | null = null

function loadMermaid(): Promise<Mermaid> {
  if (!mermaidPromise) {
    mermaidPromise = import('mermaid').then((m) => {
      m.default.initialize({
        startOnLoad: false,
        theme: 'dark',
        securityLevel: 'strict',
      })
      return m.default
    })
  }
  return mermaidPromise
}

export function MoreInfo(props: MoreInfoProps) {
  const [opened, setOpened] = useState(false)
  const [diagram, setDiagram] = useState<DiagramState>({ kind: 'pending' })
  const renderStarted = useRef(false)
  const idRef = useRef<string>(nextMermaidId())

  // Once opened, stay opened — keeps mermaid from re-rendering.
  function handleToggle(e: React.SyntheticEvent<HTMLDetailsElement>) {
    if (e.currentTarget.open) setOpened(true)
  }

  // Diagram source is immutable per-instance (sourced from demoInfo.ts). Once we've started
  // a render, the renderStarted guard prevents the effect from re-firing.
  useEffect(() => {
    if (!opened || renderStarted.current) return
    renderStarted.current = true
    let cancelled = false
    ;(async () => {
      try {
        const mermaid = await loadMermaid()
        const { svg } = await mermaid.render(idRef.current, props.diagram)
        if (!cancelled) setDiagram({ kind: 'rendered', svg })
      } catch {
        if (!cancelled) setDiagram({ kind: 'failed' })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [opened, props.diagram])

  return (
    <details className={styles.details} onToggle={handleToggle}>
      <summary className={styles.summary}>
        <svg
          className={styles.chevron}
          viewBox="0 0 12 12"
          fill="none"
          aria-hidden="true"
        >
          <path d="M4 2 L8 6 L4 10" stroke="currentColor" strokeWidth="1.5" />
        </svg>
        More info
      </summary>

      {opened && (
        <div className={styles.body}>
          <div className={styles.diagram} aria-label="Architecture diagram">
            {diagram.kind === 'pending' && (
              <span className={styles.diagramPending}>Rendering diagram…</span>
            )}
            {diagram.kind === 'rendered' && (
              // SVG is mermaid's sanitized render output; input is developer-controlled via demoInfo.ts
              <div dangerouslySetInnerHTML={{ __html: diagram.svg }} />
            )}
            {diagram.kind === 'failed' && (
              <pre className={styles.diagramFallback}>{props.diagram}</pre>
            )}
          </div>

          <p className={styles.description}>{props.description}</p>

          <div className={styles.links}>
            <div>
              <div className={styles.linkGroupLabel}>Apigee policy docs</div>
              <div className={styles.linkRow}>
                {props.policyLinks.map((link) => (
                  <a
                    key={link.label}
                    className={styles.link}
                    href={link.href}
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    {link.label}
                  </a>
                ))}
              </div>
            </div>
            <div>
              <a
                className={styles.link}
                href={props.githubHref}
                target="_blank"
                rel="noopener noreferrer"
              >
                View this demo on GitHub →
              </a>
            </div>
          </div>
        </div>
      )}
    </details>
  )
}
