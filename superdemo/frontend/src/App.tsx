import { useEffect, useState } from 'react'
import { fetchDemos } from './api'
import type { DemosResponse } from './types'
import { Sidebar } from './components/Sidebar'
import { StatusBanner } from './components/StatusBanner'
import { BasicQuotaDemo } from './components/BasicQuotaDemo'
import { LlmSecurityDemo } from './components/LlmSecurityDemo'
import { LlmRateLimitingDemo } from './components/LlmRateLimitingDemo'
import { PlaceholderDemo } from './components/PlaceholderDemo'
import { ApigeeMcpDemo } from './components/ApigeeMcpDemo'
import { CloudLoggingDemo } from './components/CloudLoggingDemo'
import { ThreatProtectionDemo } from './components/ThreatProtectionDemo'
import { EmptyState } from './components/EmptyState'
import { useShowStatus } from './hooks/useShowStatus'

export function App() {
  const [demos, setDemos] = useState<DemosResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null)
  const [showStatus, setShowStatus] = useShowStatus()

  useEffect(() => {
    fetchDemos()
      .then((data) => {
        setDemos(data)
        if (data.status === 'ready' && data.demos.length > 0) {
          setActiveDemoId(data.demos[0].id)
        }
      })
      .catch((err: unknown) => {
        const msg = err instanceof Error ? err.message : String(err)
        setError(`Backend unreachable: ${msg}`)
      })
  }, [])

  const activeDemo = demos?.demos.find((d) => d.id === activeDemoId) ?? null

  return (
    <div className="app">
      <Sidebar
        demos={demos?.demos ?? []}
        activeDemoId={activeDemoId}
        onSelect={setActiveDemoId}
        showStatus={showStatus}
        onShowStatusChange={setShowStatus}
      />
      <main className="app__main">
        <StatusBanner demos={demos} error={error} />
        {activeDemo === null && <EmptyState />}
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
      </main>
    </div>
  )
}
