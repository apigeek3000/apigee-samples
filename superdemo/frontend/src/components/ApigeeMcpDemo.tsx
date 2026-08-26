import { useEffect, useRef, useState } from 'react'
import { marked } from 'marked'
import type { DemoMetadata, McpTool, McpChatEvent } from '../types'
import { MoreInfo } from './MoreInfo'
import { fetchMcpTools, streamMcpChat } from '../api'
import { apigeeProxyLinks, demoInfo } from '../demoInfo'
import styles from './ApigeeMcpDemo.module.css'

interface Props {
  demo: DemoMetadata
  projectId?: string | null
}

type DisplayMessage =
  | { kind: 'user'; text: string; id: string }
  | { kind: 'assistant'; text: string; id: string; agent?: string }
  | {
      kind: 'tool_call'
      callId: string
      name: string
      args: Record<string, unknown>
      id: string
      agent?: string
    }
  | {
      kind: 'tool_result'
      callId: string
      isError: boolean
      body: string
      id: string
      agent?: string
    }
  | { kind: 'error'; text: string; id: string }

function renderMarkdown(raw: string): string {
  try {
    return marked.parse(raw, { async: false, breaks: true, gfm: true }) as string
  } catch {
    return raw
  }
}

function formatToolResultBody(body: string): string {
  if (
    body === '{"result": null}' ||
    body === '{"result":null}' ||
    body === '{"result": ""}' ||
    body === '{"result":""}'
  ) {
    return '{"result": "success"}'
  }
  return body
}

function renderAgentBadge(agent?: string) {
  if (!agent) return null
  if (agent === 'complex_analyst') {
    return <span className={styles.agentBadgePro}>Pro Specialist (Gemini Pro)</span>
  }
  if (agent === 'standard_assistant') {
    return <span className={styles.agentBadgeFlash}>Fast Assistant (Gemini Flash)</span>
  }
  if (agent === 'root_coordinator') {
    return <span className={styles.agentBadgeRoot}>Coordinator</span>
  }
  return <span className={styles.agentBadgeGeneric}>{agent}</span>
}

const CANNED_PROMPTS = [
  'Get details for customer 1234',
  'Create a customer named Acme Corp',
  'Perform a detailed risk analysis for customer 1234',
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

export function ApigeeMcpDemo({ demo, projectId }: Props) {
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
          if (last && last.kind === 'assistant' && last.agent === event.agent) {
            const updated: DisplayMessage = { ...last, text: last.text + event.text }
            return [...prev.slice(0, -1), updated]
          }
          return [
            ...prev,
            { kind: 'assistant', text: event.text, id: nextMessageId(), agent: event.agent },
          ]
        })
        break
      case 'tool_call':
        appendMessage({
          kind: 'tool_call',
          callId: event.id,
          name: event.name,
          args: event.args,
          id: nextMessageId(),
          agent: event.agent,
        })
        break
      case 'tool_result':
        appendMessage({
          kind: 'tool_result',
          callId: event.id,
          isError: event.is_error,
          body: event.body,
          id: nextMessageId(),
          agent: event.agent,
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
                    {renderAgentBadge(msg.agent)}
                    <div
                      className={styles.markdownContent}
                      dangerouslySetInnerHTML={{ __html: renderMarkdown(msg.text) }}
                    />
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
                    ← {formatToolResultBody(msg.body)}
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

      <MoreInfo
        {...demoInfo['apigee-mcp']}
        apigeeProxyLinks={apigeeProxyLinks('apigee-mcp', projectId)}
      />
    </div>
  )
}
