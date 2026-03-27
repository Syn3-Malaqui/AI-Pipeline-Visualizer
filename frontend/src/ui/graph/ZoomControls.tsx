import type { PipelineGraphHandle } from './PipelineGraph'

type ZoomControlsProps = {
  graphRef: React.RefObject<PipelineGraphHandle | null>
}

export function ZoomControls(props: ZoomControlsProps) {
  return (
    <div className="flex items-center gap-2 bg-surface-container-lowest/80 backdrop-blur-md border border-outline-variant/20 p-1.5 rounded-full shadow-lg">
      <button
        type="button"
        onClick={() => props.graphRef.current?.zoomOut()}
        className="w-9 h-9 rounded-full flex items-center justify-center hover:bg-surface-container-low text-on-surface-variant transition-colors"
        aria-label="Zoom out"
      >
        <span className="material-symbols-outlined">remove</span>
      </button>
      <button
        type="button"
        onClick={() => props.graphRef.current?.resetView()}
        className="px-3 h-9 rounded-full flex items-center justify-center hover:bg-surface-container-low text-on-surface-variant transition-colors text-[11px] font-bold"
        aria-label="Reset view"
      >
        Reset
      </button>
      <button
        type="button"
        onClick={() => props.graphRef.current?.zoomIn()}
        className="w-9 h-9 rounded-full flex items-center justify-center bg-primary text-on-primary shadow-sm active:scale-[0.98] transition-transform"
        aria-label="Zoom in"
      >
        <span className="material-symbols-outlined">add</span>
      </button>
    </div>
  )
}

