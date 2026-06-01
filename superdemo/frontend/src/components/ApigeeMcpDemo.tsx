import { useEffect, useRef, useState } from 'react'
import type { DemoMetadata, McpTool, McpChatEvent } from '../types'
import { MoreInfo } from './MoreInfo'
import { fetchMcpTools, streamMcpChat } from '../api'
import { demoInfo } from '../demoInfo'
import styles from './ApigeeMcpDemo.module.css'

interface Props {
  demo: DemoMetadata
}

type DisplayMessage =
  | { kind: 'user'; text: string; id: string }
  | { kind: 'assistant'; text: string; id: string }
  | {
      kind: 'tool_call'
      callId: string
      name: string
      args: Record<string, unknown>
      id: string
    }
  | {
      kind: 'tool_result'
      callId: string
      isError: boolean
      body: string
      id: string
    }
  | { kind: 'error'; text: string; id: string }

const CANNED_PROMPTS = [
  'List recent customers',
  'Tell me about customer 1',
  'Create a customer named Acme Corp',
]

const SESSION_KEY = 'apigee-mcp-session'

function obtainSessionId(): string {
  const existing = sessionStorage.getItem(SESSION_KEY)
  if (existing) return existing
  const fresh = crypto.randomUUID()
  sessionStorage.setItem(SESSION_KEY, fresh)
  return fresh
}

let messageSeq = 0
function nextMessageId(): string {
  messageSeq += 1
  return `m-${messageSeq}`
}

export function ApigeeMcpDemo({ demo }: Props) {
  const [tools, setTools] = useState<McpTool[]>([])
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [toolsLoading, setToolsLoading] = useState(true)
  const [messages, setMessages] = useState<DisplayMessage[]>([])
  const [draft, setDraft] = useState('')
  const [sending, setSending] = useState(false)
  const sessionIdRef = useRef<string>('')

  if (!sessionIdRef.current) {
    sessionIdRef.current = obtainSessionId()
  }

  useEffect(() => {
    let cancelled = false
    fetchMcpTools()
      .then((next) => {
        if (!cancelled) setTools(next)
      })
      .catch((e: unknown) => {
        if (!cancelled) {
          setToolsError(
            e && typeof e === 'object' && 'message' in e
              ? String((e as { message: unknown }).message)
              : String(e),
          )
        }
      })
      .finally(() => {
        if (!cancelled) setToolsLoading(false)
      })
    return () => {
      cancelled = true
    }
  }, [])

  function appendMessage(msg: DisplayMessage) {
    setMessages((prev) => [...prev, msg])
  }

  function applyChatEvent(event: McpChatEvent) {
    switch (event.type) {
      case 'session_restarted':
        // The backend has no record of this session — either this is the first
        // message, or the backend restarted and lost its in-memory state. Drop
        // any stale history from the previous (now-gone) session, but KEEP the
        // message we're currently sending: it belongs to the fresh session and
        // a response is about to stream against it. Clearing unconditionally
        // here would wipe the user's very first message.
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          return last && last.kind === 'user' ? [last] : []
        })
        break
      case 'delta':
        setMessages((prev) => {
          const last = prev[prev.length - 1]
          if (last && last.kind === 'assistant') {
            const updated: DisplayMessage = { ...last, text: last.text + event.text }
            return [...prev.slice(0, -1), updated]
          }
          return [...prev, { kind: 'assistant', text: event.text, id: nextMessageId() }]
        })
        break
      case 'tool_call':
        appendMessage({
          kind: 'tool_call',
          callId: event.id,
          name: event.name,
          args: event.args,
          id: nextMessageId(),
        })
        break
      case 'tool_result':
        appendMessage({
          kind: 'tool_result',
          callId: event.id,
          isError: event.is_error,
          body: event.body,
          id: nextMessageId(),
        })
        break
      case 'error':
        appendMessage({ kind: 'error', text: event.message, id: nextMessageId() })
        break
      case 'done':
        break
    }
  }

  async function handleSend() {
    const prompt = draft.trim()
    if (!prompt || sending) return

    appendMessage({ kind: 'user', text: prompt, id: nextMessageId() })
    setDraft('')
    setSending(true)
    try {
      await streamMcpChat(sessionIdRef.current, prompt, applyChatEvent)
    } catch (e) {
      const message =
        e && typeof e === 'object' && 'message' in e
          ? String((e as { message: unknown }).message)
          : String(e)
      appendMessage({ kind: 'error', text: message, id: nextMessageId() })
    } finally {
      setSending(false)
    }
  }

  return (
    <div className={styles.wrap}>
      <header className={styles.header}>
        <h2>{demo.title}</h2>
        <p>{demo.description}</p>
      </header>

      <div className={styles.body}>
        <section className={styles.toolsPanel} aria-label="Discovered MCP tools">
          <h3 className={styles.toolsPanelHeading}>Discovered Tools</h3>
          {toolsError && <div className={styles.toolsEmpty}>{toolsError}</div>}
          {!toolsError && toolsLoading && (
            <div className={styles.toolsEmpty} role="status" aria-live="polite">
              Discovering tools…
            </div>
          )}
          {!toolsError && !toolsLoading && tools.length === 0 && (
            <div className={styles.toolsEmpty}>
              No tools discovered. Check API hub specs are published.
            </div>
          )}
          {tools.length > 0 && (
            <div className={styles.toolsGrid}>
              {tools.map((tool) => (
                <div key={tool.name} className={styles.toolItem}>
                  <div className={styles.toolName}>{tool.name}</div>
                  {tool.description && (
                    <div className={styles.toolDescription}>{tool.description}</div>
                  )}
                  {tool.openapi_op && (
                    <div className={styles.toolOp}>{tool.openapi_op}</div>
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className={styles.chat} aria-label="Chat">
          <div className={styles.messages} aria-live="polite">
            {messages.map((msg) => {
              if (msg.kind === 'user') {
                return (
                  <div key={msg.id} className={styles.bubbleUser}>
                    {msg.text}
                  </div>
                )
              }
              if (msg.kind === 'assistant') {
                return (
                  <div key={msg.id} className={styles.bubbleAssistant}>
                    {msg.text}
                  </div>
                )
              }
              if (msg.kind === 'tool_call') {
                return (
                  <div key={msg.id} className={styles.bubbleTool}>
                    → {msg.name}({JSON.stringify(msg.args)})
                  </div>
                )
              }
              if (msg.kind === 'tool_result') {
                return (
                  <div
                    key={msg.id}
                    className={`${styles.bubbleTool} ${
                      msg.isError ? styles.bubbleToolError : ''
                    }`}
                  >
                    ← {msg.body}
                  </div>
                )
              }
              return (
                <div
                  key={msg.id}
                  className={`${styles.bubbleTool} ${styles.bubbleToolError}`}
                >
                  ⚠ {msg.text}
                </div>
              )
            })}
          </div>
          <div className={styles.input}>
            <input
              type="text"
              placeholder="Ask the agent…"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') handleSend()
              }}
              aria-label="Prompt"
            />
            <button
              type="button"
              onClick={handleSend}
              disabled={sending || draft.trim() === ''}
            >
              {sending ? 'Sending…' : 'Send'}
            </button>
          </div>
          <div className={styles.suggested} aria-label="Suggested prompts">
            {CANNED_PROMPTS.map((prompt) => (
              <button
                key={prompt}
                type="button"
                onClick={() => setDraft(prompt)}
                disabled={sending}
              >
                {prompt}
              </button>
            ))}
          </div>
        </section>
      </div>

      <MoreInfo {...demoInfo['apigee-mcp']} />
    </div>
  )
}
