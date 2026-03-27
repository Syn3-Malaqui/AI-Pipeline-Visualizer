import { useEffect, useMemo, useRef, useState } from 'react'

import type { PipelineEvent } from '../../shared/types'

type NodeInspectorProps = {
  selectedNodeId: string | null
  events: PipelineEvent[]
}

type NodeEventGroup = {
  nodeId: string
  events: PipelineEvent[]
}

function formatTMs(tMs: number) {
  const totalMs = Math.max(0, Math.floor(tMs))
  const mins = Math.floor(totalMs / 60000)
  const secs = Math.floor((totalMs % 60000) / 1000)
  const ms = totalMs % 1000
  return `${String(mins).padStart(2, '0')}:${String(secs).padStart(2, '0')}.${String(ms).padStart(3, '0')}`
}

function truncateFragment(value: unknown, maxLen = 80) {
  const str = typeof value === 'string' ? value : JSON.stringify(value)
  if (!str) return ''
  return str.length > maxLen ? `${str.slice(0, maxLen - 1)}…` : str
}

function getMaybeMemory(payload: Record<string, unknown>) {
  const candidates = ['mem', 'memory', 'rss', 'rssMb', 'memMb', 'memoryMb', 'memGB', 'memoryGB']
  for (const key of candidates) {
    const v = payload[key]
    if (typeof v === 'number' && Number.isFinite(v)) return { key, value: v }
    if (typeof v === 'string') {
      const parsed = Number(v)
      if (Number.isFinite(parsed)) return { key, value: parsed }
    }
  }
  return null
}

function groupEventsByNodeId(events: PipelineEvent[]): NodeEventGroup[] {
  const byId = new Map<string, PipelineEvent[]>()
  for (const e of events) {
    if (!e.nodeId) continue
    const list = byId.get(e.nodeId) ?? []
    list.push(e)
    byId.set(e.nodeId, list)
  }

  return [...byId.entries()]
    .map(([nodeId, nodeEvents]) => ({ nodeId, events: nodeEvents }))
    .sort((a, b) => (a.events[0]?.tMs ?? 0) - (b.events[0]?.tMs ?? 0))
}

function getPrefersReducedMotion() {
  return window.matchMedia?.('(prefers-reduced-motion: reduce)')?.matches ?? false
}

