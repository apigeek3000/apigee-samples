import { useEffect, useState } from 'react'
import { fetchDemos } from './api'
import type { DemosResponse } from './types'
import { Sidebar } from './components/Sidebar'
import { Topbar } from './components/Topbar'
import { Homepage } from './components/Homepage'
import { StatusBanner } from './components/StatusBanner'
import { BasicQuotaDemo } from './components/BasicQuotaDemo'
import { LlmSecurityDemo } from './components/LlmSecurityDemo'
import { LlmRateLimitingDemo } from './components/LlmRateLimitingDemo'
import { PlaceholderDemo } from './components/PlaceholderDemo'
import { ApigeeMcpDemo } from './components/ApigeeMcpDemo'
import { CloudLoggingDemo } from './components/CloudLoggingDemo'
import { ThreatProtectionDemo } from './components/ThreatProtectionDemo'
import { LlmCircuitBreakingDemo } from './components/LlmCircuitBreakingDemo'
import { LlmTokenLimitsPerUserDemo } from './components/LlmTokenLimitsPerUserDemo'
import { EmptyState } from './components/EmptyState'
import { LoginScreen } from './components/LoginScreen'
import { useShowStatus } from './hooks/useShowStatus'
import { useAuth } from './hooks/useAuth'
import { authEnabled } from './auth'

export function App() {
  const [demos, setDemos] = useState<DemosResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null)
  const [showStatus, setShowStatus] = useShowStatus()
  const { user, loading: authLoading, signIn, signOut } = useAuth()
  const [accessDenied, setAccessDenied] = useState(false)
  
  // Persisted collapsible sidebar state
  const [isSidebarCollapsed, setIsSidebarCollapsed] = useState<boolean>(() => {
    const saved = localStorage.getItem('apigee-superdemo-sidebar-collapsed')
    return saved === 'true'
  })

  useEffect(() => {
    // When auth is on, wait for sign-in; when off, fetch immediately.
    if (authEnabled && !user) return
    fetchDemos()
      .then((data) => {
        setDemos(data)
        setAccessDenied(false)
      })
      .catch((err: unknown) => {
        if (
          err &&
          typeof err === 'object' &&
          'status' in err &&
          (err as { status: number }).status === 403
        ) {
          setAccessDenied(true)
          return
        }
        const msg = err instanceof Error ? err.message : String(err)
        setError(`Backend unreachable: ${msg}`)
      })
  }, [user])

  useEffect(() => {
    localStorage.setItem('apigee-superdemo-sidebar-collapsed', String(isSidebarCollapsed))
  }, [isSidebarCollapsed])

  const activeDemo = demos?.demos.find((d) => d.id === activeDemoId) ?? null

  // Auth gating only applies when auth is enabled (Cloud Run by default).
  // Local dev skips straight to the app.
  if (authEnabled) {
    if (authLoading) {
      return <div className="app__auth-loading" />
    }
    if (!user) {
      return <LoginScreen onSignIn={() => void signIn()} />
    }
    if (accessDenied) {
      return (
        <LoginScreen
          onSignIn={() => void signIn()}
          denied
          deniedEmail={user.email ?? undefined}
          onSignOut={() => void signOut()}
        />
      )
    }
  }

  return (
    <div className="app">
      <Sidebar
        demos={demos?.demos ?? []}
        activeDemoId={activeDemoId}
        onSelect={setActiveDemoId}
        showStatus={showStatus}
        onShowStatusChange={setShowStatus}
        isCollapsed={isSidebarCollapsed}
      />
      <main className="app__main">
        <Topbar
          isSidebarCollapsed={isSidebarCollapsed}
          onToggleSidebar={() => setIsSidebarCollapsed(!isSidebarCollapsed)}
          activeDemo={activeDemo}
          onNavigateHome={() => setActiveDemoId(null)}
          userEmail={authEnabled ? (user?.email ?? undefined) : undefined}
          onSignOut={authEnabled ? () => void signOut() : undefined}
        />
        <div className="app__content">
          <StatusBanner demos={demos} error={error} />
          {activeDemo === null && demos && (
            <Homepage
              demos={demos.demos}
              onSelect={setActiveDemoId}
              showStatus={showStatus}
            />
          )}
          {activeDemo === null && !demos && <EmptyState />}
          {activeDemo?.placeholder && <PlaceholderDemo demo={activeDemo} />}
          {!activeDemo?.placeholder && activeDemo?.id === 'basic-quota' && (
            <BasicQuotaDemo projectId={demos?.project_id} />
          )}
          {!activeDemo?.placeholder && activeDemo?.id === 'llm-security' && demos && (
            <LlmSecurityDemo demos={demos} demo={activeDemo} />
          )}
          {!activeDemo?.placeholder && activeDemo?.id === 'llm-token-limits-v2' && demos && (
            <LlmRateLimitingDemo demos={demos} demo={activeDemo} />
          )}
          {!activeDemo?.placeholder && activeDemo?.id === 'apigee-mcp' && (
            <ApigeeMcpDemo demo={activeDemo} projectId={demos?.project_id} />
          )}
          {!activeDemo?.placeholder && activeDemo?.id === 'cloud-logging' && demos && (
            <CloudLoggingDemo demos={demos} demo={activeDemo} />
          )}
          {!activeDemo?.placeholder && activeDemo?.id === 'threat-protection' && (
            <ThreatProtectionDemo demo={activeDemo} projectId={demos?.project_id} />
          )}
          {!activeDemo?.placeholder && activeDemo?.id === 'llm-circuit-breaking' && demos && (
            <LlmCircuitBreakingDemo demos={demos} demo={activeDemo} />
          )}
          {!activeDemo?.placeholder &&
            activeDemo?.id === 'llm-token-limits-per-user' &&
            demos && (
              <LlmTokenLimitsPerUserDemo demos={demos} demo={activeDemo} />
            )}
        </div>
      </main>
    </div>
  )
}
export default App
