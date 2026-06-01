import { render, screen, waitFor } from '@testing-library/react'
import { fireEvent } from '@testing-library/react'
import { vi } from 'vitest'
import { ApigeeMcpDemo } from './ApigeeMcpDemo'
import * as api from '../api'
import type { DemoMetadata } from '../types'
import type { McpChatEvent } from '../types'

const MCP_DEMO: DemoMetadata = {
  id: 'apigee-mcp',
  title: 'MCP Server',
  description: 'MCP demo',
  icon: '🔌',
  status: 'passing',
  mcp_endpoint: 'https://apigee.test.example.com/crm-mcp-proxy/sse',
  model: 'gemini-2.5-flash',
  region: 'us-east1',
}

describe('ApigeeMcpDemo (scaffold)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchMcpTools').mockResolvedValue([])
    sessionStorage.clear()
  })

  it('renders the page title and description', async () => {
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    expect(screen.getByRole('heading', { name: /MCP Server/i })).toBeInTheDocument()
    expect(screen.getByText(/MCP demo/i)).toBeInTheDocument()
  })

  it('shows the discovered-tools rail label', async () => {
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    await waitFor(() =>
      expect(screen.getByText(/Discovered Tools/i)).toBeInTheDocument(),
    )
  })

  it('renders the chat input', async () => {
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    expect(screen.getByPlaceholderText(/Ask the agent/i)).toBeInTheDocument()
  })
})

describe('ApigeeMcpDemo (tools panel)', () => {
  beforeEach(() => {
    sessionStorage.clear()
  })

  it('renders tools returned by fetchMcpTools', async () => {
    vi.spyOn(api, 'fetchMcpTools').mockResolvedValue([
      { name: 'list_customers', description: 'List customers', openapi_op: 'GET /customers' },
      { name: 'get_customer', description: 'Get one', openapi_op: 'GET /customers/{id}' },
    ])
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    await waitFor(() => screen.getByText('list_customers'))
    expect(screen.getByText('GET /customers')).toBeInTheDocument()
    expect(screen.getByText('get_customer')).toBeInTheDocument()
    expect(screen.getByText('GET /customers/{id}')).toBeInTheDocument()
  })

  it('renders the empty state when no tools are discovered', async () => {
    vi.spyOn(api, 'fetchMcpTools').mockResolvedValue([])
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    await waitFor(() =>
      screen.getByText(/No tools discovered/i),
    )
  })

  it('renders the error message when fetchMcpTools rejects', async () => {
    vi.spyOn(api, 'fetchMcpTools').mockRejectedValue({
      status: 503,
      message: 'apigee-mcp not deployed — run deploy-superdemo.sh',
    })
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    await waitFor(() =>
      screen.getByText(/not deployed/i),
    )
  })
})

