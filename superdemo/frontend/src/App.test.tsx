import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { App } from './App'
import type { DemosResponse } from './types'

vi.mock('./api', () => ({
  fetchDemos: vi.fn(),
  sendBasicQuota: vi.fn(),
  sendLlmSecurity: vi.fn(),
  sendLlmRateLimiting: vi.fn(),
  sendCloudLogging: vi.fn(),
  fetchRecentLog: vi.fn(),
  sendThreatRegex: vi.fn(),
  sendThreatJson: vi.fn(),
}))

import { fetchDemos } from './api'

const signedIn = { email: 'tester@example.com', uid: 'u1' }
let authState = {
  user: signedIn as unknown,
  loading: false,
  signIn: vi.fn(),
  signOut: vi.fn(),
}
vi.mock('./hooks/useAuth', () => ({
  useAuth: () => authState,
}))

// authEnabled is read by App directly from ./auth; make it controllable so we
// can exercise both the gated (Cloud Run) and ungated (local dev) paths.
const authConfig = vi.hoisted(() => ({ enabled: true }))
vi.mock('./auth', () => ({
  get authEnabled() {
    return authConfig.enabled
  },
  auth: null,
  signInWithGoogle: vi.fn(),
  signOutUser: vi.fn(),
}))

const readyDemos: DemosResponse = {
  status: 'ready',
  host: 'apigee.test',
  project_id: 'fake-project',
  demos: [
    { id: 'basic-quota', title: 'Basic Quota', description: 'Shows Apigee enforcing different per-product quotas on a single shared proxy.', icon: '⏱️', status: 'passing' },
    {
      id: 'llm-security',
      title: 'LLM Security v2',
      description: 'Apigee calls out to Model Armor to inspect every prompt.',
      icon: '🛡️',
      status: 'passing',
      model_name: 'gemini-fake',
      model_armor_region: 'us-central1',
    },
  ],
}

const unconfiguredDemos: DemosResponse = {
  status: 'unconfigured',
  demos: readyDemos.demos,
}

beforeEach(() => {
  vi.resetAllMocks()
  localStorage.clear()
  authState = { user: signedIn as unknown, loading: false, signIn: vi.fn(), signOut: vi.fn() }
  authConfig.enabled = true
})

describe('App — loading state', () => {
  it('shows the loading status banner before demos resolve', () => {
    vi.mocked(fetchDemos).mockReturnValue(new Promise(() => {}))

    render(<App />)

    expect(screen.getByText(/loading backend status/i)).toBeInTheDocument()
  })
})

describe('App — ready state', () => {
  it('renders the Homepage first after fetchDemos resolves with status ready', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce(readyDemos)

    render(<App />)

    expect(
      await screen.findByRole('heading', { level: 1, name: /Apigee Super Demos/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/connected to apigee/i)).toBeInTheDocument()
  })
})

describe('App — unconfigured state', () => {
  it('shows the unconfigured banner and the homepage tiles when fetchDemos resolves with status unconfigured', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce(unconfiguredDemos)

    render(<App />)

    expect(
      await screen.findByText(/backend reachable but unconfigured/i),
    ).toBeInTheDocument()
    // Lands on Homepage
    expect(
      await screen.findByRole('heading', { level: 1, name: /Apigee Super Demos/i }),
    ).toBeInTheDocument()
  })
})

describe('App — sidebar and homepage navigation', () => {
  it('switches the active panel when a sidebar item is clicked and can navigate back home', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce(readyDemos)
    const user = userEvent.setup()

    render(<App />)

    // Initially we are on the Homepage
    await screen.findByRole('heading', { level: 1, name: /Apigee Super Demos/i })

    // Click sidebar button to go to "Basic Quota" (anchored to avoid homepage card conflict)
    await user.click(
      screen.getByRole('button', { name: /^Basic Quota$/i }),
    )

    // Expect "Basic Quota" demo page to render
    expect(
      await screen.findByRole('heading', { level: 2, name: /^Basic Quota$/i }),
    ).toBeInTheDocument()

    // Click "Home" link in the sidebar to go back
    await user.click(
      within(screen.getByRole('navigation', { name: /Demos/i })).getByRole('button', { name: /^Home$/i }),
    )

    // Should be back on the Homepage
    expect(
      await screen.findByRole('heading', { level: 1, name: /Apigee Super Demos/i }),
    ).toBeInTheDocument()
  })

  it('can navigate to a demo by clicking its homepage card', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce(readyDemos)
    const user = userEvent.setup()

    render(<App />)

    // Find the homepage card and click it
    const card = await screen.findByRole('button', { name: /Open demo: Basic Quota/i })
    await user.click(card)

    // Expect "Basic Quota" demo page to render
    expect(
      await screen.findByRole('heading', { level: 2, name: /^Basic Quota$/i }),
    ).toBeInTheDocument()
  })

  it('renders LlmRateLimitingDemo when llm-token-limits-v2 is selected', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce({
      status: 'ready',
      host: 'h',
      project_id: 'p',
      demos: [
        {
          id: 'llm-token-limits-v2',
          title: 'LLM Rate Limiting',
          description: 'd',
          icon: '⚡',
          status: 'passing',
          bronze_token_limit: 2000,
          silver_token_limit: 5000,
          interval_minutes: 5,
          model: 'gemini-2.5-flash',
          region: 'us-central1',
        },
      ],
    })
    const user = userEvent.setup()

    render(<App />)

    const card = await screen.findByRole('button', { name: /Open demo: LLM Rate Limiting/i })
    await user.click(card)

    expect(
      await screen.findByRole('heading', { level: 2, name: 'LLM Rate Limiting' }),
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Bronze')).toBeInTheDocument()
    expect(screen.getByLabelText('Silver')).toBeInTheDocument()
  })
})

