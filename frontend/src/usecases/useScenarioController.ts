import { useEffect, useState } from 'react'

import { fetchScenarios } from '../adapters/api/httpClient'
import type { ScenarioSummary } from '../shared/types'

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
        setSelectedScenarioId((prev) => prev || data[0]?.id || '')
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
