import type { PipelineEvent } from '../../shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { forwardRef, useImperativeHandle } from 'react'
import { createPortal } from 'react-dom'

import { getNodeAccent } from './nodeAccent'

function formatDiagnoseResponseMode(mode: string): string {
  if (mode === 'comparison_table') return 'Comparison table'
  if (mode === 'numbered_list') return 'Numbered list'
  if (mode === 'details') return 'Details'
  return mode
}

const NODES = [
  { id: 'ingest', label: 'Query Input', kind: 'Input', icon: 'input' },
  { id: 'preprocess', label: 'Preprocessing', kind: 'Preprocess', icon: 'cleaning_services' },
  { id: 'embed', label: 'Vectorize', kind: 'Embedding', icon: 'schema' },
  { id: 'retrieve', label: 'Retrieval', kind: 'Search', icon: 'database' },
  { id: 'tfidf_retrieve', label: 'TF-IDF Retrieval', kind: 'TfIdf', icon: 'text_fields' },
  { id: 'rerank', label: 'Rerank', kind: 'Scoring', icon: 'sort' },
  { id: 'filter', label: 'Relevance Filter', kind: 'Filter', icon: 'filter_list' },
  { id: 'generate', label: 'Generation', kind: 'LLM', icon: 'psychology' },
  { id: 'synthesize', label: 'Evidence synthesis', kind: 'LLM', icon: 'psychology' },
  { id: 'diagnose', label: 'Formal response layer', kind: 'LLM', icon: 'medical_services' },
  { id: 'standardize', label: 'Standardized output', kind: 'Format', icon: 'rule' },
]

type PipelineGraphProps = {
  activeNodeId: string | null
  selectedNodeId: string | null
  onSelectNode: (id: string) => void
  events: PipelineEvent[]
}

export type PipelineGraphHandle = {
  zoomIn: () => void
  zoomOut: () => void
  resetView: () => void
  getScale: () => number
}

