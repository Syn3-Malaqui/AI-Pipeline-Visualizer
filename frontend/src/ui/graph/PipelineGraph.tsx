import type { PipelineEvent } from '../../shared/types'
import { useEffect, useMemo, useRef, useState } from 'react'
import type React from 'react'
import { forwardRef, useImperativeHandle } from 'react'

import { getNodeAccent } from './nodeAccent'

const NODES = [
  { id: 'ingest', label: 'Query Input', kind: 'Input', icon: 'input' },
  { id: 'preprocess', label: 'Preprocessing', kind: 'Preprocess', icon: 'cleaning_services' },
  { id: 'embed', label: 'Vectorize', kind: 'Embedding', icon: 'schema' },
  { id: 'retrieve', label: 'Retrieval', kind: 'Search', icon: 'database' },
  { id: 'rerank', label: 'Rerank', kind: 'Scoring', icon: 'sort' },
  { id: 'generate', label: 'Generation', kind: 'LLM', icon: 'psychology' },
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

  // When nodes first appear, center the view.
  useEffect(() => {
    if (!visibleNodes.length) return
    if (props.selectedNodeId) return
    if (panDragRef.current.active) return

    const focusId = props.activeNodeId ?? visibleNodes[0]?.id
    if (!focusId) return
    const nextTarget = computeTargetPanForNode(focusId)
    if (!nextTarget) return
    panRef.current = nextTarget
    setPan(nextTarget)
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

      // Smooth follow: critically damped-ish easing. Reads/writes through refs to avoid stale state jitter.
      const p = panRef.current
      const dx = target.x - p.x
      const dy = target.y - p.y
      const dist = Math.hypot(dx, dy)
      if (dist < 0.5) {
        cancelFollow()
        schedulePanCommit(target)
        rafRef.current = window.requestAnimationFrame(tick)
        return
      }

      const k = 0.13
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
              <div key={node.id} className="flex items-center">
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
                        {active ? node.id : pending ? 'Waiting...' : 'Completed'}
                      </p>
                    </div>
                  </div>

                  {active ? (
                    <div className="w-full bg-surface-container-high h-1.5 rounded-full overflow-hidden">
                      <div className="bg-primary h-full w-[65%] shadow-[0_0_8px_rgba(0,82,204,0.4)]" />
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
    </div>
  )
})
