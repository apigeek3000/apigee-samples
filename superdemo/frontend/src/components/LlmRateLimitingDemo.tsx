import { useRef, useState } from 'react'
import type { DemoMetadata, DemosResponse } from '../types'
import { MoreInfo } from './MoreInfo'
import { RateLimitPane, type RateLimitPaneHandle } from './RateLimitPane'
import { demoInfo } from '../demoInfo'
import styles from './LlmRateLimitingDemo.module.css'

const BURST_PROMPTS = [
  'Why is the sky blue? Provide a very long and detailed explanation.',
  'Furnish an exhaustive and long explanation (as long as a science magazine article) for the phenomenon of the blue sky.',
  'Can you give me a really in-depth and as long as a book chapter of why the sky is blue?',
  'Give me a super detailed and very extensive explanation (as long as the yellow pages) of why the sky is blue.',
  'Can you tell me all about why the sky is blue, and make sure it is longer than a novel?',
]

interface Props {
  demos: DemosResponse
  demo: DemoMetadata
}

export function LlmRateLimitingDemo({ demos, demo }: Props) {
  const [prompt, setPrompt] = useState('')
  const [busy, setBusy] = useState(false)
  const [bursting, setBursting] = useState(false)

  const bronzeRef = useRef<RateLimitPaneHandle>(null)
  const silverRef = useRef<RateLimitPaneHandle>(null)

  const projectId = demos.project_id ?? ''
  const region = demo.region ?? ''
  const model = demo.model ?? ''
  const missingConfig = !projectId || !region || !model

  async function handleSend() {
    const text = prompt.trim()
    if (!text || busy || bursting) return
    setBusy(true)
    setPrompt('')
    try {
      await Promise.all([
        bronzeRef.current?.send(text) ?? Promise.resolve(),
        silverRef.current?.send(text) ?? Promise.resolve(),
      ])
    } finally {
      setBusy(false)
    }
  }

  async function handleBurst() {
    if (busy || bursting) return
    setBursting(true)
    try {
      await Promise.all([
        runBurst(bronzeRef.current),
        runBurst(silverRef.current),
      ])
    } finally {
      bronzeRef.current?.clearBurstProgress()
      silverRef.current?.clearBurstProgress()
      setBursting(false)
    }
  }

  async function runBurst(pane: RateLimitPaneHandle | null) {
    if (!pane) return
    for (let i = 0; i < BURST_PROMPTS.length; i++) {
      pane.setBurstProgress(i + 1, BURST_PROMPTS.length)
      const res = await pane.send(BURST_PROMPTS[i])
      if (!res.ok) return
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>LLM Rate Limiting</h2>
        <p>
          Sends one prompt to both bronze and silver tiers of the{' '}
          <code>llm-token-limits-v2</code>{' '}
          proxy in parallel. Bronze allows {demo.bronze_token_limit ?? '—'} tokens
          per {demo.interval_minutes ?? '—'} minutes; silver allows
          {' '}{demo.silver_token_limit ?? '—'}. Use "Trigger 429 burst" to fire
          five long pre-canned prompts and watch bronze hit the limit while
          silver keeps going.
        </p>
      </header>

      <div className={styles.panes}>
        <RateLimitPane
          ref={bronzeRef}
          tier="bronze"
          label="Bronze"
          limit={demo.bronze_token_limit}
          projectId={projectId}
          region={region}
          model={model}
        />
        <RateLimitPane
          ref={silverRef}
          tier="silver"
          label="Silver"
          limit={demo.silver_token_limit}
          projectId={projectId}
          region={region}
          model={model}
        />
      </div>

      <div className={styles.inputRow}>
        <textarea
          className={styles.textarea}
          aria-label="Prompt"
          value={prompt}
          onChange={(e) => setPrompt(e.target.value)}
          placeholder="Type a prompt — it will be sent to both tiers."
          disabled={busy || bursting}
        />
        <div className={styles.actions}>
          <div className={styles.meta}>
            {missingConfig
              ? 'Config missing — run deploy-superdemo.sh'
              : `${model} · ${region}`}
          </div>
          <div className={styles.btnGroup}>
            <button
              type="button"
              className={styles.burstBtn}
              onClick={handleBurst}
              disabled={busy || bursting || missingConfig}
            >
              {bursting ? 'Bursting…' : 'Trigger 429 burst'}
            </button>
            <button
              type="button"
              className={styles.sendBtn}
              onClick={handleSend}
              disabled={
                busy || bursting || missingConfig || !prompt.trim()
              }
            >
              {busy ? 'Sending…' : 'Send'}
            </button>
          </div>
        </div>
      </div>

      <MoreInfo {...demoInfo['llm-token-limits-v2']} />
    </div>
  )
}
