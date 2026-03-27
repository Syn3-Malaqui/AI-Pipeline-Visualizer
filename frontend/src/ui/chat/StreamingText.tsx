import { useEffect, useMemo, useRef } from 'react'
import type { PipelineEvent } from '../../shared/types'

type StreamingTextProps = {
  events: PipelineEvent[]
  className?: string
}

function tokenString(events: PipelineEvent[]): string {
  return events.map((e) => String((e as any).payload?.token ?? '')).join('')
}

function splitSegments(text: string): string[] {
  if (!text) return []
  return text.match(/(\s+|[^\s]+)/g) ?? []
}

function streamIdFromEvents(events: PipelineEvent[]): string {
  if (!events.length) return 'empty'
  const first = events[0]
  const last = events[events.length - 1]
  // If a new run starts, React will remount spans (keys change),
  // so the "previous count" tracking naturally resets visually.
  return `${first.runId ?? 'run'}:${last.runId ?? 'run'}`
}

export function StreamingText(props: StreamingTextProps) {
  const streamId = useMemo(() => streamIdFromEvents(props.events), [props.events])

  const segments = useMemo(() => {
    return splitSegments(tokenString(props.events))
  }, [props.events])

  const prevCountRef = useRef(0)
  useEffect(() => {
    prevCountRef.current = segments.length
  }, [segments.length, streamId])

  // Subtle stagger for *newly appended* segments only.
  // Keep this tight so streaming doesn't feel "chunky" / delayed.
  // If we stagger at all, long outputs can feel like they're "crawling" in.
  // Set to zero so new segments appear immediately with only the fade-in.
  const unitDelayMs = 0
  const maxDelayMs = 0
  const prevCount = prevCountRef.current

  return (
    <span className={props.className}>
      {segments.map((text, idx) => {
        const isNew = idx >= prevCount
        const isWhitespace = /^\s+$/.test(text)
        const newIndex = idx - prevCount
        const animate = isNew && !isWhitespace
        return (
          <span
            key={`${streamId}:${idx}`}
            className="ui-stream-unit"
            data-new={animate ? 'true' : 'false'}
            style={
              animate ? { animationDelay: `${Math.min(maxDelayMs, newIndex * unitDelayMs)}ms` } : undefined
            }
          >
            {text}
          </span>
        )
      })}
    </span>
  )
}

