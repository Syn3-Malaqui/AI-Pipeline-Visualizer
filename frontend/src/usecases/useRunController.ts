import { useEffect, useMemo, useRef, useState } from 'react'

import { streamRun } from '../adapters/api/httpClient'
import type { PipelineEvent, PlaybackState } from '../shared/types'

type RunController = {
  events: PipelineEvent[]
  visibleEvents: PipelineEvent[]
  activeNodeId: string | null
  finalAnswer: string
  isRunning: boolean
  error: string | null
  playback: PlaybackState
  startRun: (scenarioId: string, query: string) => void
  pause: () => void
  resume: () => void
  step: () => void
  setSpeed: (speed: number) => void
}

export function useRunController(): RunController {
  const [events, setEvents] = useState<PipelineEvent[]>([])
  const [playback, setPlayback] = useState<PlaybackState>({ paused: false, speed: 1, cursor: 0 })
  const [isRunning, setIsRunning] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const timerRef = useRef<number | null>(null)
  const playbackPaceRef = useRef<number>(0)
  const abortRef = useRef<AbortController | null>(null)
  const eventsRef = useRef<PipelineEvent[]>([])
  const revealTimesRef = useRef<{
    nodeStartedAt: Map<string, number>
    runningNodeId: string | null
  }>({ nodeStartedAt: new Map(), runningNodeId: null })

  // Minimum time a node should appear "running" before completion is revealed.
  const MIN_RUNNING_MS = 1000
  const MIN_RUNNING_GENERATE_MS = 180

  const visibleEvents = useMemo(() => events.slice(0, playback.cursor), [events, playback.cursor])

  const activeNodeId = useMemo(() => {
    const completed = new Set<string>()
    for (const e of [...visibleEvents].reverse()) {
      if (!e.nodeId) continue
      if (e.kind === 'node_completed') completed.add(e.nodeId)
      if (e.kind === 'node_started' && !completed.has(e.nodeId)) return e.nodeId
    }
    return null
  }, [visibleEvents])

  const finalAnswer = useMemo(() => {
    let answer = ''
    for (const event of visibleEvents) {
      if (event.kind === 'token') {
        answer += String(event.payload.token ?? '')
      }
      if (event.kind === 'run_completed') {
        answer = String(event.payload.answer ?? answer)
      }
    }
    return answer
  }, [visibleEvents])

  function clearTimer() {
    if (timerRef.current) {
      window.clearInterval(timerRef.current)
      timerRef.current = null
    }
  }

  function canRevealEvent(event: PipelineEvent) {
    const now = performance.now()
    const state = revealTimesRef.current

    if (event.kind === 'node_started' && event.nodeId) {
      // Prevent overlapping "running" nodes in the UI.
      if (state.runningNodeId && state.runningNodeId !== event.nodeId) return false
      return true
    }

    if (event.kind === 'node_completed' && event.nodeId) {
      const startedAt = state.nodeStartedAt.get(event.nodeId)
      if (startedAt === undefined) return true
      const minMs = event.nodeId === 'generate' ? MIN_RUNNING_GENERATE_MS : MIN_RUNNING_MS
      return now - startedAt >= minMs
    }

    return true
  }

  function recordReveal(event: PipelineEvent) {
    const now = performance.now()
    const state = revealTimesRef.current
    if (event.kind === 'node_started' && event.nodeId) {
      state.nodeStartedAt.set(event.nodeId, now)
      state.runningNodeId = event.nodeId
    }
    if (event.kind === 'node_completed' && event.nodeId) {
      if (state.runningNodeId === event.nodeId) state.runningNodeId = null
    }
  }

  function startPlaybackTimer() {
    clearTimer()
    timerRef.current = window.setInterval(() => {
      setPlayback((prev) => {
        if (prev.paused) return prev
        const stepCount = Math.max(1, Math.floor(prev.speed))
        let cursor = prev.cursor
        let consumed = 0
        const revealState = revealTimesRef.current
        const isGeneratePhase = revealState.runningNodeId === 'generate'

        // Keep the overall visualizer cadence at 200ms, but allow a quicker 60ms cadence
        // specifically during the Generation phase so token streaming keeps up.
        const now = performance.now()
        if (!isGeneratePhase) {
          const last = playbackPaceRef.current
          if (last && now - last < 200) return prev
          playbackPaceRef.current = now
        }

        let tokenBudget = isGeneratePhase ? 1400 : 160

        while (cursor < eventsRef.current.length && consumed < stepCount) {
          const nextEvent = eventsRef.current[cursor]
          if (!nextEvent) break
          if (!canRevealEvent(nextEvent)) break

          // During token streaming, don't throttle on the same budget as node events.
          // This keeps "Generation" feeling real-time even when tokens are tiny (e.g. per-character).
          if (nextEvent.kind === 'token') {
            if (tokenBudget <= 0) break
            tokenBudget -= 1
            cursor += 1
            recordReveal(nextEvent)
            continue
          }

          cursor += 1
          consumed += 1
          recordReveal(nextEvent)
        }

        if (cursor === prev.cursor) return prev
        return { ...prev, cursor }
      })
    }, 60)
  }

  function startRun(scenarioId: string, query: string) {
    abortRef.current?.abort()
    setEvents([])
    setPlayback({ paused: false, speed: 1, cursor: 0 })
    setError(null)
    setIsRunning(true)
    playbackPaceRef.current = 0
    revealTimesRef.current = { nodeStartedAt: new Map(), runningNodeId: null }
    startPlaybackTimer()

    abortRef.current = streamRun(
      scenarioId,
      query,
      (event) => {
        setEvents((prev) => {
          const next = [...prev, event]
          eventsRef.current = next
          return next
        })
        if (event.kind === 'run_completed' || event.kind === 'error') {
          setIsRunning(false)
        }
      },
      (message) => {
        setError(message)
        setIsRunning(false)
      },
    )
  }

  // When the run finishes, keep playback pacing (do not fast-forward).
  useEffect(() => {
    if (isRunning) return
    if (events.length === 0) return
    // If we're already fully revealed, stop the timer.
    if (playback.cursor >= events.length) clearTimer()
  }, [isRunning, events.length, playback.cursor])

  function pause() {
    setPlayback((prev) => ({ ...prev, paused: true }))
  }

  function resume() {
    setPlayback((prev) => ({ ...prev, paused: false }))
    startPlaybackTimer()
  }

  function step() {
    setPlayback((prev) => {
      let cursor = prev.cursor
      while (cursor < eventsRef.current.length) {
        cursor += 1
        const event = eventsRef.current[cursor - 1]
        if (event.kind === 'node_started' || event.kind === 'node_completed' || event.kind === 'run_completed') {
          break
        }
      }
      return { ...prev, paused: true, cursor }
    })
  }

  function setSpeed(speed: number) {
    setPlayback((prev) => ({ ...prev, speed }))
  }

  useEffect(() => {
    return () => {
      clearTimer()
      abortRef.current?.abort()
    }
  }, [])

  return {
    events,
    visibleEvents,
    activeNodeId,
    finalAnswer,
    isRunning,
    error,
    playback,
    startRun,
    pause,
    resume,
    step,
    setSpeed,
  }
}
