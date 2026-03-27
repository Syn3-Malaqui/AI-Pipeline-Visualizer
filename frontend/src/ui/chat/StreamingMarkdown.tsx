import { useEffect, useMemo, useRef, useState } from 'react'
import type { PipelineEvent } from '../../shared/types'
import { MarkdownBlock } from './MarkdownBlock'

type StreamingMarkdownProps = {
  events: PipelineEvent[]
  className?: string
}

function tokenFromEvent(event: PipelineEvent): string {
  return String((event as any).payload?.token ?? '')
}

function streamIdFromEvents(events: PipelineEvent[]): string {
  if (!events.length) return 'empty'
  const first = events[0]
  const last = events[events.length - 1]
  return `${first.runId ?? 'run'}:${last.runId ?? 'run'}`
}

export function StreamingMarkdown(props: StreamingMarkdownProps) {
  const streamId = useMemo(() => streamIdFromEvents(props.events), [props.events])

  // Fade in once per stream (not per token).
  const [isIn, setIsIn] = useState(false)
  useEffect(() => {
    setIsIn(false)
    const id = requestAnimationFrame(() => setIsIn(true))
    return () => cancelAnimationFrame(id)
  }, [streamId])

  // Throttle markdown parsing/rendering to at most once per frame.
  const [text, setText] = useState('')
  const rafRef = useRef<number | null>(null)
  const latestEventsRef = useRef<PipelineEvent[]>(props.events)
  latestEventsRef.current = props.events

  // Incremental append so per-frame updates stay O(newTokens), not O(allTokens).
  const appendedRef = useRef('')
  const lastLenRef = useRef(0)
  useEffect(() => {
    appendedRef.current = ''
    lastLenRef.current = 0
    setText('')
  }, [streamId])

  useEffect(() => {
    if (rafRef.current != null) return
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = null
      const events = latestEventsRef.current
      const start = Math.min(lastLenRef.current, events.length)
      let delta = ''
      for (let i = start; i < events.length; i++) delta += tokenFromEvent(events[i])
      lastLenRef.current = events.length
      if (delta) appendedRef.current += delta
      setText(appendedRef.current)
    })
  }, [props.events.length, streamId])

  const outerClassName = props.className ? `ui-reveal ${props.className}` : 'ui-reveal'

  return (
    <div className={outerClassName} data-state={isIn ? 'in' : undefined}>
      <MarkdownBlock markdown={text} className="ui-markdown text-sm text-on-surface" />
    </div>
  )
}