export const PipelineGraph = forwardRef<PipelineGraphHandle, PipelineGraphProps>(function PipelineGraph(props, ref) {
  const wrapperRef = useRef<HTMLDivElement | null>(null)
  const nodeRefs = useRef<Record<string, HTMLButtonElement | null>>({})
  const panDragRef = useRef<{
    active: boolean
    pointerId: number | null
    startX: number
    startY: number
    startPanX: number
    startPanY: number
  }>({ active: false, pointerId: null, startX: 0, startY: 0, startPanX: 0, startPanY: 0 })

  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [scale, setScale] = useState(1)
  const panRef = useRef(pan)
  const scaleRef = useRef(scale)
  const prefersReducedMotionRef = useRef(false)
  const followNodeIdRef = useRef<string | null>(null)
  const rafRef = useRef<number | null>(null)
  const commitRafRef = useRef<number | null>(null)
  const pendingPanRef = useRef<{ x: number; y: number } | null>(null)
  // Spring velocity for smooth camera follow
  const followVelRef = useRef({ x: 0, y: 0 })

  function cancelFollow() {
    followNodeIdRef.current = null
  }

  function schedulePanCommit(next: { x: number; y: number }) {
    pendingPanRef.current = next
    if (commitRafRef.current) return
    commitRafRef.current = window.requestAnimationFrame(() => {
      commitRafRef.current = null
      const pending = pendingPanRef.current
      if (!pending) return
      panRef.current = pending
      setPan(pending)
    })
  }

  useEffect(() => {
    panRef.current = pan
  }, [pan])

  useEffect(() => {
    scaleRef.current = scale
  }, [scale])

  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-reduced-motion: reduce)')
    const update = () => {
      prefersReducedMotionRef.current = Boolean(mq?.matches)
    }
    update()
    if (!mq) return
    mq.addEventListener('change', update)
    return () => mq.removeEventListener('change', update)
  }, [])

  const completed = useMemo(
    () => new Set(props.events.filter((event) => event.kind === 'node_completed').map((event) => event.nodeId)),
    [props.events],
  )

  type ChunkHit = { chunkId: string; score: number; text?: string }

  const [selectedChunk, setSelectedChunk] = useState<ChunkHit | null>(null)

  function extractMedicineName(hit: ChunkHit): string {
    if (hit.text) {
      const match = hit.text.match(/^##\s+([^(`\n]+)/m)
      if (match) return match[1].trim()
    }
    return hit.chunkId
  }

  function extractMedId(hit: ChunkHit): string | null {
    if (!hit.text) return null
    const match = hit.text.match(/\(`(med-\d+)`\)/)
    return match ? match[1] : null
  }

  function extractField(text: string, label: string): string | null {
    const re = new RegExp(`\\*\\*${label}[^:]*:\\*\\*\\s*(.+)`, 'i')
    const match = text.match(re)
    return match ? match[1].trim() : null
  }

  function hasMedicineHeading(hit: ChunkHit): boolean {
    return Boolean(hit.text?.match(/^##\s+[^(`\n]+/m))
  }

  const retrievedChunks = useMemo<ChunkHit[]>(() => {
    for (const e of [...props.events].reverse()) {
      if (e.nodeId === 'retrieve' && e.kind === 'node_output') {
        const list = e.payload.retrieved
        if (Array.isArray(list)) {
          return (list as ChunkHit[]).filter(hasMedicineHeading).slice(0, 5)
        }
      }
    }
    return []
  }, [props.events])

  const tfidfChunks = useMemo<ChunkHit[]>(() => {
    for (const e of [...props.events].reverse()) {
      if (e.nodeId === 'tfidf_retrieve' && e.kind === 'node_output') {
        const list = e.payload.retrieved
        if (Array.isArray(list)) {
          return (list as ChunkHit[]).filter(hasMedicineHeading).slice(0, 5)
        }
      }
    }
    return []
  }, [props.events])

  const rerankedChunks = useMemo<ChunkHit[]>(() => {
    const textByChunkId = new Map(retrievedChunks.map((h) => [h.chunkId, h.text]))
    for (const e of [...props.events].reverse()) {
      if (e.nodeId === 'rerank' && e.kind === 'node_output') {
        const list = e.payload.reranked
        if (Array.isArray(list)) {
          return (list as ChunkHit[])
            .map((h) => ({ ...h, text: h.text ?? textByChunkId.get(h.chunkId) }))
            .filter(hasMedicineHeading)
            .slice(0, 5)
        }
      }
    }
    return []
  }, [props.events, retrievedChunks])

  const filteredChunks = useMemo<ChunkHit[]>(() => {
    const textByChunkId = new Map<string, string | undefined>()
    for (const h of retrievedChunks) textByChunkId.set(h.chunkId, h.text)
    for (const h of tfidfChunks) textByChunkId.set(h.chunkId, h.text ?? textByChunkId.get(h.chunkId))
    for (const e of [...props.events].reverse()) {
      if (e.nodeId === 'filter' && e.kind === 'node_output') {
        const list = e.payload.filtered
        if (Array.isArray(list)) {
          return (list as ChunkHit[])
            .map((h) => ({ ...h, text: h.text ?? textByChunkId.get(h.chunkId) }))
            .filter(hasMedicineHeading)
            .slice(0, 5)
        }
      }
    }
    return []
  }, [props.events, retrievedChunks, tfidfChunks])

  const diagnoseResponseMode = useMemo(() => {
    for (const e of [...props.events].reverse()) {
      if (e.nodeId !== 'diagnose') continue
      const m = e.payload.responseMode
      if (typeof m === 'string' && m.length > 0) return m
    }
    return null
  }, [props.events])

  const triggered = useMemo(() => {
    const ids = new Set<string>()
    for (const e of props.events) {
      if (e.nodeId) ids.add(e.nodeId)
    }
    if (props.activeNodeId) ids.add(props.activeNodeId)
    if (props.selectedNodeId) ids.add(props.selectedNodeId)
    return ids
  }, [props.events, props.activeNodeId, props.selectedNodeId])

  const visibleNodes = useMemo(() => NODES.filter((n) => triggered.has(n.id)), [triggered])

  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1
  const snapToDevicePixel = (value: number) => Math.round(value * dpr) / dpr
  const renderPan = useMemo(() => ({ x: snapToDevicePixel(pan.x), y: snapToDevicePixel(pan.y) }), [pan.x, pan.y, dpr])
  const renderScale = useMemo(() => Math.round(scale * 1000) / 1000, [scale])

  function computeTargetPanForNode(nodeId: string) {
    const el = nodeRefs.current[nodeId]
    const wrapper = wrapperRef.current
    if (!el || !wrapper) return null

    const wRect = wrapper.getBoundingClientRect()
    const nRect = el.getBoundingClientRect()
    const dx = wRect.left + wRect.width / 2 - (nRect.left + nRect.width / 2)
    const dy = wRect.top + wRect.height / 2 - (nRect.top + nRect.height / 2)
    const base = panRef.current
    return { x: base.x + dx, y: base.y + dy }
  }

  function zoomAt(clientX: number, clientY: number, nextScale: number) {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const cx = clientX - rect.left
    const cy = clientY - rect.top

    const prevScale = scaleRef.current
    const p = panRef.current
    const worldX = (cx - p.x) / prevScale
    const worldY = (cy - p.y) / prevScale

    const nextPan = { x: cx - worldX * nextScale, y: cy - worldY * nextScale }
    panRef.current = nextPan
    setPan(nextPan)

    scaleRef.current = nextScale
    setScale(nextScale)
  }

  function zoomAroundCenter(factor: number) {
    const wrapper = wrapperRef.current
    if (!wrapper) return
    const rect = wrapper.getBoundingClientRect()
    const prevScale = scaleRef.current
    const nextScale = Math.min(1.9, Math.max(0.55, prevScale * factor))
    zoomAt(rect.left + rect.width / 2, rect.top + rect.height / 2, nextScale)
  }

  function resetView() {
    cancelFollow()
    scaleRef.current = 1
    setScale(1)
    panRef.current = { x: 0, y: 0 }
    setPan({ x: 0, y: 0 })
  }

  useImperativeHandle(
    ref,
    () => ({
      zoomIn: () => zoomAroundCenter(1.12),
      zoomOut: () => zoomAroundCenter(0.88),
      resetView,
      getScale: () => scaleRef.current,
    }),
    [],
  )

  // When a new node first appears, smoothly pan to it via the spring follow.
  // We defer one rAF so the node has been painted and its rect is valid.
  useEffect(() => {
    if (!visibleNodes.length) return
    if (props.selectedNodeId) return
    if (panDragRef.current.active) return

    const focusId = props.activeNodeId ?? visibleNodes[0]?.id
    if (!focusId) return

    const raf = window.requestAnimationFrame(() => {
      if (props.selectedNodeId) return
      if (panDragRef.current.active) return
      if (prefersReducedMotionRef.current) {
        const nextTarget = computeTargetPanForNode(focusId)
        if (nextTarget) schedulePanCommit(nextTarget)
        return
      }
      followVelRef.current = { x: 0, y: 0 }
      followNodeIdRef.current = focusId
    })
    return () => window.cancelAnimationFrame(raf)
  }, [visibleNodes.length])

  useEffect(() => {
    return () => {
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      if (commitRafRef.current) window.cancelAnimationFrame(commitRafRef.current)
      commitRafRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!props.activeNodeId) return
    if (props.selectedNodeId) return
    if (panDragRef.current.active) return

    if (prefersReducedMotionRef.current) {
      cancelFollow()
      const nextTarget = computeTargetPanForNode(props.activeNodeId)
      if (nextTarget) schedulePanCommit(nextTarget)
      return
    }

    // Reset spring velocity so the camera starts fresh for each new target node.
    followVelRef.current = { x: 0, y: 0 }
    followNodeIdRef.current = props.activeNodeId
  }, [props.activeNodeId, props.selectedNodeId])

  useEffect(() => {
    if (props.selectedNodeId) {
      cancelFollow()
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
      return
    }

    let mounted = true
    const tick = () => {
      if (!mounted) return
      const followNodeId = followNodeIdRef.current
      if (!followNodeId) {
        rafRef.current = window.requestAnimationFrame(tick)
        return
      }

      const target = computeTargetPanForNode(followNodeId)
      if (!target) {
        rafRef.current = window.requestAnimationFrame(tick)
        return
      }

      // Ease-out lerp: closes 8% of remaining distance each frame — smooth deceleration, no overshoot.
      const p = panRef.current
      const dx = target.x - p.x
      const dy = target.y - p.y
      const dist = Math.hypot(dx, dy)
      if (dist < 0.4) {
        followVelRef.current = { x: 0, y: 0 }
        cancelFollow()
        schedulePanCommit(target)
        rafRef.current = window.requestAnimationFrame(tick)
        return
      }

      const k = 0.08
      const next = { x: p.x + dx * k, y: p.y + dy * k }
      schedulePanCommit(next)
      rafRef.current = window.requestAnimationFrame(tick)
    }
    rafRef.current = window.requestAnimationFrame(tick)
    return () => {
      mounted = false
      if (rafRef.current) window.cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
  }, [props.selectedNodeId])

  function onPointerDown(e: React.PointerEvent<HTMLDivElement>) {
    if (e.button !== 0) return
    panDragRef.current.active = true
    panDragRef.current.pointerId = e.pointerId
    panDragRef.current.startX = e.clientX
    panDragRef.current.startY = e.clientY
    panDragRef.current.startPanX = panRef.current.x
    panDragRef.current.startPanY = panRef.current.y
    cancelFollow()
    e.currentTarget.setPointerCapture(e.pointerId)
  }

  function onPointerMove(e: React.PointerEvent<HTMLDivElement>) {
    if (!panDragRef.current.active) return
    if (panDragRef.current.pointerId !== e.pointerId) return
    const dx = e.clientX - panDragRef.current.startX
    const dy = e.clientY - panDragRef.current.startY
    const next = { x: panDragRef.current.startPanX + dx, y: panDragRef.current.startPanY + dy }
    schedulePanCommit(next)
  }

  function endPointer(e: React.PointerEvent<HTMLDivElement>) {
    if (panDragRef.current.pointerId !== e.pointerId) return
    panDragRef.current.active = false
    panDragRef.current.pointerId = null
  }

  function onWheel(e: React.WheelEvent<HTMLDivElement>) {
    // Wheel -> zoom. Prevent page scroll and zoom around cursor.
    e.preventDefault()
    e.stopPropagation()
    cancelFollow()

    const wrapper = wrapperRef.current
    if (!wrapper) return

    const prevScale = scaleRef.current
    const nextScale = Math.min(1.9, Math.max(0.55, prevScale * (e.deltaY > 0 ? 0.92 : 1.08)))
    if (Math.abs(nextScale - prevScale) < 0.0001) return

    zoomAt(e.clientX, e.clientY, nextScale)
  }

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="p-6 pb-2">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-on-surface flex items-center gap-2 font-headline">
            <span className="material-symbols-outlined text-primary">hub</span>
            Pipeline Visualizer
          </h2>
          <div />
        </div>
      </div>

      <div
        ref={wrapperRef}
        className="flex-1 canvas-wrapper"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endPointer}
        onPointerCancel={endPointer}
        onPointerLeave={endPointer}
        onWheel={onWheel}
      >
        <div
          className="flow-stage"
          style={{
            transform: `translate(${renderPan.x}px, ${renderPan.y}px) scale(${renderScale})`,
          }}
        >
          <div className="flow-container">
            {visibleNodes.map((node, idx) => {
            const done = completed.has(node.id)
            const active = props.activeNodeId === node.id
            const selected = props.selectedNodeId === node.id
            const pending = !done && !active

            const baseNodeClasses =
              'w-64 rounded-xl p-4 cursor-pointer relative flex-shrink-0 outline-none will-change-transform motion-safe:transition-[transform,opacity,filter,background-color,border-color,box-shadow] motion-safe:duration-200 motion-safe:ease-out motion-reduce:transition-none active:scale-[0.99]'

            const statusClasses = active
              ? 'bg-surface-container-lowest shadow-[0_4px_12px_rgba(5,26,62,0.04),0_12px_24px_rgba(5,26,62,0.06)] motion-safe:scale-[1.03] z-10 border border-primary-container ring-2 ring-primary-fixed/50'
              : done
                ? 'bg-surface-container-low opacity-95 border border-outline-variant/20'
                : 'bg-surface-container-lowest/60 border border-outline-variant/10 grayscale opacity-60 hover:bg-surface-container-lowest hover:border-outline-variant/20 hover:grayscale-0 hover:opacity-100'

            const selectedClasses = selected
              ? active
                ? 'ring-offset-0 shadow-[0_0_0_1px_rgba(20,184,166,0.10),0_0_18px_rgba(20,184,166,0.14)]'
                : 'z-10 ring-2 ring-tertiary/70 shadow-[0_0_0_1px_rgba(20,184,166,0.18),0_0_22px_rgba(20,184,166,0.22)]'
              : ''

            const nodeClasses = `pipeline-node ${baseNodeClasses} ${statusClasses} ${selectedClasses}`
            const accent = getNodeAccent(node.kind, node.id)

            return (
              <div key={node.id} className="flex items-center pipeline-node-wrap">
                <button
                  ref={(el) => {
                    nodeRefs.current[node.id] = el
                  }}
                  type="button"
                  className={nodeClasses}
                  style={
                    {
                      '--pipeline-node-accent': accent.accent,
                    } as React.CSSProperties
                  }
                  data-kind={node.kind}
                  data-active={active ? 'true' : 'false'}
                  data-selected={selected ? 'true' : 'false'}
                  onPointerDown={(e) => {
                    // Clicking a node should not start canvas pan.
                    e.stopPropagation()
                  }}
                  onClick={() => props.onSelectNode(node.id)}
                >
                  {selected ? (
                    <div className="absolute -top-2 -left-2 bg-surface-container-highest/90 text-tertiary border border-tertiary/30 text-[8px] font-bold px-2 py-0.5 rounded-full shadow-lg uppercase tracking-widest">
                      Selected
                    </div>
                  ) : null}
                  {active ? (
                    <div className="absolute -top-2 -right-2 bg-primary text-on-primary text-[8px] font-bold px-2 py-0.5 rounded-full shadow-lg uppercase tracking-widest motion-safe:animate-pulse">
                      Running
                    </div>
                  ) : null}

                  <div className="flex justify-between items-center mb-1">
                    <span
                      className={
                        done
                          ? 'text-[10px] font-bold text-tertiary uppercase tracking-wider'
                          : active
                            ? 'text-[10px] font-bold text-primary uppercase tracking-wider'
                            : 'text-[10px] font-bold text-outline uppercase tracking-wider'
                      }
                    >
                      {node.kind}
                    </span>
                    {done ? (
                      <span
                        className="material-symbols-outlined text-tertiary text-sm motion-safe:transition-transform motion-safe:duration-200 motion-safe:ease-out motion-safe:scale-100"
                        style={{ fontVariationSettings: "'FILL' 1, 'wght' 400, 'GRAD' 0, 'opsz' 24" }}
                      >
                        check_circle
                      </span>
                    ) : active ? (
                      <div className="flex h-2 w-2 relative">
                        <span className="motion-safe:animate-ping absolute inline-flex h-full w-full rounded-full bg-primary opacity-75" />
                        <span className="relative inline-flex rounded-full h-2 w-2 bg-primary" />
                      </div>
                    ) : null}
                  </div>

                  <div className="flex items-center gap-3 mb-3">
                    <div
                      className={
                        done
                          ? 'p-2 bg-surface-container-lowest rounded-lg border border-outline-variant/10'
                          : active
                            ? 'p-2 bg-primary-container/10 rounded-lg border border-primary-container/30'
                            : 'p-2 bg-surface-container-lowest rounded-lg border border-outline-variant/10'
                      }
                    >
                      <span
                        className={
                          done
                            ? 'material-symbols-outlined text-tertiary text-xl'
                            : pending
                              ? 'material-symbols-outlined text-secondary text-xl'
                              : 'material-symbols-outlined text-primary text-xl'
                        }
                      >
                        {node.icon}
                      </span>
                    </div>
                    <div>
                      <h4 className="text-xs font-bold text-on-surface">{node.label}</h4>
                      <p
                        className={
                          active
                            ? 'text-[10px] text-primary font-medium'
                            : 'text-[10px] text-on-surface-variant'
                        }
                      >
                        {node.id === 'diagnose' && diagnoseResponseMode
                          ? active
                            ? formatDiagnoseResponseMode(diagnoseResponseMode)
                            : pending
                              ? 'Waiting...'
                              : `Completed · ${formatDiagnoseResponseMode(diagnoseResponseMode)}`
                          : active
                            ? node.id
                            : pending
                              ? 'Waiting...'
                              : 'Completed'}
                      </p>
                    </div>
                  </div>

                  {active ? (
                    <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
                      <div className="bg-primary h-full w-[65%] shadow-[0_0_8px_rgba(0,82,204,0.4)]" />
                    </div>
                  ) : null}

                  {node.id === 'retrieve' && retrievedChunks.length > 0 ? (
                    <div className="chunk-list-wrap mt-2.5">
                      <div className="chunk-list-inner flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-on-surface/50 uppercase tracking-widest mb-0.5">
                          Top {retrievedChunks.length} matches
                        </span>
                        {retrievedChunks.map((hit, i) => (
                          <button
                            key={hit.chunkId}
                            type="button"
                            className="chunk-row flex items-center justify-between gap-2 bg-primary/[0.07] border border-primary/20 rounded-lg px-2.5 py-1 w-full text-left hover:bg-primary/[0.13] hover:border-primary/35 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                            style={{ animationDelay: `${80 + i * 70}ms` }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setSelectedChunk(hit) }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[9px] font-bold text-primary/60 tabular-nums w-3 shrink-0">
                                {i + 1}.
                              </span>
                              <span className="text-[10px] font-semibold text-on-surface truncate">
                                {extractMedicineName(hit)}
                              </span>
                            </div>
                            <span className="text-[9px] font-mono tabular-nums text-tertiary shrink-0 bg-tertiary/10 border border-tertiary/20 px-1.5 py-0.5 rounded-md">
                              {hit.score.toFixed(3)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {node.id === 'tfidf_retrieve' && tfidfChunks.length > 0 ? (
                    <div className="chunk-list-wrap mt-2.5">
                      <div className="chunk-list-inner flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-on-surface/50 uppercase tracking-widest mb-0.5">
                          TF-IDF top {tfidfChunks.length}
                        </span>
                        {tfidfChunks.map((hit, i) => (
                          <button
                            key={hit.chunkId}
                            type="button"
                            className="chunk-row flex items-center justify-between gap-2 bg-primary/[0.07] border border-primary/20 rounded-lg px-2.5 py-1 w-full text-left hover:bg-primary/[0.13] hover:border-primary/35 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-primary/50"
                            style={{ animationDelay: `${80 + i * 70}ms` }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setSelectedChunk(hit) }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[9px] font-bold text-primary/60 tabular-nums w-3 shrink-0">
                                {i + 1}.
                              </span>
                              <span className="text-[10px] font-semibold text-on-surface truncate">
                                {extractMedicineName(hit)}
                              </span>
                            </div>
                            <span className="text-[9px] font-mono tabular-nums text-tertiary shrink-0 bg-tertiary/10 border border-tertiary/20 px-1.5 py-0.5 rounded-md">
                              {hit.score.toFixed(3)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {node.id === 'rerank' && rerankedChunks.length > 0 ? (
                    <div className="chunk-list-wrap mt-2.5">
                      <div className="chunk-list-inner flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-on-surface/50 uppercase tracking-widest mb-0.5">
                          Reranked top {rerankedChunks.length}
                        </span>
                        {rerankedChunks.map((hit, i) => (
                          <button
                            key={hit.chunkId}
                            type="button"
                            className="chunk-row flex items-center justify-between gap-2 bg-secondary/[0.07] border border-secondary/20 rounded-lg px-2.5 py-1 w-full text-left hover:bg-secondary/[0.13] hover:border-secondary/35 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-secondary/50"
                            style={{ animationDelay: `${80 + i * 70}ms` }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setSelectedChunk(hit) }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[9px] font-bold text-secondary/60 tabular-nums w-3 shrink-0">
                                {i + 1}.
                              </span>
                              <span className="text-[10px] font-semibold text-on-surface truncate">
                                {extractMedicineName(hit)}
                              </span>
                            </div>
                            <span className="text-[9px] font-mono tabular-nums text-tertiary shrink-0 bg-tertiary/10 border border-tertiary/20 px-1.5 py-0.5 rounded-md">
                              {hit.score.toFixed(3)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}

                  {node.id === 'filter' && filteredChunks.length > 0 ? (
                    <div className="chunk-list-wrap mt-2.5">
                      <div className="chunk-list-inner flex flex-col gap-1">
                        <span className="text-[9px] font-bold text-on-surface/50 uppercase tracking-widest mb-0.5">
                          Kept after filter {filteredChunks.length}
                        </span>
                        {filteredChunks.map((hit, i) => (
                          <button
                            key={hit.chunkId}
                            type="button"
                            className="chunk-row flex items-center justify-between gap-2 bg-tertiary/[0.08] border border-tertiary/25 rounded-lg px-2.5 py-1 w-full text-left hover:bg-tertiary/[0.14] hover:border-tertiary/40 transition-colors cursor-pointer outline-none focus-visible:ring-1 focus-visible:ring-tertiary/50"
                            style={{ animationDelay: `${80 + i * 70}ms` }}
                            onPointerDown={(e) => e.stopPropagation()}
                            onClick={(e) => { e.stopPropagation(); setSelectedChunk(hit) }}
                          >
                            <div className="flex items-center gap-1.5 min-w-0">
                              <span className="text-[9px] font-bold text-tertiary/70 tabular-nums w-3 shrink-0">
                                {i + 1}.
                              </span>
                              <span className="text-[10px] font-semibold text-on-surface truncate">
                                {extractMedicineName(hit)}
                              </span>
                            </div>
                            <span className="text-[9px] font-mono tabular-nums text-tertiary shrink-0 bg-tertiary/10 border border-tertiary/20 px-1.5 py-0.5 rounded-md">
                              {hit.score.toFixed(3)}
                            </span>
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : null}
                </button>

                {idx < visibleNodes.length - 1 ? (
                  (() => {
                    const next = visibleNodes[idx + 1]
                    const nextDone = completed.has(next.id)
                    const nextActive = props.activeNodeId === next.id

                    const edgeClass = nextDone ? 'flow-line completed' : nextActive ? 'flow-line active' : 'flow-line'
                    return (
                      <div className={edgeClass} aria-hidden="true">
                        {nextActive ? <div className="data-particle" /> : null}
                        <div className="flow-arrow" />
                      </div>
                    )
                  })()
                ) : null}
              </div>
            )
          })}
          </div>
        </div>
      </div>

      {selectedChunk ? createPortal(
        <div
          className="fixed inset-0 z-50 flex items-center justify-center p-4"
          style={{ backgroundColor: 'rgba(5,26,62,0.55)', backdropFilter: 'blur(4px)' }}
          onClick={() => setSelectedChunk(null)}
        >
          <div
            className="relative bg-surface rounded-2xl shadow-2xl w-full max-w-md max-h-[80vh] flex flex-col overflow-hidden border border-outline-variant/30"
            style={{ animation: 'pipelineNodeEnter 260ms cubic-bezier(0.16,1,0.3,1) both' }}
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="px-5 pt-5 pb-4 border-b border-outline-variant/20 bg-gradient-to-br from-primary-fixed/30 via-surface to-surface shrink-0">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <h3 className="text-base font-bold text-on-surface leading-tight">
                    {extractMedicineName(selectedChunk)}
                  </h3>
                  <div className="flex items-center gap-2 mt-1.5 flex-wrap">
                    {extractMedId(selectedChunk) ? (
                      <span className="font-mono text-[11px] font-semibold bg-primary/10 text-primary border border-primary/20 px-2 py-0.5 rounded-full">
                        {extractMedId(selectedChunk)}
                      </span>
                    ) : null}
                    <span className="font-mono text-[11px] text-tertiary bg-tertiary/10 border border-tertiary/20 px-2 py-0.5 rounded-full">
                      score {selectedChunk.score.toFixed(4)}
                    </span>
                    <span className="text-[11px] text-on-surface-variant bg-surface-container-high px-2 py-0.5 rounded-full border border-outline-variant/20">
                      {selectedChunk.chunkId}
                    </span>
                  </div>
                </div>
                <button
                  type="button"
                  className="shrink-0 p-1.5 rounded-lg hover:bg-surface-container-high transition-colors text-on-surface-variant hover:text-on-surface"
                  onClick={() => setSelectedChunk(null)}
                  aria-label="Close"
                >
                  <span className="material-symbols-outlined text-[20px]">close</span>
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="overflow-y-auto custom-scrollbar flex-1 p-5 space-y-4">
              {selectedChunk.text ? (() => {
                const t = selectedChunk.text
                const drugClass  = extractField(t, 'Drug class')
                const symptoms   = extractField(t, 'Symptoms')
                const mechanism  = extractField(t, 'Mechanism')
                const cautions   = extractField(t, 'Cautions')
                const doseNote   = extractField(t, 'Dose note')

                const Field = ({ icon, label, value }: { icon: string; label: string; value: string }) => (
                  <div className="flex gap-3">
                    <span className="material-symbols-outlined text-primary/60 text-[18px] mt-0.5 shrink-0">{icon}</span>
                    <div className="min-w-0">
                      <p className="text-[10px] font-bold text-on-surface/50 uppercase tracking-wider mb-0.5">{label}</p>
                      <p className="text-sm text-on-surface leading-snug">{value}</p>
                    </div>
                  </div>
                )

                return (
                  <>
                    {drugClass  && <Field icon="category"         label="Drug class"  value={drugClass} />}
                    {symptoms   && <Field icon="symptoms"         label="Indications" value={symptoms} />}
                    {mechanism  && <Field icon="biotech"          label="Mechanism"   value={mechanism} />}
                    {cautions   && <Field icon="warning"          label="Cautions"    value={cautions} />}
                    {doseNote   && <Field icon="medication"       label="Dose note"   value={doseNote} />}
                  </>
                )
              })() : (
                <p className="text-sm text-on-surface-variant italic">No detail available for this chunk.</p>
              )}

              {/* Raw chunk text */}
              <details className="group mt-2">
                <summary className="flex items-center gap-2 cursor-pointer text-[11px] font-semibold text-on-surface-variant uppercase tracking-wider list-none hover:text-on-surface transition-colors">
                  <span className="material-symbols-outlined text-[16px] group-open:rotate-90 transition-transform">chevron_right</span>
                  Raw chunk text
                </summary>
                <pre className="mt-2 p-3 bg-surface-container-high rounded-xl text-[10px] font-mono text-on-surface/75 whitespace-pre-wrap leading-relaxed overflow-x-auto border border-outline-variant/20 max-h-48 overflow-y-auto custom-scrollbar">
                  {selectedChunk.text ?? '(no text)'}
                </pre>
              </details>
            </div>
          </div>
        </div>,
        document.body,
      ) : null}
    </div>
  )
})