describe('ApigeeMcpDemo (chat)', () => {
  function mockChatStream(events: McpChatEvent[]) {
    return vi
      .spyOn(api, 'streamMcpChat')
      .mockImplementation(async (_session, _prompt, onEvent) => {
        for (const e of events) {
          onEvent(e)
        }
      })
  }

  beforeEach(() => {
    vi.spyOn(api, 'fetchMcpTools').mockResolvedValue([])
    sessionStorage.clear()
  })

  it('renders user prompt + streamed assistant delta + tool cards in order', async () => {
    mockChatStream([
      { type: 'delta', text: 'Looking that up…' },
      { type: 'tool_call', id: 't1', name: 'list_customers', args: {} },
      { type: 'tool_result', id: 't1', is_error: false, body: '{"customers":[]}' },
      { type: 'delta', text: 'No customers yet.' },
      { type: 'done' },
    ])

    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    const input = screen.getByPlaceholderText(/Ask the agent/i) as HTMLInputElement
    fireEvent.change(input, { target: { value: 'list customers' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/i }))

    await waitFor(() => screen.getByText('list customers'))
    expect(screen.getByText('list customers')).toBeInTheDocument()
    expect(screen.getByText(/Looking that up/)).toBeInTheDocument()
    expect(screen.getByText(/list_customers/)).toBeInTheDocument()
    expect(screen.getByText(/"customers":\[\]/)).toBeInTheDocument()
    expect(screen.getByText(/No customers yet/)).toBeInTheDocument()
  })

  it('renders an error event in the chat', async () => {
    mockChatStream([
      { type: 'error', message: 'Apigee returned 401' },
      { type: 'done' },
    ])
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    fireEvent.change(screen.getByPlaceholderText(/Ask the agent/i), {
      target: { value: 'hi' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/i }))

    await waitFor(() => screen.getByText(/Apigee returned 401/))
  })

  it('keeps the first user message when session_restarted leads the stream', async () => {
    // The backend always emits session_restarted on the very first message
    // (it has no record of the client-generated session id yet). Regression
    // test: that event must not wipe the message we just sent.
    sessionStorage.setItem('apigee-mcp-session', 'persistent-id')
    mockChatStream([
      { type: 'session_restarted', session_id: 'persistent-id' },
      { type: 'delta', text: 'Fresh agent.' },
      { type: 'done' },
    ])
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    fireEvent.change(screen.getByPlaceholderText(/Ask the agent/i), {
      target: { value: 'hello' },
    })
    fireEvent.click(screen.getByRole('button', { name: /Send/i }))

    await waitFor(() => screen.getByText('Fresh agent.'))
    expect(screen.getByText('hello')).toBeInTheDocument()
    expect(sessionStorage.getItem('apigee-mcp-session')).toBe('persistent-id')
  })

  it('drops stale history but keeps the current message on a later restart', async () => {
    sessionStorage.setItem('apigee-mcp-session', 'persistent-id')
    const stream = vi.spyOn(api, 'streamMcpChat')
    // First turn: a normal exchange that builds up history.
    stream.mockImplementationOnce(async (_session, _prompt, onEvent) => {
      onEvent({ type: 'session_restarted', session_id: 'persistent-id' })
      onEvent({ type: 'delta', text: 'First answer.' })
      onEvent({ type: 'done' })
    })
    // Second turn: backend restarted, so it announces a restart again.
    stream.mockImplementationOnce(async (_session, _prompt, onEvent) => {
      onEvent({ type: 'session_restarted', session_id: 'persistent-id' })
      onEvent({ type: 'delta', text: 'Second answer.' })
      onEvent({ type: 'done' })
    })

    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    const input = screen.getByPlaceholderText(/Ask the agent/i)

    fireEvent.change(input, { target: { value: 'first' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/i }))
    await waitFor(() => screen.getByText('First answer.'))

    fireEvent.change(input, { target: { value: 'second' } })
    fireEvent.click(screen.getByRole('button', { name: /Send/i }))
    await waitFor(() => screen.getByText('Second answer.'))

    // Stale history from the first turn is gone; the current message stays.
    expect(screen.queryByText('first')).not.toBeInTheDocument()
    expect(screen.queryByText('First answer.')).not.toBeInTheDocument()
    expect(screen.getByText('second')).toBeInTheDocument()
  })
})

describe('ApigeeMcpDemo (canned prompts)', () => {
  beforeEach(() => {
    vi.spyOn(api, 'fetchMcpTools').mockResolvedValue([])
    sessionStorage.clear()
  })

  it('clicking a canned prompt populates the input', () => {
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    const chip = screen.getByRole('button', { name: /List recent customers/i })
    fireEvent.click(chip)
    const input = screen.getByPlaceholderText(/Ask the agent/i) as HTMLInputElement
    expect(input.value).toBe('List recent customers')
  })

  it('renders all three canned prompts', () => {
    render(<ApigeeMcpDemo demo={MCP_DEMO} />)
    expect(screen.getByRole('button', { name: /List recent customers/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Tell me about customer 1/i })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Create a customer named Acme/i })).toBeInTheDocument()
  })
})
