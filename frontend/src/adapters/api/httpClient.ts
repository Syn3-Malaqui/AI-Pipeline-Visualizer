import type { PipelineEvent, ScenarioSummary } from '../../shared/types'

const API_BASE = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

export async function fetchScenarios(): Promise<ScenarioSummary[]> {
  const response = await fetch(`${API_BASE}/api/scenarios`)
  if (!response.ok) {
    throw new Error(`Failed to load scenarios: ${response.status}`)
  }
  return (await response.json()) as ScenarioSummary[]
}

export function streamRun(
  scenarioId: string,
  query: string,
  onEvent: (event: PipelineEvent) => void,
  onError: (message: string) => void,
): AbortController {
  const abortController = new AbortController()
  fetch(`${API_BASE}/api/runs/stream`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ scenarioId, query }),
    signal: abortController.signal,
  })
    .then(async (response) => {
      if (!response.ok || !response.body) {
        throw new Error(`Run stream failed: ${response.status}`)
      }
      const reader = response.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ''
      while (true) {
        const { done, value } = await reader.read()
        if (done) {
          break
        }
        buffer += decoder.decode(value, { stream: true })
        const blocks = buffer.split('\n\n')
        buffer = blocks.pop() ?? ''
        for (const block of blocks) {
          const dataLine = block
            .split('\n')
            .find((line) => line.startsWith('data: '))
          if (!dataLine) {
            continue
          }
          try {
            onEvent(JSON.parse(dataLine.replace('data: ', '')) as PipelineEvent)
          } catch {
            onError(`Malformed stream event: ${dataLine}`)
          }
        }
      }
    })
    .catch((error: unknown) => {
      onError(error instanceof Error ? error.message : 'Unknown stream error')
    })

  return abortController
}
