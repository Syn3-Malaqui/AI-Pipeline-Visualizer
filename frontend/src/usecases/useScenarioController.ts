import { useEffect, useState } from 'react'

import { fetchScenarios } from '../adapters/api/httpClient'
import type { ScenarioSummary } from '../shared/types'

/** Default scenario when present in the API list (otherwise first item). */
const DEFAULT_SCENARIO_ID = 'medicine-rag'

export function useScenarioController() {
  const [scenarios, setScenarios] = useState<ScenarioSummary[]>([])
  const [selectedScenarioId, setSelectedScenarioId] = useState('')
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let mounted = true
    fetchScenarios()
      .then((data) => {
        if (!mounted) return
        setScenarios(data)
        setSelectedScenarioId((prev) => {
          if (prev) return prev
          const preferred = data.find((s) => s.id === DEFAULT_SCENARIO_ID)
          return preferred?.id ?? data[0]?.id ?? ''
        })
        setError(null)
      })
      .catch((err: unknown) => {
        if (!mounted) return
        setError(err instanceof Error ? err.message : 'Failed to fetch scenarios')
      })
      .finally(() => {
        if (!mounted) return
        setLoading(false)
      })
    return () => {
      mounted = false
    }
  }, [])

  return {
    scenarios,
    selectedScenarioId,
    setSelectedScenarioId,
    loading,
    error,
  }
}