function NodeEventsTable(props: { nodeId: string; events: PipelineEvent[]; running: boolean }) {
  const lastLatestSeqRef = useRef<number | null>(null)
  const [flashSeq, setFlashSeq] = useState<number | null>(null)

  const eventsNewestFirst = useMemo(() => [...props.events].sort((a, b) => b.tMs - a.tMs), [props.events])
  const latest = eventsNewestFirst[0] ?? null
  const latestMem = [...props.events].reverse().map((e) => getMaybeMemory(e.payload)).find(Boolean) ?? null
  const started = props.events.find((event) => event.kind === 'node_started')
  const completed = props.events.findLast((event) => event.kind === 'node_completed')
  const latency = started && completed ? completed.tMs - started.tMs : null

  useEffect(() => {
    const latestSeq = eventsNewestFirst[0]?.seq ?? null
    if (latestSeq === null) return
    const prev = lastLatestSeqRef.current
    lastLatestSeqRef.current = latestSeq
    if (prev === null) return
    if (prev === latestSeq) return
    setFlashSeq(latestSeq)
    const t = window.setTimeout(() => setFlashSeq(null), 360)
    return () => window.clearTimeout(t)
  }, [eventsNewestFirst])

  return (
    <div className="rounded-xl bg-surface-container-lowest border border-outline-variant/30 overflow-hidden shadow-sm">
      <div className="px-6 h-12 bg-surface-container-low flex items-center justify-between border-b border-outline-variant/10">
        <div className="flex items-center gap-3">
          <span className="text-[11px] font-bold text-on-surface-variant uppercase tracking-wider">Node</span>
          <span className="px-3 py-1 bg-primary-container/10 text-primary border border-primary-container/20 rounded-full text-[10px] font-bold">
            {props.nodeId}
          </span>
        </div>
        <div className="flex items-center gap-4 text-[11px] font-medium text-on-surface-variant">
          <span className="flex items-center gap-1">
            <span className="material-symbols-outlined text-[18px]">schedule</span>
            <span className="font-mono">{latency !== null ? `${Math.max(0, Math.round(latency))}ms` : props.running ? '—' : '—'}</span>
          </span>
          {latestMem ? (
            <span className="flex items-center gap-1">
              <span className="material-symbols-outlined text-[18px]">memory</span>
              <span className="font-mono">{latestMem.value}</span>
            </span>
          ) : null}
        </div>
      </div>

      <div className="overflow-hidden">
        <div className="overflow-y-auto custom-scrollbar max-h-[clamp(10rem,22vh,16rem)]">
          <table className="w-full text-left border-separate border-spacing-0">
            <thead className="sticky top-0 bg-surface-container-low z-10 shadow-sm">
              <tr>
                <th className="py-3 px-6 text-[10px] font-bold text-outline uppercase tracking-wider border-b border-outline-variant/10">
                  Timestamp
                </th>
                <th className="py-3 px-6 text-[10px] font-bold text-outline uppercase tracking-wider border-b border-outline-variant/10">
                  Action
                </th>
                <th className="py-3 px-6 text-[10px] font-bold text-outline uppercase tracking-wider border-b border-outline-variant/10">
                  Status
                </th>
                <th className="py-3 px-6 text-[10px] font-bold text-outline uppercase tracking-wider border-b border-outline-variant/10">
                  Data Fragment
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-outline-variant/5">
              {eventsNewestFirst.map((event, idx) => {
                const isLatest = idx === 0
                const status =
                  event.kind === 'node_completed'
                    ? 'Success'
                    : isLatest && props.running
                      ? 'Running'
                      : event.kind === 'error'
                        ? 'Error'
                        : 'Event'
                const flash = flashSeq !== null && flashSeq === event.seq
                const rowTone =
                  isLatest && props.running
                    ? `bg-primary/5 hover:bg-primary/10 ${flash ? 'ui-row-flash' : ''}`
                    : `hover:bg-surface-container-high/50 ${flash ? 'ui-row-flash' : ''}`

                return (
                  <tr key={event.seq} className={`transition-colors ${rowTone}`}>
                    <td className="py-2.5 px-6 font-mono text-[11px] text-on-surface-variant">
                      {formatTMs(event.tMs)}
                    </td>
                    <td className="py-2.5 px-6 text-xs font-medium">
                      {event.kind.replaceAll('_', ' ').replace(/\b\w/g, (m) => m.toUpperCase())}
                    </td>
                    <td className="py-2.5 px-6">
                      {status === 'Success' ? (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-tertiary">
                          <span className="w-1.5 h-1.5 rounded-full bg-tertiary" />
                          Success
                        </div>
                      ) : status === 'Running' ? (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-primary">
                          <span className="w-1.5 h-1.5 rounded-full bg-primary motion-safe:animate-pulse" />
                          Running
                        </div>
                      ) : status === 'Error' ? (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-error">
                          <span className="w-1.5 h-1.5 rounded-full bg-error" />
                          Error
                        </div>
                      ) : (
                        <div className="flex items-center gap-1.5 text-[10px] font-semibold text-outline">
                          <span className="w-1.5 h-1.5 rounded-full bg-outline/40" />
                          Event
                        </div>
                      )}
                    </td>
                    <td className="py-2.5 px-6">
                      <div className="bg-surface-container-highest/30 px-2 py-1 rounded text-[10px] font-mono text-outline truncate max-w-[240px]">
                        {truncateFragment(event.payload, 120)}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {latest ? (
          <div className="px-6 py-3 border-t border-outline-variant/10 bg-surface">
            <div className="flex items-center justify-between gap-3">
              <span className="text-[10px] font-bold text-outline uppercase tracking-wider">Latest</span>
              <span className="text-[10px] font-bold text-on-surface-variant uppercase tracking-wider">
                {latest.kind.replaceAll('_', ' ')}
              </span>
            </div>
            <div className="mt-1 text-[11px] text-on-surface/55 italic ui-line-clamp-2">
              {truncateFragment(latest.payload, 220)}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

export function NodeInspector(props: NodeInspectorProps) {
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const lastSelectedLatestSeqRef = useRef<number | null>(null)

  const nodeEvents = props.events.filter((event) => event.nodeId === props.selectedNodeId)
  const started = nodeEvents.find((event) => event.kind === 'node_started')
  const completed = nodeEvents.findLast((event) => event.kind === 'node_completed')
  const running = Boolean(props.selectedNodeId && started && !completed)

  const groups = groupEventsByNodeId(props.events)

  const selectedLatestSeq = useMemo(() => {
    const latest = nodeEvents.length ? [...nodeEvents].sort((a, b) => b.tMs - a.tMs)[0] : null
    return latest?.seq ?? null
  }, [nodeEvents])

  useEffect(() => {
    if (!props.selectedNodeId) {
      lastSelectedLatestSeqRef.current = null
      return
    }
    if (!scrollRef.current) return
    if (selectedLatestSeq === null) return

    const prev = lastSelectedLatestSeqRef.current
    lastSelectedLatestSeqRef.current = selectedLatestSeq
    if (prev === null) return
    if (prev === selectedLatestSeq) return

    const el = scrollRef.current
    const prefersReducedMotion = getPrefersReducedMotion()
    if (prefersReducedMotion) {
      el.scrollTop = 0
    } else {
      el.scrollTo({ top: 0, behavior: 'smooth' })
    }
  }, [props.selectedNodeId, selectedLatestSeq])

  return (
    <aside className="h-[clamp(18rem,34vh,22rem)] border-t border-outline-variant/30 bg-surface-container-low flex flex-col min-h-0">
      <div className="px-6 h-12 flex items-center justify-between border-b border-outline-variant/10 bg-surface-container-low">
        <div className="flex items-center gap-3">
          <h2 className="text-sm font-bold text-on-background font-headline">Node Inspector</h2>
          <span className="bg-primary/10 text-primary text-[10px] font-bold px-2 py-0.5 rounded-full border border-primary/20">
            {props.selectedNodeId ?? 'Select a node'}
          </span>
        </div>
        <button type="button" className="text-outline hover:text-on-surface transition-colors" aria-label="Close inspector">
          <span className="material-symbols-outlined">close</span>
        </button>
      </div>

      <div ref={scrollRef} className="flex-1 min-h-0 overflow-hidden flex">
        <div className="flex-1 min-w-0 overflow-y-auto custom-scrollbar p-4">
          {props.selectedNodeId ? (
            <NodeEventsTable nodeId={props.selectedNodeId} events={nodeEvents} running={running} />
          ) : groups.length ? (
            <div className="flex flex-col gap-4">
              {groups.map((group) => {
                const groupStarted = group.events.find((e) => e.kind === 'node_started')
                const groupCompleted = group.events.findLast((e) => e.kind === 'node_completed')
                const groupRunning = Boolean(groupStarted && !groupCompleted)
                return (
                  <NodeEventsTable key={group.nodeId} nodeId={group.nodeId} events={group.events} running={groupRunning} />
                )
              })}
            </div>
          ) : (
            <div className="text-sm text-on-surface-variant">
              Run a query to see node events, then click a node to focus it.
            </div>
          )}
        </div>
      </div>
    </aside>
  )
}
