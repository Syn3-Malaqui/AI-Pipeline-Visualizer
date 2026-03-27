export type EventKind =
  | 'run_started'
  | 'node_started'
  | 'node_output'
  | 'token'
  | 'node_completed'
  | 'run_completed'
  | 'error'

export type PipelineEvent = {
  version: string
  runId: string
  seq: number
  tMs: number
  kind: EventKind
  nodeId: string | null
  payload: Record<string, unknown>
}

export type ScenarioSummary = {
  id: string
  name: string
  description: string
}

export type PlaybackState = {
  paused: boolean
  speed: number
  cursor: number
}