describe('App — placeholder demos', () => {
  it('renders PlaceholderDemo when a placeholder demo card is clicked', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce({
      status: 'ready',
      host: 'h',
      project_id: 'p',
      demos: [
        {
          id: 'llm-routing',
          title: 'LLM Model Routing',
          description: 'Routes prompts between cheap and premium models.',
          icon: '🔀',
          status: 'placeholder',
          placeholder: true,
        },
      ],
    })
    const user = userEvent.setup()

    render(<App />)

    const card = await screen.findByRole('button', { name: /Open demo: LLM Model Routing/i })
    await user.click(card)

    expect(
      await screen.findByRole('heading', { level: 2, name: /LLM Model Routing/i }),
    ).toBeInTheDocument()
    expect(screen.getByText(/not yet implemented/i)).toBeInTheDocument()
  })
})

describe('App — routes cloud-logging and threat-protection', () => {
  it('renders CloudLoggingDemo when cloud-logging is clicked', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce({
      status: 'ready',
      host: 'h',
      project_id: 'fake-project',
      demos: [
        {
          id: 'cloud-logging',
          title: 'Cloud Logging',
          description: 'd',
          icon: '🪵',
          status: 'passing',
          log_name: 'projects/fake-project/logs/apigee',
          proxy_name: 'sample-cloud-logging',
        },
      ],
    })
    const user = userEvent.setup()

    render(<App />)

    const card = await screen.findByRole('button', { name: /Open demo: Cloud Logging/i })
    await user.click(card)

    expect(
      await screen.findByRole('heading', { level: 2, name: /Cloud Logging/i }),
    ).toBeInTheDocument()
    expect(
      screen.getByRole('link', { name: /open in logs explorer/i }),
    ).toBeInTheDocument()
  })

  it('renders ThreatProtectionDemo when threat-protection is clicked', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce({
      status: 'ready',
      host: 'h',
      project_id: 'p',
      demos: [
        {
          id: 'threat-protection',
          title: 'Threat Protection',
          description: 'd',
          icon: '🧱',
          status: 'passing',
          max_json_object_keys: 5,
          blocked_keywords: ['delete'],
        },
      ],
    })
    const user = userEvent.setup()

    render(<App />)

    const card = await screen.findByRole('button', { name: /Open demo: Threat Protection/i })
    await user.click(card)

    expect(
      await screen.findByRole('heading', { level: 2, name: /Threat Protection/i }),
    ).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^delete$/i })).toBeInTheDocument()
  })
})

describe('App — sidebar collapsibility', () => {
  it('toggles sidebar state and saves to localStorage', async () => {
    vi.mocked(fetchDemos).mockResolvedValueOnce(readyDemos)
    const user = userEvent.setup()

    render(<App />)

    const toggleBtn = screen.getByRole('button', { name: /Collapse sidebar/i })
    expect(toggleBtn).toBeInTheDocument()

    // Collapse it
    await user.click(toggleBtn)
    expect(localStorage.getItem('apigee-superdemo-sidebar-collapsed')).toBe('true')

    // Topbar brand should now be visible in the document
    expect(screen.getByRole('button', { name: /Apigee Superdemo home/i })).toBeInTheDocument()

    // Expand it again
    const expandBtn = screen.getByRole('button', { name: /Expand sidebar/i })
    await user.click(expandBtn)
    expect(localStorage.getItem('apigee-superdemo-sidebar-collapsed')).toBe('false')
  })
})

describe('App — auth gating', () => {
  it('shows the LoginScreen when no user is signed in', async () => {
    authState = { user: null, loading: false, signIn: vi.fn(), signOut: vi.fn() }
    render(<App />)
    expect(
      await screen.findByRole('button', { name: /sign in with google/i }),
    ).toBeInTheDocument()
  })

  it('shows access-denied when the backend rejects with 403', async () => {
    authState = { user: signedIn as unknown, loading: false, signIn: vi.fn(), signOut: vi.fn() }
    vi.mocked(fetchDemos).mockRejectedValueOnce({ status: 403, message: 'Not authorized' })
    render(<App />)
    expect(await screen.findByText(/not authorized/i)).toBeInTheDocument()
  })

  it('skips the LoginScreen and loads demos when auth is disabled (local dev)', async () => {
    authConfig.enabled = false
    authState = { user: null, loading: false, signIn: vi.fn(), signOut: vi.fn() }
    vi.mocked(fetchDemos).mockResolvedValueOnce(readyDemos)
    render(<App />)
    expect(
      await screen.findByRole('heading', { level: 1, name: /Apigee Super Demos/i }),
    ).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /sign in with google/i }),
    ).not.toBeInTheDocument()
  })
})
