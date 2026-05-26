import { useEffect, useState } from 'react'
import { fetchDemos } from './api'
import type { DemosResponse } from './types'
import { Sidebar } from './components/Sidebar'
import { StatusBanner } from './components/StatusBanner'
import { BasicQuotaDemo } from './components/BasicQuotaDemo'
import { LlmSecurityDemo } from './components/LlmSecurityDemo'
import { EmptyState } from './components/EmptyState'

export function App() {
  const [demos, setDemos] = useState<DemosResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [activeDemoId, setActiveDemoId] = useState<string | null>(null)

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
      />
      <main className="app__main">
        <StatusBanner demos={demos} error={error} />
        {activeDemo === null && <EmptyState />}
        {activeDemo?.id === 'basic-quota' && <BasicQuotaDemo />}
        {activeDemo?.id === 'llm-security' && demos && (
          <LlmSecurityDemo demos={demos} />
        )}
      </main>
    </div>
  )
}
