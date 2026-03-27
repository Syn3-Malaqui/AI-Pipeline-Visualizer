import { useEffect, useRef, useState } from 'react'

import { useRunController } from '../../usecases/useRunController'
import { useScenarioController } from '../../usecases/useScenarioController'
import { ChatPanel } from '../chat/ChatPanel'
import { PipelineGraph } from '../graph/PipelineGraph'
import { NodeInspector } from '../inspector/NodeInspector'
import type { PipelineGraphHandle } from '../graph/PipelineGraph'
import { ZoomControls } from '../graph/ZoomControls'

export function WorkspaceSplit() {
  const scenario = useScenarioController()
  const run = useRunController()
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null)
  const hasRun = run.visibleEvents.length > 0 || run.isRunning || Boolean(run.error) || Boolean(run.finalAnswer)
  const [graphRevealState, setGraphRevealState] = useState<'out' | 'in'>('out')
  const graphRef = useRef<PipelineGraphHandle | null>(null)

  useEffect(() => {
    if (!hasRun) {
      setGraphRevealState('out')
      return
    }
    // Next frame: ensure mount paint happens before we transition in.
    const raf = window.requestAnimationFrame(() => setGraphRevealState('in'))
    return () => window.cancelAnimationFrame(raf)
  }, [hasRun])

  return (
    <main className="bg-background text-on-surface antialiased h-dvh overflow-hidden font-body">
      <div className="mx-auto w-full max-w-[1600px] px-4 md:px-6 py-4 md:py-6 h-full">
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-4 md:gap-6 h-full min-h-0">
          <section className="lg:col-span-5 bg-surface/80 backdrop-blur-md rounded-xl overflow-hidden border border-outline-variant/30 shadow-sm flex flex-col min-h-0">
            <div className="p-5 md:p-6 flex-1 min-h-0 overflow-y-auto">
              <ChatPanel
                scenarios={scenario.scenarios}
                selectedScenarioId={scenario.selectedScenarioId}
                onSelectScenario={scenario.setSelectedScenarioId}
                onSendQuery={(query) => run.startRun(scenario.selectedScenarioId, query)}
                finalAnswer={run.finalAnswer}
                events={run.visibleEvents}
                isRunning={run.isRunning}
                error={scenario.error ?? run.error}
              />
            </div>
          </section>
          <section className="lg:col-span-7 bg-surface rounded-xl flex flex-col relative overflow-hidden border border-outline-variant/30 shadow-sm min-h-0">
            <div className="flex-1 flex flex-col overflow-hidden">
              {hasRun ? (
                <div className="ui-reveal h-full flex flex-col min-h-0" data-state={graphRevealState}>
                  <div className="absolute top-4 right-4 z-20">
                    <ZoomControls graphRef={graphRef} />
                  </div>
                  <div className="flex-1 min-h-0 flex flex-col">
                    <PipelineGraph
                      ref={graphRef}
                      activeNodeId={run.activeNodeId}
                      selectedNodeId={selectedNodeId}
                      onSelectNode={(id) => setSelectedNodeId((prev) => (prev === id ? null : id))}
                      events={run.visibleEvents}
                    />
                  </div>
                </div>
              ) : (
                <div className="h-full w-full flex items-center justify-center p-10">
                  <div className="max-w-md w-full rounded-xl bg-surface-container-lowest border border-outline-variant/30 p-6 shadow-sm">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl bg-primary-container/10 border border-primary-container/20 flex items-center justify-center">
                        <span className="material-symbols-outlined text-primary">hub</span>
                      </div>
                      <div>
                        <div className="text-sm font-bold text-on-surface font-headline">Pipeline Visualizer</div>
                        <div className="text-xs text-on-surface-variant">
                          Run a query to watch the pipeline assemble and process in real time.
                        </div>
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>
            {hasRun ? <NodeInspector selectedNodeId={selectedNodeId} events={run.visibleEvents} /> : null}
          </section>
        </div>
      </div>
    </main>
  )
}
